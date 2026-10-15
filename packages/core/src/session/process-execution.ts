import { SessionExecutionPolicy } from "./execution-policy"
export * as SessionProcessExecution from "./process-execution"

import { Cause, Clock, Context, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Scope } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { SessionProcess } from "@apexo/schema/session-process"
import { BackgroundJob } from "../background-job"
import { CommandSandbox } from "../command-sandbox"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { AppProcess } from "../process"
import { SessionGoalUsage } from "./goal-usage"
import { SessionGoal } from "./goal"
import { SessionLifecycle } from "./lifecycle"
import { SessionManagedChild } from "./managed-child"
import { SessionMessage } from "./message"
import { SessionProcessCompletion } from "./process-completion"
import { SessionProcessControl } from "./process-control"
import { SessionProcessMonitor } from "./process-monitor"
import { SessionProcessOutput } from "./process-output"
import { SessionProcessStore } from "./process-store"
import { SessionRunner } from "./runner"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"

const make = Effect.gen(function* () {
  const processes = yield* SessionProcessStore.Service
  const control = yield* SessionProcessControl.Service
  const completions = yield* SessionProcessCompletion.Service
  const lifecycle = yield* SessionLifecycle.Service
  const sessions = yield* SessionStore.Service
  const managed = yield* SessionManagedChild.Service
  const goals = yield* SessionGoal.Service
  const jobs = yield* BackgroundJob.Service
  const sandbox = yield* CommandSandbox.Service
  const appProcess = yield* AppProcess.Service
  const location = yield* Location.Service
  const ownerships = new Map<Scope.Closeable, SessionProcess.ID>()
  const lifetime = { closed: false }
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      lifetime.closed = true
      for (const [scope, id] of ownerships) {
        yield* jobs.cancel(id)
        yield* Scope.close(scope, Exit.void)
      }
      ownerships.clear()
    }),
  )
  return {
    // Implicit host wait defaults must not require a detached lifetime in a
    // foreground-only context. Execute still checks authority again at admission.
    canPromote: (sessionID: SessionSchema.ID) =>
      Effect.gen(function* () {
        if (yield* SessionExecutionPolicy.forSession(sessionID)) return false
        if (yield* SessionGoalUsage.Current) return false
        if (yield* managed.managed(sessionID)) return false
        return (yield* goals.get(sessionID))?.status !== "active"
      }),
    execute: (input: {
      sessionID: SessionSchema.ID
      messageID: SessionMessage.ID
      callID: string
      request: SessionProcessStore.Request
      checkpoint: SessionProcessCompletion.Checkpoint
    }) =>
      lifecycle.run(
        input.sessionID,
        Effect.scoped(
          Effect.gen(function* () {
            if (yield* SessionExecutionPolicy.forSession(input.sessionID))
              return yield* new SessionProcessStore.Failure({
                code: "invalid",
                message: "Detached process execution is unavailable to headless inputs",
              })
            if (
              lifetime.closed ||
              !lifecycle.available(input.checkpoint.claim) ||
              input.checkpoint.claim.sessionID !== input.sessionID
            )
              return yield* new SessionProcessStore.Failure({
                code: "stale",
                message: "Shell execution owner is unavailable",
              })
            if (
              (yield* SessionGoalUsage.Current) ||
              (yield* managed.managed(input.sessionID)) ||
              (yield* goals.get(input.sessionID))?.status === "active"
            )
              return yield* new SessionProcessStore.Failure({
                code: "invalid",
                message: "Background shell is unavailable to managed children and active Goals",
              })
            const session = yield* sessions.get(input.sessionID)
            if (
              !session ||
              session.location.directory !== location.directory ||
              session.location.workspaceID !== location.workspaceID
            )
              return yield* new SessionProcessStore.Failure({
                code: "missing",
                message: "Shell Session is unavailable in this Location",
              })
            const children = yield* SessionRunner.CurrentChildren
            const notify = children?.notify
            if (!notify)
              return yield* new SessionProcessStore.Failure({
                code: "invalid",
                message: "Background shell requires native Session execution ownership",
              })
            return yield* Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const admitted = yield* lifecycle.use(input.sessionID, processes.begin(input))
                if (!admitted.created) return yield* control.output(input.sessionID, admitted.record.id)
                const record = admitted.record
                const work = yield* Scope.make()
                const ownership = { transferred: false }
                ownerships.set(work, record.id)
                yield* Effect.addFinalizer(() =>
                  ownership.transferred
                    ? Effect.void
                    : jobs
                        .cancel(record.id)
                        .pipe(
                          Effect.andThen(Scope.close(work, Exit.void)),
                          Effect.ensuring(Effect.sync(() => ownerships.delete(work))),
                        ),
                )
                const settlement = yield* control.settlement(record).pipe(Effect.provideService(Scope.Scope, work))
                yield* Scope.addFinalizer(
                  work,
                  processes
                    .finish(input.sessionID, record.id, {
                      status: "cancelled",
                      output: "",
                      truncated: false,
                    })
                    .pipe(Effect.ignore, Effect.ensuring(settlement.finish)),
                )
                const ticket = yield* completions.issue(record, input.checkpoint, notify(input.sessionID))
                const ready = Deferred.makeUnsafe<void>()
                const capture = SessionProcessOutput.make(SessionProcessStore.MAX_OUTPUT_BYTES)
                const preview = { revision: 0, persisted: 0, signal: Deferred.makeUnsafe<void>() }
                const monitor = input.request.monitor ? SessionProcessMonitor.make() : undefined
                const monitorState = {
                  epoch: completions.monitorEpoch(ticket),
                  reported: "",
                  dropped: 0,
                  admitted: false,
                }
                const overload = Deferred.makeUnsafe<void, SessionProcessStore.Failure>()
                const syncEpoch = () => {
                  const epoch = completions.monitorEpoch(ticket)
                  if (monitorState.epoch === epoch) return
                  monitorState.epoch = epoch
                  monitor?.clear()
                }
                const flush = (wake = true) =>
                  Effect.gen(function* () {
                    if (preview.revision !== preview.persisted) {
                      const revision = preview.revision
                      const current = capture.read()
                      yield* processes.snapshot(input.sessionID, record.id, current.output, current.truncated)
                      preview.persisted = revision
                    }
                    if (!monitor || !monitorState.admitted) return
                    syncEpoch()
                    const text = monitor.flush(yield* Clock.currentTimeMillis)
                    const current = monitor.read()
                    if (text) monitorState.dropped = yield* completions.event(ticket, text, wake && !current.overloaded)
                    const stats = { ...current, suppressed: current.suppressed + monitorState.dropped }
                    const key = JSON.stringify(stats)
                    if (key !== monitorState.reported) {
                      yield* processes.monitor(input.sessionID, record.id, stats)
                      monitorState.reported = key
                    }
                    if (current.overloaded) yield* Deferred.succeed(overload, undefined)
                  })
                const run = Effect.gen(function* () {
                  yield* Deferred.await(ready)
                  const confined = yield* sandbox.prepare(input.sessionID, {
                    shell: input.request.shell,
                    command: input.request.command,
                    cwd: input.request.cwd,
                  })
                  const command =
                    confined?.command ??
                    ChildProcess.make(input.request.command, [], {
                      cwd: input.request.cwd,
                      shell: input.request.shell,
                      stdin: "ignore",
                      detached: process.platform !== "win32",
                      forceKillAfter: Duration.seconds(3),
                    })
                  // A coalesced dirty signal gives quiet processes a trailing write without polling storage.
                  const ticker = yield* Effect.forever(
                    Effect.gen(function* () {
                      yield* Deferred.await(preview.signal)
                      preview.signal = Deferred.makeUnsafe<void>()
                      yield* Effect.sleep(SessionProcessMonitor.DEBOUNCE_MS)
                      yield* flush()
                    }),
                  ).pipe(
                    Effect.catch((error) => Deferred.fail(overload, error)),
                    Effect.forkIn(work),
                  )
                  const execution = appProcess.run(command, {
                    combineOutput: !confined && !monitor,
                    ...(input.request.monitor && (input.request.monitor.persistent || input.request.timeoutMs === 0)
                      ? {}
                      : { timeout: Duration.millis(input.request.timeoutMs) }),
                    maxOutputBytes: SessionProcessStore.MAX_OUTPUT_BYTES + (confined ? 128 : 0),
                    ...(confined || monitor ? { maxErrorBytes: SessionProcessStore.MAX_OUTPUT_BYTES } : {}),
                    onStart: () => settlement.started.pipe(Effect.orDie),
                    onOutput: (chunk) =>
                      Effect.gen(function* () {
                        const data = confined ? confined.preview(chunk) : chunk.data
                        if (!data) return
                        syncEpoch()
                        monitor?.push({ channel: chunk.channel, data })
                        const changed = capture.push({ channel: chunk.channel, data })
                        if (changed) preview.revision++
                        // Monitor events continue after the retained output reaches its byte bound.
                        if (changed || monitor) yield* Deferred.succeed(preview.signal, undefined)
                      }),
                  })
                  const result = yield* Effect.raceFirst(
                    execution,
                    Deferred.await(overload).pipe(
                      Effect.andThen(
                        Effect.fail(
                          new SessionProcessStore.Failure({
                            code: "invalid",
                            message: "Monitor stopped after sustained output overload",
                          }),
                        ),
                      ),
                    ),
                  ).pipe(Effect.ensuring(Fiber.interrupt(ticker)))
                  if (confined) yield* confined.settle(result)
                  monitor?.finish()
                  yield* flush(false)
                  capture.finish()
                  const current = capture.read()
                  yield* processes.finish(input.sessionID, record.id, {
                    status: result.exitCode === 0 && !monitor?.read().overloaded ? "completed" : "failed",
                    exitCode: result.exitCode,
                    ...current,
                  })
                  return current.output
                }).pipe(
                  Effect.provideService(Scope.Scope, work),
                  Effect.onExit((exit) =>
                    Exit.isSuccess(exit)
                      ? Effect.void
                      : Effect.gen(function* () {
                          capture.finish()
                          yield* processes
                            .finish(input.sessionID, record.id, {
                              status: Cause.hasInterrupts(exit.cause) ? "cancelled" : "failed",
                              ...capture.read(),
                            })
                            .pipe(Effect.ignore)
                        }),
                  ),
                  Effect.ensuring(settlement.finish),
                  Effect.ensuring(
                    Scope.close(work, Exit.void).pipe(Effect.ensuring(Effect.sync(() => ownerships.delete(work)))),
                  ),
                  Effect.onExit(() => completions.ready(ticket)),
                )
                yield* lifecycle.owned(
                  input.checkpoint.claim,
                  jobs.start({
                    id: record.id,
                    type: input.request.monitor ? "monitor" : "shell",
                    title: input.request.description,
                    metadata: { ownerSessionId: input.sessionID },
                    run,
                  }),
                )
                yield* Deferred.succeed(ready, undefined)
                yield* restore(settlement.waitStarted).pipe(Effect.onInterrupt(() => jobs.cancel(record.id)))
                const done =
                  input.request.waitMs === 0
                    ? Option.none()
                    : yield* restore(settlement.wait.pipe(Effect.timeoutOption(input.request.waitMs))).pipe(
                        Effect.onInterrupt(() => jobs.cancel(record.id)),
                      )
                if (Option.isNone(done)) {
                  const promoted = yield* processes.promote(input.sessionID, record.id)
                  if (promoted.status === "running") {
                    ownership.transferred = true
                    monitorState.admitted = true
                    if (monitor) yield* Deferred.succeed(preview.signal, undefined)
                  }
                  // The process can settle between timeout and promotion. Only running promotion transfers ownership.
                  if (promoted.status !== "running") yield* completions.observed(input.sessionID, record.id)
                } else yield* completions.observed(input.sessionID, record.id)
                return yield* control.output(input.sessionID, record.id)
              }),
            )
          }),
        ),
      ),
  }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "@apexo/SessionProcessExecution",
) {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    SessionProcessStore.node,
    SessionProcessControl.node,
    SessionProcessCompletion.node,
    SessionLifecycle.node,
    SessionStore.node,
    SessionManagedChild.node,
    SessionGoal.node,
    BackgroundJob.node,
    CommandSandbox.node,
    AppProcess.node,
    Location.node,
  ],
})

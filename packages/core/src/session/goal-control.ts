import { SessionManagedChild } from "./managed-child"
import { SessionLifecycle } from "./lifecycle"
export * as SessionGoalControl from "./goal-control"

import { Context, Effect, FiberSet, Layer, Semaphore } from "effect"
import { Goal } from "@apexo/schema/goal"
import { makeGlobalNode } from "../effect/app-node"
import { Global } from "../global"
import { AppProcess } from "../process"
import { SessionV2 } from "../session"
import { SessionExecution } from "./execution"
import { SessionGoal } from "./goal"
import { SessionGoalCleanup } from "./goal-cleanup"
import { SessionGoalChanges } from "./goal-changes"
import { SessionGoalReports } from "./goal-reports"
import { SessionSchema } from "./schema"
import { SessionMessage } from "./message"

const make = Effect.gen(function* () {
  const lifecycle = yield* SessionLifecycle.Service
  const tasks = yield* SessionManagedChild.Service
  const goals = yield* SessionGoal.Service
  const cleanup = yield* SessionGoalCleanup.Service
  const sessions = yield* SessionV2.Service
  const execution = yield* SessionExecution.Service
  const global = yield* Global.Service
  const process = yield* AppProcess.Service
  const fork = yield* FiberSet.makeRuntime<never, void, never>()
  const control = Semaphore.makeUnsafe(1).withPermit
  const admitted = <A, E, R>(sessionID: SessionSchema.ID, effect: Effect.Effect<A, E, R>) =>
    lifecycle
      .use(sessionID, effect)
      .pipe(
        Effect.catchTag("SessionLifecycle.Closed", () =>
          Effect.fail(new SessionGoal.Conflict({ code: "missing", message: "Session is being deleted" })),
        ),
      )
  const owned = <A, E, R>(sessionID: SessionSchema.ID, effect: Effect.Effect<A, E, R>) =>
    lifecycle.capture(sessionID).pipe(
      Effect.flatMap((claim) => lifecycle.owned(claim, effect)),
      Effect.catchTag("SessionLifecycle.Closed", () =>
        Effect.fail(new SessionGoal.Conflict({ code: "missing", message: "Session is being deleted" })),
      ),
    )
  const unmanaged = (sessionID: SessionSchema.ID) =>
    Effect.gen(function* () {
      const failure = new SessionGoal.Conflict({ code: "invalid", message: "Managed children cannot start Goals" })
      if (yield* tasks.managed(sessionID).pipe(Effect.mapError(() => failure))) return yield* failure
    })
  const requireGoal = (target: SessionGoal.Target) =>
    goals
      .get(target.sessionID)
      .pipe(
        Effect.flatMap((info) =>
          info?.id === target.goalID
            ? Effect.succeed(info)
            : Effect.fail(new SessionGoal.Conflict({ code: "missing", message: "Goal does not exist" })),
        ),
      )
  const run = Effect.fn("SessionGoalControl.run")(
    function* (target: SessionGoal.Target, resume = false) {
      yield* unmanaged(target.sessionID)
      if ((yield* execution.active).has(target.sessionID))
        return yield* new SessionGoal.Conflict({ code: "busy", message: "Session already has active execution" })
      const current = yield* requireGoal(target)
      if (current.status === "active" && current.phase !== "idle") yield* goals.recover(target, current.revision)
      const info = resume ? yield* goals.resume(target) : yield* requireGoal(target)
      if (info.status !== "active")
        return yield* new SessionGoal.Conflict({ code: "inactive", message: "Resume the Goal explicitly" })
      if (info.launch) {
        yield* sessions.switchModel({ sessionID: target.sessionID, model: info.launch.model })
        yield* sessions.switchAgent({ sessionID: target.sessionID, agent: info.launch.agent })
        yield* sessions
          .prompt({
            sessionID: target.sessionID,
            id: SessionMessage.ID.make(info.launch.messageID),
            prompt: { text: info.objective },
            resume: false,
          })
          .pipe(
            Effect.catchTag(
              "Session.ManagedInputError",
              () => new SessionGoal.Conflict({ code: "invalid", message: "Managed children cannot start Goals" }),
            ),
          )
      }
      const action = yield* lifecycle
        .bind(target.sessionID, execution.resume(target.sessionID))
        .pipe(Effect.mapError(() => new SessionGoal.Conflict({ code: "missing", message: "Session is being deleted" })))
      fork(action.pipe(Effect.catchCause((cause) => Effect.logError("Native Goal execution failed", cause))))
      return info
    },
    (effect, target, _resume?: boolean) =>
      lifecycle
        .use(target.sessionID, effect)
        .pipe(
          Effect.catchTag("SessionLifecycle.Closed", () =>
            Effect.fail(new SessionGoal.Conflict({ code: "missing", message: "Session is being deleted" })),
          ),
        ),
  )
  const reports = Effect.fn("SessionGoalControl.reports")(function* (target: SessionGoal.Target) {
    yield* sessions.get(target.sessionID)
    const info = yield* goals.get(target.sessionID)
    return SessionGoalReports.make({
      data: global.data,
      ...target,
      info: info?.id === target.goalID ? info : undefined,
    })
  })
  return {
    get: goals.get,
    create: Effect.fn("SessionGoalControl.create")(
      function* (sessionID: SessionSchema.ID, input: Goal.Create) {
        const session = yield* sessions.get(sessionID)
        yield* unmanaged(sessionID)
        const baseline = yield* SessionGoalChanges.make(process).baseline(session.location.directory)
        return yield* admitted(
          sessionID,
          sessions.get(sessionID).pipe(Effect.andThen(goals.create(sessionID, input, baseline))),
        )
      },
      (effect, sessionID, _input) => owned(sessionID, effect),
    ),
    start: Effect.fn("SessionGoalControl.start")(
      function* (target: SessionGoal.Target, input: Goal.Start) {
        yield* unmanaged(target.sessionID)
        if ((yield* execution.active).has(target.sessionID))
          return yield* new SessionGoal.Conflict({ code: "busy", message: "Session already has active execution" })
        yield* goals.prepareStart(target, input)
        return yield* run(target)
      },
      (effect, target, _input) => control(admitted(target.sessionID, effect)),
    ),
    run: (target: SessionGoal.Target, resume = false) => control(run(target, resume)),
    pause: Effect.fn("SessionGoalControl.pause")(
      function* (target: SessionGoal.Target) {
        const info = yield* admitted(target.sessionID, goals.pause(target, "user_paused", "Paused by user"))
        yield* execution.interrupt(target.sessionID)
        return info
      },
      (effect, target) => control(owned(target.sessionID, effect)),
    ),
    clear: Effect.fn("SessionGoalControl.clear")(
      function* (target: SessionGoal.Target) {
        yield* admitted(target.sessionID, goals.pause(target, "user_paused", "Goal cleared"))
        yield* execution.interrupt(target.sessionID)
        yield* admitted(
          target.sessionID,
          Effect.gen(function* () {
            yield* cleanup.prepare(target, "goal_cleared", yield* requireGoal(target)).pipe(Effect.orDie)
            yield* goals.clear(target)
            yield* cleanup.drain(target.sessionID).pipe(Effect.orDie)
          }),
        )
      },
      (effect, target) => control(owned(target.sessionID, effect)),
    ),
    reports,
    cleanupReports: Effect.fn("SessionGoalControl.cleanupReports")(
      function* (target: SessionGoal.Target) {
        const current = yield* goals.get(target.sessionID)
        if (
          (yield* execution.active).has(target.sessionID) ||
          (current?.id === target.goalID && !["complete", "budget_limited"].includes(current.status))
        )
          return yield* new SessionGoal.Conflict({
            code: "inactive",
            message: "Clear the resumable Goal before removing reports",
          })
        const files = yield* reports(target)
        return yield* Effect.tryPromise(() => files.cleanup()).pipe(
          Effect.mapError(() => new SessionGoal.StorageError({ message: "Goal report cleanup failed" })),
        )
      },
      (effect, target) => admitted(target.sessionID, effect),
    ),
  }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/v2/SessionGoalControl") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    SessionLifecycle.node,
    SessionGoal.node,
    SessionManagedChild.node,
    SessionGoalCleanup.node,
    SessionV2.node,
    SessionExecution.node,
    Global.node,
    AppProcess.node,
  ],
})

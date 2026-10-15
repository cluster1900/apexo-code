import { Cause, Deferred, Effect, Exit, Option, Scope, Semaphore } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Database } from "@apexo/core/database/database"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionGoalCleanup } from "@apexo/core/session/goal-cleanup"
import { SessionGoalChanges } from "@apexo/core/session/goal-changes"
import { SessionGoalReports } from "@apexo/core/session/goal-reports"
import { Global } from "@apexo/core/global"
import { AppProcess } from "@apexo/core/process"
import { SessionID } from "@apexo/schema/session-id"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { MessageID, PartID } from "@/session/schema"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionRunState } from "@/session/run-state"
import { NotFoundError } from "@/storage/storage"
import { InstanceHttpApi } from "../api"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, SessionBusyError, notFound } from "../errors"

export const goalHandlers = HttpApiBuilder.group(InstanceHttpApi, "goal", (handlers) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const runs = yield* SessionRunState.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const process = yield* AppProcess.Service
    const global = yield* Global.Service
    const goals = SessionGoal.make(database.db)
    const cleanup = yield* SessionGoalCleanup.Service
    const state = yield* InstanceState.make(() =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope
        return { scope, locks: new Map<SessionID, { lock: Semaphore.Semaphore; users: number }>() }
      }),
    )

    const requireSession = Effect.fnUntraced(function* (id: SessionID) {
      const session = yield* sessions.get(id)
      if (session.directory !== (yield* InstanceState.directory))
        return yield* new NotFoundError({ message: "Session does not belong to this directory" })
      return session
    })
    const requireGoal = Effect.fnUntraced(function* (target: SessionGoal.Target) {
      const info = yield* goals.get(target.sessionID)
      if (!info) return yield* new SessionGoal.Conflict({ code: "missing", message: "No goal exists in this session" })
      if (info.id !== target.goalID)
        return yield* new SessionGoal.Conflict({ code: "stale", message: "The goal has been replaced or cleared" })
      return info
    })
    const boundary = <A, E, R>(work: Effect.Effect<A, E, R>) =>
      work.pipe(
        Effect.mapError((error) => {
          if (error instanceof NotFoundError) return notFound(error.message)
          if (error instanceof SessionGoalReports.Unavailable)
            return error.reason === "missing"
              ? notFound(error.message)
              : new ConflictError({ message: error.message, resource: "goal-report" })
          if (error instanceof Session.BusyError)
            return new SessionBusyError({
              sessionID: error.sessionID,
              message: "Wait for the current session execution to finish",
            })
          if (error instanceof SessionGoal.Conflict) {
            if (error.code === "missing") return notFound(error.message)
            if (error.code === "invalid") return new InvalidRequestError({ message: error.message, kind: error.code })
            return new ConflictError({ message: error.message, resource: "goal" })
          }
          return new ServiceUnavailableError({ message: "Goal storage is unavailable", service: "goal" })
        }),
      )
    const locked = <A, E>(id: SessionID, work: Effect.Effect<A, E>) =>
      boundary(
        Effect.gen(function* () {
          yield* requireSession(id)
          const data = yield* InstanceState.get(state)
          return yield* Effect.acquireUseRelease(
            Effect.sync(() => {
              const entry = data.locks.get(id) ?? { lock: Semaphore.makeUnsafe(1), users: 0 }
              entry.users++
              data.locks.set(id, entry)
              return entry
            }),
            (entry) => entry.lock.withPermit(work.pipe(Effect.uninterruptible)),
            (entry) =>
              Effect.sync(() => {
                entry.users--
                if (!entry.users) data.locks.delete(id)
              }),
          )
        }),
      )
    const start = Effect.fnUntraced(function* (target: SessionGoal.Target, resume: boolean) {
      yield* runs.assertNotBusy(target.sessionID)
      const info = yield* requireGoal(target)
      if (
        !info.launch &&
        Option.isNone(yield* sessions.findMessage(target.sessionID, (message) => message.info.role === "user"))
      )
        return yield* new SessionGoal.Conflict({
          code: "invalid",
          message: "Select a model by admitting a user prompt before running the goal",
        })
      // Only the idle local executor may recover an abandoned attempt. GET never changes state.
      if (info.status === "active" && info.phase !== "idle") yield* goals.recover(target, info.revision)
      const ready = resume ? yield* goals.resume(target) : yield* requireGoal(target)
      if (ready.status !== "active")
        return yield* new SessionGoal.Conflict({
          code: "inactive",
          message: "The goal is paused or finished; resume must be explicit",
        })
      const data = yield* InstanceState.get(state)
      const admitted = yield* Deferred.make<void, Session.BusyError | SessionGoal.Error>()
      const prepare = Effect.gen(function* () {
        const launch = ready.launch
        if (!launch) return
        const existing = yield* sessions.findMessage(
          target.sessionID,
          (message) => message.info.id === MessageID.make(launch.messageID),
        )
        if (Option.isSome(existing)) {
          const message = existing.value
          if (
            message.info.role !== "user" ||
            message.info.agent !== launch.agent ||
            message.info.model.providerID !== launch.model.providerID ||
            message.info.model.modelID !== launch.model.id ||
            (launch.model.variant !== undefined && message.info.model.variant !== launch.model.variant)
          )
            return yield* new SessionGoal.Conflict({
              code: "exists",
              message: "The goal's initial message conflicts with existing history",
            })
          // Authorized edits and chat.message hooks may enrich the text. Keep the admitted message;
          // the immutable objective is held by Goal, independently of transcript presentation.
          if (
            message.parts.some(
              (part) => part.id === PartID.make(`prt_${launch.messageID.slice(4)}`) && part.type === "text",
            )
          )
            return
          if (message.parts.length > 0)
            return yield* new SessionGoal.Conflict({
              code: "exists",
              message: "The goal's initial message has conflicting parts",
            })
        }
        // Runs inside the owned Session executor. A retry repairs a partially written prompt using the durable IDs.
        yield* prompt.prompt({
          sessionID: target.sessionID,
          messageID: MessageID.make(launch.messageID),
          model: { providerID: launch.model.providerID, modelID: launch.model.id },
          agent: launch.agent,
          variant: launch.model.variant,
          noReply: true,
          parts: [{ id: PartID.make(`prt_${launch.messageID.slice(4)}`), type: "text", text: ready.objective }],
        })
      }).pipe(
        Effect.tapError((error) =>
          Deferred.fail(
            admitted,
            error instanceof SessionGoal.Conflict
              ? error
              : new SessionGoal.StorageError({ message: "Could not admit the goal objective" }),
          ),
        ),
        Effect.orDie,
      )
      yield* prompt.runGoal(target, Deferred.succeed(admitted, undefined).pipe(Effect.asVoid), prepare).pipe(
        Effect.interruptible,
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            if (Exit.isFailure(exit)) {
              yield* goals.pauseRevision(target, ready.revision, "infra_paused", "Goal execution could not start").pipe(
                Effect.catchTag("GoalConflict", () => Effect.void),
                Effect.catch((error) => Effect.logError("Goal admission cleanup failed", error)),
              )
              yield* Deferred.failCause(admitted, exit.cause)
              yield* Effect.logError("Goal execution failed", Cause.pretty(exit.cause))
              return
            }
            yield* Deferred.fail(
              admitted,
              new SessionGoal.Conflict({ code: "inactive", message: "Goal execution ended before admission" }),
            )
          }),
        ),
        Effect.forkIn(data.scope, { startImmediately: true }),
      )
      yield* Deferred.await(admitted)
      return yield* requireGoal(target)
    })

    return handlers
      .handle("reports", (ctx) =>
        boundary(
          Effect.gen(function* () {
            yield* requireSession(ctx.params.sessionID)
            const info = yield* goals.get(ctx.params.sessionID)
            return yield* Effect.tryPromise(() =>
              SessionGoalReports.make({ data: global.data, ...ctx.params, info }).list(),
            )
          }),
        ),
      )
      .handle("report", (ctx) =>
        boundary(
          Effect.gen(function* () {
            yield* requireSession(ctx.params.sessionID)
            const info = yield* goals.get(ctx.params.sessionID)
            return yield* Effect.tryPromise({
              try: () =>
                SessionGoalReports.make({ data: global.data, ...ctx.params, info }).read(
                  ctx.params.reportID,
                  ctx.params.file,
                ),
              catch: (error) => error,
            })
          }),
        ),
      )
      .handle("cleanupReports", (ctx) =>
        locked(
          ctx.params.sessionID,
          Effect.gen(function* () {
            yield* runs.assertNotBusy(ctx.params.sessionID)
            const info = yield* goals.get(ctx.params.sessionID)
            if (info?.id === ctx.params.goalID && !["complete", "budget_limited"].includes(info.status))
              return yield* new SessionGoal.Conflict({
                code: "inactive",
                message: "Clear the resumable Goal before removing its reports",
              })
            return yield* Effect.tryPromise(() =>
              SessionGoalReports.make({ data: global.data, ...ctx.params, info }).cleanup(),
            )
          }),
        ),
      )
      .handle("get", (ctx) =>
        boundary(
          Effect.gen(function* () {
            yield* requireSession(ctx.params.sessionID)
            return (yield* goals.get(ctx.params.sessionID)) ?? null
          }),
        ),
      )
      .handle("create", (ctx) =>
        locked(
          ctx.params.sessionID,
          Effect.gen(function* () {
            yield* runs.assertNotBusy(ctx.params.sessionID)
            // An exact retry retains its original baseline, even after new commits.
            const current = yield* goals.get(ctx.params.sessionID)
            const baseline =
              current?.id === ctx.payload.id
                ? current.changesBaselineCommit
                : yield* SessionGoalChanges.make(process).baseline(yield* InstanceState.directory)
            return yield* goals.create(ctx.params.sessionID, ctx.payload, baseline)
          }),
        ),
      )
      .handle("run", (ctx) => locked(ctx.params.sessionID, start(ctx.params, false)))
      .handle("start", (ctx) =>
        locked(
          ctx.params.sessionID,
          Effect.gen(function* () {
            const current = yield* requireGoal(ctx.params)
            if (!current.launch) {
              yield* runs.assertNotBusy(ctx.params.sessionID)
              if (!(yield* agents.get(ctx.payload.agent)))
                return yield* new SessionGoal.Conflict({
                  code: "invalid",
                  message: "The selected agent does not exist",
                })
              yield* provider
                .getModel(ctx.payload.model.providerID, ctx.payload.model.id)
                .pipe(
                  Effect.mapError(
                    () => new SessionGoal.Conflict({ code: "invalid", message: "The selected model is unavailable" }),
                  ),
                )
            }
            const ready = yield* goals.prepareStart(ctx.params, ctx.payload)
            // Retrying start must never resume a paused goal or recover an abandoned execution.
            if (ready.status !== "active" || ready.phase !== "idle" || ready.workerRounds > 0) return ready
            return yield* start(ctx.params, false)
          }),
        ),
      )
      .handle("resume", (ctx) => locked(ctx.params.sessionID, start(ctx.params, true)))
      .handle("pause", (ctx) =>
        locked(
          ctx.params.sessionID,
          Effect.gen(function* () {
            yield* goals.pause(ctx.params, "user_paused", "Paused by the user")
            yield* runs.cancelGoal(ctx.params.sessionID, ctx.params.goalID)
            return yield* requireGoal(ctx.params)
          }),
        ),
      )
      .handle("clear", (ctx) =>
        locked(
          ctx.params.sessionID,
          Effect.gen(function* () {
            yield* goals.pause(ctx.params, "user_paused", "Cleared by the user")
            yield* runs.cancelGoal(ctx.params.sessionID, ctx.params.goalID)
            const info = yield* requireGoal(ctx.params)
            yield* cleanup.prepare(ctx.params, "goal_cleared", info)
            yield* goals.clear(ctx.params)
            yield* cleanup.drain(ctx.params.sessionID)
            return true
          }),
        ),
      )
  }),
)

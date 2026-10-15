export * as SessionScheduleRuntime from "./schedule"

import { Cause, Clock, Context, Effect, Exit, Layer } from "effect"
import { SessionSchedule } from "@apexo/schema/session-schedule"
import { makeLocationNode } from "../effect/app-node"
import { AgentV2 } from "../agent"
import { PermissionV2 } from "../permission"
import { SessionRunnerModel } from "./runner/model"
import { Location } from "../location"
import { SessionSchema } from "./schema"
import { SessionLifecycle } from "./lifecycle"
import { SessionManagedChild } from "./managed-child"
import { SessionStore } from "./store"
import { SessionTask } from "./task"
import { SessionTaskOrigin } from "./task-origin"
import { SessionScheduleRecord } from "./schedule-record"
import { SessionScheduleStore } from "./schedule-store"
import { SessionScheduleOwner } from "./schedule-owner"
import { SessionRunner } from "./runner"
import { SessionGoalUsage } from "./goal-usage"
import { SessionExecutionPolicy } from "./execution-policy"

const make = Effect.gen(function* () {
  const lifecycle = yield* SessionLifecycle.Service
  const managed = yield* SessionManagedChild.Service
  const sessions = yield* SessionStore.Service
  const tasks = yield* SessionTask.Service
  const store = yield* SessionScheduleStore.Service
  const owners = yield* SessionScheduleOwner.Service
  const location = yield* Location.Service
  const agents = yield* AgentV2.Service
  const permission = yield* PermissionV2.Service
  const models = yield* SessionRunnerModel.Service
  const bindings = new Map<SessionLifecycle.Claim, object>()
  yield* Effect.addFinalizer(() =>
    Effect.forEach([...bindings], ([claim, token]) => owners.unbind(claim, token), { discard: true }),
  )
  const parentAtLocation = (sessionID: SessionSchema.ID) =>
    Effect.gen(function* () {
      const parent = yield* sessions.get(sessionID)
      if (
        !parent ||
        parent.location.directory !== location.directory ||
        parent.location.workspaceID !== location.workspaceID
      )
        return yield* new SessionScheduleRecord.Failure({
          code: "missing",
          message: "Schedule parent is unavailable in this Location",
        })
      return parent
    })
  const bind = (sessionID: SessionSchema.ID) =>
    Effect.gen(function* () {
      if (yield* SessionExecutionPolicy.forSession(sessionID))
        return yield* new SessionScheduleRecord.Failure({
          code: "denied",
          message: "Headless inputs cannot bind schedule timers",
        })
      if ((yield* SessionGoalUsage.Current) || (yield* managed.managed(sessionID)))
        return yield* new SessionScheduleRecord.Failure({
          code: "denied",
          message: "Managed children and Goal workers cannot own schedule timers",
        })
      const children = yield* SessionRunner.CurrentChildren
      if (!children?.notify)
        return yield* new SessionScheduleRecord.Failure({
          code: "invalid",
          message: "Schedule requires owned native child execution",
        })
      yield* parentAtLocation(sessionID)
      const claim = yield* lifecycle.capture(sessionID)
      if (bindings.has(claim)) return claim
      const token = yield* owners.bind(claim, (id, current) =>
        tasks.scheduled(id).pipe(
          Effect.provideService(SessionRunner.CurrentChildren, children),
          Effect.provideService(SessionTaskOrigin.Current, { occurrenceID: id, current }),
          Effect.provideService(SessionGoalUsage.Current, undefined),
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? store
                  .failClaim(id, Cause.hasInterrupts(exit.cause))
                  .pipe(Effect.catch(() => Effect.logWarning("Schedule occurrence terminal receipt is unavailable")))
              : Effect.void,
          ),
          Effect.asVoid,
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logWarning("Native schedule occurrence failed; no automatic retry is admitted"),
          ),
        ),
      )
      bindings.set(claim, token)
      return claim
    }).pipe(
      Effect.catchTag("SessionManagedChildFailure", () =>
        Effect.fail(
          new SessionScheduleRecord.Failure({ code: "denied", message: "Managed Session ownership is unavailable" }),
        ),
      ),
      Effect.catchTag("SessionLifecycle.Closed", () => Effect.interrupt),
    )
  return {
    bind,
    joinStop: owners.joinStop,
    signal: (sessionID: SessionSchema.ID) =>
      lifecycle.find(sessionID).pipe(Effect.flatMap((claim) => (claim ? owners.changed(claim) : Effect.void))),
    restore: (sessionID: SessionSchema.ID) =>
      Effect.gen(function* () {
        const parent = yield* parentAtLocation(sessionID)
        const saved = yield* store.list(sessionID)
        const blocked = yield* store.restorationBlock(sessionID)
        if (blocked) return { sessionID, schedules: saved.map((item) => ({ id: item.id, reason: blocked })) }
        if (!saved.length) return { sessionID, schedules: [] }
        const claim = yield* bind(sessionID)
        const current = owners.checkpoint(claim)
        const inherited = yield* PermissionV2.Inherited
        const schedules = yield* owners.restoring(
          claim,
          saved,
          Effect.forEach(saved, (item) =>
            Effect.gen(function* () {
              const initial = store.restorationReason(item, yield* Clock.currentTimeMillis)
              if (initial) return { id: item.id, reason: initial }
              if (!current()) return { id: item.id, reason: "changed" as const }
              const agent = yield* agents.resolve(item.agent)
              if (!agent || agent.hidden || agent.mode === "primary")
                return { id: item.id, reason: "unavailable" as const }
              const inspect = permission
                .inspect(sessionID, item.parentAgent)
                .pipe(
                  Effect.provideService(
                    PermissionV2.Inherited,
                    new Map(inherited).set(sessionID, [...(inherited.get(sessionID) ?? []), ...item.authority]),
                  ),
                )
              const authority = (yield* inspect)("task", [agent.id])
              if (authority !== "allow")
                return {
                  id: item.id,
                  reason: authority === "ask" ? ("permission_required" as const) : ("denied" as const),
                }
              const model = yield* models.resolve({ ...parent, agent: agent.id, model: item.model }).pipe(Effect.result)
              if (model._tag === "Failure") return { id: item.id, reason: "unavailable" as const }
              const latest = (yield* inspect)("task", [agent.id])
              if (latest !== "allow")
                return {
                  id: item.id,
                  reason: latest === "ask" ? ("permission_required" as const) : ("denied" as const),
                }
              const reason = yield* store.restore(item, current)
              return { id: item.id, reason }
            }),
          ),
        )
        // Never clear a Stop epoch. An explicit per-intent Resume remains the only override.
        if (current()) yield* owners.changed(claim)
        return { sessionID, schedules } satisfies SessionSchedule.Restoration
      }).pipe(
        Effect.catchTag("Session.NotFoundError", () =>
          Effect.fail(new SessionScheduleRecord.Failure({ code: "missing", message: "Session is unavailable" })),
        ),
      ),
    resume: (sessionID: SessionSchema.ID, id: SessionSchedule.ID) =>
      Effect.gen(function* () {
        const claim = yield* bind(sessionID)
        // Join the old Stop before saving new intent, not only before rearming its timer.
        yield* owners.joinStop(claim)
        const saved = yield* store.owned(sessionID, id)
        const parent = yield* sessions.get(sessionID)
        const agent = yield* agents.resolve(saved.agent)
        if (!parent || !agent || agent.hidden || agent.mode === "primary")
          return yield* new SessionScheduleRecord.Failure({
            code: "invalid",
            message: "Scheduled subagent is unavailable",
          })
        const inherited = yield* PermissionV2.Inherited
        yield* permission
          .assert({
            sessionID,
            agent: saved.parentAgent,
            action: "task",
            resources: [agent.id],
            save: [agent.id],
            source: saved.permissionSource,
          })
          .pipe(
            Effect.provideService(
              PermissionV2.Inherited,
              new Map(inherited).set(sessionID, [...(inherited.get(sessionID) ?? []), ...saved.authority]),
            ),
            // Runner refusals stop a turn as defects; management requests need a typed denial.
            Effect.catchDefect((error) =>
              error instanceof PermissionV2.DeclinedError ? Effect.fail(error) : Effect.die(error),
            ),
            Effect.mapError(
              () =>
                new SessionScheduleRecord.Failure({
                  code: "denied",
                  message: "Saved schedule authority does not allow this subagent",
                }),
            ),
          )
        yield* models
          .resolve({ ...parent, agent: agent.id, model: saved.model })
          .pipe(
            Effect.mapError(
              () =>
                new SessionScheduleRecord.Failure({ code: "invalid", message: "Saved schedule model is unavailable" }),
            ),
          )
        const next = yield* store.resume(sessionID, id)
        yield* owners.changed(claim, true)
        return next
      }),
    changed: (sessionID: SessionSchema.ID, activate = false) =>
      bind(sessionID).pipe(Effect.flatMap((claim) => owners.changed(claim, activate))),
  }
})
export type Interface = Effect.Success<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionScheduleRuntime") {}
export const node = makeLocationNode({
  service: Service,
  deps: [
    SessionLifecycle.node,
    SessionManagedChild.node,
    SessionStore.node,
    SessionTask.node,
    SessionScheduleStore.node,
    SessionScheduleOwner.node,
    Location.node,
    AgentV2.node,
    PermissionV2.node,
    SessionRunnerModel.node,
  ],
  layer: Layer.effect(Service, make),
})

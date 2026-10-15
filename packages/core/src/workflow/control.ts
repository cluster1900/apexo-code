import { SessionManagedChild } from "../session/managed-child"
import { SessionLifecycle } from "../session/lifecycle"
import { LocationRuntimeGuard } from "../location-runtime-guard"
export * as WorkflowControl from "./control"

import { Context, Effect, FiberSet, Layer, Semaphore } from "effect"
import { and, desc, eq, sql } from "drizzle-orm"
import { Workflow } from "@apexo/schema/workflow"
import { SessionID } from "@apexo/schema/session-id"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionV2 } from "../session"
import { MessageTable, PartTable, SessionTable } from "../session/sql"
import { SessionStore } from "../session/store"
import { AgentV2 } from "../agent"
import { SessionExecution } from "../session/execution"
import { SessionGoal } from "../session/goal"
import { LocationServiceMap } from "../location-service-map"
import { WorkflowSources } from "./sources"
import { WorkflowStore } from "./store"

const make = Effect.gen(function* () {
  const lifecycle = yield* SessionLifecycle.Service
  const tasks = yield* SessionManagedChild.Service
  const store = yield* WorkflowStore.Service
  const locations = yield* LocationServiceMap.Service
  const guard = yield* LocationRuntimeGuard.Service
  const sessions = yield* SessionV2.Service
  const sessionStore = yield* SessionStore.Service
  const goals = yield* SessionGoal.Service
  const execution = yield* SessionExecution.Service
  const database = yield* Database.Service
  const fork = yield* FiberSet.makeRuntime<never, void, never>()
  const control = Semaphore.makeUnsafe(1).withPermit
  const unmanaged = (sessionID: SessionID) =>
    Effect.gen(function* () {
      const failure = new WorkflowStore.Failure({
        code: "invalid",
        message: "Managed children cannot launch workflows",
      })
      if (yield* tasks.managed(sessionID).pipe(Effect.mapError(() => failure))) return yield* failure
    })
  const eligible = (sessionID: SessionID) =>
    Effect.gen(function* () {
      yield* sessions.get(sessionID)
      yield* unmanaged(sessionID)
      if ((yield* execution.active).has(sessionID))
        return yield* new WorkflowStore.Failure({ code: "busy", message: "Session is already executing" })
      const row = yield* database.db
        .select({ metadata: SessionTable.metadata })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (row?.metadata?.workflowChild || row?.metadata?.goalReview)
        return yield* new WorkflowStore.Failure({ code: "invalid", message: "Review children cannot launch workflows" })
      if ((yield* goals.get(sessionID))?.status === "active")
        return yield* new WorkflowStore.Failure({
          code: "busy",
          message: "Pause the active Goal before starting a standalone workflow",
        })
      if ((yield* store.list(sessionID)).some((run) => ["pending", "running"].includes(run.status)))
        return yield* new WorkflowStore.Failure({ code: "busy", message: "Session already has pending workflow work" })
    })
  const admitted = <A, E, R>(sessionID: SessionID, effect: Effect.Effect<A, E, R>) =>
    lifecycle
      .use(sessionID, effect)
      .pipe(
        Effect.catchTag("SessionLifecycle.Closed", () =>
          Effect.fail(new WorkflowStore.Failure({ code: "missing", message: "Session is being deleted" })),
        ),
      )
  const schedule = (sessionID: SessionID) =>
    Effect.gen(function* () {
      const action = yield* lifecycle
        .bind(sessionID, execution.resume(sessionID))
        .pipe(
          Effect.mapError(() => new WorkflowStore.Failure({ code: "missing", message: "Session is being deleted" })),
        )
      fork(action.pipe(Effect.catchCause((cause) => Effect.logError("Workflow execution failed", cause))))
    })
  return {
    related: (sessionID: SessionID) =>
      Effect.gen(function* () {
        yield* sessions.get(sessionID)
        const children = yield* database.db
          .select({ id: SessionTable.id, metadata: SessionTable.metadata })
          .from(SessionTable)
          .where(eq(SessionTable.parent_id, sessionID))
          .all()
          .pipe(Effect.orDie)
        const runs = yield* Effect.forEach(
          children.filter((child) => child.metadata?.workflowHost === sessionID),
          (child) => store.list(child.id),
        )
        return [...(yield* store.list(sessionID)), ...runs.flat()].toSorted((a, b) => b.createdAt - a.createdAt)
      }),
    launch: (sessionID: SessionID, input: Workflow.Launch) =>
      control(
        admitted(
          sessionID,
          Effect.gen(function* () {
            const parent = yield* sessions.get(sessionID)
            yield* unmanaged(sessionID)
            const row = yield* database.db
              .select({ metadata: SessionTable.metadata })
              .from(SessionTable)
              .where(eq(SessionTable.id, sessionID))
              .get()
              .pipe(Effect.orDie)
            if (row?.metadata?.workflowChild || row?.metadata?.goalReview || row?.metadata?.workflowHost)
              return yield* new WorkflowStore.Failure({
                code: "invalid",
                message: "Workflow hosts and review children cannot launch nested workflows",
              })
            const resolved = yield* Effect.gen(function* () {
              const sources = yield* WorkflowSources.Service
              const agents = yield* AgentV2.Service
              return {
                source: yield* sources.resolve(sessionID, input.source),
                agent: yield* agents.select(input.agent ?? parent.agent),
              }
            }).pipe(Effect.provide(locations.get(parent.location)), (effect) => guard.use(parent.location, effect))
            const permissions = yield* sessionStore.permissions(sessionID)
            const parts = yield* database.db
              .select({ data: PartTable.data, role: sql<string>`json_extract(${MessageTable.data}, '$.role')` })
              .from(PartTable)
              .innerJoin(MessageTable, eq(PartTable.message_id, MessageTable.id))
              .where(and(eq(PartTable.session_id, sessionID), sql`json_extract(${PartTable.data}, '$.type') = 'text'`))
              .orderBy(desc(PartTable.time_created), desc(PartTable.id))
              .limit(32)
              .all()
              .pipe(Effect.orDie)
            const context = parts
              .toReversed()
              .flatMap((part) =>
                "text" in part.data && typeof part.data.text === "string"
                  ? [`${part.role}: ${part.data.text.slice(0, 2000)}`]
                  : [],
              )
              .join("\n\n")
              .slice(-64_000)
            const hostID = SessionID.create()
            return yield* admitted(
              hostID,
              Effect.gen(function* () {
                const host = yield* sessions
                  .create({
                    id: hostID,
                    parentID: sessionID,
                    metadata: { workflowHost: sessionID },
                    location: parent.location,
                    model: input.model ?? parent.model,
                    agent: resolved.agent.id,
                  })
                  .pipe(
                    Effect.catchTag("CommandSandbox.Failure", (error) =>
                      Effect.fail(
                        new WorkflowStore.Failure({
                          code: error.code === "unavailable" ? "storage" : "invalid",
                          message: "The Workflow host could not inherit the original Session command sandbox policy.",
                        }),
                      ),
                    ),
                  )
                yield* sessionStore.setPermissions({
                  sessionID: host.id,
                  permissions: [
                    ...(resolved.agent.info?.permissions ?? []).map((rule) => ({
                      permission: rule.action,
                      pattern: rule.resource,
                      action: rule.effect,
                    })),
                    ...(permissions ?? []),
                  ],
                })
                const state = yield* store.create(host.id, { ...input, source: resolved.source }, context)
                yield* schedule(host.id)
                return store.info(state)
              }),
            )
          }),
        ),
      ),
    sources: (sessionID: SessionID) =>
      Effect.gen(function* () {
        const session = yield* sessions.get(sessionID)
        return yield* WorkflowSources.Service.use((sources) => sources.list(sessionID)).pipe(
          Effect.provide(locations.get(session.location)),
          (effect) => guard.use(session.location, effect),
        )
      }),
    validate: (sessionID: SessionID, source: Workflow.Source) =>
      Effect.gen(function* () {
        const session = yield* sessions.get(sessionID)
        return yield* WorkflowSources.Service.use((sources) => sources.validate(sessionID, source)).pipe(
          Effect.provide(locations.get(session.location)),
          (effect) => guard.use(session.location, effect),
        )
      }),
    list: (sessionID: SessionID) => sessions.get(sessionID).pipe(Effect.flatMap(() => store.list(sessionID))),
    get: (sessionID: SessionID, id: Workflow.ID) =>
      sessions.get(sessionID).pipe(
        Effect.flatMap(() => store.read(sessionID, id)),
        Effect.map(store.info),
      ),
    start: (sessionID: SessionID, input: Workflow.Start) =>
      control(
        admitted(
          sessionID,
          Effect.gen(function* () {
            yield* eligible(sessionID)
            const session = yield* sessions.get(sessionID)
            const source = yield* WorkflowSources.Service.use((sources) =>
              sources.resolve(sessionID, input.source),
            ).pipe(Effect.provide(locations.get(session.location)), (effect) => guard.use(session.location, effect))
            const state = yield* store.create(sessionID, { ...input, source })
            yield* schedule(sessionID)
            return store.info(state)
          }),
        ),
      ),
    resume: (sessionID: SessionID, id: Workflow.ID, budget?: number) =>
      control(
        admitted(
          sessionID,
          Effect.gen(function* () {
            yield* store.checkResumeOwner(sessionID, id)
            yield* eligible(sessionID)
            const state = yield* store.resume(sessionID, id, budget)
            yield* schedule(sessionID)
            return store.info(state)
          }),
        ),
      ),
    stop: (sessionID: SessionID, id: Workflow.ID, cancel = false) =>
      control(
        lifecycle.capture(sessionID).pipe(
          Effect.flatMap((claim) =>
            lifecycle.owned(
              claim,
              Effect.gen(function* () {
                yield* sessions.get(sessionID)
                const state = yield* admitted(sessionID, store.stop(sessionID, id, cancel))
                // A persisted pre-crash run cannot own an unrelated drain in this process.
                if (state.info.status === (cancel ? "cancelled" : "paused"))
                  yield* execution.interrupt(sessionID, () => store.owns(id))
                return store.info(state)
              }),
            ),
          ),
          Effect.catchTag("SessionLifecycle.Closed", () =>
            Effect.fail(new WorkflowStore.Failure({ code: "missing", message: "Session is being deleted" })),
          ),
        ),
      ),
  }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/WorkflowControl") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    SessionLifecycle.node,
    WorkflowStore.node,
    SessionManagedChild.node,
    SessionV2.node,
    SessionStore.node,
    SessionExecution.node,
    SessionGoal.node,
    Database.node,
    LocationServiceMap.node,
    LocationRuntimeGuard.node,
  ],
})

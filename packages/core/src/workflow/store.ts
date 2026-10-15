import { SessionChildPlacementRecord } from "../session/child-placement-record"
export * as WorkflowStore from "./store"

import { randomUUID } from "node:crypto"
import { and, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema, Semaphore, Struct } from "effect"
import { Workflow } from "@apexo/schema/workflow"
import { Agent } from "@apexo/schema/agent"
import { Model } from "@apexo/schema/model"
import { SessionEvent } from "../session/event"
import { PermissionAuthority } from "../permission/authority"
import { SessionID } from "@apexo/schema/session-id"
import { NonNegativeInt, optional } from "@apexo/schema/schema"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { WorkflowRunTable } from "./sql"
import { WorkflowDefinition } from "./definition"
import { WorkflowLimits } from "./limits"

export class Failure extends Schema.TaggedErrorClass<Failure>()("WorkflowFailure", {
  code: Schema.Literals(["missing", "busy", "invalid", "stale", "storage", "restart", "budget"]),
  message: Schema.String,
}) {}
export const UsageReceipt = Schema.Struct({
  tokens: optional(NonNegativeInt),
  finished: Schema.Boolean,
})
export type UsageReceipt = typeof UsageReceipt.Type
export const ChildSelection = Schema.Struct({
  agent: Agent.ID,
  model: Model.Ref,
  authority: Schema.Array(PermissionAuthority.Snapshot),
  inherited: optional(Schema.Boolean),
  readOnly: optional(Schema.Boolean),
  taskPolicy: optional(Schema.Boolean),
  resume: optional(SessionEvent.HistoryCopy.Source),
  placement: optional(SessionChildPlacementRecord.Record),
})
export type ChildSelection = typeof ChildSelection.Type
export const Task = Schema.Struct({
  key: Schema.String,
  hash: Schema.String,
  stage: Schema.String,
  status: Schema.Literals(["reserved", "running", "done"]),
  sessionID: optional(SessionID),
  result: optional(Workflow.ChildResult),
  selection: optional(ChildSelection),
  schemaAttempt: optional(Schema.Literals([0, 1])),
  schemaPending: optional(Schema.Boolean),
  schemaPriorCalls: optional(Schema.Array(Schema.String)),
  usage: optional(Schema.Record(Schema.String, UsageReceipt)),
})
const StoredInfo = Schema.Struct(Struct.omit(Workflow.Info.fields, ["resumeBlockedReason"]))
export const State = Schema.Struct({
  info: StoredInfo,
  revision: NonNegativeInt,
  owner: Schema.String,
  definition: Workflow.Definition,
  script: optional(Schema.String),
  context: optional(Schema.String.check(Schema.isMaxLength(64_000))),
  calls: Schema.Array(Schema.Struct({ id: NonNegativeInt, hash: Schema.String, result: Schema.Json })),
  args: Schema.Json,
  tasks: Schema.Array(Task),
})
export type State = typeof State.Type
export function make(db: Database.Interface["db"]) {
  const owner = randomUUID()
  const gate = Semaphore.makeUnsafe(1)
  const executing = new Set<Workflow.ID>()
  const storage = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.mapError((error) =>
        error instanceof Failure ? error : new Failure({ code: "storage", message: "Workflow state is unavailable" }),
      ),
    )
  const read = (sessionID: SessionID, id: Workflow.ID) =>
    storage(
      Effect.gen(function* () {
        const row = yield* db
          .select()
          .from(WorkflowRunTable)
          .where(and(eq(WorkflowRunTable.id, id), eq(WorkflowRunTable.session_id, sessionID)))
          .get()
        if (!row) return yield* new Failure({ code: "missing", message: "Workflow run does not exist" })
        const state = yield* Schema.decodeUnknownEffect(State)(row.data)
        if (state.info.id !== row.id || state.info.sessionID !== row.session_id || state.revision !== row.revision)
          return yield* new Failure({ code: "storage", message: "Workflow state ownership is invalid" })
        return state
      }),
    )
  const change = (sessionID: SessionID, id: Workflow.ID, update: (state: State) => State) =>
    gate.withPermit(
      storage(
        Effect.gen(function* () {
          const prior = yield* read(sessionID, id)
          const changed = yield* Effect.try({
            try: () => {
              const next = update(prior)
              WorkflowLimits.journal(next.calls)
              return next
            },
            catch: (error) =>
              error instanceof Failure
                ? error
                : new Failure({ code: "invalid", message: "Invalid workflow transition" }),
          })
          const state: State = {
            ...changed,
            revision: prior.revision + 1,
            info: {
              ...(yield* Schema.decodeUnknownEffect(Schema.toType(StoredInfo))(changed.info)),
              updatedAt: Date.now(),
            },
          }
          const rows = yield* db
            .update(WorkflowRunTable)
            .set({ revision: state.revision, data: state })
            .where(and(eq(WorkflowRunTable.id, id), eq(WorkflowRunTable.revision, prior.revision)))
            .returning({ id: WorkflowRunTable.id })
          if (rows.length !== 1) return yield* new Failure({ code: "stale", message: "Workflow changed concurrently" })
          return state
        }),
      ),
    )
  const info = (state: State): Workflow.Info => ({
    ...state.info,
    resumeBlockedReason: ["completed", "failed"].includes(state.info.status)
      ? undefined
      : state.owner !== owner
        ? "process_restart"
        : ["paused", "cancelled", "budget_limited"].includes(state.info.status) &&
            state.tasks.some((task) => task.status !== "done" && task.schemaAttempt !== undefined)
          ? "schema_attempt_claimed"
          : undefined,
  })
  const requireResumeOwner = (state: State) => {
    if (state.owner !== owner)
      throw new Failure({ code: "restart", message: "Workflow recovery after process restart requires a new run" })
  }
  return {
    owner,
    info,
    read,
    change,
    checkResumeOwner: (sessionID: SessionID, id: Workflow.ID) =>
      read(sessionID, id).pipe(
        Effect.flatMap((state) =>
          Effect.try({
            try: () => requireResumeOwner(state),
            catch: (error) =>
              error instanceof Failure
                ? error
                : new Failure({ code: "storage", message: "Workflow ownership is unavailable" }),
          }),
        ),
      ),
    selectChild: (sessionID: SessionID, id: Workflow.ID, key: string, selection: ChildSelection) =>
      change(sessionID, id, (state) => {
        const task = state.tasks.find((task) => task.key === key)
        if (state.info.status !== "running" || !task || task.status === "done")
          throw new Failure({ code: "busy", message: "Workflow stopped before child selection" })
        if (task.selection && JSON.stringify(task.selection) !== JSON.stringify(selection))
          throw new Failure({ code: "stale", message: "Workflow child selection cannot change" })
        return {
          ...state,
          tasks: state.tasks.map((task) => (task.key === key ? { ...task, selection } : task)),
        }
      }).pipe(Effect.as(selection)),
    claimSchemaAttempt: (sessionID: SessionID, id: Workflow.ID, key: string, attempt: 0 | 1) =>
      change(sessionID, id, (state) => {
        const task = state.tasks.find((task) => task.key === key)
        if (state.info.status !== "running" || !task || task.status === "done")
          throw new Failure({ code: "busy", message: "Workflow stopped before its structured-output attempt" })
        if (attempt === 0 ? task.schemaAttempt !== undefined : task.schemaAttempt !== 0)
          throw new Failure({
            code: "stale",
            message: "Structured-output attempt was already claimed; start a new Workflow run",
          })
        return {
          ...state,
          info: { ...state.info, usageIncomplete: true },
          tasks: state.tasks.map((task) =>
            task.key === key
              ? {
                  ...task,
                  schemaAttempt: attempt,
                  schemaPending: true,
                  schemaPriorCalls: Object.keys(task.usage ?? {}),
                }
              : task,
          ),
        }
      }).pipe(Effect.asVoid),
    recordUsage: (
      sessionID: SessionID,
      id: Workflow.ID,
      key: string,
      childID: SessionID,
      receipts: Readonly<Record<string, UsageReceipt>>,
    ) =>
      change(sessionID, id, (state) => {
        const task = state.tasks.find((task) => task.key === key)
        if (!task || task.sessionID !== childID)
          throw new Failure({ code: "stale", message: "Workflow usage no longer belongs to this child" })
        const usage = { ...task.usage }
        for (const [callID, receipt] of Object.entries(receipts)) {
          const prior = usage[callID]
          const tokens =
            prior?.tokens === undefined
              ? receipt.tokens
              : receipt.tokens === undefined
                ? prior.tokens
                : Math.max(prior.tokens, receipt.tokens)
          usage[callID] = {
            ...(tokens === undefined ? {} : { tokens }),
            finished: !!prior?.finished || receipt.finished,
          }
        }
        const sum = (values: Readonly<Record<string, UsageReceipt>> | undefined) =>
          Object.values(values ?? {}).reduce((total, receipt) => total + (receipt.tokens ?? 0), 0)
        const tokens = state.info.tokens + sum(usage) - sum(task.usage)
        if (!Number.isSafeInteger(tokens))
          throw new Failure({ code: "invalid", message: "Workflow usage exceeds its numeric capacity" })
        // Old receipts cannot settle a correction claimed before its provider call.
        const fresh = Object.entries(usage).filter(([callID]) => !task.schemaPriorCalls?.includes(callID))
        const schemaPending =
          task.schemaPending &&
          !(fresh.length && fresh.every(([, receipt]) => receipt.finished && receipt.tokens !== undefined))
        const tasks = state.tasks.map((task) =>
          task.key === key
            ? { ...task, usage, ...(task.schemaAttempt === undefined ? {} : { schemaPending: !!schemaPending }) }
            : task,
        )
        return {
          ...state,
          tasks,
          info: {
            ...state.info,
            tokens,
            usageIncomplete: tasks.some(
              (task) =>
                task.schemaPending ||
                Object.values(task.usage ?? {}).some((receipt) => !receipt.finished || receipt.tokens === undefined),
            ),
          },
        }
      }).pipe(Effect.asVoid),
    claim: (id: Workflow.ID) => {
      if (executing.has(id)) return false
      executing.add(id)
      return true
    },
    release: (id: Workflow.ID) => {
      executing.delete(id)
    },
    owns: (id: Workflow.ID) => executing.has(id),
    stop: (sessionID: SessionID, id: Workflow.ID, cancel = false) =>
      change(sessionID, id, (state) =>
        (cancel ? ["pending", "running", "paused", "budget_limited"] : ["pending", "running"]).includes(
          state.info.status,
        )
          ? {
              ...state,
              info: {
                ...state.info,
                status: cancel ? "cancelled" : "paused",
                message: cancel ? "Stopped by user" : "Paused by user",
              },
            }
          : state,
      ),
    list: (sessionID: SessionID) =>
      storage(
        Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(WorkflowRunTable)
            .where(eq(WorkflowRunTable.session_id, sessionID))
            .orderBy(desc(WorkflowRunTable.time_created))
          return yield* Effect.forEach(rows, (row) =>
            Schema.decodeUnknownEffect(State)(row.data).pipe(Effect.map(info)),
          )
        }),
      ),
    create: (sessionID: SessionID, input: Workflow.Start, context?: string) =>
      gate.withPermit(
        storage(
          Effect.gen(function* () {
            const definition = yield* Effect.try({
              try: () => WorkflowDefinition.resolve(input.source),
              catch: (error) => new Failure({ code: "invalid", message: String(error) }),
            })
            const now = Date.now()
            const state: State = {
              owner,
              revision: 0,
              definition,
              script: input.source.type === "script" ? input.source.script : undefined,
              context,
              args: input.args ?? null,
              tasks: [],
              calls: [],
              info: {
                id: Workflow.ID.create(),
                sessionID,
                name: definition.name,
                status: "pending",
                agentBudget: input.agentBudget ?? 128,
                agentsSpent: 0,
                concurrency: input.concurrency ?? 4,
                tokens: 0,
                createdAt: now,
                updatedAt: now,
                children: [],
              },
            }
            yield* db
              .insert(WorkflowRunTable)
              .values({ id: state.info.id, session_id: sessionID, revision: 0, data: state, time_created: now })
              .run()
            return state
          }),
        ),
      ),
    resume: (sessionID: SessionID, id: Workflow.ID, agentBudget?: number) =>
      change(sessionID, id, (state) => {
        if (executing.has(id)) throw new Failure({ code: "busy", message: "Workflow execution is still closing" })
        requireResumeOwner(state)
        if (state.tasks.some((task) => task.status !== "done" && task.schemaAttempt !== undefined))
          throw new Failure({
            code: "stale",
            message: "Structured-output attempt was already claimed; start a new Workflow run",
          })
        if (!["paused", "budget_limited", "cancelled"].includes(state.info.status))
          throw new Failure({ code: "busy", message: "Workflow is not resumable" })
        if (
          agentBudget !== undefined &&
          (agentBudget < state.info.agentBudget || agentBudget > 1024 || !Number.isInteger(agentBudget))
        )
          throw new Failure({ code: "invalid", message: "Workflow budget can only increase up to 1024" })
        if (state.info.status === "budget_limited" && (agentBudget ?? state.info.agentBudget) <= state.info.agentBudget)
          throw new Failure({ code: "budget", message: "Increase the agent budget before resuming" })
        return {
          ...state,
          info: {
            ...state.info,
            status: "pending",
            message: undefined,
            pauseKind: undefined,
            agentBudget: agentBudget ?? state.info.agentBudget,
          },
        }
      }),
  }
}
export type Interface = ReturnType<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/WorkflowStore") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(
    Service,
    Database.Service.use((db) => Effect.succeed(make(db.db))),
  ),
  deps: [Database.node],
})

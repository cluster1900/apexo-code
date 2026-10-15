import { SessionChildPlacementRecord } from "./child-placement-record"
import { SessionEvent } from "./event"
import { SessionChildPolicy } from "./child-policy"
import { SessionInput } from "@apexo/schema/session-input"
export * as SessionTaskStore from "./task-store"

import { desc, eq } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { Context, Effect, Layer, Schema } from "effect"
import { Model } from "@apexo/schema/model"
import { optional } from "@apexo/schema/schema"
import { AgentV2 } from "../agent"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { PermissionAuthority } from "../permission/authority"
import { SessionSchema } from "./schema"
import { SessionMessage } from "./message"
import { SessionIncarnation } from "./incarnation"
import { SessionTaskLaunchTable, SessionTaskTable } from "./task.sql"
import { SessionTable } from "./sql"
import { SessionTaskOrigin } from "./task-origin"
import { SessionSchedule } from "@apexo/schema/session-schedule"
import { SessionScheduleAdmission } from "./schedule-admission"
import { SessionScheduleRecord } from "./schedule-record"

export class Failure extends Schema.TaggedErrorClass<Failure>()("SessionTaskFailure", {
  code: Schema.Literals(["missing", "busy", "invalid", "restart", "storage", "denied", "stale"]),
  message: Schema.String,
}) {}
export const Delegation = Schema.Struct({
  rootID: SessionSchema.ID,
  rootCreated: Schema.String,
  depth: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16 })),
  maxDepth: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16 })),
})
export type Delegation = typeof Delegation.Type
export const Record = Schema.Struct({
  sessionID: SessionSchema.ID,
  parentID: SessionSchema.ID,
  parentCreated: Schema.String,
  scheduleID: optional(SessionSchedule.ID),
  delegation: optional(Delegation),
  childCreated: Schema.String,
  agent: AgentV2.ID,
  inherited: optional(Schema.Boolean),
  sourcePolicy: optional(SessionChildPolicy.Policy),
  resume: optional(SessionEvent.HistoryCopy.Source),
  placement: optional(SessionChildPlacementRecord.Record),
  model: optional(Model.Ref),
  authority: Schema.Array(PermissionAuthority.Snapshot),
  createdAt: Schema.Number,
})
export type Record = typeof Record.Type
export const Request = Schema.Struct({
  description: Schema.String,
  prompt: Schema.String,
  agent: AgentV2.ID,
  taskID: optional(SessionSchema.ID),
  resumeFrom: optional(SessionSchema.ID),
  cwd: optional(Schema.String),
  isolation: optional(Schema.Literals(["none", "worktree"])),
  executionPolicy: optional(SessionInput.ExecutionPolicy),
  background: optional(Schema.Boolean),
  activeMessages: optional(Schema.Boolean),
})
export type Request = typeof Request.Type
export const Launch = Schema.Struct({
  id: Schema.String,
  sessionID: SessionSchema.ID,
  parentID: SessionSchema.ID,
  owner: Schema.String,
  request: Request,
  origin: optional(SessionTaskOrigin.Scheduled),
  status: Schema.Literals(["running", "completed", "failed", "cancelled"]),
  completedAt: optional(Schema.Number),
  replyID: optional(SessionMessage.ID),
  message: optional(Schema.String),
  notice: optional(Schema.Literals(["pending", "delivered", "observed", "suppressed"])),
  createdAt: Schema.Number,
})
export type Launch = typeof Launch.Type

/** Durable records establish authority; the live role separately admits an owned runner drain. */
export function make(db: Database.Interface["db"]) {
  const owner = randomUUID()
  const storage = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.mapError((error) =>
        error instanceof Failure
          ? error
          : error instanceof SessionScheduleRecord.Failure
            ? new Failure({ code: error.code, message: error.message })
            : new Failure({ code: "storage", message: "Task state is unavailable" }),
      ),
    )
  const read = (sessionID: SessionSchema.ID) =>
    storage(
      Effect.gen(function* () {
        const row = yield* db.select().from(SessionTaskTable).where(eq(SessionTaskTable.session_id, sessionID)).get()
        if (!row) return
        const record = yield* Schema.decodeUnknownEffect(Record)(row.data)
        if (record.sessionID !== row.session_id || record.parentID !== row.parent_id)
          return yield* new Failure({ code: "storage", message: "Task ownership is invalid" })
        return record
      }),
    )
  const owned = (parentID: SessionSchema.ID, sessionID: SessionSchema.ID) =>
    storage(
      Effect.gen(function* () {
        const record = yield* read(sessionID)
        if (!record || record.parentID !== parentID)
          return yield* new Failure({ code: "missing", message: "Task does not belong to this Session" })
        if (
          record.parentCreated !== (yield* SessionIncarnation.created(db, parentID)) ||
          record.childCreated !== (yield* SessionIncarnation.created(db, sessionID)) ||
          (record.delegation !== undefined &&
            (record.delegation.depth > record.delegation.maxDepth ||
              record.delegation.rootCreated !== (yield* SessionIncarnation.created(db, record.delegation.rootID))))
        )
          return yield* new Failure({
            code: "stale",
            message: "Task ownership no longer matches this Session incarnation",
          })
        return record
      }),
    )
  const launch = (id: string) =>
    storage(
      Effect.gen(function* () {
        const row = yield* db.select().from(SessionTaskLaunchTable).where(eq(SessionTaskLaunchTable.id, id)).get()
        if (!row) return
        const value = yield* Schema.decodeUnknownEffect(Launch)(row.data)
        if (value.id !== row.id || value.sessionID !== row.session_id)
          return yield* new Failure({ code: "storage", message: "Task launch ownership is invalid" })
        return value
      }),
    )
  const validateDelegation = (record: Record) =>
    Effect.gen(function* () {
      const parent = yield* read(record.parentID)
      const policy = record.delegation
      if (!parent) {
        if (!policy) return // Historical first-level Tasks retain the default non-delegating policy.
        if (policy.depth === 1 && policy.rootID === record.parentID && policy.rootCreated === record.parentCreated)
          return
        return yield* new Failure({ code: "invalid", message: "Task root delegation identity is invalid" })
      }
      yield* owned(parent.parentID, parent.sessionID)
      const inherited = parent.delegation
      if (
        !policy ||
        !inherited ||
        policy.depth !== inherited.depth + 1 ||
        policy.depth > inherited.maxDepth ||
        policy.maxDepth !== inherited.maxDepth ||
        policy.rootID !== inherited.rootID ||
        policy.rootCreated !== inherited.rootCreated
      )
        return yield* new Failure({
          code: "denied",
          message: "Task delegation must retain its original root depth limit",
        })
    })
  const insert = (record: Record) =>
    db
      .insert(SessionTaskTable)
      .values({
        session_id: record.sessionID,
        parent_id: record.parentID,
        data: record,
        time_created: record.createdAt,
      })
      .run()
  return {
    /** Only the Created publication commit may use this reserved event proof, before EventTable insertion. */
    commitCreated: (record: Record, scheduled?: { origin: SessionTaskOrigin.Scheduled; launchID: string }) =>
      storage(
        Effect.gen(function* () {
          const child = yield* db
            .select({ parentID: SessionTable.parent_id })
            .from(SessionTable)
            .where(eq(SessionTable.id, record.sessionID))
            .get()
          if (
            !child ||
            child.parentID !== record.parentID ||
            record.parentCreated !== (yield* SessionIncarnation.created(db, record.parentID)) ||
            (yield* SessionIncarnation.created(db, record.sessionID)) ||
            (yield* read(record.sessionID))
          )
            return yield* new Failure({
              code: "invalid",
              message: "Task ownership requires its original atomic child creation",
            })
          if (record.scheduleID !== scheduled?.origin.scheduleID)
            return yield* new Failure({ code: "denied", message: "Task scheduling ownership is unavailable" })
          if (scheduled)
            yield* SessionScheduleAdmission.bind(
              db,
              scheduled.origin,
              owner,
              record.parentID,
              record.sessionID,
              scheduled.launchID,
            )
          yield* validateDelegation(record)
          yield* insert(record)
        }),
      ),
    list: (parentID: SessionSchema.ID, limit = 50) =>
      storage(
        Effect.gen(function* () {
          const created = yield* SessionIncarnation.created(db, parentID)
          if (!created) return yield* new Failure({ code: "missing", message: "Task parent no longer exists" })
          const rows = yield* db
            .select()
            .from(SessionTaskTable)
            .where(eq(SessionTaskTable.parent_id, parentID))
            .orderBy(desc(SessionTaskTable.time_created), desc(SessionTaskTable.session_id))
            .limit(Math.min(100, Math.max(1, limit)))
          const records = yield* Effect.forEach(rows, (row) => Schema.decodeUnknownEffect(Record)(row.data))
          return records.filter((record) => record.parentCreated === created)
        }),
      ),
    owner,
    managed: (sessionID: SessionSchema.ID) => managed(db, sessionID),
    read,
    owned,
    launch,
    create: (record: Record) =>
      storage(
        Effect.gen(function* () {
          if (record.scheduleID)
            return yield* new Failure({
              code: "denied",
              message: "Scheduled Tasks require atomic occurrence admission",
            })
          const existing = yield* read(record.sessionID)
          if (existing) return yield* new Failure({ code: "invalid", message: "Task ownership already exists" })
          if (
            record.parentCreated !== (yield* SessionIncarnation.created(db, record.parentID)) ||
            record.childCreated !== (yield* SessionIncarnation.created(db, record.sessionID))
          )
            return yield* new Failure({ code: "missing", message: "Task creation identity is unavailable" })
          yield* validateDelegation(record)
          yield* insert(record)
        }),
      ),
    begin: (input: Pick<Launch, "id" | "sessionID" | "parentID" | "request" | "origin">) =>
      storage(
        db.transaction(
          () =>
            Effect.gen(function* () {
              const record = yield* owned(input.parentID, input.sessionID)
              if (record.scheduleID !== input.origin?.scheduleID)
                return yield* new Failure({
                  code: "denied",
                  message: "Task launch must retain its original scheduling owner",
                })
              const previous = yield* launch(input.id)
              if (previous) {
                if (
                  previous.parentID !== input.parentID ||
                  previous.sessionID !== input.sessionID ||
                  JSON.stringify(previous.request) !== JSON.stringify(input.request) ||
                  previous.origin?.scheduleID !== input.origin?.scheduleID ||
                  previous.origin?.occurrenceID !== input.origin?.occurrenceID
                )
                  return yield* new Failure({
                    code: "invalid",
                    message: "Task launch identity was reused with different input",
                  })
                if (previous.status === "running")
                  return yield* new Failure({
                    code: previous.owner === owner ? "busy" : "restart",
                    message:
                      previous.owner === owner
                        ? "Task launch is already running"
                        : "Interrupted Task launch cannot be retried; start a new Task",
                  })
                return previous
              }
              const rows = yield* db
                .select()
                .from(SessionTaskLaunchTable)
                .where(eq(SessionTaskLaunchTable.session_id, input.sessionID))
              for (const row of rows) {
                const prior = yield* Schema.decodeUnknownEffect(Launch)(row.data)
                if (prior.status === "running")
                  return yield* new Failure({
                    code: prior.owner === owner ? "busy" : "restart",
                    message: "Task has unfinished work; wait for it or start a new Task",
                  })
              }
              if (input.origin)
                yield* SessionScheduleAdmission.bind(db, input.origin, owner, input.parentID, input.sessionID, input.id)
              const value: Launch = {
                ...input,
                owner,
                status: "running",
                createdAt: Math.max(Date.now(), ...rows.map((row) => row.time_created + 1)),
              }
              yield* db
                .insert(SessionTaskLaunchTable)
                .values({ id: value.id, session_id: value.sessionID, data: value, time_created: value.createdAt })
              return value
            }),
          { behavior: "immediate" },
        ),
      ),
    finish: (
      input: Pick<Launch, "id" | "sessionID" | "parentID"> & {
        status: "completed" | "failed" | "cancelled"
        replyID?: SessionMessage.ID
        message?: string
        summary?: string
      },
    ) =>
      storage(
        db.transaction(
          () =>
            Effect.gen(function* () {
              yield* owned(input.parentID, input.sessionID)
              const previous = yield* launch(input.id)
              if (
                !previous ||
                previous.parentID !== input.parentID ||
                previous.sessionID !== input.sessionID ||
                previous.owner !== owner
              )
                return yield* new Failure({ code: "missing", message: "Task launch no longer belongs to this owner" })
              if (previous.status !== "running") return previous
              const completedAt = Date.now()
              if (previous.origin)
                yield* SessionScheduleAdmission.settle(db, previous.origin, owner, input.id, {
                  status: input.status,
                  completedAt,
                  summary: input.summary,
                })
              const value: Launch = {
                ...previous,
                status: input.status,
                completedAt,
                replyID: input.replyID,
                message: input.message,
              }
              yield* db
                .update(SessionTaskLaunchTable)
                .set({ data: value })
                .where(eq(SessionTaskLaunchTable.id, input.id))
              return value
            }),
          { behavior: "immediate" },
        ),
      ),
    notice: (id: string, state: NonNullable<Launch["notice"]>) =>
      storage(
        db.transaction(
          () =>
            Effect.gen(function* () {
              const previous = yield* launch(id)
              if (!previous || previous.owner !== owner || !previous.request.background) return false
              yield* owned(previous.parentID, previous.sessionID)
              if (previous.status === "running" || previous.status === "cancelled") return false
              if (
                state === "pending"
                  ? previous.notice !== undefined
                  : previous.notice !== undefined && previous.notice !== "pending"
              )
                return false
              yield* db
                .update(SessionTaskLaunchTable)
                .set({ data: { ...previous, notice: state } })
                .where(eq(SessionTaskLaunchTable.id, id))
              return true
            }),
          { behavior: "immediate" },
        ),
      ),
    latest: (parentID: SessionSchema.ID, sessionID: SessionSchema.ID) =>
      storage(
        Effect.gen(function* () {
          yield* owned(parentID, sessionID)
          const row = yield* db
            .select()
            .from(SessionTaskLaunchTable)
            .where(eq(SessionTaskLaunchTable.session_id, sessionID))
            .orderBy(desc(SessionTaskLaunchTable.time_created), desc(SessionTaskLaunchTable.id))
            .get()
          return row ? yield* Schema.decodeUnknownEffect(Launch)(row.data) : undefined
        }),
      ),
  }
}
export type Interface = ReturnType<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionTaskStore") {}
export const node = makeGlobalNode({
  service: Service,
  deps: [Database.node],
  layer: Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      return make(database.db)
    }),
  ),
})

/** A present private record is never ordinary execution, including stale or invalid authority. */
export const managed = (db: Database.Interface["db"], sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const row = yield* db.select().from(SessionTaskTable).where(eq(SessionTaskTable.session_id, sessionID)).get()
    if (!row) return false
    const record = yield* Schema.decodeUnknownEffect(Record)(row.data)
    if (record.sessionID !== row.session_id || record.parentID !== row.parent_id)
      return yield* new Failure({ code: "storage", message: "Task ownership is invalid" })
    if (
      record.childCreated !== (yield* SessionIncarnation.created(db, sessionID)) ||
      record.parentCreated !== (yield* SessionIncarnation.created(db, record.parentID))
    )
      return yield* new Failure({ code: "stale", message: "Task ownership no longer matches this Session incarnation" })
    return true
  }).pipe(
    Effect.mapError((error) =>
      error instanceof Failure ? error : new Failure({ code: "storage", message: "Task ownership is unavailable" }),
    ),
  )

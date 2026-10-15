export * as SessionManagedChild from "./managed-child"

import { and, asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Workflow } from "@apexo/schema/workflow"
import { Goal } from "@apexo/schema/goal"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { EventTable } from "../event/sql"
import { SessionV1 } from "../v1/session"
import { SessionSchema } from "./schema"
import { SessionIncarnation } from "./incarnation"
import { SessionLifecycle } from "./lifecycle"
import { SessionManagedChildTable } from "./managed-child.sql"
import { SessionTaskStore } from "./task-store"
import { SessionTable } from "./sql"

export class Failure extends Schema.TaggedErrorClass<Failure>()("SessionManagedChildFailure", {
  code: Schema.Literals(["missing", "stale", "invalid", "storage"]),
  message: Schema.String,
}) {}
export const Owner = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("workflow"), runID: Workflow.ID, key: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("goal"),
    goalID: Goal.ID,
    attemptID: Schema.String,
    role: Schema.Literals(["planning", "verifying", "strategizing", "summary"]),
  }),
])
export type Owner = typeof Owner.Type
export const Record = Schema.Struct({
  sessionID: SessionSchema.ID,
  parentID: SessionSchema.ID,
  parentCreated: Schema.String,
  childCreated: Schema.String,
  owner: Owner,
})
export type Record = typeof Record.Type
const identity = Symbol("Managed child creation")
export interface Capability {
  readonly [identity]: true
}
const storage = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.mapError((error) =>
      error instanceof Failure
        ? error
        : new Failure({ code: "storage", message: "Managed child ownership is unavailable" }),
    ),
  )
export const same = (left: Record, right: Record) =>
  left.sessionID === right.sessionID &&
  left.parentID === right.parentID &&
  left.parentCreated === right.parentCreated &&
  left.childCreated === right.childCreated &&
  sameOwner(left.owner, right.owner)
const sameOwner = (left: Owner, right: Owner) =>
  left.kind === "workflow"
    ? right.kind === "workflow" && left.runID === right.runID && left.key === right.key
    : right.kind === "goal" &&
      left.goalID === right.goalID &&
      left.attemptID === right.attemptID &&
      left.role === right.role

/** Only absence means ordinary; stale or malformed private evidence always fails closed. */
export const read = (db: Database.Interface["db"], sessionID: SessionSchema.ID) =>
  storage(
    Effect.gen(function* () {
      const row = yield* db
        .select()
        .from(SessionManagedChildTable)
        .where(eq(SessionManagedChildTable.session_id, sessionID))
        .get()
      if (!row) return
      const record = yield* Schema.decodeUnknownEffect(Record)(row.data)
      if (record.sessionID !== row.session_id || record.parentID !== row.parent_id)
        return yield* new Failure({ code: "storage", message: "Managed child ownership is invalid" })
      if (
        record.childCreated !== (yield* SessionIncarnation.created(db, sessionID)) ||
        record.parentCreated !== (yield* SessionIncarnation.created(db, record.parentID))
      )
        return yield* new Failure({
          code: "stale",
          message: "Managed child incarnation changed; start a new Workflow run or Goal attempt",
        })
      return record
    }),
  )

/** Old Created markers can quarantine a child, but can never grant ownership or provider work. */
export const historical = (db: Database.Interface["db"], sessionID: SessionSchema.ID) =>
  storage(
    Effect.gen(function* () {
      const rows = yield* db
        .select({ data: EventTable.data })
        .from(EventTable)
        .where(
          and(
            eq(EventTable.aggregate_id, sessionID),
            eq(
              EventTable.type,
              EventV2.versionedType(SessionV1.Event.Created.type, SessionV1.Event.Created.durable!.version),
            ),
          ),
        )
        .orderBy(asc(EventTable.seq))
        .limit(2)
      if (!rows.length) return false
      if (rows.length !== 1)
        return yield* new Failure({ code: "stale", message: "Session creation proof is ambiguous" })
      const created = yield* Schema.decodeUnknownEffect(SessionV1.Event.Created.data)(rows[0].data)
      const metadata = created.info.metadata
      return !!metadata && ["workflowChild", "goalReview", "goalSummary"].some((key) => Object.hasOwn(metadata, key))
    }),
  )
export const managed = (db: Database.Interface["db"], sessionID: SessionSchema.ID) =>
  storage(
    Effect.gen(function* () {
      if (yield* SessionTaskStore.managed(db, sessionID)) return true
      if (yield* read(db, sessionID)) return true
      return yield* historical(db, sessionID)
    }),
  )

export const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const db = database.db
  const lifecycle = yield* SessionLifecycle.Service
  const capabilities = new WeakMap<Capability, { claim: SessionLifecycle.Claim; created: string; owner: Owner }>()
  const owned = (sessionID: SessionSchema.ID) =>
    Effect.gen(function* () {
      const record = yield* read(db, sessionID)
      if (!record)
        return yield* new Failure({
          code: "missing",
          message: "Child has no private ownership; start a new Workflow run or Goal attempt",
        })
      return record
    })
  return {
    read: (sessionID: SessionSchema.ID) => read(db, sessionID),
    managed: (sessionID: SessionSchema.ID) => managed(db, sessionID),
    owned,
    require: (sessionID: SessionSchema.ID, parentID: SessionSchema.ID, owner: Owner) =>
      Effect.gen(function* () {
        const record = yield* owned(sessionID)
        if (record.parentID !== parentID || !sameOwner(record.owner, owner))
          return yield* new Failure({ code: "stale", message: "Child belongs to a different managed operation" })
        return record
      }),
    capture: (parentID: SessionSchema.ID, owner: Owner) =>
      storage(
        Effect.gen(function* () {
          const claim = yield* lifecycle.capture(parentID)
          const created = yield* SessionIncarnation.created(db, parentID)
          if (!created) return yield* new Failure({ code: "missing", message: "Managed child parent no longer exists" })
          const value: Capability = { [identity]: true }
          capabilities.set(value, { claim, created, owner: yield* Schema.decodeUnknownEffect(Owner)(owner) })
          return value
        }),
      ),
    /** Compose inside Created's transaction, after projection and before EventTable append/notification. */
    commitCreated: (capability: Capability, sessionID: SessionSchema.ID, childCreated: EventV2.ID) =>
      storage(
        Effect.gen(function* () {
          const captured = capabilities.get(capability)
          if (!captured || !lifecycle.available(captured.claim))
            return yield* new Failure({ code: "stale", message: "Managed child parent capability expired" })
          const row = yield* db
            .select({ parentID: SessionTable.parent_id })
            .from(SessionTable)
            .where(eq(SessionTable.id, sessionID))
            .get()
          if (
            !row ||
            row.parentID !== captured.claim.sessionID ||
            captured.created !== (yield* SessionIncarnation.created(db, captured.claim.sessionID)) ||
            (yield* SessionIncarnation.created(db, sessionID)) ||
            (yield* read(db, sessionID))
          )
            return yield* new Failure({
              code: "invalid",
              message: "Managed ownership requires its original atomic child creation",
            })
          const record: Record = {
            sessionID,
            parentID: captured.claim.sessionID,
            parentCreated: captured.created,
            childCreated,
            owner: captured.owner,
          }
          yield* db
            .insert(SessionManagedChildTable)
            .values({ session_id: sessionID, parent_id: record.parentID, data: record })
            .run()
        }),
      ),
  }
})
export type Interface = Effect.Success<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionManagedChild") {}
export const node = makeGlobalNode({
  service: Service,
  deps: [Database.node, SessionLifecycle.node],
  layer: Layer.effect(Service, make),
})

export * as SessionPlanReceipt from "./plan-receipt"

import { optional } from "@apexo/schema/schema"
import { Question } from "@apexo/schema/question"
import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionIncarnation } from "./incarnation"
import { SessionLifecycle } from "./lifecycle"
import { SessionSchema } from "./schema"
import { SessionMessage } from "./message"
import { SessionEvent } from "./event"
import { SessionPlanReceiptTable } from "./plan-receipt.sql"

export class Failure extends Schema.TaggedErrorClass<Failure>()("SessionPlanFailure", {
  code: Schema.Literals(["conflict", "denied", "unavailable"]),
  message: Schema.String,
}) {}
export const Turn = Schema.Struct({ finish: Schema.String, tokens: SessionEvent.Step.Ended.data.fields.tokens })
export interface Turn extends Schema.Schema.Type<typeof Turn> {}
export const CurrentTurn = Context.Reference<Turn | undefined>("@apexo/SessionPlanReceipt/Turn", {
  defaultValue: () => undefined,
})
export const Record = Schema.Struct({
  sessionID: SessionSchema.ID,
  created: Schema.String,
  selection: Schema.String.pipe(optional),
  request: Question.Request,
  assistantMessageID: SessionMessage.ID,
  callID: Schema.String,
  artifact: Schema.Struct({
    path: Schema.String,
    resource: Schema.String,
    content: Schema.String,
    hash: Schema.String,
  }),
  turn: Turn,
  decision: Schema.Literals(["pending", "approved", "rejected", "cancelled"]),
  answers: Schema.Array(Question.Answer),
  settled: Schema.Boolean,
})
export interface Record extends Schema.Schema.Type<typeof Record> {}
export interface Checkpoint {
  readonly claim: SessionLifecycle.Claim
  readonly generation: number
}
const safe = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((error) =>
      error instanceof Failure
        ? error
        : new Failure({ code: "unavailable", message: "Plan approval storage is unavailable" }),
    ),
  )

const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const lifecycle = yield* SessionLifecycle.Service
  const locks = new WeakMap<SessionLifecycle.Claim, Semaphore.Semaphore>()
  const generations = new WeakMap<SessionLifecycle.Claim, number>()
  const tickets = new Map<Question.ID, { checkpoint: Checkpoint; release: () => void }>()
  const forget = (id: Question.ID) => {
    const ticket = tickets.get(id)
    if (!ticket) return
    tickets.delete(id)
    ticket.release()
  }
  const stop = (claim: SessionLifecycle.Claim) => {
    generations.set(claim, (generations.get(claim) ?? 0) + 1)
    for (const [id, ticket] of tickets) if (ticket.checkpoint.claim === claim) forget(id)
  }
  const current = (checkpoint: Checkpoint) =>
    lifecycle.available(checkpoint.claim) && checkpoint.generation === (generations.get(checkpoint.claim) ?? 0)
  const decode = (row: typeof SessionPlanReceiptTable.$inferSelect) =>
    safe(
      Effect.gen(function* () {
        const record = yield* Schema.decodeUnknownEffect(Record)(row.data)
        if (
          record.request.id !== row.id ||
          record.sessionID !== row.session_id ||
          record.request.sessionID !== row.session_id ||
          record.assistantMessageID !== row.assistant_message_id ||
          record.callID !== row.call_id
        )
          return yield* new Failure({ code: "unavailable", message: "Plan approval identity is invalid" })
        if (record.created !== (yield* SessionIncarnation.created(database.db, record.sessionID)))
          return yield* new Failure({ code: "conflict", message: "Plan approval belongs to an earlier Session" })
        return record
      }),
    )
  const read = (id: Question.ID, sessionID?: SessionSchema.ID) =>
    safe(
      Effect.gen(function* () {
        const row = yield* database.db
          .select()
          .from(SessionPlanReceiptTable)
          .where(
            sessionID
              ? and(eq(SessionPlanReceiptTable.id, id), eq(SessionPlanReceiptTable.session_id, sessionID))
              : eq(SessionPlanReceiptTable.id, id),
          )
          .get()
        return row ? yield* decode(row) : undefined
      }),
    )
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const id of tickets.keys()) forget(id)
    }),
  )
  return {
    read,
    stop,
    current,
    checkpoint: (claim: SessionLifecycle.Claim): Checkpoint => ({ claim, generation: generations.get(claim) ?? 0 }),
    lock: <A, E, R>(claim: SessionLifecycle.Claim, effect: Effect.Effect<A, E, R>) =>
      Effect.suspend(() => {
        const semaphore = locks.get(claim) ?? Semaphore.makeUnsafe(1)
        locks.set(claim, semaphore)
        return semaphore.withPermit(effect)
      }),
    list: (sessionID?: SessionSchema.ID) =>
      safe(
        Effect.gen(function* () {
          const rows = yield* database.db
            .select()
            .from(SessionPlanReceiptTable)
            .where(sessionID ? eq(SessionPlanReceiptTable.session_id, sessionID) : undefined)
            .all()
          return yield* Effect.forEach(rows, decode)
        }),
      ),
    write: (record: Record) =>
      safe(
        database.db
          .insert(SessionPlanReceiptTable)
          .values({
            id: record.request.id,
            session_id: record.sessionID,
            assistant_message_id: record.assistantMessageID,
            call_id: record.callID,
            data: record,
          })
          .onConflictDoUpdate({ target: SessionPlanReceiptTable.id, set: { data: record } })
          .run(),
      ).pipe(Effect.asVoid),
    issue: (id: Question.ID, checkpoint: Checkpoint) =>
      Effect.gen(function* () {
        if (!current(checkpoint)) return false
        forget(id)
        const ticket = { checkpoint, release: () => {} }
        ticket.release = yield* lifecycle.register(
          checkpoint.claim,
          ticket,
          Effect.sync(() => forget(id)),
        )
        if (!current(checkpoint)) {
          ticket.release()
          return false
        }
        tickets.set(id, ticket)
        return true
      }),
    ready: (sessionID: SessionSchema.ID) =>
      Effect.sync(() => {
        for (const [id, ticket] of tickets) {
          if (!current(ticket.checkpoint)) {
            forget(id)
            continue
          }
          if (ticket.checkpoint.claim.sessionID === sessionID) return true
        }
        return false
      }),
    consume: (sessionID: SessionSchema.ID) =>
      Effect.sync(() => {
        for (const [id, ticket] of tickets) if (ticket.checkpoint.claim.sessionID === sessionID) forget(id)
      }),
  }
})
export type Interface = Effect.Success<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionPlanReceipt") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Database.node, SessionLifecycle.node],
})

export * as SessionInput from "./input"

import { and, asc, desc, eq, isNull, lte, notExists } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { Admitted, Delivery, ExecutionPolicy } from "@apexo/schema/session-input"
import type { Database } from "../database/database"
import type { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionInputExecutionOwner } from "./input-execution-owner"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionSchema } from "./schema"
import { SessionTaskMessageTable } from "./task.sql"
import { SessionInputTable, SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

// Launch-bound messages are admitted only by their explicit owner promotion path.
const ordinaryInput = (db: DatabaseService) =>
  notExists(
    db
      .select({ id: SessionTaskMessageTable.input_id })
      .from(SessionTaskMessageTable)
      .where(eq(SessionTaskMessageTable.input_id, SessionInputTable.id)),
  )

export {
  Admitted,
  Delivery,
  ExecutionPolicy,
  Execution,
  ExecutionStatus,
  ExecutionReason,
  ExecutionWait,
} from "@apexo/schema/session-input"

const decodePrompt = Schema.decodeUnknownSync(Prompt)
const encodePrompt = Schema.encodeSync(Prompt)

const fromRow = (row: typeof SessionInputTable.$inferSelect): Admitted =>
  Admitted.make({
    admittedSeq: row.admitted_seq,
    id: SessionMessage.ID.make(row.id),
    sessionID: SessionSchema.ID.make(row.session_id),
    prompt: decodePrompt(row.prompt),
    delivery: row.delivery,
    ...(row.execution_policy === null ? {} : { executionPolicy: row.execution_policy }),
    timeCreated: DateTime.makeUnsafe(row.time_created),
    ...(row.promoted_seq === null ? {} : { promotedSeq: row.promoted_seq }),
    ...(row.withdrawn_seq === null ? {} : { withdrawnSeq: row.withdrawn_seq }),
  })

export const find = Effect.fn("SessionInput.find")(function* (db: DatabaseService, id: SessionMessage.ID) {
  const row = yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).get().pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

export class Withdrawn extends Schema.TaggedErrorClass<Withdrawn>()("SessionInput.Withdrawn", {
  id: SessionMessage.ID,
}) {}

export class LifecycleConflict extends Schema.TaggedErrorClass<LifecycleConflict>()("SessionInput.LifecycleConflict", {
  id: SessionMessage.ID,
}) {}

export const admit = Effect.fn("SessionInput.admit")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly executionPolicy?: ExecutionPolicy
  },
) {
  const existing = yield* find(db, input.id)
  if (existing !== undefined) return existing
  const timestamp = yield* DateTime.now
  return yield* events
    .publish(SessionEvent.PromptAdmitted, {
      messageID: input.id,
      sessionID: input.sessionID,
      timestamp,
      prompt: input.prompt,
      delivery: input.delivery,
      executionPolicy: input.executionPolicy,
    })
    .pipe(
      Effect.flatMap((event) =>
        event.durable === undefined
          ? Effect.die("Prompt admission event is missing aggregate sequence")
          : Effect.succeed(
              Admitted.make({
                admittedSeq: event.durable.seq,
                id: input.id,
                sessionID: input.sessionID,
                prompt: input.prompt,
                delivery: input.delivery,
                executionPolicy: input.executionPolicy,
                timeCreated: timestamp,
              }),
            ),
      ),
      Effect.catchDefect((defect) =>
        find(db, input.id).pipe(Effect.flatMap((stored) => (stored ? Effect.succeed(stored) : Effect.die(defect)))),
      ),
    )
})

export const projectAdmitted = Effect.fn("SessionInput.projectAdmitted")(function* (
  db: DatabaseService,
  input: {
    readonly admittedSeq: number
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly executionPolicy?: ExecutionPolicy
    readonly timeCreated: DateTime.Utc
  },
) {
  const message = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (message !== undefined) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const stored = yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      admitted_seq: input.admittedSeq,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      execution_policy: input.executionPolicy,
      execution_status: input.executionPolicy ? "admitted" : null,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .onConflictDoNothing()
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

export const projectWithdrawn = Effect.fn("SessionInput.projectWithdrawn")(function* (
  db: DatabaseService,
  input: { readonly id: SessionMessage.ID; readonly sessionID: SessionSchema.ID; readonly withdrawnSeq: number },
) {
  const stored = yield* find(db, input.id)
  if (!stored || stored.sessionID !== input.sessionID || stored.promotedSeq !== undefined || stored.executionPolicy)
    return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  if (stored.withdrawnSeq !== undefined) return
  yield* db
    .update(SessionInputTable)
    .set({ withdrawn_seq: input.withdrawnSeq })
    .where(
      and(
        eq(SessionInputTable.id, input.id),
        isNull(SessionInputTable.promoted_seq),
        isNull(SessionInputTable.withdrawn_seq),
      ),
    )
    .run()
    .pipe(Effect.orDie)
})

/** Internal ownership callers must fence their launch before withdrawing its pending inputs. */
export const withdraw = Effect.fn("SessionInput.withdraw")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  id: SessionMessage.ID,
) {
  const stored = yield* find(db, id)
  if (
    !stored ||
    stored.sessionID !== sessionID ||
    stored.promotedSeq !== undefined ||
    stored.withdrawnSeq !== undefined
  )
    return stored
  yield* events.publish(SessionEvent.PromptWithdrawn, { sessionID, messageID: id, timestamp: yield* DateTime.now })
  return yield* find(db, id)
})

export const projectPrompted = Effect.fn("SessionInput.projectPrompted")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly executionPolicy?: ExecutionPolicy
    readonly timeCreated: DateTime.Utc
    readonly promotedSeq: number
  },
) {
  const current = yield* db
    .select()
    .from(SessionInputTable)
    .where(eq(SessionInputTable.id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (current?.withdrawn_seq !== null && current?.withdrawn_seq !== undefined)
    return yield* Effect.die(new Withdrawn({ id: input.id }))
  if (
    current?.execution_ended_seq !== null &&
    current?.execution_ended_seq !== undefined &&
    current.promoted_seq === null
  )
    return yield* Effect.die(new Withdrawn({ id: input.id }))
  const previous = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, input.sessionID),
        eq(SessionInputTable.execution_status, "active"),
        isNull(SessionInputTable.execution_ended_seq),
        isNull(SessionInputTable.withdrawn_seq),
      ),
    )
    .orderBy(desc(SessionInputTable.promoted_seq))
    .all()
    .pipe(Effect.orDie)
  for (const row of previous) {
    if (row.id === input.id) continue
    yield* db
      .update(SessionInputTable)
      .set({
        execution_status: "superseded",
        execution_reason: "superseded",
        execution_ended_seq: input.promotedSeq,
      })
      .where(eq(SessionInputTable.id, row.id))
      .run()
      .pipe(Effect.orDie)
  }
  const updated = yield* db
    .update(SessionInputTable)
    .set({
      promoted_seq: input.promotedSeq,
      ...(input.executionPolicy
        ? {
            execution_status: "active" as const,
            execution_started_seq: input.promotedSeq,
            execution_usage_incomplete: true,
          }
        : {}),
    })
    .where(
      and(
        eq(SessionInputTable.id, input.id),
        eq(SessionInputTable.session_id, input.sessionID),
        isNull(SessionInputTable.promoted_seq),
        isNull(SessionInputTable.execution_ended_seq),
        isNull(SessionInputTable.withdrawn_seq),
      ),
    )
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (updated) {
    const stored = fromRow(updated)
    if (!matchesProjection(stored, input)) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  const stored = yield* find(db, input.id)
  if (stored) {
    if (!matchesProjection(stored, input) || stored.promotedSeq !== input.promotedSeq)
      return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      execution_policy: input.executionPolicy,
      execution_status: input.executionPolicy ? "active" : null,
      execution_started_seq: input.executionPolicy ? input.promotedSeq : null,
      execution_usage_incomplete: input.executionPolicy ? true : null,
      admitted_seq: input.promotedSeq,
      promoted_seq: input.promotedSeq,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .run()
    .pipe(Effect.orDie)
})

export const hasPending = Effect.fn("SessionInput.hasPending")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  delivery: Delivery,
) {
  const row = yield* db
    .select({ id: SessionInputTable.id })
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        ordinaryInput(db),
        isNull(SessionInputTable.promoted_seq),
        isNull(SessionInputTable.execution_ended_seq),
        isNull(SessionInputTable.withdrawn_seq),
        eq(SessionInputTable.delivery, delivery),
      ),
    )
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row !== undefined
})

export const equivalent = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly executionPolicy?: ExecutionPolicy
  },
) =>
  input.delivery === expected.delivery &&
  JSON.stringify(input.executionPolicy ?? null) === JSON.stringify(expected.executionPolicy ?? null) &&
  matchesPrompt(input, expected)

const matchesPrompt = (input: Admitted, expected: { readonly sessionID: SessionSchema.ID; readonly prompt: Prompt }) =>
  input.sessionID === expected.sessionID &&
  JSON.stringify(encodePrompt(input.prompt)) === JSON.stringify(encodePrompt(expected.prompt))

const matchesProjection = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly executionPolicy?: ExecutionPolicy
    readonly timeCreated: DateTime.Utc
  },
) =>
  equivalent(input, expected) &&
  DateTime.toEpochMillis(input.timeCreated) === DateTime.toEpochMillis(expected.timeCreated)

const publish = Effect.fn("SessionInput.publish")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  rows: ReadonlyArray<typeof SessionInputTable.$inferSelect>,
  commit?: () => Effect.Effect<void>,
) {
  const counts = yield* Effect.forEach(rows, (row) => {
    const id = SessionMessage.ID.make(row.id)
    return events
      .publish(
        SessionEvent.Prompted,
        {
          sessionID,
          timestamp: DateTime.makeUnsafe(row.time_created),
          messageID: id,
          prompt: decodePrompt(row.prompt),
          delivery: row.delivery,
          executionPolicy: row.execution_policy ?? undefined,
        },
        {
          commit: () =>
            Effect.gen(function* () {
              if (commit) yield* commit()
              if (row.execution_policy)
                yield* db
                  .update(SessionInputTable)
                  .set({ execution_owner: SessionInputExecutionOwner.stamp })
                  .where(eq(SessionInputTable.id, id))
                  .run()
                  .pipe(Effect.orDie)
              yield* SessionInputExecutionOwner.promoted(sessionID)
            }),
        },
      )
      .pipe(
        Effect.as(1),
        Effect.catchDefect((defect) =>
          defect instanceof Withdrawn
            ? Effect.succeed(0)
            : defect instanceof LifecycleConflict
              ? find(db, id).pipe(
                  Effect.flatMap((stored) =>
                    stored?.promotedSeq === undefined ? Effect.die(defect) : Effect.succeed(0),
                  ),
                )
              : Effect.die(defect),
        ),
      )
  })
  return counts.reduce((sum, count) => sum + count, 0)
})

export const promoteSteers = Effect.fn("SessionInput.promoteSteers")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  cutoff: number,
) {
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        ordinaryInput(db),
        isNull(SessionInputTable.promoted_seq),
        isNull(SessionInputTable.execution_ended_seq),
        isNull(SessionInputTable.withdrawn_seq),
        eq(SessionInputTable.delivery, "steer"),
        lte(SessionInputTable.admitted_seq, cutoff),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return yield* publish(db, events, sessionID, rows)
})

export const promoteNextQueued = Effect.fn("SessionInput.promoteNextQueued")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        ordinaryInput(db),
        isNull(SessionInputTable.promoted_seq),
        isNull(SessionInputTable.execution_ended_seq),
        isNull(SessionInputTable.withdrawn_seq),
        eq(SessionInputTable.delivery, "queue"),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? false : yield* publish(db, events, sessionID, [row]).pipe(Effect.map((count) => count > 0))
})

/** A managed child promotes only the prompt admitted by its live launch capability. */
export const promoteOwned = Effect.fn("SessionInput.promoteOwned")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  id: SessionMessage.ID,
  commit?: () => Effect.Effect<void>,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        commit ? undefined : ordinaryInput(db),
        eq(SessionInputTable.id, id),
        isNull(SessionInputTable.promoted_seq),
        isNull(SessionInputTable.execution_ended_seq),
        isNull(SessionInputTable.withdrawn_seq),
      ),
    )
    .get()
    .pipe(Effect.orDie)
  return row ? yield* publish(db, events, sessionID, [row], commit) : 0
})

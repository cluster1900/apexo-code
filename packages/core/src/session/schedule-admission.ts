export * as SessionScheduleAdmission from "./schedule-admission"

import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { SessionSchedule } from "@apexo/schema/session-schedule"
import { Database } from "../database/database"
import { SessionSchema } from "./schema"
import { SessionIncarnation } from "./incarnation"
import { SessionGoal } from "./goal"
import { SessionPlanReceipt } from "./plan-receipt"
import { SessionPlanReceiptTable } from "./plan-receipt.sql"
import { SessionScheduleTable, SessionScheduleOccurrenceTable } from "./schedule.sql"
import { SessionScheduleRecord } from "./schedule-record"
import { SessionTaskOrigin } from "./task-origin"

export const intent = (db: Database.Interface["db"], id: SessionSchedule.ID) =>
  Effect.gen(function* () {
    const row = yield* db.select().from(SessionScheduleTable).where(eq(SessionScheduleTable.id, id)).get()
    if (!row) return yield* new SessionScheduleRecord.Failure({ code: "missing", message: "Schedule does not exist" })
    const value = yield* Schema.decodeUnknownEffect(SessionScheduleRecord.Intent)(row.data)
    if (value.id !== row.id || value.sessionID !== row.session_id || value.invocation !== row.invocation)
      return yield* new SessionScheduleRecord.Failure({ code: "storage", message: "Schedule identity is invalid" })
    if (value.parentCreated !== (yield* SessionIncarnation.created(db, value.sessionID)))
      return yield* new SessionScheduleRecord.Failure({
        code: "stale",
        message: "Schedule belongs to an earlier Session",
      })
    return value
  })

export const occurrence = (db: Database.Interface["db"], id: SessionTaskOrigin.OccurrenceID) =>
  Effect.gen(function* () {
    const row = yield* db
      .select()
      .from(SessionScheduleOccurrenceTable)
      .where(eq(SessionScheduleOccurrenceTable.id, id))
      .get()
    if (!row)
      return yield* new SessionScheduleRecord.Failure({
        code: "missing",
        message: "Schedule occurrence does not exist",
      })
    const value = yield* Schema.decodeUnknownEffect(SessionScheduleRecord.Occurrence)(row.data)
    if (value.id !== row.id || value.scheduleID !== row.schedule_id || value.ordinal !== row.ordinal)
      return yield* new SessionScheduleRecord.Failure({
        code: "storage",
        message: "Schedule occurrence identity is invalid",
      })
    if (value.parentCreated !== (yield* SessionIncarnation.created(db, value.parentID)))
      return yield* new SessionScheduleRecord.Failure({
        code: "stale",
        message: "Schedule occurrence belongs to an earlier Session",
      })
    return value
  })

/** Rechecked inside final admission transaction, after external permission/credential work. */
export const blocked = (db: Database.Interface["db"], parentID: SessionSchema.ID) =>
  Effect.gen(function* () {
    if ((yield* SessionGoal.make(db).get(parentID))?.status === "active") return "goal_active" as const
    const rows = yield* db
      .select()
      .from(SessionPlanReceiptTable)
      .where(eq(SessionPlanReceiptTable.session_id, parentID))
    for (const row of rows) {
      const value = yield* Schema.decodeUnknownEffect(SessionPlanReceipt.Record)(row.data)
      if (
        value.sessionID !== parentID ||
        value.request.id !== row.id ||
        value.created !== (yield* SessionIncarnation.created(db, parentID))
      )
        return yield* new SessionScheduleRecord.Failure({
          code: "storage",
          message: "Plan approval identity is unavailable",
        })
      if (value.decision === "pending") return "plan_pending" as const
    }
  })

export const available = (db: Database.Interface["db"], parentID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const reason = yield* blocked(db, parentID)
    if (reason)
      return yield* new SessionScheduleRecord.Failure({
        code: "busy",
        message:
          reason === "goal_active"
            ? "Schedule is blocked by active Goal execution"
            : "Schedule is blocked by pending Plan approval",
      })
  })

export const admission = (db: Database.Interface["db"], id: SessionTaskOrigin.OccurrenceID, owner: string) =>
  Effect.gen(function* () {
    const item = yield* occurrence(db, id)
    if (item.owner !== owner)
      return yield* new SessionScheduleRecord.Failure({
        code: "restart",
        message: "Interrupted schedule work cannot be replayed",
      })
    return {
      origin: { scheduleID: item.scheduleID, occurrenceID: item.id },
      revision: item.revision,
      processOwner: item.owner,
      parentID: item.parentID,
      parentCreated: item.parentCreated,
      parentAgent: item.parentAgent,
      agent: item.agent,
      model: item.model,
      authority: item.authority,
      description: item.description,
      prompt: item.prompt,
      taskID: item.followup ? item.childID : undefined,
      childID: item.childID,
      launchID: item.launchID,
      permissionSource: item.permissionSource,
    } satisfies SessionTaskOrigin.Admission
  })

/** Caller owns the transaction. A new child uses its atomic Created commit; follow-up uses Task.begin. */
export const bind = (
  db: Database.Interface["db"],
  origin: SessionTaskOrigin.Scheduled,
  owner: string,
  parentID: SessionSchema.ID,
  childID: SessionSchema.ID,
  launchID: string,
) =>
  Effect.gen(function* () {
    const fence = yield* SessionTaskOrigin.Current
    if (!fence || fence.occurrenceID !== origin.occurrenceID)
      return yield* new SessionScheduleRecord.Failure({
        code: "stale",
        message: "Schedule launch was stopped before admission",
      })
    const item = yield* occurrence(db, origin.occurrenceID)
    if (
      item.scheduleID !== origin.scheduleID ||
      item.owner !== owner ||
      item.parentID !== parentID ||
      item.childID !== childID ||
      item.launchID !== launchID
    )
      return yield* new SessionScheduleRecord.Failure({
        code: "denied",
        message: "Schedule occurrence does not own this Task admission",
      })
    // Created already committed child ownership. Finish only that exact Task receipt even after Stop;
    // the owned worker checks the epoch before invoking the child runner.
    if (item.status === "admitted") return item
    if (!fence.current())
      return yield* new SessionScheduleRecord.Failure({
        code: "stale",
        message: "Schedule launch was stopped before admission",
      })
    if (item.status !== "claimed")
      return yield* new SessionScheduleRecord.Failure({
        code: "invalid",
        message: "Schedule occurrence is already settled",
      })
    const current = yield* intent(db, origin.scheduleID)
    if (
      current.status !== "active" ||
      current.owner !== owner ||
      current.revision !== item.revision ||
      current.generation !== item.generation ||
      current.expiresAt <= Date.now()
    )
      return yield* new SessionScheduleRecord.Failure({
        code: "stale",
        message: "Schedule changed before Task admission",
      })
    yield* available(db, parentID)
    if (!fence.current())
      return yield* new SessionScheduleRecord.Failure({
        code: "stale",
        message: "Schedule launch was stopped before admission",
      })
    const next: SessionScheduleRecord.Occurrence = { ...item, status: "admitted" }
    yield* db
      .update(SessionScheduleOccurrenceTable)
      .set({ data: next })
      .where(eq(SessionScheduleOccurrenceTable.id, item.id))
    return next
  })

/** Terminal Task and occurrence writes share one transaction, before any completion notice. */
export const settle = (
  db: Database.Interface["db"],
  origin: SessionTaskOrigin.Scheduled,
  owner: string,
  launchID: string,
  outcome: { status: "completed" | "failed" | "cancelled"; completedAt: number; summary?: string },
) =>
  Effect.gen(function* () {
    const item = yield* occurrence(db, origin.occurrenceID)
    if (item.scheduleID !== origin.scheduleID || item.owner !== owner || item.launchID !== launchID)
      return yield* new SessionScheduleRecord.Failure({
        code: "denied",
        message: "Task cannot settle this schedule occurrence",
      })
    if (item.status !== "admitted") {
      if (item.status === outcome.status) return
      return yield* new SessionScheduleRecord.Failure({
        code: "stale",
        message: "Schedule occurrence settlement changed",
      })
    }
    yield* db
      .update(SessionScheduleOccurrenceTable)
      .set({ data: { ...item, status: outcome.status, completedAt: outcome.completedAt } })
      .where(eq(SessionScheduleOccurrenceTable.id, item.id))
    const current = yield* intent(db, item.scheduleID)
    // An update resets the continuation chain without cancelling an already admitted old child.
    if (current.generation !== item.generation) return
    yield* db
      .update(SessionScheduleTable)
      .set({
        data: {
          ...current,
          childID: outcome.status === "completed" ? item.childID : undefined,
          childGeneration: outcome.status === "completed" ? item.generation : undefined,
          chainCount: outcome.status === "completed" ? current.chainCount + 1 : 0,
          summary: outcome.status === "completed" ? (outcome.summary ?? "").slice(0, 600) : current.summary,
        },
      })
      .where(eq(SessionScheduleTable.id, current.id))
  })

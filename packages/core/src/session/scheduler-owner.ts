export * as SessionSchedulerOwner from "./scheduler-owner"

import { and, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database"
import { Scheduler } from "../scheduler"
import { SessionIncarnation } from "./incarnation"
import { SessionLifecycle } from "./lifecycle"
import { SessionSchema } from "./schema"
import { MessageTable, PartTable, SessionTable } from "./sql"
import { MessageID } from "../v1/session"

const receipt = Schema.Struct({
  type: Schema.Literal("tool"),
  tool: Schema.Literal("scheduler_create"),
  state: Schema.Struct({
    status: Schema.Literal("completed"),
    metadata: Schema.Struct({ task_id: Schema.String }),
  }),
})

export function make(db: Database.Interface["db"], lifecycle: SessionLifecycle.Interface): Scheduler.Ownership {
  return {
    current: (id) =>
      lifecycle
        .read(
          SessionSchema.ID.make(id),
          Effect.gen(function* () {
            const sessionID = SessionSchema.ID.make(id)
            const claim = yield* lifecycle.find(sessionID)
            const row = yield* db
              .select({ id: SessionTable.id })
              .from(SessionTable)
              .where(eq(SessionTable.id, sessionID))
              .get()
            if (!row) return
            const created = yield* SessionIncarnation.created(db, sessionID)
            if (!claim || !lifecycle.available(claim)) return
            if (!created)
              return yield* new Scheduler.SchedulerError({
                message: "Session creation identity is unavailable; the saved schedule remains inactive",
              })
            return created
          }),
        )
        .pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.succeed(undefined))),
    legacy: (schedule) =>
      lifecycle
        .read(
          SessionSchema.ID.make(schedule.ownerSessionId),
          Effect.gen(function* () {
            if (!schedule.resume) return false
            const rows = yield* db
              .select({ data: PartTable.data })
              .from(PartTable)
              .innerJoin(MessageTable, eq(MessageTable.id, PartTable.message_id))
              .where(
                and(
                  eq(PartTable.session_id, SessionSchema.ID.make(schedule.ownerSessionId)),
                  eq(MessageTable.session_id, SessionSchema.ID.make(schedule.ownerSessionId)),
                  eq(PartTable.message_id, MessageID.make(schedule.resume.messageID)),
                ),
              )
              .all()
            // An actual completed tool receipt proves this exact saved task belonged to this Session.
            // An arbitrary reused message ID or timestamp is not sufficient evidence.
            return rows.some((row) => Schema.is(receipt)(row.data) && row.data.state.metadata.task_id === schedule.id)
          }),
        )
        .pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.succeed(false))),
  }
}

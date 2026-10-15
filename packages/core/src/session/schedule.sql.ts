import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { SessionSchedule } from "@apexo/schema/session-schedule"
import type { SessionSchema } from "./schema"
import type { SessionTaskOrigin } from "./task-origin"
import { SessionTable } from "./sql"

/** Native future intent. Deletion is a tombstone so admitted Task receipts remain independent. */
export const SessionScheduleTable = sqliteTable(
  "session_schedule",
  {
    id: text().$type<SessionSchedule.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    invocation: text().notNull(),
    data: text({ mode: "json" }).$type<unknown>().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [
    uniqueIndex("session_schedule_invocation_idx").on(table.session_id, table.invocation),
    index("session_schedule_session_idx").on(table.session_id, table.time_created),
  ],
)

/** A claimed occurrence never authorizes replay after process restart. */
export const SessionScheduleOccurrenceTable = sqliteTable(
  "session_schedule_occurrence",
  {
    id: text().$type<SessionTaskOrigin.OccurrenceID>().primaryKey(),
    schedule_id: text()
      .$type<SessionSchedule.ID>()
      .notNull()
      .references(() => SessionScheduleTable.id, { onDelete: "cascade" }),
    ordinal: integer().notNull(),
    data: text({ mode: "json" }).$type<unknown>().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [uniqueIndex("session_schedule_occurrence_ordinal_idx").on(table.schedule_id, table.ordinal)],
)

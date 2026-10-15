import { blob, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionID } from "@apexo/schema/session-id"
import { SessionTable } from "../session/sql"

export const FeedbackDraftTable = sqliteTable(
  "session_feedback_draft",
  {
    id: text().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    data: text({ mode: "json" }).$type<unknown>().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [index("session_feedback_draft_session_idx").on(table.session_id, table.time_created)],
)

export const FeedbackImageTable = sqliteTable(
  "session_feedback_image",
  {
    id: text().primaryKey(),
    draft_id: text()
      .notNull()
      .references(() => FeedbackDraftTable.id, { onDelete: "cascade" }),
    mime_type: text().notNull(),
    file_name: text().notNull(),
    size: integer().notNull(),
    data: blob({ mode: "buffer" }).notNull(),
  },
  (table) => [index("session_feedback_image_draft_idx").on(table.draft_id)],
)

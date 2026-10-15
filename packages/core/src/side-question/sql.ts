import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionID } from "@apexo/schema/session-id"
import { SessionTable } from "../session/sql"

export const SideQuestionTable = sqliteTable(
  "session_side_question",
  {
    id: text().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    data: text({ mode: "json" }).$type<unknown>().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [index("session_side_question_session_idx").on(table.session_id, table.time_created)],
)

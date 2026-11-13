import { CodeReview } from "@apexo/schema/code-review"
import { SessionID } from "@apexo/schema/session-id"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./sql"

export const SessionCodeReviewTable = sqliteTable(
  "session_code_review",
  {
    id: text().$type<CodeReview.ID>().primaryKey(),
    parent_session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    data: text({ mode: "json" }).$type<unknown>().notNull(),
    time_created: integer().notNull(),
    execution_owner: text(),
  },
  (table) => [index("session_code_review_parent_idx").on(table.parent_session_id, table.time_created)],
)

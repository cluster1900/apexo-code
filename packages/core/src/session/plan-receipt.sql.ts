import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./sql"
import type { SessionSchema } from "./schema"
import type { Question } from "@apexo/schema/question"

/** Private Plan interaction receipts; public metadata never grants continuation authority. */
export const SessionPlanReceiptTable = sqliteTable(
  "session_plan_receipt",
  {
    id: text().$type<Question.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    assistant_message_id: text().notNull(),
    call_id: text().notNull(),
    data: text({ mode: "json" }).$type<unknown>().notNull(),
  },
  (table) => [
    index("session_plan_receipt_session").on(table.session_id),
    uniqueIndex("session_plan_receipt_call").on(table.session_id, table.assistant_message_id, table.call_id),
  ],
)

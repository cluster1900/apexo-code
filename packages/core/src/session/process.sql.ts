import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { SessionProcess } from "@apexo/schema/session-process"
import type { SessionSchema } from "./schema"
import { SessionTable } from "./sql"

/** Private process authority; neither Session metadata nor BackgroundJob metadata can create a receipt. */
export const SessionProcessTable = sqliteTable(
  "session_process",
  {
    id: text().$type<SessionProcess.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    invocation: text().notNull(),
    data: text({ mode: "json" }).$type<unknown>().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [
    uniqueIndex("session_process_invocation_idx").on(table.session_id, table.invocation),
    index("session_process_session_idx").on(table.session_id, table.time_created),
  ],
)

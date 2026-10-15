import { integer, sqliteTable, text, index, primaryKey } from "drizzle-orm/sqlite-core"
import { SessionSchema } from "./schema"
import { SessionTable } from "./sql"

export const SessionHookStopTable = sqliteTable(
  "session_hook_stop",
  {
    engine: text().$type<"v1" | "v2">().notNull(),
    message_id: text().notNull(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    state: text().$type<"evaluating" | "ready" | "consumed">().notNull(),
    reason: text(),
    force_stop: integer({ mode: "boolean" }).notNull().default(false),
    time_created: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.engine, table.message_id] }),
    index("session_hook_stop_pending_idx").on(table.session_id, table.state),
  ],
)

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { SessionSchema } from "./schema"
import { SessionTable } from "./sql"

/** Durable process-local execution ownership. The generation fences stale runners after a restart or takeover. */
export const SessionExecutionTable = sqliteTable(
  "session_execution",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    owner_id: text().notNull(),
    generation: integer().notNull(),
    status: text().notNull(),
    attempt_id: text().notNull(),
    started_at: integer().notNull(),
    heartbeat_at: integer().notNull(),
    ended_at: integer(),
    error: text(),
  },
  (table) => [index("session_execution_status_idx").on(table.status, table.heartbeat_at)],
)

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { MemoryOperation } from "@apexo/schema/memory-operation"
import type { SessionSchema } from "./schema"
import { SessionTable } from "./sql"

/** Durable management evidence. A receipt never grants authority to run or publish. */
export const SessionMemoryOperationTable = sqliteTable(
  "session_memory_operation",
  {
    id: text().$type<MemoryOperation.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    token: text().notNull(),
    created_event_id: text().notNull(),
    data: text({ mode: "json" }).$type<unknown>().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [index("session_memory_operation_session_idx").on(table.session_id, table.time_created)],
)

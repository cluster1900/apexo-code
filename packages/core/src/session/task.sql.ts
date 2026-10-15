import { index, sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { SessionInputTable, SessionTable } from "./sql"
import type { SessionSchema } from "./schema"

/** Private ownership and permission authority. Never projected through Session metadata PATCH. */
export const SessionTaskTable = sqliteTable(
  "session_task",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    parent_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    data: text({ mode: "json" }).$type<unknown>().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [index("session_task_parent_idx").on(table.parent_id, table.time_created)],
)

/** One immutable admitted tool request. Interrupted work is evidence, never permission to retry. */
export const SessionTaskLaunchTable = sqliteTable(
  "session_task_launch",
  {
    id: text().primaryKey(),
    admission_open: integer({ mode: "boolean" }).notNull().default(false),
    admission_closed: integer({ mode: "boolean" }).notNull().default(false),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTaskTable.session_id, { onDelete: "cascade" }),
    data: text({ mode: "json" }).$type<unknown>().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [index("session_task_launch_session_idx").on(table.session_id, table.time_created)],
)

/** Payload remains in the canonical inbox; this row only binds delivery to its authorized launch. */
export const SessionTaskMessageTable = sqliteTable(
  "session_task_message",
  {
    input_id: text()
      .primaryKey()
      .references(() => SessionInputTable.id, { onDelete: "cascade" }),
    launch_id: text()
      .notNull()
      .references(() => SessionTaskLaunchTable.id, { onDelete: "cascade" }),
    parent_created: text().notNull(),
    child_created: text().notNull(),
    delivery: text().$type<import("@apexo/schema/task").Task.MessageDelivery>().notNull(),
    bytes: integer().notNull(),
    terminal: text().$type<"cancelled" | "interrupted">(),
    promoted_at: integer(),
  },
  (table) => [index("session_task_message_launch_idx").on(table.launch_id)],
)

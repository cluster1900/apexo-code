import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./sql"
import type { SessionSchema } from "./schema"

export const SessionCommandSandboxTable = sqliteTable("session_command_sandbox", {
  session_id: text()
    .$type<SessionSchema.ID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  created_event_id: text().notNull(),
  version: integer().notNull(),
  policy: text({ mode: "json" }).$type<unknown>().notNull(),
  time_created: integer().notNull(),
})

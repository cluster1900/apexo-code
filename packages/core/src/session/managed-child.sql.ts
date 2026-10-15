import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./sql"
import type { SessionSchema } from "./schema"

/** Private domain ownership; Session metadata is never execution authority. */
export const SessionManagedChildTable = sqliteTable("session_managed_child", {
  session_id: text()
    .$type<SessionSchema.ID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  parent_id: text()
    .$type<SessionSchema.ID>()
    .notNull()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  data: text({ mode: "json" }).$type<unknown>().notNull(),
})

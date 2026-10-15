import { index, sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Workflow } from "@apexo/schema/workflow"
import { SessionID } from "@apexo/schema/session-id"
import { SessionTable } from "../session/sql"

export const WorkflowRunTable = sqliteTable(
  "session_workflow_run",
  {
    id: text().$type<Workflow.ID>().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    revision: integer().notNull(),
    data: text({ mode: "json" }).$type<unknown>().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [index("session_workflow_run_session_idx").on(table.session_id, table.time_created)],
)

import { integer, primaryKey, sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { Goal } from "@apexo/schema/goal"
import { SessionID } from "@apexo/schema/session-id"
import { SessionTable } from "../session/sql"

export const GoalTable = sqliteTable("session_goal", {
  session_id: text()
    .$type<SessionID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  id: text().$type<Goal.ID>().notNull().unique(),
  data: text({ mode: "json" }).$type<unknown>().notNull(),
})

// No cascading foreign keys: cleanup must remain recoverable after the owning Session or Goal is deleted.
export const GoalCleanupTable = sqliteTable(
  "session_goal_cleanup",
  {
    id: text().primaryKey(),
    session_id: text().$type<SessionID>().notNull(),
    goal_id: text().$type<Goal.ID>().notNull(),
    reason: text().$type<"terminal" | "retention" | "goal_cleared" | "session_deleted">().notNull(),
    data: text({ mode: "json" }).$type<unknown>().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [index("session_goal_cleanup_pending_idx").on(table.time_updated)],
)

export const GoalAttemptTable = sqliteTable(
  "session_goal_attempt",
  {
    id: text().primaryKey(),
    goal_id: text()
      .$type<Goal.ID>()
      .notNull()
      .references(() => GoalTable.id, { onDelete: "cascade" }),
    generation: integer().notNull(),
    kind: text().$type<"planning" | "executing" | "evaluating" | "verifying" | "summarizing">().notNull(),
    state: text().$type<"running" | "finished" | "invalidated">().notNull(),
    time_created: integer().notNull(),
    time_finished: integer(),
  },
  (table) => [index("session_goal_attempt_goal_idx").on(table.goal_id)],
)

export const GoalUsageTable = sqliteTable(
  "session_goal_usage",
  {
    attempt_id: text()
      .notNull()
      .references(() => GoalAttemptTable.id, { onDelete: "cascade" }),
    id: text().notNull(),
    tokens: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.attempt_id, table.id] })],
)

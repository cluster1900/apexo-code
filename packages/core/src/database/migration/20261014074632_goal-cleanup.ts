import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261014074632_goal-cleanup",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_goal_cleanup\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`goal_id\` text NOT NULL,
          \`reason\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_goal_cleanup_pending_idx\` ON \`session_goal_cleanup\` (\`time_updated\`);`)
    })
  },
} satisfies DatabaseMigration.Migration

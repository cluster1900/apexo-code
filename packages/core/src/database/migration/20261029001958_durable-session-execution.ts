import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261029001958_durable-session-execution",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_execution\` (
          \`session_id\` text PRIMARY KEY,
          \`owner_id\` text NOT NULL,
          \`generation\` integer NOT NULL,
          \`status\` text NOT NULL,
          \`attempt_id\` text NOT NULL,
          \`started_at\` integer NOT NULL,
          \`heartbeat_at\` integer NOT NULL,
          \`ended_at\` integer,
          \`error\` text,
          CONSTRAINT \`fk_session_execution_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_execution_status_idx\` ON \`session_execution\` (\`status\`,\`heartbeat_at\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration

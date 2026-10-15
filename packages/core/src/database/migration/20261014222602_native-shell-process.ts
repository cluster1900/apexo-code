import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261014222602_native-shell-process",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_process\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`invocation\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_process_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_process_invocation_idx\` ON \`session_process\` (\`session_id\`,\`invocation\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_process_session_idx\` ON \`session_process\` (\`session_id\`,\`time_created\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration

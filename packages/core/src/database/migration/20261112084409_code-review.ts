import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261112084409_code-review",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_code_review\` (
          \`id\` text PRIMARY KEY,
          \`parent_session_id\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_code_review_parent_session_id_session_id_fk\` FOREIGN KEY (\`parent_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_code_review_parent_idx\` ON \`session_code_review\` (\`parent_session_id\`,\`time_created\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration

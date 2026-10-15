import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261013070028_session_memory_context",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_memory_context\` (
          \`session_id\` text NOT NULL,
          \`epoch\` text NOT NULL,
          \`content\` text NOT NULL,
          \`access_paths\` text NOT NULL,
          CONSTRAINT \`session_memory_context_pk\` PRIMARY KEY(\`session_id\`, \`epoch\`),
          CONSTRAINT \`fk_session_memory_context_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration

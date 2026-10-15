import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261013094031_session_memory_mode",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_memory_mode\` (
          \`session_id\` text PRIMARY KEY,
          \`enabled\` integer NOT NULL,
          \`pending\` integer NOT NULL,
          \`revision\` text NOT NULL,
          CONSTRAINT \`fk_session_memory_mode_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration

import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261013143144_session-memory-backend",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_memory_backend\` (
          \`session_id\` text PRIMARY KEY,
          \`backend\` text NOT NULL,
          \`rollout\` text NOT NULL,
          CONSTRAINT \`fk_session_memory_backend_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      // Sessions created before V2 must keep using their existing legacy store.
      yield* tx.run(`INSERT INTO session_memory_backend (session_id, backend, rollout)
        SELECT id, 'legacy', 'active' FROM session`)
    })
  },
} satisfies DatabaseMigration.Migration

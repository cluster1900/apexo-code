import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261015014134_native_input_memory",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_memory_operation\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`token\` text NOT NULL,
          \`created_event_id\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_memory_operation_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`execution_policy\` text;`)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`execution_status\` text;`)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`execution_owner\` text;`)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`execution_started_seq\` integer;`)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`execution_ended_seq\` integer;`)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`execution_reason\` text;`)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`execution_finish\` text;`)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`execution_usage_incomplete\` integer;`)
      yield* tx.run(
        `CREATE INDEX \`session_memory_operation_session_idx\` ON \`session_memory_operation\` (\`session_id\`,\`time_created\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration

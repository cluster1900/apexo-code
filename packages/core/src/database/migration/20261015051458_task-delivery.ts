import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261015051458_task-delivery",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_task_message\` (
          \`input_id\` text PRIMARY KEY,
          \`launch_id\` text NOT NULL,
          \`parent_created\` text NOT NULL,
          \`child_created\` text NOT NULL,
          \`delivery\` text NOT NULL,
          \`bytes\` integer NOT NULL,
          \`terminal\` text,
          \`promoted_at\` integer,
          CONSTRAINT \`fk_session_task_message_input_id_session_input_id_fk\` FOREIGN KEY (\`input_id\`) REFERENCES \`session_input\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_task_message_launch_id_session_task_launch_id_fk\` FOREIGN KEY (\`launch_id\`) REFERENCES \`session_task_launch\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`ALTER TABLE \`session_task_launch\` ADD \`admission_open\` integer DEFAULT false NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session_task_launch\` ADD \`admission_closed\` integer DEFAULT false NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`withdrawn_seq\` integer;`)
      yield* tx.run(`CREATE INDEX \`session_task_message_launch_idx\` ON \`session_task_message\` (\`launch_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration

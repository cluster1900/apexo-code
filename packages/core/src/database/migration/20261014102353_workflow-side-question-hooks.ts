import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261014102353_workflow-side-question-hooks",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_hook_stop\` (
          \`engine\` text NOT NULL,
          \`message_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`state\` text NOT NULL,
          \`reason\` text,
          \`force_stop\` integer DEFAULT false NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`session_hook_stop_pk\` PRIMARY KEY(\`engine\`, \`message_id\`),
          CONSTRAINT \`fk_session_hook_stop_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_side_question\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_side_question_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_workflow_run\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_workflow_run_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_hook_stop_pending_idx\` ON \`session_hook_stop\` (\`session_id\`,\`state\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_side_question_session_idx\` ON \`session_side_question\` (\`session_id\`,\`time_created\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_workflow_run_session_idx\` ON \`session_workflow_run\` (\`session_id\`,\`time_created\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration

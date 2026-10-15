import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261014183152_native-task-ownership",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_task_launch\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_task_launch_session_id_session_task_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_task\`(\`session_id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_task\` (
          \`session_id\` text PRIMARY KEY,
          \`parent_id\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_task_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_task_parent_id_session_id_fk\` FOREIGN KEY (\`parent_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_task_launch_session_idx\` ON \`session_task_launch\` (\`session_id\`,\`time_created\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_task_parent_idx\` ON \`session_task\` (\`parent_id\`,\`time_created\`);`)
    })
  },
} satisfies DatabaseMigration.Migration

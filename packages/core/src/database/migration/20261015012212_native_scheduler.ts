import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261015012212_native_scheduler",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_schedule_occurrence\` (
          \`id\` text PRIMARY KEY,
          \`schedule_id\` text NOT NULL,
          \`ordinal\` integer NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_schedule_occurrence_schedule_id_session_schedule_id_fk\` FOREIGN KEY (\`schedule_id\`) REFERENCES \`session_schedule\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_schedule\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`invocation\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_schedule_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_schedule_occurrence_ordinal_idx\` ON \`session_schedule_occurrence\` (\`schedule_id\`,\`ordinal\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_schedule_invocation_idx\` ON \`session_schedule\` (\`session_id\`,\`invocation\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_schedule_session_idx\` ON \`session_schedule\` (\`session_id\`,\`time_created\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration

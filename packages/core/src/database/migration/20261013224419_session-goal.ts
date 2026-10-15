import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261013224419_session-goal",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_goal_attempt\` (
          \`id\` text PRIMARY KEY,
          \`goal_id\` text NOT NULL,
          \`generation\` integer NOT NULL,
          \`kind\` text NOT NULL,
          \`state\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_finished\` integer,
          CONSTRAINT \`fk_session_goal_attempt_goal_id_session_goal_id_fk\` FOREIGN KEY (\`goal_id\`) REFERENCES \`session_goal\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_goal\` (
          \`session_id\` text PRIMARY KEY,
          \`id\` text NOT NULL UNIQUE,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_goal_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_goal_usage\` (
          \`attempt_id\` text NOT NULL,
          \`id\` text NOT NULL,
          \`tokens\` integer NOT NULL,
          CONSTRAINT \`session_goal_usage_pk\` PRIMARY KEY(\`attempt_id\`, \`id\`),
          CONSTRAINT \`fk_session_goal_usage_attempt_id_session_goal_attempt_id_fk\` FOREIGN KEY (\`attempt_id\`) REFERENCES \`session_goal_attempt\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_goal_attempt_goal_idx\` ON \`session_goal_attempt\` (\`goal_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration

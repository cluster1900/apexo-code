import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261014215054_native-plan-approval",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_plan_receipt\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`assistant_message_id\` text NOT NULL,
          \`call_id\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_plan_receipt_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_plan_receipt_session\` ON \`session_plan_receipt\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_plan_receipt_call\` ON \`session_plan_receipt\` (\`session_id\`,\`assistant_message_id\`,\`call_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration

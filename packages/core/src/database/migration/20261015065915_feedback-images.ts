import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261015065915_feedback-images",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_feedback_image\` (
          \`id\` text PRIMARY KEY,
          \`draft_id\` text NOT NULL,
          \`mime_type\` text NOT NULL,
          \`file_name\` text NOT NULL,
          \`size\` integer NOT NULL,
          \`data\` blob NOT NULL,
          CONSTRAINT \`fk_session_feedback_image_draft_id_session_feedback_draft_id_fk\` FOREIGN KEY (\`draft_id\`) REFERENCES \`session_feedback_draft\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_feedback_image_draft_idx\` ON \`session_feedback_image\` (\`draft_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration

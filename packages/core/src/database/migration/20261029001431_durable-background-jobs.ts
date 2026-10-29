import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261029001431_durable-background-jobs",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`background_job\` (
          \`id\` text PRIMARY KEY,
          \`type\` text NOT NULL,
          \`title\` text,
          \`status\` text NOT NULL,
          \`started_at\` integer NOT NULL,
          \`completed_at\` integer,
          \`output\` text,
          \`error\` text,
          \`metadata\` text,
          \`owner_id\` text NOT NULL,
          \`owner_generation\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`background_job_status_idx\` ON \`background_job\` (\`status\`,\`time_updated\`);`)
    })
  },
} satisfies DatabaseMigration.Migration

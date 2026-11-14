import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261113112329_session-input-origin",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`origin\` text DEFAULT 'unknown' NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration

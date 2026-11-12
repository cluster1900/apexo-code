import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261112130620_review-owner",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_code_review\` ADD \`execution_owner\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration

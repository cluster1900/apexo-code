import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261013145043_memory-capture-boundary",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_memory_backend\` ADD \`skip_through\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration

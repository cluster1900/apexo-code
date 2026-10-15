import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261013101011_memory_mode_busy",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`UPDATE \`session_memory_mode\` SET \`enabled\` = 0 WHERE \`pending\` = 1;`)
      yield* tx.run(`ALTER TABLE \`session_memory_mode\` DROP COLUMN \`pending\`;`)
    })
  },
} satisfies DatabaseMigration.Migration

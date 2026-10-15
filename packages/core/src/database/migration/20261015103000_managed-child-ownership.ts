import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"
export default {
  id: "20261015103000_managed-child-ownership",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`CREATE TABLE session_managed_child (
        session_id text PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE,
        parent_id text NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        data text NOT NULL
      );`)
    })
  },
} satisfies DatabaseMigration.Migration

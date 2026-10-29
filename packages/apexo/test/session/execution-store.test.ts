import { describe, expect } from "bun:test"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Database } from "@apexo/core/database/database"
import { AbsolutePath } from "@apexo/core/schema"
import { ProjectTable } from "@apexo/core/project/sql"
import { ProjectV2 } from "@apexo/core/project"
import { SessionExecutionStore } from "@apexo/core/session/execution-store"
import { SessionExecutionTable } from "@apexo/core/session/execution-store.sql"
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionTable } from "@apexo/core/session/sql"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Database.node, SessionExecutionStore.node]), [
    [Database.node, Database.layerFromPath(":memory:")],
  ]),
)

describe("session execution ownership", () => {
  it.live("increments generations and rejects a fenced owner", () =>
    Effect.gen(function* () {
      const directory = "/"
      const database = yield* Database.Service
      const sessionID = SessionSchema.ID.create()
      const projectID = ProjectV2.ID.make(`execution-${sessionID}`)
      yield* database.db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make(directory), sandboxes: [] })
      yield* database.db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: projectID,
          slug: "execution",
          directory,
          title: "Execution",
          version: "1",
        })
        .run()

      const store = yield* SessionExecutionStore.Service
      const first = yield* store.claim(sessionID)
      yield* store.assert(first)
      expect(yield* store.recoverable).toEqual([sessionID])

      yield* database.db
        .update(SessionExecutionTable)
        .set({ owner_id: "replacement", generation: first.generation + 1 })
        .run()
      const stale = yield* store.assert(first).pipe(Effect.flip)
      expect(stale.code).toBe("stale")

      const replacement = yield* store.claim(sessionID)
      expect(replacement.generation).toBe(first.generation + 2)
      yield* store.finish(replacement, "completed")
      expect(yield* store.recoverable).toEqual([])
    }),
  )
})

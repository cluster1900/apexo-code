import { expect } from "bun:test"
import path from "node:path"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { ProjectCatalog } from "@apexo/core/project/catalog"
import { ProjectTable } from "@apexo/core/project/sql"
import { Project } from "@apexo/schema/project"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

it.live("native project catalog returns persisted metadata and distinguishes empty from invalid storage", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const database = yield* Database.Service
      const catalog = yield* ProjectCatalog.Service
      expect(yield* catalog.list).toEqual([])
      const id = Project.ID.make("catalog-project")
      yield* database.db
        .insert(ProjectTable)
        .values({
          id,
          worktree: AbsolutePath.make(path.join(root, "checkout")),
          vcs: "git",
          name: "Persisted project",
          icon_url: "https://example.invalid/icon.svg",
          icon_url_override: "custom-icon",
          icon_color: "blue",
          commands: { start: "bun run dev" },
          sandboxes: [AbsolutePath.make(path.join(root, "worktree"))],
          time_created: 10,
          time_updated: 20,
          time_initialized: 30,
        })
        .run()
      expect(yield* catalog.list).toEqual([
        {
          id,
          worktree: path.join(root, "checkout"),
          vcs: "git",
          name: "Persisted project",
          icon: { url: "https://example.invalid/icon.svg", override: "custom-icon", color: "blue" },
          commands: { start: "bun run dev" },
          sandboxes: [path.join(root, "worktree")],
          time: { created: 10, updated: 20, initialized: 30 },
        },
      ])
      yield* database.db.update(ProjectTable).set({ vcs: "invalid-vcs" }).where(eq(ProjectTable.id, id)).run()
      const failure = yield* catalog.list.pipe(Effect.flip)
      expect(failure).toBeInstanceOf(ProjectCatalog.Failure)
      expect(failure.message).toBe("Could not read the project catalog")
      expect(failure.message).not.toContain(root)
      yield* database.db.delete(ProjectTable).where(eq(ProjectTable.id, id)).run()
      expect(yield* catalog.list).toEqual([])
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(LayerNode.group([Database.node, ProjectCatalog.node]), [
          [
            Global.node,
            Layer.succeed(Global.Service)(
              Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
            ),
          ],
        ]),
      ),
    )
  }),
)

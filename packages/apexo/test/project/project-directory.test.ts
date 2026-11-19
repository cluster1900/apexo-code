import { describe, expect } from "bun:test"
import { $ } from "bun"
import path from "path"
import { eq } from "drizzle-orm"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Hash } from "@apexo/core/util/hash"
import { AbsolutePath } from "@apexo/core/schema"
import { migrateAppDirectory } from "@apexo/core/app-directory"
import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { ProjectDirectories } from "@apexo/core/project/directories"
import { ProjectDirectoryTable, ProjectTable } from "@apexo/core/project/sql"
import { ProjectV2 } from "@apexo/core/project"
import { Project } from "@/project/project"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Project.node, Database.node, CrossSpawnSpawner.node])))

function directories(projectID: ProjectV2.ID) {
  return Database.Service.use(({ db }) =>
    db
      .select()
      .from(ProjectDirectoryTable)
      .where(eq(ProjectDirectoryTable.project_id, projectID))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) =>
          rows
            .map((row) => ({ directory: row.directory, strategy: row.strategy ?? undefined }))
            .toSorted((a, b) => a.directory.localeCompare(b.directory)),
        ),
      ),
  )
}

describe("Project directory persistence", () => {
  it.live("stores the first opened checkout directory", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service

      const result = yield* project.fromDirectory(tmp)

      expect(yield* directories(result.project.id)).toEqual([
        { directory: AbsolutePath.make(tmp), strategy: undefined },
      ])
    }),
  )

  it.live("stores a repeatedly opened checkout directory only once", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service

      const result = yield* project.fromDirectory(tmp)
      const next = yield* project.fromDirectory(tmp)

      expect(next.project.id).toBe(result.project.id)
      expect(yield* directories(result.project.id)).toEqual([
        { directory: AbsolutePath.make(tmp), strategy: undefined },
      ])
    }),
  )

  it.live("stores an opened linked worktree directory", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service
      const main = yield* project.fromDirectory(tmp)
      const worktree = path.join(tmp, "..", path.basename(tmp) + "-project-directory-worktree")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`git worktree remove ${worktree}`.cwd(tmp).quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add ${worktree} -b project-directory-${Date.now()}`.cwd(tmp).quiet())

      yield* project.fromDirectory(worktree)

      expect(yield* directories(main.project.id)).toEqual(
        [
          { directory: AbsolutePath.make(tmp), strategy: undefined },
          { directory: AbsolutePath.make(worktree), strategy: undefined },
        ].toSorted((a, b) => a.directory.localeCompare(b.directory)),
      )
    }),
  )

  it.live("refreshes a migrated worktree by updating its existing directory registration", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service
      const result = yield* project.fromDirectory(tmp)
      const database = yield* Database.Service
      const base = path.join(tmp, "data")
      const data = path.join(base, "apexo")
      const legacy = AbsolutePath.make(path.join(base, "opencode", "worktree", "copy"))
      const current = AbsolutePath.make(path.join(data, "worktree", "copy"))
      const registry = LayerNode.compile(ProjectDirectories.node, [
        [Global.node, Global.layerWith({ data })],
        [Database.node, Layer.succeed(Database.Service, database)],
      ]).pipe(Layer.fresh)

      yield* Effect.promise(() => Bun.write(path.join(legacy, "marker"), "existing worktree"))
      yield* Effect.gen(function* () {
        const registered = yield* ProjectDirectories.Service
        const location = { projectID: result.project.id, directory: current }
        expect(yield* registered.create({ ...location, directory: legacy })).toBe(true)
        yield* Effect.promise(() => migrateAppDirectory(base, "apexo", "opencode"))
        expect((yield* registered.get(location))?.directory).toBe(legacy)
        expect(yield* registered.create({ ...location, strategy: "git_worktree", behavior: "replace" })).toBe(true)
        expect(yield* registered.get(location)).toEqual({ directory: legacy, strategy: "git_worktree" })
        expect((yield* registered.list(location.projectID)).filter((item) => item.directory !== tmp)).toEqual([
          { directory: legacy, strategy: "git_worktree" },
        ])
        expect(yield* registered.remove(location)).toBe(true)
        expect(yield* registered.contains({ ...location, directory: legacy })).toBe(false)
      }).pipe(Effect.provide(registry))
    }),
  )

  it.live("stores only the linked copy when first opened from an external linked worktree", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const worktree = path.join(tmp, "..", path.basename(tmp) + "-project-directory-first-worktree")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`git worktree remove ${worktree}`.cwd(tmp).quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add --detach ${worktree} HEAD`.cwd(tmp).quiet())
      const project = yield* Project.Service

      const result = yield* project.fromDirectory(worktree)

      expect(yield* directories(result.project.id)).toEqual([
        { directory: AbsolutePath.make(worktree), strategy: undefined },
      ])
    }),
  )

  it.live("stores a separately opened clone as a secondary directory", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const bare = tmp + "-project-directory-bare"
      const clone = tmp + "-project-directory-clone"
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${bare} ${clone}`.quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git clone --bare ${tmp} ${bare}`.quiet())
      yield* Effect.promise(() => $`git clone ${bare} ${clone}`.quiet())
      const project = yield* Project.Service
      const main = yield* project.fromDirectory(tmp)

      yield* project.fromDirectory(clone)

      expect(yield* directories(main.project.id)).toEqual(
        [
          { directory: AbsolutePath.make(tmp), strategy: undefined },
          { directory: AbsolutePath.make(clone), strategy: undefined },
        ].toSorted((a, b) => a.directory.localeCompare(b.directory)),
      )
    }),
  )

  it.live("stores only the materialized worktree for a bare repository", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const bare = tmp + "-project-directory-bare-store.git"
      const worktree = tmp + "-project-directory-bare-worktree"
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${bare} ${worktree}`.quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git clone --bare ${tmp} ${bare}`.quiet())
      yield* Effect.promise(() => $`git worktree add ${worktree} HEAD`.cwd(bare).quiet())
      const project = yield* Project.Service

      const result = yield* project.fromDirectory(worktree)

      expect(yield* directories(result.project.id)).toEqual([
        { directory: AbsolutePath.make(worktree), strategy: undefined },
      ])
    }),
  )

  it.live("records the active directory under its newly resolved project id", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service
      yield* project.fromDirectory(tmp)
      const remoteID = ProjectV2.ID.make(Hash.fast("git-remote:github.com/project-directory-test/collision"))
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({
          id: remoteID,
          worktree: AbsolutePath.make("/tmp/existing"),
          vcs: "git",
          time_created: Date.now(),
          time_updated: Date.now(),
          sandboxes: [],
        })
        .run()
        .pipe(Effect.orDie)
      yield* Effect.promise(() =>
        $`git remote add origin git@github.com:project-directory-test/collision.git`.cwd(tmp).quiet(),
      )

      yield* project.fromDirectory(tmp)

      expect(yield* directories(remoteID)).toEqual([{ directory: AbsolutePath.make(tmp), strategy: undefined }])
    }),
  )

  it.live("clears stale directories when the project id changes", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service
      const original = yield* project.fromDirectory(tmp)
      const stale = AbsolutePath.make(tmp + "-stale-checkout")
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectDirectoryTable)
        .values({ project_id: original.project.id, directory: stale })
        .run()
        .pipe(Effect.orDie)
      const remoteID = ProjectV2.ID.make(Hash.fast("git-remote:github.com/project-directory-test/migration"))
      yield* Effect.promise(() =>
        $`git remote add origin git@github.com:project-directory-test/migration.git`.cwd(tmp).quiet(),
      )

      yield* project.fromDirectory(tmp)

      expect(yield* directories(original.project.id)).toEqual([])
      expect(yield* directories(remoteID)).toEqual([{ directory: AbsolutePath.make(tmp), strategy: undefined }])
    }),
  )
})

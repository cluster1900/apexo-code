import { expect, test } from "bun:test"
import { $ } from "bun"
import { mkdir, readFile, realpath, rm, rmdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { Project } from "@/project/project"
import { tmpdir, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Project.node, CrossSpawnSpawner.node])))

test("automatic legacy migration checks source and destination permissions before reading or writing", async () => {
  await using home = await tmpdir()
  await using directory = await tmpdir()
  await WorkspaceMemory.update(directory.path, { operation: "remember", content: "LEGACY_FOR_RECALL" }, home.path)
  const legacy = WorkspaceMemory.file(directory.path, home.path)
  const location = { projectID: "automatic-migration" }
  const target = WorkspaceMemory.file(directory.path, home.path, location)
  const canonical = await realpath(legacy)
  await WorkspaceMemory.migrate(directory.path, home.path, location, (paths) => !paths.read.includes(canonical))
  expect(await Bun.file(target).exists()).toBe(false)
  await WorkspaceMemory.migrate(directory.path, home.path, location, (paths) => !paths.edit.includes(target))
  expect(await Bun.file(target).exists()).toBe(false)
  await WorkspaceMemory.migrate(directory.path, home.path, location, () => true)
  expect(await Bun.file(target).text()).toContain("LEGACY_FOR_RECALL")
  expect(await Bun.file(legacy).text()).toContain("LEGACY_FOR_RECALL")
  await writeFile(target, "USER_REMOVED_OLD_KNOWLEDGE")
  await WorkspaceMemory.migrate(directory.path, home.path, location, () => true)
  expect(await Bun.file(target).text()).toBe("USER_REMOVED_OLD_KNOWLEDGE")
})

test("automatic legacy migration rejects redirected source files and parent directories", async () => {
  await using home = await tmpdir()
  await using directory = await tmpdir()
  const legacy = WorkspaceMemory.file(directory.path, home.path)
  const external = path.join(directory.path, "external.md")
  const location = { projectID: "redirected-migration" }
  const target = WorkspaceMemory.file(directory.path, home.path, location)
  await mkdir(path.dirname(legacy), { recursive: true })
  await writeFile(external, "OUTSIDE_MIGRATION_SECRET")
  await symlink(external, legacy)
  await expect(WorkspaceMemory.migrate(directory.path, home.path, location, () => true)).rejects.toThrow("symlinks")
  expect(await Bun.file(target).exists()).toBe(false)
  await rm(legacy)
  await rmdir(path.dirname(legacy))
  await writeFile(path.join(directory.path, "MEMORY.md"), "OUTSIDE_PARENT_SECRET")
  await symlink(directory.path, path.dirname(legacy))
  await expect(WorkspaceMemory.migrate(directory.path, home.path, location, () => true)).rejects.toThrow("symlinks")
  expect(await Bun.file(target).exists()).toBe(false)
})

test("global preferences cross projects while repository and non-Git notes remain isolated", async () => {
  await using home = await tmpdir()
  await using first = await tmpdir()
  await using second = await tmpdir()
  await WorkspaceMemory.update(
    first.path,
    { operation: "remember", scope: "global", content: "Prefer concise answers" },
    home.path,
  )
  await WorkspaceMemory.update(first.path, { operation: "remember", content: "Repository alpha" }, home.path, {
    projectID: "alpha",
  })
  await WorkspaceMemory.update(first.path, { operation: "remember", content: "Non-Git notes" }, home.path)

  expect(await WorkspaceMemory.read(second.path, home.path, { scope: "global" })).toContain("Prefer concise answers")
  expect(await WorkspaceMemory.read(second.path, home.path, { projectID: "beta" })).toBe("")
  expect(await WorkspaceMemory.read(second.path, home.path, { projectID: "global" })).toBe("")
  expect(await WorkspaceMemory.read(first.path, home.path, { projectID: "global" })).toContain("Non-Git notes")
  const notes = await WorkspaceMemory.context(second.path, home.path, { projectID: "alpha" })
  expect(notes.map((note) => note.scope)).toEqual(["global", "workspace"])
  expect(notes[0]?.content).toContain("Prefer concise answers")
  expect(notes[1]?.content).toContain("Repository alpha")
  expect(notes[1]?.content).not.toContain("Non-Git notes")
})

test("migration merges each directory once, retains original notes and does not resurrect deletions", async () => {
  await using home = await tmpdir()
  await using first = await tmpdir()
  await using second = await tmpdir()
  const location = { projectID: "shared-repository" }
  const firstSaved = await WorkspaceMemory.update(
    first.path,
    { operation: "remember", content: "shared note\n\n```ts\nconst value = 1\n```" },
    home.path,
  )
  await WorkspaceMemory.update(second.path, { operation: "remember", content: "another worktree note" }, home.path)
  await Promise.all([
    ...Array.from({ length: 3 }, () => WorkspaceMemory.read(first.path, home.path, location)),
    WorkspaceMemory.read(second.path, home.path, location),
    WorkspaceMemory.update(first.path, { operation: "remember", content: "new scoped note" }, home.path, location),
  ])
  const target = WorkspaceMemory.file(first.path, home.path, location)
  const saved = await readFile(target, "utf8")
  expect(saved.match(/^# Memory$/gm)).toHaveLength(1)
  expect(saved.match(/shared note/g)).toHaveLength(1)
  expect(saved).toContain("```ts\nconst value = 1\n```")
  expect(saved).toContain("another worktree note")
  expect(saved).toContain("new scoped note")
  expect(await readFile(WorkspaceMemory.file(first.path, home.path), "utf8")).toBe(firstSaved)
  await writeFile(target, "# Memory\n\nCleaned by user\n")
  expect(await WorkspaceMemory.read(first.path, home.path, location)).toBe("# Memory\n\nCleaned by user\n")
  expect(await WorkspaceMemory.read(second.path, home.path, location)).toBe("# Memory\n\nCleaned by user\n")
})

test("parallel saves from different projects retain every global preference", async () => {
  await using home = await tmpdir()
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      WorkspaceMemory.update(
        path.join(home.path, `workspace-${index}`),
        { operation: "remember", scope: "global", content: `global preference ${index}` },
        home.path,
        { projectID: `project-${index}` },
      ),
    ),
  )
  const saved = await WorkspaceMemory.read(home.path, home.path, { scope: "global" })
  expect(saved.match(/global preference /g)).toHaveLength(8)
})

it.live("actual Git clones, worktrees and subdirectories share memory using resolved project identity", () =>
  Effect.gen(function* () {
    const projects = yield* Project.Service
    const home = yield* tmpdirScoped()
    const root = yield* tmpdirScoped()
    const original = yield* tmpdirScoped({ git: true })
    const clone = path.join(root, "clone")
    const worktree = path.join(root, "linked")
    const nested = path.join(original, "nested")
    yield* Effect.promise(async () => {
      await $`git remote add origin https://github.example/acme/repository.git`.cwd(original).quiet()
      await $`git clone ${original} ${clone}`.quiet()
      await $`git remote set-url origin git@github.example:acme/repository.git`.cwd(clone).quiet()
      await $`git worktree add --detach ${worktree}`.cwd(original).quiet()
      await mkdir(nested)
    })
    const resolved = yield* Effect.forEach([original, clone, worktree, nested], (directory) =>
      projects.fromDirectory(directory),
    )
    expect(new Set(resolved.map((item) => item.project.id)).size).toBe(1)
    yield* Effect.promise(() =>
      WorkspaceMemory.update(original, { operation: "remember", content: "shared clone convention" }, home, {
        projectID: resolved[0]!.project.id,
      }),
    )
    yield* Effect.forEach([clone, worktree, nested], (directory, index) =>
      Effect.promise(async () => {
        expect(await WorkspaceMemory.read(directory, home, { projectID: resolved[index + 1]!.project.id })).toContain(
          "shared clone convention",
        )
      }),
    )
    yield* Effect.promise(() =>
      $`git remote set-url origin https://another.example/acme/repository.git`.cwd(clone).quiet(),
    )
    const separate = yield* projects.fromDirectory(clone)
    expect(separate.project.id).not.toBe(resolved[0]!.project.id)
    expect(yield* Effect.promise(() => WorkspaceMemory.read(clone, home, { projectID: separate.project.id }))).toBe("")
  }),
)

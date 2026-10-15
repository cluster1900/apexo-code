import { $ } from "bun"
import { expect } from "bun:test"
import path from "node:path"
import { mkdir, rename, symlink } from "node:fs/promises"
import { Effect } from "effect"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { AppProcess } from "@apexo/core/process"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { SessionGoalChanges } from "@apexo/core/session/goal-changes"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([AppProcess.node, CrossSpawnSpawner.node])))

it.live("Goal baseline is best effort for non-Git and unborn repositories", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const appProcess = yield* AppProcess.Service
    const changes = SessionGoalChanges.make(appProcess)
    expect(yield* changes.baseline(directory)).toBeUndefined()
    yield* Effect.promise(() => $`git init`.cwd(directory).quiet())
    expect(yield* changes.baseline(directory)).toBeUndefined()
    const captured = yield* changes.capture({ directory, canRead: () => true })
    expect(captured.status).toBe("unavailable")
    expect(JSON.parse(SessionGoalChanges.materialize(captured, () => true).manifest).reason).toContain("baseline")
  }),
)

it.live(
  "Goal Git evidence includes later commits, index, worktree, renames and untracked paths without changing the index",
  () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const appProcess = yield* AppProcess.Service
      const changes = SessionGoalChanges.make(appProcess)
      yield* Effect.promise(async () => {
        await Bun.write(path.join(directory, "old.txt"), "old\n")
        await Bun.write(path.join(directory, "work.txt"), "before\n")
        await $`git add .`.cwd(directory).quiet()
        await $`git commit -m initial`.cwd(directory).quiet()
      })
      const baseline = yield* changes.baseline(directory)
      expect(baseline).toMatch(/^[a-f0-9]{40,64}$/)
      const strange = process.platform === "win32" ? "space file.txt" : "line\n中文.txt"
      yield* Effect.promise(async () => {
        await rename(path.join(directory, "old.txt"), path.join(directory, "renamed.txt"))
        await Bun.write(path.join(directory, "committed.txt"), "COMMITTED_PROOF\n")
        await $`git add .`.cwd(directory).quiet()
        await $`git commit -m worker`.cwd(directory).quiet()
        await Bun.write(path.join(directory, "staged.txt"), "STAGED_PROOF\n")
        await $`git add staged.txt`.cwd(directory).quiet()
        await Bun.write(path.join(directory, "work.txt"), "WORKTREE_PROOF\n")
        await Bun.write(path.join(directory, strange), "UNTRACKED_PROOF\n")
      })
      const index = yield* Effect.promise(() => Bun.file(path.join(directory, ".git/index")).arrayBuffer())
      const captured = yield* changes.capture({ directory, baseline, canRead: () => true })
      expect(captured.status).toBe("captured")
      expect(captured.files).toEqual(
        ["committed.txt", strange, "old.txt", "renamed.txt", "staged.txt", "work.txt"].sort(),
      )
      const material = SessionGoalChanges.materialize(captured, () => true)
      expect(material.patch).toContain("+COMMITTED_PROOF")
      expect(material.patch).toContain("+STAGED_PROOF")
      expect(material.patch).toContain("+WORKTREE_PROOF")
      expect(material.patch).not.toContain("UNTRACKED_PROOF")
      expect(yield* Effect.promise(() => Bun.file(path.join(directory, ".git/index")).arrayBuffer())).toEqual(index)
      expect(yield* changes.baseline(directory)).not.toBe(baseline)
    }),
)

it.live("Goal patch truncation preserves the complete file list and marks incomplete evidence", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped({ git: true })
    const appProcess = yield* AppProcess.Service
    const changes = SessionGoalChanges.make(appProcess)
    const baseline = yield* changes.baseline(directory)
    yield* Effect.promise(async () => {
      await Bun.write(path.join(directory, "a-big.txt"), "中文😀\n".repeat(50_000))
      await Bun.write(path.join(directory, "z-tail.txt"), "TAIL_PROOF\n")
      await $`git add .`.cwd(directory).quiet()
    })
    const captured = yield* changes.capture({ directory, baseline, canRead: () => true })
    expect(captured.status).toBe("captured")
    expect(captured.files).toEqual(["a-big.txt", "z-tail.txt"])
    expect(captured.truncated).toBe(true)
    const material = SessionGoalChanges.materialize(captured, () => true)
    expect(Buffer.byteLength(material.patch)).toBeLessThan(263_000)
    expect(material.patch).toContain("Patch truncated")
    expect(material.patch).not.toContain("�")
  }),
)

it.live(
  "Goal automatic evidence excludes restricted names and contents and supports stricter reviewer permissions",
  () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const appProcess = yield* AppProcess.Service
      const changes = SessionGoalChanges.make(appProcess)
      const baseline = yield* changes.baseline(directory)
      yield* Effect.promise(async () => {
        await Bun.write(path.join(directory, "secret.env"), "PRIVATE_SECRET_VALUE\n")
        await Bun.write(path.join(directory, "allowed.txt"), "PUBLIC_PROOF\n")
        await $`git add .`.cwd(directory).quiet()
      })
      const captured = yield* changes.capture({ directory, baseline, canRead: (file) => !file.endsWith("secret.env") })
      expect(captured.omitted).toBe(1)
      expect(JSON.stringify(captured)).not.toMatch(/PRIVATE_SECRET_VALUE|secret\.env/)
      const material = SessionGoalChanges.materialize(captured, () => false)
      expect(JSON.parse(material.manifest)).toMatchObject({ files: [], omitted: 2 })
      expect(material.patch).not.toContain("PUBLIC_PROOF")
    }),
)

it.live("Goal capture is directory scoped, keeps literal pathspecs and disables text conversion commands", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped({ git: true })
    const appProcess = yield* AppProcess.Service
    const changes = SessionGoalChanges.make(appProcess)
    const baseline = yield* changes.baseline(directory)
    yield* Effect.promise(async () => {
      await mkdir(path.join(directory, "nested"))
      await Bun.write(path.join(directory, "outside.txt"), "OUTSIDE_PROOF\n")
      await Bun.write(path.join(directory, "nested", "[literal].txt"), "LITERAL_PROOF\n")
      await Bun.write(path.join(directory, ".gitattributes"), "*.txt diff=custom\n")
      await $`git config diff.custom.textconv 'echo TEXTCONV_SHOULD_NOT_RUN'`.cwd(directory).quiet()
      await $`git add .`.cwd(directory).quiet()
    })
    const captured = yield* changes.capture({
      directory: path.join(directory, "nested"),
      baseline,
      canRead: () => true,
    })
    expect(captured.files).toEqual(["[literal].txt"])
    const patch = SessionGoalChanges.materialize(captured, () => true).patch
    expect(patch).toContain("LITERAL_PROOF")
    expect(patch).not.toMatch(/OUTSIDE_PROOF|TEXTCONV_SHOULD_NOT_RUN/)
  }),
)

it.live("Goal capture distinguishes a missing commit and does not follow untracked links", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped({ git: true })
    const outside = yield* tmpdirScoped()
    const appProcess = yield* AppProcess.Service
    const changes = SessionGoalChanges.make(appProcess)
    const failed = yield* changes.capture({ directory, baseline: "f".repeat(40), canRead: () => true })
    expect(failed.status).toBe("unavailable")
    if (process.platform === "win32") return
    yield* Effect.promise(async () => {
      await Bun.write(path.join(outside, "secret"), "OUTSIDE_SECRET")
      await symlink(path.join(outside, "secret"), path.join(directory, "link"))
    })
    const captured = yield* changes.capture({
      directory,
      baseline: yield* changes.baseline(directory),
      canRead: () => true,
    })
    expect(captured.files).toEqual(["link"])
    expect(JSON.stringify(captured)).not.toContain("OUTSIDE_SECRET")
  }),
)

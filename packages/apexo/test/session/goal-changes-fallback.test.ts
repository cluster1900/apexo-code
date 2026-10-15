import { $ } from "bun"
import { expect } from "bun:test"
import { link, mkdir, symlink, utimes, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { AppProcess } from "@apexo/core/process"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { SessionGoalChanges } from "@apexo/core/session/goal-changes"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([AppProcess.node, CrossSpawnSpawner.node])))

it.live("Goal discovers a repository created during work and diffs the initial commit against its own empty tree", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const appProcess = yield* AppProcess.Service
    const changes = SessionGoalChanges.make(appProcess)
    const createdAt = Date.now() - 1000
    expect(yield* changes.baseline(directory)).toBeUndefined()
    yield* Effect.promise(async () => {
      await $`git init`.cwd(directory).quiet()
      await Bun.write(path.join(directory, "root.txt"), "ROOT_COMMIT_PROOF\n")
      await $`git add .`.cwd(directory).quiet()
      await commit(directory, "root")
      await Bun.write(path.join(directory, "later.txt"), "LATER_COMMIT_PROOF\n")
      await $`git add .`.cwd(directory).quiet()
      await commit(directory, "later")
      await Bun.write(path.join(directory, "untracked.txt"), "UNTRACKED_CURRENT_PROOF\n")
    })
    const capture = yield* changes.capture({ directory, createdAt, canRead: () => true })
    expect(capture.source).toBe("git_history")
    expect(capture.derivedBaseline).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904")
    expect(capture.baseline).toBeUndefined()
    expect(capture.files).toEqual(["later.txt", "root.txt", "untracked.txt"])
    const material = SessionGoalChanges.materialize(capture, () => true)
    expect(material.patch).toContain("ROOT_COMMIT_PROOF")
    expect(material.patch).toContain("LATER_COMMIT_PROOF")
    expect(material.patch).not.toContain("UNTRACKED_CURRENT_PROOF")
  }),
)

it.live(
  "Goal history fallback starts at the earliest in-window commit's parent and supports stale recorded baselines",
  () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const appProcess = yield* AppProcess.Service
      const changes = SessionGoalChanges.make(appProcess)
      const createdAt = Date.now() - 1000
      yield* Effect.promise(async () => {
        await Bun.write(path.join(directory, "existing.txt"), "OLD_COMMITTED_CONTENT\n")
        await $`git add .`.cwd(directory).quiet()
        await commit(directory, "older", new Date(createdAt - 60_000).toISOString())
      })
      const parent = yield* changes.baseline(directory)
      yield* Effect.promise(async () => {
        await Bun.write(path.join(directory, "new.txt"), "WINDOW_COMMIT_PROOF\n")
        await $`git add .`.cwd(directory).quiet()
        await commit(directory, "in-window")
      })
      const capture = yield* changes.capture({ directory, createdAt, baseline: "f".repeat(40), canRead: () => true })
      expect(capture.source).toBe("git_history")
      expect(capture.derivedBaseline).toBe(parent)
      expect(capture.baseline).toBe("f".repeat(40))
      expect(capture.files).toEqual(["new.txt"])
      expect(SessionGoalChanges.materialize(capture, () => true).patch).not.toContain("OLD_COMMITTED_CONTENT")
    }),
)

it.live("Goal derives the empty tree per repository hash format", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const appProcess = yield* AppProcess.Service
    const createdAt = Date.now() - 1000
    yield* Effect.promise(async () => {
      await $`git init --object-format=sha256`.cwd(directory).quiet()
      await Bun.write(path.join(directory, "proof.txt"), "SHA256_PROOF\n")
      await $`git add .`.cwd(directory).quiet()
      await commit(directory, "root")
    })
    const capture = yield* SessionGoalChanges.make(appProcess).capture({ directory, createdAt, canRead: () => true })
    expect(capture.source).toBe("git_history")
    expect(capture.derivedBaseline).toHaveLength(64)
    expect(SessionGoalChanges.materialize(capture, () => true).patch).toContain("SHA256_PROOF")
  }),
)

it.live("Goal mtime fallback honors same-second edits, ignore files, generated directories and permissions", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const appProcess = yield* AppProcess.Service
    const createdAt = Date.now()
    yield* Effect.promise(async () => {
      await Bun.write(path.join(directory, ".gitignore"), "ignored.txt\nnested/*.skip\n")
      await Bun.write(path.join(directory, ".ignore"), "also-ignored.txt\n")
      await Bun.write(path.join(directory, "proof.txt"), "MTIME_PROOF\n")
      await utimes(path.join(directory, "proof.txt"), createdAt / 1000, Math.floor(createdAt / 1000))
      await Bun.write(path.join(directory, "old.txt"), "OLD_MTIME_CONTENT\n")
      await utimes(path.join(directory, "old.txt"), createdAt / 1000, createdAt / 1000 - 60)
      for (const file of [
        "ignored.txt",
        "also-ignored.txt",
        "nested/file.skip",
        "target/build.txt",
        "node_modules/dependency.txt",
        "secret.txt",
      ]) {
        await mkdir(path.dirname(path.join(directory, file)), { recursive: true })
        await Bun.write(path.join(directory, file), "MUST_NOT_CAPTURE\n")
      }
      await Bun.write(path.join(directory, "nested/.gitignore"), "private.txt\n")
      await Bun.write(path.join(directory, "nested/private.txt"), "NESTED_PRIVATE\n")
      await Bun.write(path.join(directory, "nested/keep.txt"), "NESTED_PROOF\n")
    })
    const capture = yield* SessionGoalChanges.make(appProcess).capture({
      directory,
      createdAt,
      canRead: (file) => !file.endsWith("secret.txt"),
    })
    expect(capture.source).toBe("mtime")
    expect(capture.status).toBe("captured")
    expect(capture.files).toContain("proof.txt")
    expect(capture.files).toContain("nested/keep.txt")
    expect(capture.omitted).toBe(1)
    const patch = SessionGoalChanges.materialize(capture, () => true).patch
    expect(patch).toContain("MTIME_PROOF")
    expect(patch).toContain("NESTED_PROOF")
    expect(patch).not.toMatch(/MUST_NOT_CAPTURE|NESTED_PRIVATE|OLD_MTIME_CONTENT/)
    expect(patch).toContain("deleted files and prior contents cannot be recovered")
  }),
)

it.live("Goal mtime capture bounds per-file and total content while retaining tail paths and binary metadata", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const appProcess = yield* AppProcess.Service
    const createdAt = Date.now() - 1000
    yield* Effect.promise(async () => {
      await Bun.write(path.join(directory, "a.bin"), Buffer.from([0, 1, 2, 3]))
      for (const name of ["b.txt", "c.txt", "d.txt", "e.txt", "f.txt", "z-tail.txt"])
        await Bun.write(path.join(directory, name), "中文😀\n".repeat(20_000))
    })
    const capture = yield* SessionGoalChanges.make(appProcess).capture({ directory, createdAt, canRead: () => true })
    expect(capture.files).toHaveLength(7)
    expect(capture.files).toContain("z-tail.txt")
    expect(capture.truncated).toBe(true)
    const patch = SessionGoalChanges.materialize(capture, () => true).patch
    expect(patch).toContain("Binary file differs (4 bytes)")
    expect(patch).toContain("File contents truncated")
    expect(Buffer.byteLength(patch)).toBeLessThan(263_000)
    expect(patch).not.toContain("�")
  }),
)

it.live("Goal mtime capture distinguishes empty evidence and never follows file or directory links", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const outside = yield* tmpdirScoped()
    const appProcess = yield* AppProcess.Service
    const changes = SessionGoalChanges.make(appProcess)
    const createdAt = Date.now() - 1000
    const empty = yield* changes.capture({ directory, createdAt, canRead: () => true })
    expect(empty.status).toBe("unavailable")
    if (process.platform === "win32") return
    yield* Effect.promise(async () => {
      await Bun.write(path.join(outside, "secret.txt"), "OUTSIDE_SECRET\n")
      await symlink(outside, path.join(directory, "linked-directory"))
      await symlink(path.join(outside, "secret.txt"), path.join(directory, "linked-file"))
      await link(path.join(outside, "secret.txt"), path.join(directory, "hardlink"))
      await writeFile(path.join(directory, "safe.txt"), "SAFE_CONTENT\n")
    })
    const capture = yield* changes.capture({ directory, createdAt, canRead: () => true })
    expect(capture.files).toEqual(["safe.txt"])
    expect(SessionGoalChanges.materialize(capture, () => true).patch).not.toContain("OUTSIDE_SECRET")
  }),
)

async function commit(directory: string, message: string, date?: string) {
  await $`git -c commit.gpgsign=false -c user.name=Test -c user.email=test@apexo.test commit -m ${message}`
    .cwd(directory)
    .env({ ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) })
    .quiet()
}

it.live("Goal falls back to mtime when an existing repository has no commits within the Goal window", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const appProcess = yield* AppProcess.Service
    yield* Effect.promise(async () => {
      await $`git init`.cwd(directory).quiet()
      await Bun.write(path.join(directory, "proof.txt"), "BEFORE\n")
      await $`git add .`.cwd(directory).quiet()
      await commit(directory, "old root", new Date(Date.now() - 120_000).toISOString())
    })
    const createdAt = Date.now()
    yield* Effect.promise(() => Bun.write(path.join(directory, "proof.txt"), "UNCOMMITTED_MTIME_PROOF\n"))
    const capture = yield* SessionGoalChanges.make(appProcess).capture({ directory, createdAt, canRead: () => true })
    expect(capture.source).toBe("mtime")
    expect(capture.files).toEqual(["proof.txt"])
    expect(SessionGoalChanges.materialize(capture, () => true).patch).toContain("UNCOMMITTED_MTIME_PROOF")
  }),
)

import { expect } from "bun:test"
import { mkdir, readFile, stat, symlink } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const access = () => true

it.live("migration revision preview does not create a missing scope", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, projectID: "migration-test" }
    expect(yield* MemoryCapture.inspectRevision(input)).toBe("initial")
    expect(
      yield* Effect.promise(() => Bun.file(path.join(MemoryV2.directory(input), "memory_state.sqlite")).exists()),
    ).toBe(false)
    expect(
      yield* Effect.promise(() =>
        stat(MemoryV2.directory(input)).then(
          () => true,
          () => false,
        ),
      ),
    ).toBe(false)
  }),
)

it.live("curated import journals survive reopen, forget and clear without resurrecting source", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, projectID: "migration-test" }
    const store = yield* MemoryCapture.make(input)
    const content = "# Memory\n\n## Project\nThe mascot is an otter."
    const source = {
      sourceKey: "legacy",
      sourceHash: MemoryV2.hash(content),
      content,
      generation: yield* store.revision,
    }
    const result = yield* store.importLegacy(source, access)
    expect(result.imported).toBe(true)
    expect(yield* MemoryCapture.inspectRevision(input)).toBe(yield* store.revision)
    expect((yield* store.previewNote(result.path, access)).content).toBe(content)
    const reopened = yield* MemoryCapture.make(input)
    expect((yield* reopened.importLegacy(source, access)).imported).toBe(false)
    const note = yield* reopened.previewNote(result.path, access)
    yield* reopened.forget(result.path, note.hash!, access)
    expect((yield* reopened.importLegacy(source, access)).imported).toBe(false)
    expect((yield* reopened.previewNote(result.path, access).pipe(Effect.result))._tag).toBe("Failure")
    yield* reopened.clear
    expect((yield* reopened.importLegacy(source, access)).imported).toBe(false)
    const changed = content + "\nOther old retained content"
    expect(
      (yield* reopened
        .importLegacy(
          { ...source, content: changed, sourceHash: MemoryV2.hash(changed), generation: yield* reopened.revision },
          access,
        )
        .pipe(Effect.result))._tag,
    ).toBe("Failure")
  }),
)

it.live("explicit workspace relocation checks source and target hashes and preserves source", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const selected = { projectID: "stable-project" }
    const source = WorkspaceMemory.file(home, home)
    yield* Effect.promise(() => mkdir(path.dirname(source), { recursive: true }))
    yield* Effect.promise(() => Bun.write(source, "# Memory\n\nOld project facts"))
    const preview = yield* Effect.promise(() => WorkspaceMemory.migrationSnapshot(home, home, selected, true))
    expect(yield* Effect.promise(() => Bun.file(preview.target).exists())).toBe(false)
    yield* Effect.promise(() => Bun.write(source, "Changed after preview"))
    expect(
      (yield* Effect.tryPromise(() => WorkspaceMemory.migrate(home, home, selected, () => true, preview)).pipe(
        Effect.result,
      ))._tag,
    ).toBe("Failure")
    expect(yield* Effect.promise(() => Bun.file(preview.target).exists())).toBe(false)
    yield* Effect.promise(() => Bun.write(source, "# Memory\n\nOld project facts"))
    yield* Effect.promise(() => WorkspaceMemory.migrate(home, home, selected, () => true, preview))
    expect(yield* Effect.promise(() => readFile(source, "utf8"))).toBe("# Memory\n\nOld project facts")
    expect(yield* Effect.promise(() => readFile(preview.target, "utf8"))).toContain("Old project facts")
  }),
)

it.live("migration preview rejects a redirected source", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const outside = yield* tmpdirScoped()
    const source = WorkspaceMemory.file(home, home)
    yield* Effect.promise(() => mkdir(path.dirname(source), { recursive: true }))
    yield* Effect.promise(() => Bun.write(path.join(outside, "secret"), "outside"))
    yield* Effect.promise(() => symlink(path.join(outside, "secret"), source))
    expect(
      (yield* Effect.tryPromise(() =>
        WorkspaceMemory.migrationSnapshot(home, home, { projectID: "stable-project" }, true),
      ).pipe(Effect.result))._tag,
    ).toBe("Failure")
  }),
)

for (const phase of ["prepared", "published"] as const) {
  it.live(`explicit relocation recovers only its exact ${phase} crash receipt`, () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const selected = { projectID: "stable-project" }
      const source = WorkspaceMemory.file(home, home)
      yield* Effect.promise(() => mkdir(path.dirname(source), { recursive: true }))
      yield* Effect.promise(() => Bun.write(source, "# Memory\n\nOriginal relocation fact"))
      const preview = yield* Effect.promise(() => WorkspaceMemory.migrationSnapshot(home, home, selected, true))
      yield* Effect.promise(async () => {
        const child = Bun.spawn(
          [
            process.execPath,
            path.join(import.meta.dir, "../fixture/memory-relocation-crash.ts"),
            home,
            phase,
            preview.target,
          ],
          {
            env: {
              ...process.env,
              APEXO_TEST_HOME: home,
              XDG_DATA_HOME: path.join(home, "data"),
              XDG_STATE_HOME: path.join(home, "state"),
              XDG_CACHE_HOME: path.join(home, "cache"),
              XDG_CONFIG_HOME: path.join(home, "config"),
            },
            stdout: "ignore",
            stderr: "pipe",
          },
        )
        try {
          const deadline = Date.now() + 5000
          while (
            !(await Bun.file(path.join(home, "checkpoint")).exists()) &&
            Date.now() < deadline &&
            child.exitCode === null
          )
            await Bun.sleep(10)
          expect(await Bun.file(path.join(home, "checkpoint")).exists()).toBe(true)
        } finally {
          child.kill("SIGKILL")
          await child.exited
        }
      })
      expect(yield* Effect.promise(() => Bun.file(preview.target).exists())).toBe(phase === "published")
      expect(
        (yield* Effect.tryPromise(() => WorkspaceMemory.migrate(home, home, selected)).pipe(Effect.result))._tag,
      ).toBe("Failure")
      expect(
        (yield* Effect.tryPromise(() =>
          WorkspaceMemory.migrate(home, home, selected, () => true, { ...preview, targetHash: "foreign" }),
        ).pipe(Effect.result))._tag,
      ).toBe("Failure")
      yield* Effect.promise(() => WorkspaceMemory.migrate(home, home, selected, () => true, preview))
      const content = yield* Effect.promise(() => Bun.file(preview.target).text())
      expect(content.match(/Original relocation fact/g)).toHaveLength(1)
      yield* Effect.promise(() => WorkspaceMemory.migrate(home, home, selected, () => true, preview))
      expect(yield* Effect.promise(() => Bun.file(preview.target).text())).toBe(content)
      expect(yield* Effect.promise(() => Bun.file(source).text())).toBe("# Memory\n\nOriginal relocation fact")
    }),
  )
}

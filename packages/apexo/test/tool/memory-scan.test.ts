import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdir, readdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { MemoryV2Scan } from "@apexo/core/memory-v2-scan"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

it.live("Memory V2 discovery bounds entries, ignores unsafe files and selects topics deterministically", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const root = yield* Effect.promise(() => MemoryV2.initialize({ home, directory: home }))
    yield* Effect.promise(async () => {
      for (const name of ["z.md", "b.md", "a.md", "c.md"]) await writeFile(path.join(root.path, "topics", name), name)
      await writeFile(path.join(root.path, "observations/_inbox/first.md"), "observation")
      await writeFile(path.join(root.path, "archive/old.md"), "archive")
    })
    expect(
      yield* Effect.promise(() => MemoryV2Scan.discover(root, new Set(["topics/a.md"]), { files: 3, entries: 4 })),
    ).toEqual(["topics/b.md", "topics/c.md", "topics/z.md"])
    expect(
      (yield* Effect.tryPromise(() => MemoryV2Scan.discover(root, new Set(), { files: 3, entries: 3 })).pipe(
        Effect.result,
      ))._tag,
    ).toBe("Failure")
    yield* Effect.promise(async () => {
      await mkdir(path.join(root.path, "topics/nested"))
      await writeFile(path.join(root.path, "topics/nested/safe.md"), "nested")
      await writeFile(path.join(root.path, "topics/.private.md"), "hidden")
      await symlink(home, path.join(root.path, "topics/outside"))
      await symlink(path.join(root.path, "archive/old.md"), path.join(root.path, "topics/link.md"))
    })
    expect(yield* Effect.promise(() => MemoryV2Scan.discover(root))).toEqual([
      "topics/a.md",
      "topics/b.md",
      "topics/c.md",
      "topics/nested/safe.md",
      "topics/z.md",
      "observations/_inbox/first.md",
    ])
  }),
)

it.live("the public Memory V2 discovery cap is 10000 files and excess notes remain on disk", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const root = yield* Effect.promise(() => MemoryV2.initialize({ home, directory: home }))
    yield* Effect.promise(async () => {
      for (let start = 0; start < 10001; start += 128)
        await Promise.all(
          Array.from({ length: Math.min(128, 10001 - start) }, (_, offset) =>
            writeFile(path.join(root.path, "topics", `${String(start + offset).padStart(5, "0")}.md`), "# Topic"),
          ),
        )
    })
    const files = yield* Effect.promise(() => MemoryV2Scan.discover(root))
    expect(files.length).toBe(10000)
    expect(files[0]).toBe("topics/00000.md")
    expect(files.at(-1)).toBe("topics/09999.md")
    expect((yield* Effect.promise(() => readdir(path.join(root.path, "topics")))).length).toBe(10001)
  }),
)

it.live("clear reconciles deletion journals across multiple batches including archives", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home })
    yield* Effect.promise(() =>
      Promise.all(
        Array.from({ length: 513 }, (_, index) =>
          writeFile(path.join(store.root.path, index % 2 ? "topics" : "archive", `${index}.md`), "# Clear"),
        ),
      ),
    )
    expect(yield* store.clear).toBe(513)
    yield* store.reconcile
    expect(yield* store.listNotes("", () => true)).toEqual([])
    expect(yield* Effect.promise(() => readdir(path.join(store.root.path, "archive")))).toEqual([])
    expect(yield* store.clear).toBe(0)
  }),
)

it.live("pending manual publications recover across bounded batches", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home })
    {
      using database = new Database(path.join(store.root.path, "memory_state.sqlite"))
      const insert = database.prepare(
        "INSERT INTO memory_notes (path, content, content_hash, state, is_exposed) VALUES (?, ?, ?, 'pending', 1)",
      )
      database.transaction(() => {
        for (let index = 0; index < 257; index++) {
          const content = `# Recovered ${index}`
          insert.run(`observations/_inbox/pending-${index}.md`, content, MemoryV2.hash(content))
        }
      })()
      insert.finalize()
    }
    yield* store.reconcile
    expect(
      (yield* store.listNotes("", () => true)).filter((note) => note.name.startsWith("observations/")).length,
    ).toBe(257)
    yield* store.reconcile
    expect((yield* Effect.promise(() => readdir(path.join(store.root.path, "observations/_inbox")))).length).toBe(257)
  }),
)

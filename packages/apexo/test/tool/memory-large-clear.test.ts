import { expect } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

it.live("large Memory V2 files have bounded fingerprints and retain deletion conflict protection", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const root = yield* Effect.promise(() => MemoryV2.initialize({ home, directory: home }))
    const content = Buffer.concat([
      Buffer.from("# Large Unicode\n" + "界😀".repeat(500000)),
      Buffer.from([0xff, 0x80, 0]),
    ])
    const file = path.join(root.path, "topics/large.md")
    yield* Effect.promise(() => writeFile(file, content))
    const fingerprint = yield* Effect.promise(() => MemoryV2.fingerprint(root, "topics/large.md"))
    expect(fingerprint).toEqual({ hash: MemoryV2.hash(content), size: content.length })
    const preview = yield* Effect.promise(() => MemoryV2.preview(root, "topics/large.md"))
    expect(preview?.truncated).toBe(true)
    expect(preview?.hash).toBeNull()
    yield* Effect.promise(() => writeFile(file, Buffer.concat([content, Buffer.from("changed")])))
    expect(
      (yield* Effect.tryPromise(() => MemoryV2.remove(root, "topics/large.md", fingerprint!.hash)).pipe(Effect.result))
        ._tag,
    ).toBe("Failure")
    expect((yield* Effect.promise(() => readFile(file))).length).toBe(content.length + 7)
    const current = yield* Effect.promise(() => MemoryV2.fingerprint(root, "topics/large.md"))
    yield* Effect.promise(() => MemoryV2.remove(root, "topics/large.md", current!.hash))
    expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
  }),
)

it.live("V2 clear removes oversized topic, inbox and archive files and keeps the other scope", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home }
    const workspace = yield* MemoryCapture.make(input)
    const global = yield* MemoryCapture.make({ ...input, scope: "global" })
    const kept = yield* global.remember("GLOBAL_KEEP", () => true)
    const content = "# Large note\n" + "界".repeat(800000)
    yield* Effect.promise(() =>
      Promise.all(
        ["topics/large.md", "observations/_inbox/large.md", "archive/large.md", "MEMORY.md"].map((file) =>
          writeFile(path.join(workspace.root.path, file), content),
        ),
      ),
    )
    expect(yield* workspace.clear).toBe(3)
    expect(yield* workspace.listNotes("", () => true)).toEqual([])
    expect(yield* Effect.promise(() => readFile(kept.path, "utf8"))).toBe("GLOBAL_KEEP")
    yield* workspace.reconcile
    expect(yield* workspace.listNotes("", () => true)).toEqual([])
    expect(yield* workspace.clear).toBe(0)
  }),
)

it.live("oversized files retain immutable publication and expected-byte conflict protection", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const root = yield* Effect.promise(() => MemoryV2.initialize({ home, directory: home }))
    const content = Buffer.concat([Buffer.alloc(3 * 1024 * 1024, 65), Buffer.from([0xff, 0x80])])
    const file = path.join(root.path, "topics/large.md")
    yield* Effect.promise(() => writeFile(file, content))
    for (const [immutable, expected] of [
      [true, undefined],
      [false, MemoryV2.hash("stale")],
    ] as const) {
      const result = yield* Effect.tryPromise(() =>
        MemoryV2.publish(root, "topics/large.md", "replacement", immutable, expected),
      ).pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      expect(yield* Effect.promise(() => readFile(file))).toEqual(content)
    }
    yield* Effect.promise(() => MemoryV2.publish(root, "topics/large.md", "replacement", false, MemoryV2.hash(content)))
    expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe("replacement")
  }),
)

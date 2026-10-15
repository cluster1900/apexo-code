import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryManifest } from "@apexo/core/memory-manifest"
import { MemoryTopicReads } from "@apexo/core/memory-topic-reads"
import { MemoryV2Catalog } from "@apexo/core/memory-v2-catalog"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const root = { path: "/memory", scope: "workspace" as const }
const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

test("standard index uses topic descriptions, alphabetical topics and newest observations", () => {
  const result = MemoryManifest.render(root, [
    { path: "observations/_inbox/a.md", content: "# Old\nPRIVATE_BODY", modified: 1, readCount: 0 },
    { path: "topics/z.md", content: "# Zed\nTopic description\nNOT_INCLUDED", modified: 1, readCount: 100 },
    { path: "observations/_inbox/z.md", content: "# Newer", modified: 2, readCount: 0 },
    { path: "topics/a.md", content: "# Alpha", modified: 0, readCount: 0 },
    { path: "observations/_inbox/b.md", content: "# Same time", modified: 2, readCount: 0 },
  ])
  expect(result.paths).toEqual([
    "topics/a.md",
    "topics/z.md",
    "observations/_inbox/z.md",
    "observations/_inbox/b.md",
    "observations/_inbox/a.md",
  ])
  expect(result.content).toContain("**Zed** — Topic description (`topics/z.md`)")
  expect(result.content).not.toContain("PRIVATE_BODY")
  expect(result.content).not.toContain("NOT_INCLUDED")
  expect(result.truncated).toBe(false)
})

test("compact index ranks before its entry cap and omits descriptions and observations", () => {
  const entries = Array.from({ length: 200 }, (_, i) => ({
    path: `topics/topic-${String(i).padStart(3, "0")}.md`,
    content: `# Topic ${i}\nDESCRIPTION`,
    modified: i,
    readCount: i === 199 ? 3 : 0,
  }))
  const limited = MemoryManifest.render(root, entries, { ...MemoryManifest.budget(true), maxEntries: 10 })
  expect(limited.paths[0]).toBe("topics/topic-199.md")
  expect(limited.includedEntries).toBe(10)
  const result = MemoryManifest.render(
    root,
    [...entries, { path: "observations/_inbox/private.md", content: "# PRIVATE", modified: 0, readCount: 0 }],
    MemoryManifest.budget(true),
  )
  expect(result.content).toContain("## More topics")
  expect(result.includedEntries).toBe(200)
  expect(result.content).not.toContain("DESCRIPTION")
  expect(result.content).not.toContain("PRIVATE")
  expect(result.content).not.toContain("Pending observations")
  const slugs = result.content.split("By file name under `topics/`: ")[1]!.trim().split(", ")
  expect(slugs).toEqual(slugs.toSorted())
  const overflow = MemoryManifest.render(
    root,
    Array.from({ length: 2000 }, (_, i) => ({
      ...entries[0]!,
      path: `topics/longer-topic-${String(i).padStart(4, "0")}.md`,
    })),
    MemoryManifest.budget(true),
  )
  expect(overflow.content).toContain(`${2000 - overflow.includedEntries} more topics are not listed.`)
  expect(overflow.includedEntries).toBeLessThanOrEqual(512)
  expect(Buffer.byteLength(overflow.content)).toBeLessThanOrEqual(8192)
})

test("manifest budgets are hard UTF-8 caps and oversized topics do not starve later entries", () => {
  const entries = [
    { path: "topics/a.md", content: `# ${"界".repeat(300)}\n${"😀".repeat(200)}`, modified: 0, readCount: 0 },
    { path: "topics/b.md", content: "# B", modified: 0, readCount: 0 },
  ]
  for (const compact of [false, true]) {
    for (const bytes of [0, 1, 37, 160, 257, 512]) {
      const result = MemoryManifest.render(root, entries, { ...MemoryManifest.budget(compact), maxBytes: bytes })
      expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(bytes)
      expect(result.content).not.toContain("\ufffd")
    }
  }
  const result = MemoryManifest.render(root, entries, { ...MemoryManifest.budget(), maxBytes: 300 })
  expect(result.paths).toEqual(["topics/b.md"])
  const empty = MemoryManifest.render(
    root,
    [{ path: "observations/_inbox/a.md", content: "# A", modified: 0, readCount: 0 }],
    MemoryManifest.budget(true),
  )
  expect(empty.content).toContain("No topics have been recorded yet.")
})

it.live("ordinary topic reads rank compact disk, context and browser while previews do not count", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, permitted: () => true, compactIndex: true }
    const store = yield* MemoryCapture.make(input, { compactIndex: true })
    const alpha = path.join(store.root.path, "topics/a.md")
    const zulu = path.join(store.root.path, "topics/z`界.md")
    yield* Effect.promise(async () => {
      await writeFile(alpha, "# Alpha\nALPHA_DESCRIPTION")
      await writeFile(zulu, "# Zulu\nZULU_DESCRIPTION")
    })
    yield* store.reconcile
    const db = yield* Effect.acquireRelease(
      Effect.sync(() => new Database(path.join(store.root.path, "memory_state.sqlite"))),
      (db) => Effect.sync(() => db.close()),
    )
    yield* MemoryV2Catalog.preview(input, zulu)
    expect(db.query("SELECT * FROM memory_v2_topic_reads").all()).toEqual([])
    yield* MemoryTopicReads.record(input, zulu)
    yield* MemoryTopicReads.record(input, zulu)
    yield* MemoryTopicReads.record(input, path.join(store.root.path, "MEMORY.md"))
    yield* MemoryTopicReads.record({ ...input, permitted: (_, action) => action === "read" }, alpha)
    expect(db.query("SELECT relative_path, read_count FROM memory_v2_topic_reads").all()).toEqual([
      { relative_path: "topics/z`界.md", read_count: 2 },
    ])
    const snapshot = yield* MemoryV2Catalog.context(input)
    const disk = yield* Effect.promise(() => readFile(path.join(store.root.path, "MEMORY.md"), "utf8"))
    expect(snapshot.content).toContain(disk)
    expect(disk.indexOf("**Zulu**")).toBeLessThan(disk.indexOf("**Alpha**"))
    expect(disk).toContain("topics/z'界.md")
    expect(snapshot.access_paths).toContain(zulu)
    expect(disk).not.toContain("ZULU_DESCRIPTION")
    expect((yield* store.listNotes("", () => true))[0]!.path).toBe(zulu)
    yield* store.remember("# Observation\nNOT_IN_COMPACT", () => true)
    expect(yield* Effect.promise(() => readFile(path.join(store.root.path, "MEMORY.md"), "utf8"))).not.toContain(
      "NOT_IN_COMPACT",
    )
    yield* store.clear
    expect(db.query("SELECT * FROM memory_v2_topic_reads").all()).toEqual([])
  }),
)

it.live("filtered context cannot overwrite the shared manifest and changed captures stay excluded", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, permitted: () => true }
    const store = yield* MemoryCapture.make(input)
    const topic = path.join(store.root.path, "topics/secret.md")
    yield* Effect.promise(() => writeFile(topic, "# SECRET_TITLE\nSECRET_BODY"))
    yield* store.reconcile
    const snapshot = yield* MemoryV2Catalog.context(input)
    const disk = yield* Effect.promise(() => readFile(path.join(store.root.path, "MEMORY.md"), "utf8"))
    const filtered = yield* MemoryV2Catalog.context({ ...input, permitted: (paths) => !paths.includes(topic) })
    expect(filtered.content).not.toContain("SECRET")
    expect(yield* Effect.promise(() => readFile(path.join(store.root.path, "MEMORY.md"), "utf8"))).toBe(disk)
    expect(
      (yield* MemoryV2Catalog.context(
        { ...input, permitted: (paths) => !paths.includes(topic) },
        snapshot.access_paths,
      ).pipe(Effect.result))._tag,
    ).toBe("Failure")
    yield* store.admit({ sessionID: "s", promptID: "p", sourcePromptIndex: 0, source: "source", exposed: true })
    const captured = yield* store.commit(
      (yield* store.claim({ owner: "test", now: 1000, duration: 5000 }))!,
      MemoryCapture.parse(
        '{"outcome":"observations","observations":[{"type":"project","statement":"Original"}]}',
        "fixture",
        1,
      ),
      1001,
    )
    yield* Effect.promise(() => writeFile(captured.files[0]!, "# TAMPERED_CAPTURE"))
    expect((yield* MemoryV2Catalog.context(input)).content).not.toContain("TAMPERED_CAPTURE")
  }),
)

it.live("read counters tolerate missing and locked storage without creating a new scope", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, permitted: () => true }
    yield* MemoryTopicReads.record(input, path.join(home, "topics/missing.md"))
    const store = yield* MemoryCapture.make(input)
    const topic = path.join(store.root.path, "topics/a.md")
    yield* Effect.promise(() => writeFile(topic, "# Alpha"))
    const db = yield* Effect.acquireRelease(
      Effect.sync(() => new Database(path.join(store.root.path, "memory_state.sqlite"))),
      (db) => Effect.sync(() => db.close()),
    )
    db.exec("BEGIN IMMEDIATE")
    const start = Date.now()
    yield* MemoryTopicReads.record(input, topic)
    expect(Date.now() - start).toBeLessThan(1000)
    db.exec("ROLLBACK")
    expect(db.query("SELECT * FROM memory_v2_topic_reads").all()).toEqual([])
    yield* MemoryTopicReads.record(input, topic)
    expect(db.query("SELECT read_count FROM memory_v2_topic_reads").get()).toEqual({ read_count: 1 })
  }),
)

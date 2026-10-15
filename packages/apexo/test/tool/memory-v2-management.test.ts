import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { MemoryV2Catalog } from "@apexo/core/memory-v2-catalog"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const access = () => true
const observation = MemoryCapture.parse(
  '{"outcome":"observations","observations":[{"type":"project","statement":"Database retries use a bounded backoff"}]}',
  "grok",
  1,
)

it.live("manual V2 notes are distinct immutable observations in independent scopes", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, projectID: "repository", permitted: access }
    const first = yield* MemoryV2Catalog.remember(input, { content: "# Preference\n简洁回答" })
    const second = yield* MemoryV2Catalog.remember(input, { content: "# Preference\nUse examples" })
    const local = yield* MemoryV2Catalog.remember(input, { content: "# Database\nBounded retries", scope: "workspace" })
    expect(first.path).not.toBe(second.path)
    expect(first.path).toContain("/global/observations/_inbox/remember-")
    expect(local.path).toContain("/workspaces/")
    expect(
      (yield* MemoryV2Catalog.list(input)).filter((note) => note.name !== "MEMORY.md").map((note) => note.source),
    ).toEqual(["global", "global", "workspace"])
    expect((yield* MemoryV2Catalog.list(input, "preference 简洁")).map((note) => note.path)).toEqual([first.path])
    const other = { ...input, projectID: "another-repository" }
    expect((yield* MemoryV2Catalog.list(other)).map((note) => note.path)).not.toContain(local.path)
    const preview = yield* MemoryV2Catalog.preview(input, first.path)
    expect(preview.content).toBe("# Preference\n简洁回答")
    expect(preview.hash).toBe(MemoryV2.hash(preview.content))
    expect(preview.deletable).toBe(true)
  }),
)

it.live("V2 note deletion checks preview evidence and never re-publishes a captured observation", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, permitted: access }
    const store = yield* MemoryCapture.make(input)
    yield* store.admit({
      sessionID: "s",
      promptID: "p",
      sourcePromptIndex: 0,
      source: "durable transcript",
      exposed: true,
    })
    const lease = (yield* store.claim({ owner: "a", now: 1000, duration: 5000 }))!
    const result = yield* store.commit(lease, observation, 1001)
    const preview = yield* MemoryV2Catalog.preview(input, result.files[0]!)
    const before = yield* store.revision
    const wrong = yield* MemoryV2Catalog.forget(input, { path: preview.path, hash: "0".repeat(64) }).pipe(Effect.result)
    expect(wrong._tag).toBe("Failure")
    if (wrong._tag === "Failure") expect(wrong.failure.reason).toBe("changed")
    expect(yield* MemoryV2Catalog.forget(input, { path: preview.path, hash: preview.hash! })).toBe(true)
    expect(yield* store.revision).not.toBe(before)
    expect((yield* store.commit(lease, observation, 1002)).files).toEqual([])
    expect(yield* store.search("Database")).toEqual([])
    expect(yield* MemoryV2Catalog.list(input)).toEqual([])
    const reopened = yield* MemoryCapture.make(input)
    expect(yield* reopened.search("Database")).toEqual([])
  }),
)

it.live("clear fences another live handle and keeps cleared prompt admissions from replaying", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home }
    const first = yield* MemoryCapture.make(input)
    const second = yield* MemoryCapture.make(input)
    const request = {
      sessionID: "s",
      promptID: "old",
      sourcePromptIndex: 0,
      source: "OLD_PRIVATE_CAPTURE",
      exposed: true,
      createdAt: 1,
    }
    yield* first.admit(request)
    const lease = (yield* first.claim({ owner: "live-worker", now: 1000, duration: 5000 }))!
    yield* first.remember("OLD_PRIVATE_MANUAL", access)
    const generation = yield* first.revision
    yield* second.clear
    expect(yield* first.revision).not.toBe(generation)
    const stale = yield* first.commit(lease, observation, 1001).pipe(Effect.result)
    expect(stale._tag).toBe("Failure")
    if (stale._tag === "Failure") expect(stale.failure.reason).toBe("stale_lease")
    expect(yield* first.claim({ owner: "later", now: 9000, duration: 5000 })).toBeUndefined()
    expect((yield* first.admit(request)).admitted).toBe(false)
    expect((yield* first.admit({ ...request, promptID: "unadmitted-old" })).admitted).toBe(false)
    expect(yield* first.jobs("s")).toEqual([])
    expect(yield* first.cursors("s")).toEqual({ requested: 1, captured: 1, indexed: 1 })
    expect(
      (yield* first.admit({ ...request, promptID: "new", source: "fresh", createdAt: Date.now() + 1000 })).admitted,
    ).toBe(true)
    yield* first.remember("FRESH_AFTER_CLEAR", access)
    expect(yield* first.search("FRESH_AFTER_CLEAR")).toHaveLength(1)
    expect(yield* first.search("OLD_PRIVATE")).toEqual([])
  }),
)

it.live("committed deletion tombstones recover after a process stops before unlink", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home }
    const store = yield* MemoryCapture.make(input)
    const note = yield* store.remember("TOMBSTONE_PRIVATE", access)
    yield* Effect.promise(async () => {
      using db = new Database(path.join(store.root.path, "memory_state.sqlite"))
      const relative = path.relative(store.root.path, note.path)
      db.transaction(() => {
        db.query("INSERT INTO memory_tombstones(path, content_hash) VALUES (?, ?)").run(
          relative,
          MemoryV2.hash("TOMBSTONE_PRIVATE"),
        )
        db.query("UPDATE memory_notes SET state = 'deleted', content = '' WHERE path = ?").run(relative)
      })()
    })
    const reopened = yield* MemoryCapture.make(input)
    expect(yield* reopened.listNotes("", access)).toEqual([])
    expect(yield* reopened.search("TOMBSTONE_PRIVATE")).toEqual([])
    expect(yield* Effect.promise(() => Bun.file(note.path).exists())).toBe(false)
  }),
)

it.live("V2 catalog protects generated manifests, scope boundaries, links and read/edit permissions", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, permitted: access }
    const saved = yield* MemoryV2Catalog.remember(input, { content: "PRIVATE_NOTE" })
    const denied = { ...input, permitted: () => false }
    expect(yield* MemoryV2Catalog.list(denied)).toEqual([])
    expect((yield* MemoryV2Catalog.preview(denied, saved.path).pipe(Effect.result))._tag).toBe("Failure")
    const readonly = { ...input, permitted: (_: readonly string[], action: string) => action === "read" }
    expect((yield* MemoryV2Catalog.preview(readonly, saved.path)).deletable).toBe(false)
    expect((yield* MemoryV2Catalog.remember(readonly, { content: "DENIED_WRITE" }).pipe(Effect.result))._tag).toBe(
      "Failure",
    )
    const store = yield* MemoryCapture.make({ ...input, scope: "global" })
    const manifest = yield* MemoryV2Catalog.preview(input, path.join(store.root.path, "MEMORY.md"))
    expect(manifest.deletable).toBe(false)
    expect(
      (yield* MemoryV2Catalog.forget(input, { path: manifest.path, hash: manifest.hash! }).pipe(Effect.result))._tag,
    ).toBe("Failure")
    const outside = path.join(home, "outside.md")
    yield* Effect.promise(async () => {
      await writeFile(outside, "KEEP_OUTSIDE")
      await symlink(outside, path.join(store.root.path, "topics", "link.md"))
    })
    expect((yield* MemoryV2Catalog.list(input)).map((note) => note.name)).not.toContain("topics/link.md")
    expect((yield* MemoryV2Catalog.preview(input, outside).pipe(Effect.result))._tag).toBe("Failure")
    expect(
      (yield* MemoryV2Catalog.preview(input, path.join(store.root.path, "topics", "link.md")).pipe(Effect.result))._tag,
    ).toBe("Failure")
  }),
)

it.live("V2 context combines topics and manual notes while excluding hidden capture and denied files", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, permitted: access }
    const store = yield* MemoryCapture.make(input)
    yield* store.admit({ sessionID: "s", promptID: "hidden", sourcePromptIndex: 0, source: "hidden", exposed: false })
    yield* store.commit((yield* store.claim({ owner: "x", now: 1000, duration: 5000 }))!, observation, 1001)
    const note = yield* MemoryV2Catalog.remember(input, { content: "# GLOBAL_PREFERENCE" })
    yield* Effect.promise(() => writeFile(path.join(store.root.path, "topics", "guide.md"), "# Topic\nWORKSPACE_GUIDE"))
    const snapshot = yield* MemoryV2Catalog.context(input)
    expect(snapshot.content).toContain("GLOBAL_PREFERENCE")
    expect(snapshot.content).toContain("WORKSPACE_GUIDE")
    expect(snapshot.content).not.toContain("bounded backoff")
    const denied = { ...input, permitted: (paths: readonly string[]) => !paths.includes(note.path) }
    expect((yield* MemoryV2Catalog.context(denied)).content).not.toContain("GLOBAL_PREFERENCE")
    expect((yield* MemoryV2Catalog.context(denied, snapshot.access_paths).pipe(Effect.result))._tag).toBe("Failure")
    yield* MemoryV2Catalog.remember(input, { content: `${"x".repeat(511)}😀` })
    const unicode = yield* MemoryV2Catalog.context(input)
    expect(Buffer.from(unicode.content).toString()).toBe(unicode.content)
  }),
)

it.live("large V2 previews preserve UTF-8 boundaries and cannot be deleted with incomplete evidence", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, permitted: access }
    const store = yield* MemoryCapture.make(input)
    const file = path.join(store.root.path, "topics", "large.md")
    yield* Effect.promise(async () => {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, "界".repeat(100000))
    })
    const preview = yield* MemoryV2Catalog.preview(input, file)
    expect(preview.truncated).toBe(true)
    expect(preview.hash).toBeNull()
    expect(preview.deletable).toBe(false)
    expect(preview.content).not.toContain("�")
    expect((yield* MemoryV2Catalog.forget(input, { path: file, hash: "0".repeat(64) }).pipe(Effect.result))._tag).toBe(
      "Failure",
    )
    expect((yield* Effect.promise(() => readFile(file))).length).toBe(300000)
  }),
)

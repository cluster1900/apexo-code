import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { readFile, readdir, utimes, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryConsolidation } from "@apexo/core/memory-consolidation"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const access = () => true
const request = { owner: "worker", now: 1000, duration: 5000 }

it.live("opening an older capture store adds commit timestamps without replacing existing outcomes", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const root = yield* Effect.promise(() => MemoryV2.initialize({ home, directory: home }))
    yield* Effect.sync(() => {
      using database = new Database(path.join(root.path, "memory_state.sqlite"))
      database.run("CREATE TABLE capture_outcomes (job_id TEXT PRIMARY KEY, outcome_hash TEXT NOT NULL)")
      database.run("INSERT INTO capture_outcomes VALUES ('existing', 'preserved')")
    })
    const memory = yield* MemoryCapture.make({ home, directory: home })
    yield* memory.remember("Manual fact after migration", access)
    yield* Effect.sync(() => {
      using database = new Database(path.join(root.path, "memory_state.sqlite"), { readonly: true })
      expect(database.query("SELECT * FROM capture_outcomes").all()).toEqual([
        { job_id: "existing", outcome_hash: "preserved", committed_at: null },
      ])
    })
  }),
)

it.live("automatic Dream uses count and age thresholds and excludes denied or shadow notes", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    const now = Date.now()
    expect((yield* memory.dreamEligibility(now, false, access)).ready).toBe(false)
    const first = yield* memory.remember("First manual observation", access)
    yield* Effect.promise(() => utimes(first.path, new Date(1000), new Date(1000)))
    expect(yield* memory.dreamEligibility(86400_999, false, access)).toEqual({ count: 1, oldest: 1000, ready: false })
    expect((yield* memory.dreamEligibility(86401_000, false, access)).ready).toBe(true)
    expect(
      (yield* memory.dreamEligibility(now, false, (file) => path.join(memory.root.path, file) !== first.path)).count,
    ).toBe(0)
    yield* Effect.promise(() => utimes(first.path, new Date(now), new Date(now)))
    for (const n of Array.from({ length: 18 }, (_, n) => n)) yield* memory.remember(`New fact ${n}`, access)
    expect((yield* memory.dreamEligibility(now, false, access)).ready).toBe(false)
    yield* memory.remember("Twentieth observation", access)
    expect((yield* memory.dreamEligibility(now, false, access)).ready).toBe(true)
    expect((yield* memory.dreamEligibility(now, true, access)).count).toBe(0)
  }),
)

it.live("captured observation age survives file touches and shadow evaluation is deduplicated", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    yield* memory.enqueue({
      sessionID: "aged",
      from: 1,
      through: 1,
      sourcePromptIndex: 0,
      source: "fact",
      exposed: false,
    })
    const capture = (yield* memory.claim(request))!
    yield* memory.commit(
      capture,
      MemoryCapture.parse(
        '{"outcome":"observations","observations":[{"type":"project","statement":"Captured fact"}]}',
        "model",
        1,
      ),
      1001,
    )
    const lease = (yield* memory.dreamClaim({ ...request, shadow: true }, access))!
    const input = yield* memory.dreamInput(lease, 1002, access)
    yield* Effect.promise(() =>
      utimes(path.join(memory.root.path, input.observations[0]!.path), new Date(), new Date()),
    )
    expect(yield* memory.dreamEligibility(86401_001, true, access)).toEqual({ count: 1, oldest: 1001, ready: true })
    expect((yield* memory.dreamEligibility(86401_001, false, access)).count).toBe(0)
    yield* memory.dreamCommit(
      lease,
      [
        {
          action: "create",
          path: "topics/aged.md",
          content: "Fact",
          evidence: input.observations.map((row) => row.path),
        },
      ],
      1003,
      access,
    )
    expect((yield* memory.dreamEligibility(86401_001, true, access)).ready).toBe(false)
  }),
)

it.live("Dream six operations preserve evidence, archive observations, and converge the shared index", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    const consolidate = (operations: (evidence: string[]) => MemoryConsolidation.Operation[]) =>
      Effect.gen(function* () {
        yield* memory.remember("Durable new project knowledge", access)
        const lease = (yield* memory.dreamClaim(request, access))!
        const input = yield* memory.dreamInput(lease, 1001, access)
        const plan = operations(input.observations.map((item) => item.path))
        const result = yield* memory.dreamCommit(lease, plan, 1002, access)
        expect(result.status).toBe("completed")
        expect(result.observations).toBe(1)
        expect(yield* memory.dreamCommit(lease, plan, 1003, access)).toEqual(result)
        expect((yield* memory.listNotes("", access)).some((item) => item.name.startsWith("observations/"))).toBe(false)
      })
    yield* consolidate((evidence) => [
      { action: "create", path: "topics/database.md", content: "# Database\nSQLite retries", evidence },
      { action: "create", path: "topics/testing.md", content: "# Testing\nRun tests", evidence },
    ])
    yield* consolidate((evidence) => [
      {
        action: "split",
        source: "topics/database.md",
        destinations: [
          { path: "topics/database.md", content: "# Database\nSQLite" },
          { path: "topics/retries.md", content: "# Retry\nBounded backoff" },
        ],
        evidence,
      },
      {
        action: "rename",
        from: "topics/testing.md",
        to: "topics/validation.md",
        content: "# Validation\nRun tests",
        evidence,
      },
    ])
    yield* consolidate((evidence) => [
      {
        action: "merge",
        sources: ["topics/database.md", "topics/retries.md"],
        destination: "topics/database.md",
        content: "# Database\nSQLite uses bounded backoff",
        evidence,
      },
      { action: "delete", path: "topics/validation.md", evidence },
    ])
    yield* consolidate((evidence) => [
      {
        action: "update",
        path: "topics/database.md",
        content: "# Database\n最终规则 SQLite\n<!-- memory-v2 provenance: hidden -->",
        evidence,
      },
    ])
    expect((yield* memory.search("最终规则"))[0]?.path).toBe("topics/database.md")
    expect(yield* Effect.promise(() => readdir(path.join(memory.root.path, "topics")))).toEqual(["database.md"])
    expect((yield* Effect.promise(() => readdir(path.join(memory.root.path, "archive")))).length).toBe(4)
    expect(
      yield* Effect.promise(() => readFile(path.join(memory.root.path, "topics/database.md"), "utf8")),
    ).not.toContain("provenance")
    expect(yield* memory.dreamClaim(request, access)).toBeUndefined()
  }),
)

it.live("Dream snapshots exclude arrivals, independent handles contend, and stale workers are fenced", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const first = yield* MemoryCapture.make({ home, directory: home })
    const second = yield* MemoryCapture.make({ home, directory: home })
    yield* first.remember("Initial observation", access)
    const lease = (yield* first.dreamClaim(request, access))!
    yield* second.remember("Arrival after claim", access)
    expect((yield* first.dreamInput(lease, 1001, access)).observations.length).toBe(1)
    expect((yield* second.dreamClaim({ ...request, owner: "second" }, access).pipe(Effect.result))._tag).toBe("Failure")
    const successor = (yield* second.dreamClaim({ ...request, owner: "second", now: 6000 }, access))!
    expect((yield* second.dreamInput(successor, 6001, access)).observations.length).toBe(2)
    expect((yield* first.dreamInput(lease, 6001, access).pipe(Effect.result))._tag).toBe("Failure")
    expect((yield* first.dreamRelease(lease, 6001).pipe(Effect.result))._tag).toBe("Failure")
  }),
)

it.live("durable plans resume exact bytes before new arrivals and after archive completion", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const first = yield* MemoryCapture.make({ home, directory: home })
    yield* first.remember("Original evidence", access)
    const lease = (yield* first.dreamClaim(request, access))!
    const input = yield* first.dreamInput(lease, 1001, access)
    const plan: MemoryConsolidation.Operation[] = [
      {
        action: "create",
        path: "topics/recovery.md",
        content: "# Recovery\nPersist exactly",
        evidence: input.observations.map((row) => row.path),
      },
    ]
    yield* first.dreamPrepare(lease, plan, 1002, access)
    yield* first.remember("Later arrival", access)
    const reopened = yield* MemoryCapture.make({ home, directory: home })
    const resumed = (yield* reopened.dreamClaim({ ...request, now: 6000 }, access))!
    expect(resumed.id).toBe(lease.id)
    expect(resumed.planned).toBe(true)
    expect(
      (yield* reopened
        .dreamPrepare(
          resumed,
          [{ ...plan[0]!, action: "create", path: "topics/wrong.md", content: "wrong" }],
          6001,
          access,
        )
        .pipe(Effect.result))._tag,
    ).toBe("Failure")
    yield* reopened.dreamApply(resumed, 6001, access)
    const afterArchive = yield* MemoryCapture.make({ home, directory: home })
    const again = (yield* afterArchive.dreamClaim({ ...request, now: 11000 }, access))!
    const result = yield* afterArchive.dreamResume(again, 11001, access)
    expect(result.observations).toBe(1)
    expect((yield* afterArchive.search("Persist exactly"))[0]?.path).toBe("topics/recovery.md")
    const next = (yield* afterArchive.dreamClaim({ ...request, now: 11002 }, access))!
    expect((yield* afterArchive.dreamInput(next, 11003, access)).observations[0]?.content).toBe("Later arrival")
  }),
)

it.live("Dream rejects empty plans, unclaimed evidence, duplicate mutations, traversal and collisions", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    yield* memory.remember("Evidence", access)
    yield* Effect.promise(() => MemoryV2.publish(memory.root, "topics/existing.md", "Existing knowledge", true))
    const lease = (yield* memory.dreamClaim(request, access))!
    const input = yield* memory.dreamInput(lease, 1001, access)
    const evidence = input.observations.map((row) => row.path)
    const create: MemoryConsolidation.Operation = { action: "create", path: "topics/new.md", content: "New", evidence }
    const invalid: MemoryConsolidation.Operation[][] = [
      [],
      [create, create],
      [{ ...create, evidence: [] }],
      [{ ...create, evidence: ["unclaimed.md"] }],
      [{ ...create, path: "../outside.md" }],
      [{ ...create, path: "MEMORY.md" }],
      [{ ...create, path: "topics/existing.md" }],
      [{ ...create, content: "中".repeat(100_000) }],
      [{ ...create, action: "update" }],
      [{ action: "rename", from: "topics/existing.md", to: "topics/new.md", content: "", evidence }],
      [
        {
          action: "merge",
          sources: ["topics/existing.md", "topics/existing.md"],
          destination: "topics/existing.md",
          content: "Invalid",
          evidence,
        },
      ],
    ]
    for (const plan of invalid)
      expect((yield* memory.dreamPrepare(lease, plan, 1002, access).pipe(Effect.result))._tag).toBe("Failure")
    expect((yield* Effect.promise(() => readdir(path.join(memory.root.path, "archive")))).length).toBe(0)
    expect((yield* memory.dreamInput(lease, 1003, access)).observations.length).toBe(1)
    expect(() => MemoryConsolidation.parse('{"operations":[],"extra":true}')).toThrow()
    expect(MemoryConsolidation.parse(JSON.stringify({ operations: [create] }))).toEqual([create])
  }),
)

it.live("external edits abort before publication and changed durable inputs can be claimed afresh", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    const note = yield* memory.remember("Before", access)
    const lease = (yield* memory.dreamClaim(request, access))!
    const input = yield* memory.dreamInput(lease, 1001, access)
    yield* memory.dreamPrepare(
      lease,
      [
        {
          action: "create",
          path: "topics/protected.md",
          content: "Planned",
          evidence: input.observations.map((row) => row.path),
        },
      ],
      1002,
      access,
    )
    yield* Effect.promise(() => writeFile(note.path, "After"))
    expect((yield* memory.dreamResume(lease, 1003, access).pipe(Effect.result))._tag).toBe("Failure")
    expect(yield* Effect.promise(() => readdir(path.join(memory.root.path, "topics")))).toEqual([])
    const next = (yield* memory.dreamClaim({ ...request, now: 6000 }, access))!
    expect(next.planned).toBe(false)
    expect(next.id).not.toBe(lease.id)
    expect((yield* memory.dreamInput(next, 6001, access)).observations[0]?.content).toBe("After")
  }),
)

it.live("shadow validates hidden capture once without exposing, modifying or archiving it", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    yield* memory.enqueue({
      sessionID: "shadow",
      from: 1,
      through: 1,
      sourcePromptIndex: 0,
      source: "Hidden transcript",
      exposed: false,
    })
    const capture = (yield* memory.claim(request))!
    yield* memory.commit(
      capture,
      MemoryCapture.parse(
        '{"outcome":"observations","observations":[{"type":"project","statement":"Hidden durable fact"}]}',
        "model",
        1,
      ),
      1001,
    )
    yield* memory.remember("Public manual note excluded from shadow", access)
    const before = yield* Effect.promise(() => readFile(path.join(memory.root.path, "MEMORY.md"), "utf8"))
    const lease = (yield* memory.dreamClaim({ ...request, shadow: true }, access))!
    const input = yield* memory.dreamInput(lease, 1002, access)
    expect(input.observations.length).toBe(1)
    const result = yield* memory.dreamCommit(
      lease,
      [
        {
          action: "create",
          path: "topics/shadow.md",
          content: "Should not appear",
          evidence: input.observations.map((row) => row.path),
        },
      ],
      1003,
      access,
    )
    expect(result.status).toBe("shadow")
    expect(yield* memory.search("Hidden durable fact")).toEqual([])
    expect(yield* Effect.promise(() => readdir(path.join(memory.root.path, "topics")))).toEqual([])
    expect(yield* Effect.promise(() => readdir(path.join(memory.root.path, "archive")))).toEqual([])
    expect(yield* Effect.promise(() => readFile(path.join(memory.root.path, "MEMORY.md"), "utf8"))).toBe(before)
    expect(yield* memory.dreamClaim({ ...request, shadow: true }, access)).toBeUndefined()
    yield* memory.promote
    expect(yield* memory.dreamClaim(request, access)).toBeDefined()
  }),
)

it.live("clear removes private Dream journals and fences recovery; deletion invalidates inference", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    const note = yield* memory.remember("PRIVATE_NOTE", access)
    const lease = (yield* memory.dreamClaim(request, access))!
    yield* memory.forget(path.relative(memory.root.path, note.path), MemoryV2.hash("PRIVATE_NOTE"), access)
    expect((yield* memory.dreamInput(lease, 1001, access).pipe(Effect.result))._tag).toBe("Failure")
    yield* memory.remember("ANOTHER_PRIVATE_NOTE", access)
    const next = (yield* memory.dreamClaim(request, access))!
    const input = yield* memory.dreamInput(next, 1001, access)
    yield* memory.dreamPrepare(
      next,
      [
        {
          action: "create",
          path: "topics/private.md",
          content: "ANOTHER_PRIVATE_NOTE",
          evidence: input.observations.map((row) => row.path),
        },
      ],
      1002,
      access,
    )
    const detail = yield* memory.previewNote(input.observations[0]!.path, access)
    expect((yield* memory.forget(detail.name, detail.hash!, access).pipe(Effect.result))._tag).toBe("Failure")
    yield* memory.clear
    expect((yield* memory.dreamResume(next, 1003, access).pipe(Effect.result))._tag).toBe("Failure")
    expect(yield* memory.dreamClaim({ ...request, now: 6000 }, access)).toBeUndefined()
    expect(yield* memory.listNotes("", access)).toEqual([])
    const global = yield* MemoryCapture.make({ home, directory: home, scope: "global" })
    yield* global.remember("Global note remains separate", access)
    expect(yield* memory.dreamClaim(request, access)).toBeUndefined()
    expect(yield* global.dreamClaim(request, access)).toBeDefined()
  }),
)

it.live("Dream rechecks topic and archive permissions before any publication", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    yield* memory.remember("Evidence", access)
    const lease = (yield* memory.dreamClaim(request, access))!
    const input = yield* memory.dreamInput(lease, 1001, access)
    const plan: MemoryConsolidation.Operation[] = [
      {
        action: "create",
        path: "topics/denied.md",
        content: "Do not write",
        evidence: input.observations.map((row) => row.path),
      },
    ]
    expect(
      (yield* memory
        .dreamPrepare(lease, plan, 1002, (file, action) => action !== "edit" || !file.startsWith("topics/"))
        .pipe(Effect.result))._tag,
    ).toBe("Failure")
    yield* memory.dreamPrepare(lease, plan, 1002, access)
    expect(
      (yield* memory.dreamResume(lease, 1003, (file) => !file.startsWith("archive/")).pipe(Effect.result))._tag,
    ).toBe("Failure")
    expect(yield* Effect.promise(() => readdir(path.join(memory.root.path, "topics")))).toEqual([])
  }),
)

it.live("recovery preserves a manually edited topic and abandons its stale durable plan", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    yield* memory.remember("Evidence for the original plan", access)
    yield* Effect.promise(() => MemoryV2.publish(memory.root, "topics/existing.md", "Before", true))
    const lease = (yield* memory.dreamClaim(request, access))!
    const input = yield* memory.dreamInput(lease, 1001, access)
    const evidence = input.observations.map((row) => row.path)
    yield* memory.dreamPrepare(
      lease,
      [{ action: "update", path: "topics/existing.md", content: "From model", evidence }],
      1002,
      access,
    )
    yield* Effect.promise(() => writeFile(path.join(memory.root.path, "topics/existing.md"), "Manual edit"))
    expect((yield* memory.dreamResume(lease, 1003, access).pipe(Effect.result))._tag).toBe("Failure")
    const replacement = (yield* memory.dreamClaim({ ...request, now: 6000 }, access))!
    expect(replacement.planned).toBe(false)
    expect((yield* memory.dreamInput(replacement, 6001, access)).topics[0]?.content).toBe("Manual edit")
    expect(yield* Effect.promise(() => readdir(path.join(memory.root.path, "archive")))).toEqual([])
    expect(
      (yield* Effect.tryPromise(() =>
        MemoryV2.publish(memory.root, "topics/existing.md", "Wrong old data", false, MemoryV2.hash("Before")),
      ).pipe(Effect.result))._tag,
    ).toBe("Failure")
    expect(yield* Effect.promise(() => readFile(path.join(memory.root.path, "topics/existing.md"), "utf8"))).toBe(
      "Manual edit",
    )
  }),
)

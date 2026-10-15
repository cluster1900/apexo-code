import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryRetention } from "@apexo/core/memory-retention"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const access = () => true
const immediate = { archivedDays: 0, jobDays: 0 }
const day = 86400_000
type Store = Effect.Success<ReturnType<typeof MemoryCapture.make>>

it.live("retention removes terminal jobs after 14 days and archives after 30 without recapturing old turns", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home })
    const captured = yield* capture(store, "first")
    yield* consolidate(store)
    const policy = { archivedDays: 30, jobDays: 14 }
    expect(yield* store.gc(1001 + 14 * day - 1, policy, access)).toEqual({ archives: 0, jobs: 0 })
    expect(yield* store.gc(1001 + 14 * day, policy, access)).toEqual({ archives: 0, jobs: 1 })
    expect(yield* store.cursors("first")).toEqual({ requested: 1, captured: 1, indexed: 1 })
    expect(
      (yield* store.admit({
        sessionID: "first",
        promptID: "prompt",
        sourcePromptIndex: 0,
        source: "changed retry",
        exposed: true,
      })).admitted,
    ).toBe(false)
    expect(
      (yield* store
        .enqueue({ sessionID: "first", from: 1, through: 1, sourcePromptIndex: 0, source: "old" })
        .pipe(Effect.result))._tag,
    ).toBe("Failure")
    expect(yield* store.gc(1003 + 30 * day - 1, policy, access)).toEqual({ archives: 0, jobs: 0 })
    expect(yield* store.gc(1003 + 30 * day, policy, access)).toEqual({ archives: 1, jobs: 0 })
    expect(yield* Effect.promise(() => readdir(path.join(store.root.path, "archive")))).toEqual([])
    expect((yield* store.search("Retained topic"))[0]?.path).toBe("topics/retained.md")
    yield* Effect.promise(() => writeFile(captured.files[0]!, "RECREATED_OLD_OBSERVATION"))
    expect((yield* store.listNotes("RECREATED_OLD_OBSERVATION", access)).length).toBe(0)
    expect((yield* store.commit(captured.lease, captured.outcome, 1005).pipe(Effect.result))._tag).toBe("Failure")
    yield* store.admit({
      sessionID: "first",
      promptID: "next",
      sourcePromptIndex: 2,
      source: "new turn",
      exposed: true,
    })
    expect((yield* store.jobs("first"))[0]?.from_turn).toBe(2)
  }),
)

it.live("live and hidden observations, retry failures, pending and running capture jobs survive retention", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home })
    yield* capture(store, "live")
    yield* capture(store, "hidden", false)
    yield* capture(store, "noop", true, true)
    for (const sessionID of ["retry", "terminal", "running", "pending"]) {
      yield* store.admit({ sessionID, promptID: "prompt", sourcePromptIndex: 0, source: "source", exposed: true })
      if (sessionID === "pending") continue
      const lease = (yield* store.claim({ sessionID, owner: "test", now: 1000, duration: 5000 }))!
      if (sessionID !== "running") yield* store.fail(lease, "test failure", sessionID === "terminal", 1001)
    }
    expect(yield* store.gc(1001, immediate, access)).toEqual({ archives: 0, jobs: 2 })
    for (const id of ["live", "hidden", "retry", "running", "pending"]) expect((yield* store.jobs(id)).length).toBe(1)
    expect((yield* store.jobs("terminal")).length).toBe(0)
    expect((yield* store.jobs("noop")).length).toBe(0)
  }),
)

it.live("retention waits for active inference and expired durable Dream plans", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home })
    yield* capture(store, "archived")
    yield* consolidate(store)
    yield* store.remember("New evidence", access)
    const lease = (yield* store.dreamClaim({ owner: "dream", now: 2000, duration: 5000 }, access))!
    const busy = yield* store.gc(2001, immediate, access).pipe(Effect.result)
    expect(
      busy._tag === "Failure" && busy.failure instanceof MemoryRetention.RetentionError && busy.failure.reason,
    ).toBe("busy")
    const input = yield* store.dreamInput(lease, 2001, access)
    yield* store.dreamPrepare(
      lease,
      [
        {
          action: "update",
          path: "topics/retained.md",
          content: "Retained topic update",
          evidence: input.observations.map((row) => row.path),
        },
      ],
      2002,
      access,
    )
    expect((yield* store.gc(9000, immediate, access).pipe(Effect.result))._tag).toBe("Failure")
    const resumed = (yield* store.dreamClaim({ owner: "recovery", now: 9000, duration: 5000 }, access))!
    yield* store.dreamResume(resumed, 9001, access)
    expect(yield* store.gc(9002, immediate, access)).toEqual({ archives: 2, jobs: 1 })
  }),
)

it.live("retention preserves edited archives and enforces file access before staging deletion", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home })
    yield* capture(store, "archive")
    yield* consolidate(store)
    const file = (yield* Effect.promise(() => readdir(path.join(store.root.path, "archive"))))[0]!
    const original = yield* Effect.promise(() => readFile(path.join(store.root.path, "archive", file), "utf8"))
    const denied = yield* store.gc(1004, immediate, (file) => !file.startsWith("archive/")).pipe(Effect.result)
    expect(
      denied._tag === "Failure" && denied.failure instanceof MemoryRetention.RetentionError && denied.failure.reason,
    ).toBe("denied")
    yield* Effect.promise(() => writeFile(path.join(store.root.path, "archive", file), "USER_EDIT"))
    const conflict = yield* store.gc(1004, immediate, access).pipe(Effect.result)
    expect(
      conflict._tag === "Failure" &&
        conflict.failure instanceof MemoryRetention.RetentionError &&
        conflict.failure.reason,
    ).toBe("conflict")
    expect(yield* Effect.promise(() => readFile(path.join(store.root.path, "archive", file), "utf8"))).toBe("USER_EDIT")
    yield* Effect.promise(() => writeFile(path.join(store.root.path, "archive", file), original))
    expect(yield* store.gc(1004, immediate, access)).toEqual({ archives: 1, jobs: 1 })
    expect(
      (yield* store.gc(1004, { ...immediate, jobDays: Number.MAX_SAFE_INTEGER }, access).pipe(Effect.result))._tag,
    ).toBe("Failure")
  }),
)

it.live("a real SQLite cleanup failure after file removal replays its durable journal on reopening", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home })
    yield* capture(store, "crash")
    yield* consolidate(store)
    yield* Effect.sync(() => {
      using database = new Database(path.join(store.root.path, "memory_state.sqlite"))
      database.run(
        "CREATE TRIGGER gc_fault BEFORE DELETE ON dream_archives BEGIN SELECT RAISE(ABORT, 'retention fault'); END",
      )
    })
    expect((yield* store.gc(1004, immediate, access).pipe(Effect.result))._tag).toBe("Failure")
    expect(yield* Effect.promise(() => readdir(path.join(store.root.path, "archive")))).toEqual([])
    yield* Effect.sync(() => {
      using database = new Database(path.join(store.root.path, "memory_state.sqlite"))
      expect(database.query("SELECT count(*) AS n FROM memory_gc_archives").get()).toEqual({ n: 1 })
      database.run("DROP TRIGGER gc_fault")
    })
    const reopened = yield* MemoryCapture.make({ home, directory: home })
    expect(yield* reopened.gc(1005, immediate, access)).toEqual({ archives: 1, jobs: 1 })
    expect(yield* reopened.gc(1006, immediate, access)).toEqual({ archives: 0, jobs: 0 })
    expect((yield* reopened.search("Retained topic"))[0]?.path).toBe("topics/retained.md")
  }),
)

it.live("retention processes at most 256 archives per pass", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home })
    // Seed external notes together; repeatedly rebuilding the growing manifest
    // through remember() is unrelated to the retention batch boundary.
    yield* Effect.promise(() =>
      Promise.all(
        Array.from({ length: 260 }, (_, n) =>
          writeFile(path.join(store.root.path, "observations", "_inbox", `fixture-${n}.md`), `Fact ${n}`),
        ),
      ),
    )
    yield* consolidate(store)
    expect(yield* store.gc(1004, immediate, access)).toEqual({ archives: 256, jobs: 0 })
    expect(yield* Effect.promise(() => readdir(path.join(store.root.path, "archive")))).toHaveLength(4)
    expect(yield* store.gc(1005, immediate, access)).toEqual({ archives: 4, jobs: 0 })
    expect((yield* store.listNotes("", access)).some((row) => row.name.startsWith("observations/"))).toBe(false)
  }),
)

it.live("retention bounds terminal job collection and retains exact admission retries", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home })
    for (const n of Array.from({ length: 258 }, (_, n) => n)) yield* capture(store, `noop-${n}`, true, true)
    expect(yield* store.gc(1002, immediate, access)).toEqual({ archives: 0, jobs: 256 })
    expect(yield* store.gc(1003, immediate, access)).toEqual({ archives: 0, jobs: 2 })
    expect(yield* store.gc(1004, immediate, access)).toEqual({ archives: 0, jobs: 0 })
    expect(
      (yield* store.admit({
        sessionID: "noop-0",
        promptID: "prompt",
        sourcePromptIndex: 0,
        source: "source",
        exposed: true,
      })).admitted,
    ).toBe(false)
    expect(yield* store.cursors("noop-0")).toEqual({ requested: 1, captured: 1, indexed: 1 })
  }),
)

it.live("older jobs use known commit time or a stable upgrade time for retention", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const root = yield* Effect.gen(function* () {
      const store = yield* MemoryCapture.make({ home, directory: home })
      yield* capture(store, "known", true, true)
      yield* capture(store, "unknown", true, true)
      return store.root.path
    }).pipe(Effect.scoped)
    yield* Effect.sync(() => {
      using db = new Database(path.join(root, "memory_state.sqlite"))
      db.run("ALTER TABLE capture_jobs DROP COLUMN terminal_at")
      db.run(
        "UPDATE capture_outcomes SET committed_at = NULL WHERE job_id IN (SELECT job_id FROM capture_jobs WHERE session_id = 'unknown')",
      )
    })
    const before = Date.now()
    const store = yield* MemoryCapture.make({ home, directory: home })
    yield* store.jobs("unknown")
    const upgraded = yield* Effect.sync(() => {
      using db = new Database(path.join(root, "memory_state.sqlite"), { readonly: true })
      expect(db.query("SELECT terminal_at FROM capture_jobs WHERE session_id = 'known'").get()).toEqual({
        terminal_at: 1001,
      })
      const row = db
        .query<{ terminal_at: number }, []>("SELECT terminal_at FROM capture_jobs WHERE session_id = 'unknown'")
        .get()!
      expect(row.terminal_at).toBeGreaterThanOrEqual(before)
      expect(row.terminal_at).toBeLessThanOrEqual(Date.now())
      return row.terminal_at
    })
    const reopened = yield* MemoryCapture.make({ home, directory: home })
    yield* reopened.jobs("unknown")
    yield* Effect.sync(() => {
      using db = new Database(path.join(root, "memory_state.sqlite"), { readonly: true })
      expect(db.query("SELECT terminal_at FROM capture_jobs WHERE session_id = 'unknown'").get()).toEqual({
        terminal_at: upgraded,
      })
    })
    expect(yield* reopened.gc(1001 + 14 * day, { archivedDays: 30, jobDays: 14 }, access)).toEqual({
      archives: 0,
      jobs: 1,
    })
    expect((yield* reopened.jobs("unknown")).length).toBe(1)
  }),
)

function capture(store: Store, sessionID: string, exposed = true, noop = false) {
  return Effect.gen(function* () {
    yield* store.admit({ sessionID, promptID: "prompt", sourcePromptIndex: 0, source: "source", exposed })
    const lease = (yield* store.claim({ sessionID, owner: "capture", now: 1000, duration: 5000 }))!
    const outcome = MemoryCapture.parse(
      JSON.stringify(
        noop
          ? { outcome: "noop" }
          : { outcome: "observations", observations: [{ type: "project", statement: `Durable ${sessionID}` }] },
      ),
      "fixture",
      1,
    )
    return { lease, outcome, ...(yield* store.commit(lease, outcome, 1001)) }
  })
}

function consolidate(store: Store) {
  return Effect.gen(function* () {
    const lease = (yield* store.dreamClaim({ owner: "dream", now: 1002, duration: 5000 }, access))!
    const input = yield* store.dreamInput(lease, 1002, access)
    return yield* store.dreamCommit(
      lease,
      [
        {
          action: "create",
          path: "topics/retained.md",
          content: "# Retained topic\nKeep useful project knowledge.",
          evidence: input.observations.slice(0, 64).map((row) => row.path),
        },
      ],
      1003,
      access,
    )
  })
}

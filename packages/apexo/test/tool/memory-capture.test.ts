import { expect, test } from "bun:test"
import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const noop: MemoryCapture.Outcome = { outcome: "noop", observations: [] }
const enqueue = (sessionID = "session", from = 1, through = from) => ({
  sessionID,
  from,
  through,
  sourcePromptIndex: through - 1,
  source: `durable transcript ${sessionID}/${from}-${through}`,
})
const request = (owner = "worker", now = 1000) => ({ owner, now, duration: 5000 })
const outcome = (statement = "Use WAL for concurrent readers.") =>
  MemoryCapture.parse(
    JSON.stringify({
      outcome: "observations",
      observations: [
        {
          type: "project",
          topic_hint: "database",
          statement,
          keywords: ["sqlite"],
          aliases: [],
          body: "数据库连接池配置。",
        },
      ],
    }),
    "xai/grok",
    1788000000,
  )

it.live("flush progress keeps terminal failures distinct from indexed success and freezes its target", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    expect(yield* memory.progress("session", 1)).toEqual({ indexed: 0, failed: false, retry: false })
    yield* memory.enqueue(enqueue())
    yield* memory.commit((yield* memory.claim(request()))!, noop, 1100)
    expect(yield* memory.progress("session", 1)).toEqual({ indexed: 1, failed: false, retry: false })
    yield* memory.enqueue(enqueue("session", 2))
    yield* memory.fail((yield* memory.claim(request()))!, "retryable output", false, 1200)
    expect(yield* memory.progress("session", 2)).toEqual({ indexed: 1, failed: false, retry: true })
    yield* memory.enqueue(enqueue("session", 3))
    expect(yield* memory.progress("session", 2)).toEqual({ indexed: 1, failed: false, retry: true })
    expect(yield* memory.progress("session", 3)).toEqual({ indexed: 1, failed: false, retry: false })
    const pending = (yield* memory.claim(request()))!
    expect(pending.job.through_turn).toBe(3)
    yield* memory.commit(pending, noop, 1250)
    expect(yield* memory.progress("session", 3)).toEqual({ indexed: 1, failed: false, retry: true })
    yield* memory.fail((yield* memory.claim(request()))!, "terminal output", true, 1300)
    yield* memory.reconcile
    expect(yield* memory.progress("session", 2)).toEqual({ indexed: 3, failed: true, retry: false })
    expect(yield* memory.progress("session", 1)).toEqual({ indexed: 3, failed: false, retry: false })
    const reopened = yield* MemoryCapture.make({ home, directory: home })
    expect(yield* reopened.progress("session", 2)).toEqual({ indexed: 3, failed: true, retry: false })
  }),
)

it.live("prompt admission is atomic across handles and keeps the first snapshot immutable", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const location = { home, directory: home }
    const first = yield* MemoryCapture.make(location)
    const second = yield* MemoryCapture.make(location)
    const input = {
      sessionID: "session",
      promptID: "msg_first",
      sourcePromptIndex: 0,
      source: "original snapshot",
      exposed: false,
    }
    const values = yield* Effect.all([first.admit(input), second.admit(input)], { concurrency: "unbounded" })
    expect(values.filter((value) => value.admitted)).toHaveLength(1)
    expect((yield* first.admit({ ...input, source: "changed after admission", exposed: true })).admitted).toBe(false)
    yield* second.admit({ ...input, promptID: "msg_second", sourcePromptIndex: 2 })
    const jobs = yield* first.jobs("session")
    expect(jobs.map((job) => [job.from_turn, job.through_turn, job.source, job.is_exposed])).toEqual([
      [1, 1, "original snapshot", 0],
      [2, 2, "original snapshot", 0],
    ])
    expect(yield* first.cursors("session")).toEqual({ requested: 2, captured: 0, indexed: 0 })
  }),
)

test("capture parsing uses strict structured output, UTF-8 limits and control normalization", () => {
  expect(MemoryCapture.parse('{"outcome":"noop"}', "grok", 1)).toEqual(noop)
  expect(outcome("Keep\nthis\u0000fact").observations[0]?.statement).toBe("Keep this fact")
  for (const value of [
    "not json",
    '{"outcome":"observations","observations":[]}',
    '{"outcome":"noop","extra":true}',
    '{"outcome":"noop","observations":[{"type":"project","statement":"x"}]}',
    '{"outcome":"observations","observations":[{"type":"project","statement":"x","extra":true}]}',
  ])
    expect(() => MemoryCapture.parse(value, "grok", 1)).toThrow()
  expect(() => outcome("界".repeat(342))).toThrow()
  expect(outcome("界".repeat(341)).observations[0]?.statement).toHaveLength(341)
  expect(() => outcome("\u0000")).toThrow()
})

it.live("v2 scopes are isolated from legacy storage and share project identity across worktrees", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: path.join(home, "worktree-a"), projectID: "project" }
    yield* Effect.promise(async () => {
      await mkdir(path.join(home, ".grok", "memory"), { recursive: true })
      await writeFile(path.join(home, ".grok", "memory", "MEMORY.md"), "LEGACY_SECRET")
    })
    const memory = yield* MemoryCapture.make(input)
    expect(memory.root.path).toContain(`${path.sep}memory-v2${path.sep}apexo${path.sep}workspaces${path.sep}`)
    expect(MemoryV2.directory({ ...input, directory: "other-worktree" })).toBe(memory.root.path)
    expect(MemoryV2.directory({ ...input, projectID: "other-project" })).not.toBe(memory.root.path)
    expect(MemoryV2.directory({ ...input, projectID: "global" })).not.toBe(
      MemoryV2.directory({ ...input, projectID: "global", directory: "elsewhere" }),
    )
    expect(MemoryV2.directory({ ...input, scope: "global" })).toEndWith("memory-v2/apexo/global")
    expect(yield* memory.search("LEGACY_SECRET")).toEqual([])
    expect(yield* Effect.promise(() => readFile(path.join(home, ".grok", "memory", "MEMORY.md"), "utf8"))).toBe(
      "LEGACY_SECRET",
    )
  }),
)

it.live("enqueue persists a fixed source and exact retries reject conflicting locators and overlapping ranges", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    const first = yield* memory.enqueue(enqueue())
    expect(yield* memory.enqueue(enqueue())).toEqual(first)
    expect(yield* memory.jobs("session")).toHaveLength(1)
    for (const change of [
      { sourcePromptIndex: 2 },
      { source: "changed snapshot" },
      { from: 0 },
      { through: 1000000 },
      { sessionID: "invalid\n" },
      { source: "x".repeat(512 * 1024 + 1) },
    ])
      expect((yield* Effect.exit(memory.enqueue({ ...enqueue(), ...change })))._tag).toBe("Failure")
    expect((yield* Effect.exit(memory.enqueue(enqueue("session", 1, 2))))._tag).toBe("Failure")
    expect(yield* memory.cursors("session")).toEqual({ requested: 1, captured: 0, indexed: 0 })
  }),
)

it.live("independent handles serialize claims, reclaim expired leases and fence stale or tampered workers", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home }
    const a = yield* MemoryCapture.make(input)
    const b = yield* MemoryCapture.make(input)
    yield* a.enqueue(enqueue())
    const claims = yield* Effect.all([a.claim(request("a")), b.claim(request("b"))], { concurrency: "unbounded" })
    expect(claims.filter(Boolean)).toHaveLength(1)
    const old = claims.find((value) => value !== undefined)!
    expect(yield* b.claim(request("c", 5999))).toBeUndefined()
    const next = (yield* b.claim(request("c", 6000)))!
    expect(next.job.attempt).toBe(2)
    expect((yield* Effect.exit(a.commit(old, noop, 6001)))._tag).toBe("Failure")
    expect((yield* Effect.exit(a.fail(old, "late cancellation")))._tag).toBe("Failure")
    expect((yield* Effect.exit(a.commit({ ...next, job: { ...next.job, through_turn: 2 } }, noop, 6001)))._tag).toBe(
      "Failure",
    )
    expect((yield* Effect.exit(b.commit(next, noop, Number.NaN)))._tag).toBe("Failure")
    yield* b.commit(next, noop, 6001)
    expect(yield* a.cursors("session")).toEqual({ requested: 1, captured: 1, indexed: 1 })
  }),
)

it.live("capture publishes immutable Markdown, converges multilingual FTS and manifest, and survives reopening", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home }
    const files = yield* Effect.gen(function* () {
      const memory = yield* MemoryCapture.make(input)
      yield* memory.enqueue(enqueue("session/中文"))
      const lease = (yield* memory.claim(request()))!
      const result = yield* memory.commit(lease, outcome(), 1100)
      expect(result.alreadyCommitted).toBe(false)
      expect(result.files).toHaveLength(1)
      const content = yield* Effect.promise(() => readFile(result.files[0]!, "utf8"))
      expect(content).toContain('session_id: "session/中文"')
      expect(content).toContain("observation_count: 1")
      expect(content).toContain("# Use WAL for concurrent readers.")
      expect(yield* memory.search("concurrent")).toHaveLength(1)
      expect(yield* memory.search("数据库")).toHaveLength(1)
      const manifest = yield* Effect.promise(() => readFile(path.join(memory.root.path, "MEMORY.md"), "utf8"))
      expect(manifest).toContain("Use WAL for concurrent readers.")
      expect(manifest).toContain(path.basename(result.files[0]!))
      return result.files
    }).pipe(Effect.scoped)
    const reopened = yield* MemoryCapture.make(input)
    expect(yield* reopened.cursors("session/中文")).toEqual({ requested: 1, captured: 1, indexed: 1 })
    expect(yield* reopened.claim(request())).toBeUndefined()
    expect(yield* reopened.search("concurrent")).toHaveLength(1)
    expect(yield* Effect.promise(() => readdir(path.dirname(files[0]!)))).toHaveLength(1)
  }),
)

it.live("noop and out-of-order completion advance only contiguous captured and indexed cursors", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    yield* memory.enqueue(enqueue("session", 3))
    yield* memory.commit((yield* memory.claim(request()))!, noop, 1100)
    expect(yield* memory.cursors("session")).toEqual({ requested: 3, captured: 0, indexed: 0 })
    yield* memory.enqueue(enqueue("session", 1, 2))
    yield* memory.commit((yield* memory.claim(request()))!, noop, 1100)
    expect(yield* memory.cursors("session")).toEqual({ requested: 3, captured: 3, indexed: 3 })
    expect(yield* Effect.promise(() => readdir(path.join(memory.root.path, "observations/_inbox")))).toEqual([])
  }),
)

it.live("failure and cancellation remain retryable, pending work wins, terminal failures are not retried", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    yield* memory.enqueue(enqueue())
    yield* memory.fail((yield* memory.claim(request()))!, "cancelled\u0000".repeat(200))
    expect(yield* memory.cursors("session")).toEqual({ requested: 1, captured: 0, indexed: 0 })
    expect(Buffer.byteLength((yield* memory.jobs("session"))[0]!.last_error!)).toBeLessThanOrEqual(512)
    yield* memory.enqueue(enqueue("other"))
    const other = (yield* memory.claim(request()))!
    expect(other.job.session_id).toBe("other")
    yield* memory.commit(other, noop, 1100)
    const retry = (yield* memory.claim(request()))!
    expect(retry.job.attempt).toBe(2)
    yield* memory.fail(retry, "permission revoked", true)
    expect(yield* memory.claim(request())).toBeUndefined()
    expect((yield* memory.cursors("session")).captured).toBe(1)
  }),
)

it.live("exact outcome retry is idempotent and different content never replaces an observation", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    yield* memory.enqueue(enqueue())
    const lease = (yield* memory.claim(request()))!
    const result = yield* memory.commit(lease, outcome("ORIGINAL"), 1100)
    expect((yield* memory.commit(lease, outcome("ORIGINAL"), 999999)).alreadyCommitted).toBe(true)
    expect((yield* Effect.exit(memory.commit(lease, outcome("REPLACEMENT"), 1100)))._tag).toBe("Failure")
    expect(yield* Effect.promise(() => readFile(result.files[0]!, "utf8"))).toContain("# ORIGINAL")
    expect(yield* Effect.promise(() => readdir(path.dirname(result.files[0]!)))).toHaveLength(1)
  }),
)

it.live("a durable publication interrupted before files is completed on reopen without reclaiming the model job", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home }
    yield* Effect.gen(function* () {
      const memory = yield* MemoryCapture.make(input)
      yield* memory.enqueue(enqueue())
      const lease = (yield* memory.claim(request()))!
      const inbox = path.join(memory.root.path, "observations/_inbox")
      yield* Effect.promise(async () => {
        await rename(inbox, `${inbox}.parked`)
        await writeFile(inbox, "interrupted filesystem")
      })
      expect((yield* Effect.exit(memory.commit(lease, outcome("RECOVERED_ONCE"), 1100)))._tag).toBe("Failure")
      expect((yield* memory.jobs("session"))[0]!.status).toBe("publishing")
      expect(yield* memory.cursors("session")).toEqual({ requested: 1, captured: 1, indexed: 0 })
      yield* Effect.promise(async () => {
        await rm(inbox)
        await rename(`${inbox}.parked`, inbox)
      })
    }).pipe(Effect.scoped)
    const reopened = yield* MemoryCapture.make(input)
    expect(yield* reopened.claim(request("new", 99999))).toBeUndefined()
    expect(yield* reopened.search("RECOVERED_ONCE")).toHaveLength(1)
    expect(yield* reopened.cursors("session")).toEqual({ requested: 1, captured: 1, indexed: 1 })
    expect((yield* reopened.jobs("session"))[0]!.attempt).toBe(1)
  }),
)

it.live("deleted or edited committed notes stay excluded after retry and reopen", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home }
    const memory = yield* MemoryCapture.make(input)
    yield* memory.enqueue(enqueue())
    const lease = (yield* memory.claim(request()))!
    const result = yield* memory.commit(lease, outcome("DELETE_ME"), 1100)
    yield* Effect.promise(() => rm(result.files[0]!))
    expect(yield* memory.search("DELETE_ME")).toEqual([])
    yield* memory.commit(lease, outcome("DELETE_ME"), 99999)
    expect(yield* Effect.promise(() => readdir(path.dirname(result.files[0]!)))).toEqual([])
    yield* memory.enqueue(enqueue("other"))
    const changed = yield* memory.commit((yield* memory.claim(request()))!, outcome("EDIT_ME"), 1100)
    yield* Effect.promise(() => writeFile(changed.files[0]!, "USER_EDITED"))
    expect(yield* memory.search("EDIT_ME")).toEqual([])
    expect(yield* memory.search("USER_EDITED")).toEqual([])
    const reopened = yield* MemoryCapture.make(input)
    expect(yield* reopened.search("DELETE_ME")).toEqual([])
    expect(yield* Effect.promise(() => readFile(changed.files[0]!, "utf8"))).toBe("USER_EDITED")
  }),
)

it.live("record-only visibility is pinned, promotion includes already running captures", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    yield* memory.enqueue({ ...enqueue(), exposed: false })
    yield* memory.enqueue({ ...enqueue(), exposed: true })
    yield* memory.commit((yield* memory.claim(request()))!, outcome("HIDDEN_MEMORY"), 1100)
    expect(yield* memory.search("HIDDEN_MEMORY")).toEqual([])
    expect(yield* Effect.promise(() => readFile(path.join(memory.root.path, "MEMORY.md"), "utf8"))).not.toContain(
      "HIDDEN_MEMORY",
    )
    yield* memory.enqueue({ ...enqueue("other"), exposed: false })
    const running = (yield* memory.claim(request()))!
    yield* memory.promote
    yield* memory.commit(running, outcome("PROMOTED_RUNNING"), 1100)
    expect(yield* memory.search("HIDDEN_MEMORY")).toHaveLength(1)
    expect(yield* memory.search("PROMOTED_RUNNING")).toHaveLength(1)
  }),
)

it.live("v2 initialization rejects redirected ancestors and database paths before writing outside the root", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const outside = yield* tmpdirScoped()
    yield* Effect.promise(() => symlink(outside, path.join(home, ".grok")))
    expect((yield* Effect.exit(MemoryCapture.make({ home, directory: home })))._tag).toBe("Failure")
    expect(yield* Effect.promise(() => readdir(outside))).toEqual([])
    yield* Effect.promise(() => rm(path.join(home, ".grok")))
    const root = yield* Effect.promise(() => MemoryV2.initialize({ home, directory: home }))
    yield* Effect.promise(() =>
      symlink(path.join(outside, "state.sqlite"), path.join(root.path, "memory_state.sqlite")),
    )
    expect((yield* Effect.exit(MemoryCapture.make({ home, directory: home })))._tag).toBe("Failure")
    expect(yield* Effect.promise(() => readdir(outside))).toEqual([])
  }),
)

it.live("the Apexo v2 namespace does not change an installed Grok client's global database or manifest", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const official = path.join(home, ".grok", "memory-v2", "global")
    yield* Effect.promise(async () => {
      await mkdir(official, { recursive: true })
      await writeFile(path.join(official, "MEMORY.md"), "OFFICIAL_MANIFEST")
      await writeFile(path.join(official, "memory_state.sqlite"), "OFFICIAL_DATABASE")
    })
    const memory = yield* MemoryCapture.make({ home, directory: home, scope: "global" })
    yield* memory.enqueue(enqueue())
    yield* memory.commit((yield* memory.claim(request()))!, outcome(), 1100)
    expect(yield* Effect.promise(() => readFile(path.join(official, "MEMORY.md"), "utf8"))).toBe("OFFICIAL_MANIFEST")
    expect(yield* Effect.promise(() => readFile(path.join(official, "memory_state.sqlite"), "utf8"))).toBe(
      "OFFICIAL_DATABASE",
    )
  }),
)

it.live("oversized and symlinked committed files are excluded while other observations remain searchable", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const outside = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    yield* memory.enqueue(enqueue())
    const content = outcome("FIRST_OBSERVATION")
    content.observations.push(
      ...outcome("SECOND_OBSERVATION").observations,
      ...outcome("THIRD_OBSERVATION").observations,
    )
    const saved = yield* memory.commit((yield* memory.claim(request()))!, content, 1100)
    yield* Effect.promise(async () => {
      await writeFile(saved.files[0]!, "x".repeat(20000))
      await writeFile(path.join(outside, "secret.md"), "OUTSIDE_SECRET")
      await rm(saved.files[1]!)
      await symlink(path.join(outside, "secret.md"), saved.files[1]!)
    })
    expect(yield* memory.search("FIRST_OBSERVATION")).toEqual([])
    expect(yield* memory.search("SECOND_OBSERVATION")).toEqual([])
    expect(yield* memory.search("OUTSIDE_SECRET")).toEqual([])
    expect(yield* memory.search("THIRD_OBSERVATION")).toHaveLength(1)
    expect(yield* Effect.promise(() => readFile(path.join(outside, "secret.md"), "utf8"))).toBe("OUTSIDE_SECRET")
  }),
)

it.live("a redirected live lock directory cannot create a lock or admit work outside the scope", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const outside = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    yield* Effect.promise(async () => {
      await rename(memory.root.locks, `${memory.root.locks}.parked`)
      await symlink(outside, memory.root.locks)
    })
    expect((yield* Effect.exit(memory.enqueue(enqueue())))._tag).toBe("Failure")
    expect(yield* Effect.promise(() => readdir(outside))).toEqual([])
    yield* Effect.promise(async () => {
      await rm(memory.root.locks)
      await rename(`${memory.root.locks}.parked`, memory.root.locks)
    })
    expect(yield* memory.jobs("session")).toEqual([])
  }),
)

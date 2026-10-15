import assert from "node:assert/strict"
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const rollout = process.argv.includes("--record-only") ? "record_only" : "active"
const captureCalls = []
const planned = { mode: "observe", hold: undefined }
const runtime = await startShellFixture(kind, {
  config: {
    memory_v2: { enabled: true, rollout },
    memory: { enabled: true, dream: { enabled: false, check_interval_secs: 0 } },
    compaction: { auto: false, memory_flush: { enabled: false } },
  },
  async next({ input, body }) {
    if (!JSON.stringify(input).includes("You extract durable memory observations")) return
    captureCalls.push(body)
    if (planned.hold) await planned.hold.promise
    return {
      content:
        planned.mode === "invalid"
          ? "invalid JSON"
          : JSON.stringify(
              planned.mode === "noop"
                ? { outcome: "noop", observations: [] }
                : {
                    outcome: "observations",
                    observations: [
                      {
                        type: "project",
                        statement: "CAPTURE_SESSION_FACT: use stable request IDs",
                        keywords: ["stable"],
                        aliases: [],
                        topic_hint: "requests",
                        body: null,
                      },
                    ],
                  },
            ),
    }
  },
})
const checks = []
const create = async (extra = {}) => (await runtime.api("/session", { title: "Memory V2 capture check", ...extra })).id
const prompt = (id, text, extra = {}) =>
  runtime.api(`/session/${id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text, ...extra }],
  })
const endpoint = (id) => `/experimental/session/${id}/memory/operation`
const flush = async (id) => {
  await runtime.api(endpoint(id), { kind: "flush" })
  return poll(
    async () => {
      const value = await runtime.api(endpoint(id))
      return value?.state === "finished" ? value.result : undefined
    },
    "capture flush completed",
    30_000,
  )
}
const scopes = join(runtime.env.APEXO_TEST_HOME, ".grok", "memory-v2", "apexo", "workspaces")
let store
const rows = (sql, ...args) => store.query(sql).all(...args)
try {
  const id = await create()
  assert.equal((await runtime.api(`/experimental/session/${id}/memory/status`)).enabled, true)
  planned.hold = Promise.withResolvers()
  await prompt(id, "CAPTURE_SESSION_FACT: use stable request IDs for this project.")
  await poll(() => captureCalls.length === 1, "independent capture request")
  checks.push("main-turn-completes-before-capture")
  const directories = await readdir(scopes)
  store = new Database(join(scopes, directories[0], "memory_state.sqlite"), { readonly: true })
  assert.equal(rows("SELECT status FROM capture_jobs WHERE session_id = ?", id)[0].status, "running")
  const frozen = rows("SELECT source FROM capture_jobs WHERE session_id = ?", id)[0].source
  assert.match(frozen, /CAPTURE_SESSION_FACT/)
  assert.equal(captureCalls[0].tools?.length ?? 0, 0)
  assert.equal(captureCalls[0].response_format?.type ?? captureCalls[0].text?.format?.type, "json_schema")
  checks.push("durable-admission-before-extraction", "structured-tool-free-extraction")
  await runtime.api(endpoint(id), { kind: "flush" })
  assert.equal((await runtime.api(endpoint(id))).state, "running")
  const before = await runtime.api(`/session/${id}/message`)
  planned.hold.resolve()
  planned.hold = undefined
  await poll(async () => (await runtime.api(endpoint(id)))?.state === "finished", "flush barrier released")
  assert.equal((await runtime.api(endpoint(id))).result.status, "completed")
  assert.deepEqual(rows("SELECT requested,captured,indexed FROM capture_sessions WHERE session_id = ?", id)[0], {
    requested: 1,
    captured: 1,
    indexed: 1,
  })
  assert.equal((await runtime.api(`/session/${id}/message`)).length, before.length)
  assert.equal(rows("SELECT source FROM capture_jobs WHERE session_id = ?", id)[0].source, frozen)
  const manifest = await readFile(join(scopes, directories[0], "MEMORY.md"), "utf8")
  if (rollout === "active") assert.match(manifest, /CAPTURE_SESSION_FACT/)
  else {
    assert.doesNotMatch(manifest, /CAPTURE_SESSION_FACT/)
    assert.equal(rows("SELECT COUNT(*) AS count FROM capture_files")[0].count, 1)
    assert.equal(rows("SELECT COUNT(*) AS count FROM capture_fts")[0].count, 0)
    checks.push("record-only-persists-without-exposure")
  }
  const count = captureCalls.length
  assert.equal((await flush(id)).status, "completed")
  assert.equal(captureCalls.length, count)
  checks.push("flush-waits-for-index", "capture-does-not-add-main-messages", "repeat-flush-does-not-extract-again")
  planned.mode = "noop"
  await prompt(id, "Nothing durable in this follow-up.")
  assert.equal((await flush(id)).status, "completed")
  assert.deepEqual(rows("SELECT requested,captured,indexed FROM capture_sessions WHERE session_id = ?", id)[0], {
    requested: 2,
    captured: 2,
    indexed: 2,
  })
  checks.push("noop-advances-cursors")
  for (let iteration = 0; iteration < (process.argv.includes("--repeat-failures") ? 20 : 1); iteration++) {
    const failed = await create()
    planned.mode = "invalid"
    await prompt(failed, "A durable statement with a malformed extraction response.")
    await poll(
      () => rows("SELECT status FROM capture_jobs WHERE session_id = ?", failed)[0]?.status === "failed",
      "first retryable failure",
    )
    assert.equal(rows("SELECT attempt FROM capture_jobs WHERE session_id = ?", failed)[0].attempt, 1)
    assert.equal((await flush(failed)).status, "retry_required")
    for (let pollIndex = 0; pollIndex < 10; pollIndex++) {
      await runtime.api(`/experimental/session/${failed}/memory/status`)
      await runtime.api(endpoint(failed))
    }
    assert.equal(rows("SELECT attempt FROM capture_jobs WHERE session_id = ?", failed)[0].attempt, 2)
    assert.equal((await flush(failed)).status, "failed")
    assert.deepEqual(rows("SELECT attempt,terminal FROM capture_jobs WHERE session_id = ?", failed)[0], {
      attempt: 3,
      terminal: 1,
    })
  }
  checks.push("three-attempt-terminal-failure")
  planned.mode = "observe"
  const child = await create({ parentID: id })
  await prompt(child, "Child agents must not capture memory.")
  assert.equal(rows("SELECT * FROM capture_jobs WHERE session_id = ?", child).length, 0)
  const synthetic = await create()
  await prompt(synthetic, "Synthetic notification must not capture memory.", { synthetic: true })
  assert.equal(rows("SELECT * FROM capture_jobs WHERE session_id = ?", synthetic).length, 0)
  checks.push("subagents-excluded", "synthetic-turns-excluded")
  const cancelled = await create()
  planned.hold = Promise.withResolvers()
  const cancelCount = captureCalls.length
  await prompt(cancelled, "Capture cancellation and stale result isolation.")
  await poll(() => captureCalls.length > cancelCount, "capture running before disable")
  await runtime.api(`/experimental/session/${cancelled}/memory/toggle`, { enabled: false })
  await poll(
    () => rows("SELECT status FROM capture_jobs WHERE session_id = ?", cancelled)[0]?.status === "failed",
    "disabled capture releases lease",
  )
  planned.hold.resolve()
  planned.hold = undefined
  assert.equal(
    rows(
      "SELECT COUNT(*) AS count FROM capture_files JOIN capture_jobs USING(job_id) WHERE session_id = ?",
      cancelled,
    )[0].count,
    0,
  )
  await runtime.api(`/experimental/session/${cancelled}/memory/toggle`, { enabled: true })
  await poll(
    () => rows("SELECT status FROM capture_jobs WHERE session_id = ?", cancelled)[0]?.status === "completed",
    "toggle resumes admitted capture",
  )
  assert.equal((await flush(cancelled)).status, "completed")
  assert.equal(rows("SELECT attempt FROM capture_jobs WHERE session_id = ?", cancelled)[0].attempt, 2)
  checks.push("disable-interrupts-and-releases-lease", "reenable-retries-without-stale-write")
  const paused = await create()
  await runtime.api(`/experimental/session/${paused}/memory/toggle`, { enabled: false })
  await prompt(paused, "DO_NOT_CAPTURE_WHILE_DISABLED")
  await runtime.api(`/experimental/session/${paused}/memory/toggle`, { enabled: true })
  assert.equal((await flush(paused)).status, "no_work")
  await prompt(paused, "A new request after enabling memory.")
  assert.equal((await flush(paused)).status, "completed")
  const pausedJobs = rows("SELECT source FROM capture_jobs WHERE session_id = ?", paused)
  assert.equal(pausedJobs.length, 1)
  assert.doesNotMatch(pausedJobs[0].source, /DO_NOT_CAPTURE_WHILE_DISABLED/)
  checks.push("disabled-turns-never-captured-retrospectively")
  const denied = await create({ permission: [{ permission: "edit", pattern: "*", action: "deny" }] })
  const deniedCount = captureCalls.length
  await prompt(denied, "Permission denied memory must not start extraction.")
  assert.equal((await flush(denied)).status, "denied")
  assert.equal(captureCalls.length, deniedCount)
  assert.equal(rows("SELECT * FROM capture_jobs WHERE session_id = ?", denied).length, 0)
  checks.push("permission-denied-before-extraction")
  const barrier = await create()
  const first = Promise.withResolvers()
  const second = Promise.withResolvers()
  planned.hold = first
  await prompt(barrier, "First frozen barrier target.")
  await poll(
    () => rows("SELECT status FROM capture_jobs WHERE session_id = ?", barrier)[0]?.status === "running",
    "first barrier job",
  )
  await runtime.api(endpoint(barrier), { kind: "flush" })
  // Wait until the barrier has been admitted before adding a future turn.
  await poll(async () => (await runtime.api(endpoint(barrier)))?.state === "running", "first barrier running")
  await prompt(barrier, "Future turn beyond the frozen barrier target.")
  planned.hold = second
  first.resolve()
  await poll(
    async () => (await runtime.api(endpoint(barrier)))?.state === "finished",
    "frozen barrier completes without future job",
    30_000,
  )
  assert.equal((await runtime.api(endpoint(barrier))).result.eligible, 1)
  second.resolve()
  planned.hold = undefined
  assert.equal((await flush(barrier)).status, "completed")
  assert.equal(rows("SELECT requested FROM capture_sessions WHERE session_id = ?", barrier)[0].requested, 2)
  checks.push("flush-target-excludes-future-turns")
  if (process.argv.includes("--retry-admissions")) {
    const queued = await create()
    planned.mode = "invalid"
    planned.hold = Promise.withResolvers()
    await prompt(queued, "First retryable capture stays in flight.")
    await poll(
      () => rows("SELECT status FROM capture_jobs WHERE session_id = ?", queued)[0]?.status === "running",
      "held admission",
    )
    await prompt(queued, "New durable work arrives during the first extraction.")
    await poll(
      () => rows("SELECT * FROM capture_jobs WHERE session_id = ?", queued).length === 2,
      "second durable admission",
    )
    planned.hold.resolve()
    planned.hold = undefined
    await poll(
      () => rows("SELECT * FROM capture_jobs WHERE session_id = ?", queued).every((row) => row.status === "failed"),
      "both admitted captures failed",
    )
    for (let index = 0; index < 10; index++) await runtime.api(`/experimental/session/${queued}/memory/status`)
    assert.deepEqual(
      rows("SELECT attempt FROM capture_jobs WHERE session_id = ? ORDER BY from_turn", queued).map(
        (row) => row.attempt,
      ),
      [1, 1],
    )
    assert.equal((await flush(queued)).status, "retry_required")
    assert.deepEqual(
      rows("SELECT attempt FROM capture_jobs WHERE session_id = ? ORDER BY from_turn", queued).map(
        (row) => row.attempt,
      ),
      [2, 1],
    )
    planned.mode = "observe"
    assert.equal((await flush(queued)).status, "completed")
    checks.push("consumed-admission-wake-does-not-retry-failed-batch")
  }
  for (let iteration = 0; iteration < (process.argv.includes("--repeat-recovery") ? 10 : 1); iteration++) {
    const recovered = await create()
    planned.hold = Promise.withResolvers()
    const recoveryCalls = captureCalls.length
    await prompt(recovered, "Recover the admitted capture after reopening the project.")
    await poll(() => captureCalls.length > recoveryCalls, "capture before instance disposal")
    const recoverySource = rows("SELECT source FROM capture_jobs WHERE session_id = ?", recovered)[0].source
    await runtime.api("/instance/dispose", undefined, "POST")
    planned.hold.resolve()
    planned.hold = undefined
    await poll(
      () => rows("SELECT status FROM capture_jobs WHERE session_id = ?", recovered)[0]?.status === "failed",
      "disposed worker releases lease",
    )
    const recoveryHistory = (await runtime.api(`/session/${recovered}/message`)).length
    if (process.argv.includes("--repair-storage")) {
      const manifest = join(scopes, directories[0], "MEMORY.md")
      await rename(manifest, `${manifest}.parked`)
      await mkdir(manifest)
      try {
        await runtime.api(`/experimental/session/${recovered}/memory/status`)
        assert.equal(rows("SELECT status FROM capture_jobs WHERE session_id = ?", recovered)[0].status, "failed")
      } finally {
        await rm(manifest, { recursive: true })
        await rename(`${manifest}.parked`, manifest)
      }
    }
    await runtime.api(`/experimental/session/${recovered}/memory/status`)
    await poll(
      () => rows("SELECT status FROM capture_jobs WHERE session_id = ?", recovered)[0]?.status === "completed",
      "opening session resumes capture",
    )
    assert.equal(rows("SELECT source FROM capture_jobs WHERE session_id = ?", recovered)[0].source, recoverySource)
    assert.equal((await runtime.api(`/session/${recovered}/message`)).length, recoveryHistory)
  }
  checks.push("reopening-session-recovers-admitted-work-without-main-turn")
  if (process.argv.includes("--repair-storage")) checks.push("repaired-storage-retries-initialization-in-same-instance")
  const result = { kind, rollout, checks, passed: checks.length, output: runtime.output }
  console.log(JSON.stringify(result, null, 2))
} finally {
  planned.hold?.resolve()
  store?.close()
  await runtime.close()
  await writeFile(
    join(runtime.output, "memory-capture-session.json"),
    JSON.stringify({ checks, calls: captureCalls }, null, 2),
  )
  console.error(`Memory V2 session evidence: ${runtime.output}`)
}

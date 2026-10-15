// Real production-service crashes. Lease time is wall-clock time, never edited in SQLite.
import assert from "node:assert/strict"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const timeouts = process.argv.includes("--timeouts")
const calls = [],
  checks = [],
  evidence = []
const planned = { hold: Promise.withResolvers() }
const runtime = await startShellFixture(kind, {
  config: {
    memory_v2: { enabled: true, automatic_dream_enabled: false },
    memory: { enabled: true, dream: { enabled: false, check_interval_secs: 0 } },
    compaction: { auto: false, memory_flush: { enabled: false } },
  },
  async next({ body, input }) {
    if (!JSON.stringify(input).includes("You extract durable memory observations"))
      return { content: "MAIN_RECOVERY_ACK" }
    calls.push({ at: Date.now(), body })
    const hold = planned.hold
    if (hold) await hold.promise
    return {
      content: JSON.stringify({
        outcome: "observations",
        observations: [{ type: "project", statement: "RECOVERY_FACT preserve immutable request IDs" }],
      }),
    }
  },
})
const endpoint = (id) => `/experimental/session/${id}/memory`
const create = async () => (await runtime.api("/session", { title: "Production capture recovery" })).id
const prompt = (id) =>
  runtime.api(`/session/${id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "RECOVERY_FACT: preserve immutable request IDs." }],
  })
const flush = async (id) => {
  await runtime.api(`${endpoint(id)}/operation`, { kind: "flush" })
  return poll(
    async () => {
      const value = await runtime.api(`${endpoint(id)}/operation`)
      return value?.state === "finished" && value.result
    },
    "recovered flush",
    30_000,
  )
}
const database = { value: undefined }
const rows = (sql, ...args) => database.value.query(sql).all(...args)
const job = (id) => rows("SELECT * FROM capture_jobs WHERE session_id = ?", id)[0]
const release = () => {
  planned.hold?.resolve()
  planned.hold = undefined
}
try {
  const id = await create()
  await prompt(id)
  await poll(() => calls.length === 1, "production extraction held")
  const scopes = join(runtime.env.APEXO_TEST_HOME, ".grok/memory-v2/apexo/workspaces")
  const root = join(scopes, (await readdir(scopes))[0])
  database.value = new Database(join(root, "memory_state.sqlite"), { readonly: true })
  const claimed = job(id)
  assert.equal(claimed.status, "running")
  assert.equal(claimed.attempt, 1)
  assert.ok(claimed.lease_expires_at - calls[0].at > 290_000)
  assert.equal(calls[0].body.tools?.length ?? 0, 0)
  const history = await runtime.api(`/session/${id}/message`)
  await runtime.api(`${endpoint(id)}/operation`, { kind: "flush" })
  assert.equal((await runtime.api(`${endpoint(id)}/operation`)).state, "running")
  evidence.push({ stage: "claimed", job: claimed, killed: await runtime.crash() })
  release()
  assert.deepEqual(job(id), claimed)
  checks.push("sigkill-preserves-real-five-minute-lease", "pending-flush-did-not-block-main-turn")
  await runtime.reopen()
  // A kill between lock mkdir and owner metadata requires the real 60s stale
  // interval. Only recovery admission may outlive the fixture's usual 45s request.
  await runtime.api(`${endpoint(id)}/status`, undefined, "GET", 90_000)
  assert.equal(await runtime.api(`${endpoint(id)}/operation`), null)
  assert.deepEqual(await runtime.api(`/session/${id}/message`), history)
  if (timeouts) {
    const started = Date.now()
    await runtime.api(`${endpoint(id)}/operation`, { kind: "flush" })
    const result = await poll(
      async () => {
        const value = await runtime.api(`${endpoint(id)}/operation`)
        return value?.state === "finished" && value.result
      },
      "real four-minute flush deadline",
      255_000,
    )
    const elapsed = Date.now() - started
    evidence.push({ stage: "flush-timeout", elapsed, result, job: job(id) })
    assert.equal(result.status, "timed_out")
    assert.ok(elapsed >= 239_000 && elapsed < 255_000)
    assert.deepEqual(job(id), claimed)
    assert.equal(calls.length, 1)
    checks.push("four-minute-flush-timeout-preserves-background-lease")
  }
  const progress = setInterval(
    () =>
      console.error(
        `Waiting for actual lease expiry: ${Math.max(0, Math.ceil((claimed.lease_expires_at - Date.now()) / 1000))}s`,
      ),
    30_000,
  )
  await poll(
    () => {
      if (Date.now() < claimed.lease_expires_at - 1000) {
        assert.equal(calls.length, 1, "must not steal a live lease")
        assert.equal(job(id).lease_owner, claimed.lease_owner)
      }
      return job(id).status === "completed"
    },
    "real lease expiry and production recovery",
    320_000,
  ).finally(() => clearInterval(progress))
  const completed = job(id)
  assert.equal(completed.attempt, 2)
  assert.equal(completed.source, claimed.source)
  assert.equal(calls.length, 2)
  assert.ok(calls[1].at >= claimed.lease_expires_at)
  assert.deepEqual(calls[1].body.messages ?? calls[1].body.input, calls[0].body.messages ?? calls[0].body.input)
  assert.deepEqual(rows("SELECT requested,captured,indexed FROM capture_sessions WHERE session_id = ?", id)[0], {
    requested: 1,
    captured: 1,
    indexed: 1,
  })
  assert.equal((await flush(id)).status, "completed")
  assert.equal(calls.length, 2)
  assert.deepEqual(await runtime.api(`/session/${id}/message`), history)
  evidence.push({ stage: "recovered", job: completed, first: calls[0].at, retry: calls[1].at })
  checks.push(
    "live-lease-not-stolen",
    "expired-lease-reclaimed-with-frozen-transcript",
    "new-flush-observes-indexed-recovery",
    "main-history-unchanged-and-no-extra-extraction",
  )

  // Block publication after the result journal is durable, then kill the actual service.
  for (const boundary of ["observations/_inbox", "MEMORY.md"]) {
    const interrupted = await create()
    planned.hold = Promise.withResolvers()
    const count = calls.length
    await prompt(interrupted)
    await poll(() => calls.length === count + 1, "publication extraction held")
    const target = join(root, boundary)
    await rename(target, `${target}.parked`)
    if (boundary === "MEMORY.md") await mkdir(target)
    else await writeFile(target, "isolated publication obstruction")
    release()
    await poll(() => job(interrupted).status === "publishing", "durable result journal")
    assert.equal(rows("SELECT COUNT(*) AS n FROM capture_outcomes WHERE job_id = ?", job(interrupted).job_id)[0].n, 1)
    evidence.push({ stage: boundary, job: job(interrupted), killed: await runtime.crash() })
    await rm(target, { recursive: true })
    await rename(`${target}.parked`, target)
    await runtime.reopen()
    await runtime.api(`${endpoint(interrupted)}/status`, undefined, "GET", 90_000)
    assert.equal((await flush(interrupted)).status, "completed")
    assert.equal(job(interrupted).attempt, 1)
    assert.equal(calls.length, count + 1)
    assert.equal(
      rows(
        "SELECT COUNT(*) AS n FROM capture_fts WHERE path IN (SELECT path FROM capture_files WHERE job_id = ?)",
        job(interrupted).job_id,
      )[0].n,
      1,
    )
    assert.match(await readFile(join(root, "MEMORY.md"), "utf8"), /RECOVERY_FACT/)
    checks.push(
      boundary === "MEMORY.md"
        ? "manifest-crash-converges-without-inference"
        : "journal-crash-publishes-without-inference",
    )
  }
  const original = rows("SELECT path FROM capture_files WHERE job_id = ?", claimed.job_id)[0].path
  await rm(join(root, original))
  const before = calls.length
  await runtime.crash()
  await runtime.reopen()
  await runtime.api(`${endpoint(id)}/status`, undefined, "GET", 90_000)
  await flush(id)
  assert.equal(await readFile(join(root, original)).catch(() => undefined), undefined)
  assert.equal(rows("SELECT COUNT(*) AS n FROM capture_fts WHERE path = ?", original)[0].n, 0)
  assert.equal(calls.length, before)
  checks.push("deleted-observation-not-resurrected-after-crash")
  if (timeouts) {
    const timed = await create()
    const count = calls.length
    planned.hold = Promise.withResolvers()
    await prompt(timed)
    await poll(() => calls.length === count + 1, "timeout extraction held")
    const timedHistory = await runtime.api(`/session/${timed}/message`)
    await runtime.api(`${endpoint(timed)}/operation`, { kind: "flush" })
    const result = await poll(
      async () => {
        const value = await runtime.api(`${endpoint(timed)}/operation`)
        return value?.state === "finished" && value.result
      },
      "real two-minute extraction deadline",
      135_000,
    )
    const elapsed = Date.now() - calls[count].at
    evidence.push({ stage: "capture-timeout", elapsed, result, job: job(timed) })
    assert.equal(result.status, "retry_required")
    assert.ok(elapsed >= 119_000 && elapsed < 135_000)
    assert.equal(job(timed).status, "failed")
    assert.equal(job(timed).attempt, 1)
    release()
    for (let index = 0; index < 10; index++) {
      await runtime.api(`${endpoint(timed)}/status`)
      await runtime.api(`${endpoint(timed)}/operation`)
    }
    assert.equal(calls.length, count + 1)
    assert.equal(rows("SELECT COUNT(*) AS n FROM capture_files WHERE job_id = ?", job(timed).job_id)[0].n, 0)
    assert.equal((await flush(timed)).status, "completed")
    assert.equal(job(timed).attempt, 2)
    assert.equal(calls.length, count + 2)
    assert.equal(rows("SELECT COUNT(*) AS n FROM capture_files WHERE job_id = ?", job(timed).job_id)[0].n, 1)
    assert.deepEqual(await runtime.api(`/session/${timed}/message`), timedHistory)
    checks.push(
      "two-minute-capture-timeout-requires-retry",
      "status-polls-do-not-retry-timed-out-capture",
      "expired-response-cannot-publish-and-explicit-retry-publishes-once",
    )
  }
  console.log(JSON.stringify({ kind, passed: checks.length, checks, output: runtime.output }, null, 2))
} finally {
  release()
  database.value?.close()
  await writeFile(
    join(runtime.output, "memory-recovery.json"),
    JSON.stringify({ kind, checks, evidence, calls }, null, 2),
  )
  await runtime.close()
  console.error(`Production recovery evidence: ${runtime.output}`)
}

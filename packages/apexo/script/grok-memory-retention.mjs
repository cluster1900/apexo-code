import assert from "node:assert/strict"
import { Database } from "bun:sqlite"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const planned = { noop: false, hold: undefined }
const calls = { capture: 0, dream: 0 }
const checks = []
const runtime = await startShellFixture(kind, {
  config: {
    memory_v2: { enabled: true },
    memory: { enabled: true, dream: { enabled: false, check_interval_secs: 0 } },
    compaction: { auto: false, memory_flush: { enabled: false } },
  },
  async next({ input }) {
    if (JSON.stringify(input).includes("You extract durable memory observations")) {
      calls.capture++
      return {
        content: JSON.stringify(
          planned.noop
            ? { outcome: "noop" }
            : {
                outcome: "observations",
                observations: [{ type: "project", statement: "RETENTION_EVIDENCE: use WAL" }],
              },
        ),
      }
    }
    if (JSON.stringify(input).includes("Consolidate durable memory observations into topic Markdown")) {
      const message = input.findLast((row) => row.role === "user").content
      const value = JSON.parse(typeof message === "string" ? message : message.map((part) => part.text ?? "").join(""))
      calls.dream++
      if (planned.hold) await planned.hold.promise
      return {
        content: JSON.stringify({
          operations: [
            {
              action: value.topics.length ? "update" : "create",
              path: "topics/retained.md",
              content: "# Retained topic\nRETENTION_TOPIC: preserve useful knowledge",
              evidence: value.observations.map((row) => row.path),
            },
          ],
        }),
      }
    }
    return { content: "RETENTION_ACK" }
  },
})
const endpoint = (id) => `/experimental/session/${id}/memory`
const create = async (extra = {}) => (await runtime.api("/session", { title: "Retention parity", ...extra })).id
const configure = (settings = {}) =>
  runtime.api(
    "/config",
    {
      memory_v2: {
        enabled: true,
        rollout: "active",
        capture_enabled: true,
        automatic_dream_enabled: false,
        manual_dream_enabled: true,
        file_writes_enabled: true,
        archived_retention_days: 30,
        job_retention_days: 14,
        maintenance_interval_secs: 0,
        ...settings,
      },
    },
    "PATCH",
  )
const status = (id) => runtime.api(`${endpoint(id)}/status`)
const save = (id, content, scope = "workspace") => runtime.api(`${endpoint(id)}/remember`, { content, scope })
const prompt = (id) =>
  runtime.api(`/session/${id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Remember to use WAL for durable project state." }],
  })
const operation = async (id, kind) => {
  await runtime.api(`${endpoint(id)}/operation`, { kind })
  return poll(
    async () => {
      const value = await runtime.api(`${endpoint(id)}/operation`)
      return value?.state === "finished" && value.result
    },
    `retention ${kind}`,
    30_000,
  )
}
let root
const rows = (query) => {
  // Electron can checkpoint away WAL sidecars between these observations.
  using db = new Database(join(root, "memory_state.sqlite"), { readwrite: true, create: false })
  db.run("PRAGMA query_only = ON")
  return db.query(query).all()
}
const count = (table) => rows(`SELECT count(*) AS n FROM ${table}`)[0].n
const archives = () => readdir(join(root, "archive"))
const collected = () =>
  poll(async () => count("dream_archives") === 0 && (await archives()).length === 0, "archives collected", 30_000)
const archive = async (id) => {
  await prompt(id)
  assert.equal((await operation(id, "flush")).status, "completed")
  assert.equal((await operation(id, "dream")).status, "completed")
  await poll(() => count("dream_archives") > 0, "archive created")
}
try {
  await configure()
  const id = await create()
  const global = await save(id, "GLOBAL_MUST_SURVIVE", "global")
  await prompt(id)
  assert.equal((await operation(id, "flush")).status, "completed")
  const notes = await runtime.api(endpoint(id))
  root = dirname(
    dirname(dirname(notes.find((row) => row.source === "workspace" && row.name.startsWith("observations/")).path)),
  )
  assert.equal((await operation(id, "dream")).status, "completed")
  assert.equal(count("dream_archives"), 1)
  assert.equal(count("capture_jobs"), 1)
  const before = await runtime.api(`/session/${id}/message`)
  const previousCalls = { ...calls }
  checks.push("default-retention-keeps-recent-archives-and-jobs")

  await configure({ job_retention_days: 0, capture_enabled: false, manual_dream_enabled: false })
  await status(id)
  await poll(() => count("capture_jobs") === 0, "terminal jobs collected")
  assert.equal(count("capture_outcomes"), 0)
  assert.equal(count("dream_archives"), 1)
  assert.equal(count("capture_admissions"), 1)
  assert.equal(rows("SELECT indexed FROM capture_sessions")[0].indexed, 1)
  assert.deepEqual(calls, previousCalls)
  checks.push("job-retention-independent-of-capture-and-dream", "content-free-admission-and-cursor-preserved")
  await configure({ archived_retention_days: 0, job_retention_days: 0, capture_enabled: false })
  await status(id)
  await collected()
  assert.match(await readFile(join(root, "topics/retained.md"), "utf8"), /RETENTION_TOPIC/)
  assert.equal(await readFile(global.path, "utf8"), "GLOBAL_MUST_SURVIVE")
  assert.deepEqual(await runtime.api(`/session/${id}/message`), before)
  assert.deepEqual(calls, previousCalls)
  checks.push("archive-retention-keeps-topic-and-global-memory", "maintenance-does-not-run-model-or-add-messages")

  await configure({ job_retention_days: 0 })
  assert.equal((await operation(id, "flush")).status, "completed")
  assert.equal(calls.capture, previousCalls.capture)
  await prompt(id)
  assert.equal((await operation(id, "flush")).status, "completed")
  assert.equal(count("capture_jobs"), 1)
  assert.equal(rows("SELECT from_turn FROM capture_jobs")[0].from_turn, 2)
  checks.push(
    "retired-turn-does-not-recapture",
    "next-turn-remains-monotonic",
    "live-observation-protects-terminal-job",
  )
  assert.equal((await operation(id, "dream")).status, "completed")
  await configure({ archived_retention_days: 0, file_writes_enabled: false })
  assert.equal((await status(id)).enabled, false)
  assert.equal(count("dream_archives"), 1)
  await configure({ archived_retention_days: 0 })
  await status(id)
  await collected()
  checks.push("file-writes-kill-switch")

  await configure()
  await archive(id)
  await runtime.api(`${endpoint(id)}/toggle`, { enabled: false })
  await configure({ archived_retention_days: 0 })
  assert.equal((await status(id)).enabled, false)
  assert.equal(count("dream_archives"), 1)
  await runtime.api(`${endpoint(id)}/toggle`, { enabled: true })
  await collected()
  checks.push("session-off-preserves-and-reenable-collects")

  await configure()
  await archive(id)
  await configure({ archived_retention_days: 0 })
  const denied = await create({ permission: [{ permission: "edit", pattern: "*", action: "deny" }] })
  await status(denied)
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.equal(count("dream_archives"), 1)
  await status(id)
  await collected()
  checks.push("session-permission-denial")

  await configure()
  await archive(id)
  await save(id, "ARRIVING_DREAM_EVIDENCE")
  const previousArchive = (await archives())[0]
  planned.hold = Promise.withResolvers()
  const dreaming = calls.dream
  await runtime.api(`${endpoint(id)}/operation`, { kind: "dream" })
  await poll(() => calls.dream === dreaming + 1, "held Dream inference")
  {
    using db = new Database(join(root, "memory_state.sqlite"))
    db.query("UPDATE dream_archives SET archived_at = ?").run(Date.now() - 31 * 86400_000)
  }
  await status(id)
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.equal(count("dream_archives"), 1)
  planned.hold.resolve()
  planned.hold = undefined
  await poll(
    async () => count("dream_archives") === 1 && !(await archives()).includes(previousArchive),
    "Dream completion reschedules retention",
    30_000,
  )
  assert.equal((await runtime.api(`${endpoint(id)}/operation`)).result.status, "completed")
  await configure({ archived_retention_days: 0 })
  await status(id)
  await collected()
  checks.push("active-dream-defers-maintenance", "dream-completion-reschedules-maintenance")

  await configure()
  await archive(id)
  await configure({ capture_enabled: false, manual_dream_enabled: false, maintenance_interval_secs: 1 })
  const idleCalls = { ...calls }
  await status(id)
  await new Promise((resolve) => setTimeout(resolve, 2200))
  assert.equal(count("dream_archives"), 1)
  {
    using db = new Database(join(root, "memory_state.sqlite"))
    db.query("UPDATE dream_archives SET archived_at = ?").run(Date.now() - 31 * 86400_000)
    db.query("UPDATE capture_jobs SET terminal_at = ? WHERE status = 'completed'").run(Date.now() - 15 * 86400_000)
  }
  await collected()
  await poll(() => count("capture_jobs") === 0, "periodic job retention")
  assert.deepEqual(calls, idleCalls)
  checks.push("idle-maintenance-without-new-wake", "periodic-maintenance-independent-of-model-switches")

  planned.noop = true
  for (const rollout of ["record_only", "shadow"]) {
    await configure({ rollout, job_retention_days: 0 })
    const hidden = await create()
    await prompt(hidden)
    assert.equal((await operation(hidden, "flush")).status, "completed")
    await poll(
      () => !rows(`SELECT job_id FROM capture_jobs WHERE session_id = '${hidden}'`).length,
      `${rollout} noop retired`,
    )
    checks.push(`${rollout}-maintenance`)
  }
  assert.deepEqual(await archives(), [])
  console.log(JSON.stringify({ kind, passed: checks.length, checks, calls, output: runtime.output }, null, 2))
} finally {
  planned.hold?.resolve()
  await writeFile(join(runtime.output, "memory-retention.json"), JSON.stringify({ checks, calls }, null, 2))
  await runtime.close()
  console.error(`Memory retention evidence: ${runtime.output}`)
}

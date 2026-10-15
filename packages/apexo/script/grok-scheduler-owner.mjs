// Actual CLI/Desktop scheduler tools and restarts. Legacy format/timer deadline edits
// are explicit synthetic saved-store variants, persisted by the real SchedulerStore.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const held = Promise.withResolvers()
const fires = []
const calls = []
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  config: { snapshot: false, compaction: { auto: false }, memory: { enabled: false } },
  next: async ({ text, finished, ancillary }) => {
    calls.push({ text, finished, ancillary })
    if (ancillary || text.includes("Scheduled task completed:") || text.includes("Scheduled task failed:")) return { content: "SCHED_OWNER_ACK" }
    const fire = text.match(/SCHED_OWNER_FIRE_(OLD|VALID|LEGACY|UNKNOWN)/)?.[1]
    if (fire) {
      fires.push(fire)
      await held.promise
      return { content: `SCHED_OWNER_CHILD_${fire}_OK` }
    }
    if (!finished && text.includes("SCHED_OWNER_LIST")) return { tool: "scheduler_list", args: {} }
    const create = !finished && text.match(/SCHED_OWNER_CREATE_(OLD|VALID|LEGACY)/)?.[1]
    if (create) return { tool: "scheduler_create", args: {
      interval: "1h", recurring: false, durable: true, fire_immediately: false, prompt: `SCHED_OWNER_FIRE_${create}`,
    } }
    return { content: "SCHED_OWNER_ACK" }
  },
})
const checks = []
const evidence = { synthetic: ["saved deadlines made due via real store", "captured deleted Session timer restored via real store to model a stale historical record", "exact receipt record downgraded to unstamped legacy shape", "unknown legacy saved record uses unmatched task ID"] }
const store = async (save) => {
  const child = spawn("bun", [fileURLToPath(new URL("./grok-scheduler-owner-store-worker.mjs", import.meta.url)), JSON.stringify({ directory: fixture.directory, ...(save ? { save } : {}) })], {
    env: fixture.env,
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
  })
  const output = [], errors = []
  child.stdout.on("data", (chunk) => output.push(chunk))
  child.stderr.on("data", (chunk) => errors.push(chunk))
  const exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => resolve(code)) })
  const code = await deadline(exited, 15_000, "isolated SchedulerStore worker").catch(async (error) => { child.kill("SIGKILL"); await exited; throw error })
  assert.equal(code, 0, Buffer.concat(errors).toString())
  const line = Buffer.concat(output).toString().split("\n").find((line) => line.startsWith("SCHEDULER_STORE_RESULT "))
  assert.ok(line, Buffer.concat(output).toString())
  return JSON.parse(line.slice("SCHEDULER_STORE_RESULT ".length))
}
const prompt = (id, text) => fixture.api(`/session/${id}/message`, {
  model: { providerID: "xai", modelID: "grok-4.7" }, parts: [{ type: "text", text }],
})
const history = (id) => fixture.api(`/session/${id}/message`)
const tool = async (id, name) => (await history(id)).flatMap((item) => item.parts).findLast((part) => part.type === "tool" && part.tool === name)
try {
  const sessions = {}
  const taskIDs = {}
  for (const label of ["OLD", "VALID", "LEGACY"]) {
    sessions[label] = await fixture.api("/session", { title: `Scheduler owner ${label}` })
    await prompt(sessions[label].id, `SCHED_OWNER_CREATE_${label}`)
    const receipt = await tool(sessions[label].id, "scheduler_create")
    assert.equal(receipt?.state.status, "completed", JSON.stringify(receipt))
    taskIDs[label] = receipt.state.metadata.task_id
    assert.ok(taskIDs[label])
  }
  sessions.UNKNOWN = await fixture.api("/session", { title: "Scheduler unknown historical owner" })
  const original = await store()
  assert.equal(original.length, 3)
  for (const schedule of original) assert.ok(schedule.resume.createdEventID)
  assert.deepEqual(fires, [])
  checks.push("actual-scheduler-tools-persist-creation-proof-and-completed-receipts")

  await fixture.crash()
  await fixture.reopen()
  // Deletion removes the real saved timer. Below we restore its captured old proof
  // as an explicit stale-store variant to test restart defense after ID reuse.
  await fixture.api(`/session/${sessions.OLD.id}`, undefined, "DELETE")
  const replacement = (await fixture.api("/api/session", {
    id: sessions.OLD.id, location: { directory: fixture.directory }, model: { providerID: "xai", id: "grok-4.7" }, agent: "build",
  })).data
  assert.equal(replacement.id, sessions.OLD.id)
  assert.equal(replacement.parentID, undefined)
  const unopened = await store()
  assert.equal(unopened.some((record) => record.id === taskIDs.OLD), false, "real deletion must remove the saved old timer")
  assert.deepEqual(fires, [])
  await fixture.crash()

  const now = Date.now()
  const due = original.map((record) => ({ ...record, createdAt: now - record.intervalSeconds * 1000 - 1 }))
  const matching = due.find((record) => record.id === taskIDs.LEGACY)
  const { createdEventID: _proof, ...legacyResume } = matching.resume
  const legacy = { ...matching, resume: legacyResume }
  const unknown = { ...legacy, id: "job_synthetic_unknown_legacy_owner", ownerSessionId: sessions.UNKNOWN.id, prompt: "SCHED_OWNER_FIRE_UNKNOWN" }
  const prepared = await store([...due.filter((record) => record.id !== matching.id), legacy, unknown])
  assert.equal(prepared.length, 4)
  evidence.original = original
  evidence.prepared = prepared
  await fixture.reopen()
  await prompt(sessions.UNKNOWN.id, "SCHED_OWNER_LIST")
  const list = await tool(sessions.UNKNOWN.id, "scheduler_list")
  assert.equal(list?.state.status, "completed")
  assert.equal(list.state.metadata.status, "recovery_failed")
  assert.match(list.state.output, /ownership could not be verified.*saved schedule remains inactive/s)
  evidence.recoveryError = list.state.output
  await poll(() => fires.includes("VALID") && fires.includes("LEGACY"), "valid and proven legacy timers reached providers", 30_000)
  assert.deepEqual(fires.toSorted(), ["LEGACY", "VALID"])
  const running = await store()
  assert.equal(running.some((record) => record.id === taskIDs.OLD), false)
  assert.deepEqual(running.find((record) => record.id === unknown.id), unknown)
  assert.equal(running.find((record) => record.id === legacy.id)?.resume.createdEventID, matching.resume.createdEventID)
  assert.equal(running.find((record) => record.id === taskIDs.VALID)?.resume.createdEventID, original.find((record) => record.id === taskIDs.VALID).resume.createdEventID)
  checks.push("reused-session-rejects-and-removes-restored-stale-timer-with-zero-old-fires")
  checks.push("unknown-legacy-owner-remains-inactive-with-actionable-recovery-error")
  checks.push("exact-completed-task-receipt-upgrades-legacy-proof-before-execution")
  held.resolve()
  await poll(async () => {
    const records = await store()
    return !records.some((record) => [taskIDs.VALID, taskIDs.LEGACY].includes(record.id))
  }, "valid one-shot timers settle and remove saved records", 30_000)
  assert.deepEqual(fires.toSorted(), ["LEGACY", "VALID"])
  checks.push("valid-same-session-timer-runs-once-after-restart")
  await fixture.crash()
  await fixture.reopen()
  await prompt(sessions.UNKNOWN.id, "SCHED_OWNER_LIST")
  const repeated = await tool(sessions.UNKNOWN.id, "scheduler_list")
  assert.equal(repeated.state.metadata.status, "recovery_failed")
  assert.deepEqual(await store(), [unknown])
  assert.deepEqual(fires.toSorted(), ["LEGACY", "VALID"])
  checks.push("another-restart-preserves-unknown-record-and-does-not-repeat-completed-timers")
  console.log(JSON.stringify({ checks, fires, recoveryError: evidence.recoveryError, syntheticStoreVariants: evidence.synthetic, output: fixture.output }, null, 2))
} finally {
  held.resolve()
  await fixture.close()
  await writeFile(join(fixture.output, "scheduler-owner.json"), JSON.stringify({ checks, fires, calls, evidence }, null, 2))
}

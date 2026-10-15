import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const planned = { content: "## Decisions\nWORK_FLUSH_SAVED", hold: undefined, finishReason: undefined }
const calls = []
const runtime = await startShellFixture(kind, {
  config: {
    memory: { enabled: true, session: { save_on_end: false }, dream: { enabled: false, check_interval_secs: 0 } },
    compaction: { auto: false, memory_flush: { enabled: false } },
  },
  async next({ input, body }) {
    if (!JSON.stringify(input).includes("You are a memory assistant")) return
    const content = planned.content
    calls.push(body)
    if (planned.hold) await planned.hold.promise
    return { content, finishReason: planned.finishReason }
  },
})
const checks = []
const create = async (extra = {}) => (await runtime.api("/session", { title: "Memory operation check", ...extra })).id
const endpoint = (id) => `/experimental/session/${id}/memory/operation`
const start = (id, kind) => runtime.api(endpoint(id), { kind })
const done = (id) =>
  poll(async () => {
    const value = await runtime.api(endpoint(id))
    return value?.state === "finished" ? value : undefined
  }, "memory operation completed")
const history = (id) => runtime.api(`/session/${id}/message`)
const prompt = (id, content) =>
  runtime.api(`/session/${id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: content }],
  })
const snapshot = async (id) => {
  const notes = await runtime.api(`/experimental/session/${id}/memory`)
  return (await Promise.all(notes.map((note) => readFile(note.path, "utf8")))).join("\n")
}
try {
  const first = await create()
  assert.equal(await runtime.api(endpoint(first)), null)
  await start(first, "flush")
  assert.equal((await done(first)).result.status, "no_work")
  await runtime.api(`/experimental/session/${first}/memory/toggle`, { enabled: false })
  await start(first, "flush")
  assert.equal((await done(first)).result.status, "disabled")
  await runtime.api(`/experimental/session/${first}/memory/toggle`, { enabled: true })
  checks.push("empty-status", "no-history", "disabled-result")
  await prompt(first, "Keep WAL enabled for concurrent readers.")
  const before = await history(first)
  planned.hold = Promise.withResolvers()
  const running = await start(first, "flush")
  await poll(() => calls.length === 1, "manual flush inference")
  assert.equal(running.state, "running")
  assert.equal((await start(first, "flush")).id, running.id)
  assert.equal((await runtime.api(endpoint(first))).id, running.id)
  await assert.rejects(() => start(first, "dream"))
  const other = await create()
  assert.equal(await runtime.api(endpoint(other)), null)
  await assert.rejects(() => runtime.api(`${endpoint(other)}/cancel`, { id: running.id }))
  planned.hold.resolve()
  planned.hold = undefined
  const completed = await done(first)
  assert.equal(completed.result.status, "completed")
  assert.ok(completed.result.chars > 0)
  assert.match(await readFile(completed.result.path, "utf8"), /WORK_FLUSH_SAVED/)
  assert.deepEqual(await history(first), before)
  assert.equal(calls[0].tools?.length ?? 0, 0)
  await start(first, "flush")
  assert.equal((await done(first)).result.status, "no_work")
  checks.push(
    "running-progress",
    "duplicate-start-joins",
    "conflicting-operation-rejected",
    "session-isolation",
    "manual-bypasses-auto-disable",
    "flush-result-path-count",
    "no-main-turn-or-tools",
    "unchanged-history-no-work",
  )
  await prompt(first, "Release readers before checkpointing.")
  planned.hold = Promise.withResolvers()
  planned.content = "## Stale\nWORK_CANCEL_MUST_NOT_SAVE"
  const active = await start(first, "flush")
  await poll(() => calls.length === 2, "cancellable flush")
  assert.equal((await runtime.api(`${endpoint(first)}/cancel`, { id: active.id })).result.status, "cancelled")
  planned.hold.resolve()
  planned.hold = undefined
  assert.doesNotMatch(await snapshot(first), /WORK_CANCEL_MUST_NOT_SAVE/)
  planned.content = "## Decisions\nWORK_RETRY_SAVED"
  await start(first, "flush")
  assert.equal((await done(first)).result.status, "completed")
  assert.match(await snapshot(first), /WORK_RETRY_SAVED/)
  await assert.rejects(() => runtime.api(`${endpoint(first)}/cancel`, { id: active.id }))
  checks.push("cancel-without-late-write", "retry-after-cancel", "stale-cancel-cannot-stop-new-job")
  await prompt(first, "A final durable statement.")
  planned.content = "invalid unstructured summary"
  await start(first, "flush")
  assert.equal((await done(first)).result.status, "failed")
  planned.content = "NO_REPLY"
  await start(first, "flush")
  assert.equal((await done(first)).result.status, "no_work")
  checks.push("invalid-result-fails", "no-reply-result")
  const denied = await create({ permission: [{ permission: "edit", pattern: "*", action: "deny" }] })
  await prompt(denied, "This session cannot save durable notes.")
  await start(denied, "flush")
  assert.equal((await done(denied)).result.status, "denied")
  checks.push("write-permission")
  const workspace = await runtime.api(`/experimental/session/${other}/memory/remember`, {
    content: "## Existing\nWORK_PRIOR",
    scope: "workspace",
  })
  await mkdir(join(dirname(workspace.path), "sessions"), { recursive: true })
  await writeFile(join(dirname(workspace.path), "sessions", "2026-10-13-other.md"), "## Evidence\nWORK_SOURCE")
  planned.content = "## Architecture\nWORK_DREAM_SAVED"
  await start(other, "dream")
  const dream = await done(other)
  assert.equal(dream.result.status, "completed")
  assert.ok(dream.result.processed > 0)
  assert.match(await readFile(workspace.path, "utf8"), /WORK_DREAM_SAVED/)
  assert.deepEqual(await history(other), [])
  checks.push("dream-without-conversation", "dream-result-counts", "dream-bypasses-auto-gates")
  const preserved = await readFile(workspace.path, "utf8")
  planned.content = "Invalid unstructured consolidation"
  await start(other, "dream")
  assert.equal((await done(other)).result.status, "failed")
  assert.equal(await readFile(workspace.path, "utf8"), preserved)
  planned.content = "## Truncated\nWORK_TRUNCATED_MUST_NOT_SAVE"
  planned.finishReason = "length"
  await start(other, "dream")
  assert.equal((await done(other)).result.status, "failed")
  assert.equal(await readFile(workspace.path, "utf8"), preserved)
  const truncated = await create()
  await prompt(truncated, "Keep only verified migration decisions.")
  await start(truncated, "flush")
  assert.equal((await done(truncated)).result.status, "failed")
  assert.doesNotMatch(await snapshot(first), /WORK_TRUNCATED_MUST_NOT_SAVE/)
  planned.finishReason = undefined
  checks.push("invalid-dream-keeps-notes", "truncated-dream-keeps-notes", "truncated-flush-keeps-notes")
  const deleted = await create()
  planned.hold = Promise.withResolvers()
  planned.content = "## Deleted\nWORK_DELETED_MUST_NOT_SAVE"
  const count = calls.length
  await start(deleted, "dream")
  await poll(() => calls.length > count, "dream before session removal")
  await runtime.api(`/session/${deleted}`, undefined, "DELETE")
  planned.hold.resolve()
  planned.hold = undefined
  assert.doesNotMatch(await readFile(workspace.path, "utf8"), /WORK_DELETED_MUST_NOT_SAVE/)
  await assert.rejects(() => runtime.api(endpoint(deleted)))
  checks.push("session-delete-cancels-work")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, output: runtime.output }, null, 2))
} finally {
  planned.hold?.resolve()
  await writeFile(join(runtime.output, "memory-work.json"), JSON.stringify({ checks, calls }, null, 2))
  await runtime.close()
  console.error(`Memory operation evidence: ${runtime.output}`)
}

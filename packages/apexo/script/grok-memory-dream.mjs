// Actual CLI/Electron session service with deterministic model responses and isolated memory.
import assert from "node:assert/strict"
import { mkdir, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const calls = []
const planned = { content: "## Architecture\nDREAM_MERGED: preserve WAL and bounded transactions.", hold: undefined }
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  async next({ body, input, text, finished, ancillary }) {
    if (JSON.stringify(input).includes("You are a memory assistant consolidating session logs")) {
      const content = planned.content
      calls.push({ input, tools: body.tools ?? [] })
      if (planned.hold) await planned.hold.promise
      return { content }
    }
    if (!ancillary && !finished && text.includes("DREAM_MANUAL"))
      return { tool: "memory", args: { operation: "dream" } }
    if (!ancillary && !finished && text.includes("DREAM_READ")) return { tool: "memory", args: { operation: "read" } }
    if (!ancillary && !finished && text.includes("DREAM_SEARCH"))
      return {
        tool: "memory_search",
        args: { query: text.includes("AFTER") ? "DREAM_MERGED" : "DREAM_SOURCE_ONLY", min_score: 0 },
      }
  },
})
const evidence = []
async function configure(dream, extra = {}) {
  await runtime.api(
    "/config",
    {
      compaction: { memory_flush: { enabled: false } },
      memory: { enabled: true, session: { save_on_end: false }, dream },
      ...extra,
    },
    "PATCH",
  )
}
async function create(extra = {}) {
  return (await runtime.api("/session", { title: "Memory dream parity", ...extra })).id
}
async function prompt(id, text = "DREAM_MANUAL Consolidate the other sessions' durable lessons.") {
  await runtime.api(`/session/${id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text }],
  })
  const history = await runtime.api(`/session/${id}/message`)
  return history.flatMap((message) => message.parts).findLast((part) => part.type === "tool" && part.tool === "memory")
    ?.state
}
try {
  await configure({ enabled: false, check_interval_secs: 0 })
  const first = await create()
  const initial = await prompt(first, "DREAM_READ Read the initial workspace notes.")
  const file = initial.metadata.path
  const root = dirname(file)
  const logs = join(root, "sessions")
  const state = join(root, ".dream-state.json")
  await mkdir(logs, { recursive: true })
  async function seed(name, content = "## Decision\nUse bounded database transactions.", old = false) {
    const target = join(logs, `2026-10-13-${name}.md`)
    await writeFile(target, content)
    if (old) await utimes(target, new Date(1), new Date(1))
    return target
  }
  await writeFile(file, "## Existing architecture\nPRIOR_KNOWLEDGE: use WAL.\n")
  const old = await seed(
    "ses_old",
    "## Transactions\nDREAM_SOURCE_ONLY: close reader transactions before checkpointing.",
    true,
  )
  const active = await seed(first, "## Current session\nCURRENT_MUST_NOT_BE_READ")
  async function search(id, text) {
    await prompt(id, text)
    return (await runtime.api(`/session/${id}/message`))
      .flatMap((message) => message.parts)
      .findLast((part) => part.type === "tool" && part.tool === "memory_search").state.metadata.results
  }
  assert.ok((await search(first, "DREAM_SEARCH BEFORE")).map((item) => item.path).includes(await realpath(old)))
  const merged = await prompt(first)
  assert.equal(merged.metadata.status, "completed")
  assert.equal(merged.metadata.cleaned, 1)
  assert.ok(JSON.stringify(calls[0].input).includes("PRIOR_KNOWLEDGE"))
  assert.ok(!JSON.stringify(calls[0].input).includes("CURRENT_MUST_NOT_BE_READ"))
  assert.deepEqual(calls[0].tools, [])
  assert.ok((await readFile(file, "utf8")).includes("DREAM_MERGED"))
  assert.equal(await readFile(old, "utf8").catch(() => undefined), undefined)
  assert.ok(await readFile(active, "utf8"))
  evidence.push("manual-model-merge", "current-session-excluded", "old-log-cleanup")
  assert.equal((await search(first, "DREAM_SEARCH BEFORE")).length, 0, "deleted logs must leave the search index")
  const reader = await create()
  assert.ok(
    (await search(reader, "DREAM_SEARCH AFTER")).some(
      (item) => item.source === "workspace" && item.snippet.includes("DREAM_MERGED"),
    ),
  )
  evidence.push("search-index-cleanup", "cross-session-topic-recall")

  const recent = await seed("ses_recent")
  planned.content = "## New topic\nDREAM_RECENT: use short-lived reads."
  assert.equal((await prompt(first)).metadata.status, "completed")
  assert.ok(await readFile(recent, "utf8"))
  evidence.push("recent-log-retained")
  const previous = await readFile(file, "utf8")
  planned.content = "**No-Reply**"
  assert.equal((await prompt(first)).metadata.status, "no_work")
  assert.equal(await readFile(file, "utf8"), previous)
  planned.content = "Invalid plain text must not replace knowledge."
  assert.equal((await prompt(first)).metadata.status, "failed")
  assert.equal(await readFile(file, "utf8"), previous)
  evidence.push("no-reply", "invalid-response")

  const release = Promise.withResolvers()
  planned.hold = release
  planned.content = "## Stale model output\nMUST_NOT_OVERWRITE"
  const before = calls.length
  const running = prompt(first)
  await poll(() => calls.length === before + 1, "dream inference started")
  const second = await create()
  assert.equal((await prompt(second)).metadata.status, "busy")
  assert.equal(calls.length, before + 1)
  await writeFile(file, "## User correction\nCONCURRENT_EDIT_MUST_SURVIVE")
  planned.hold = undefined
  release.resolve()
  assert.equal((await running).metadata.status, "conflict")
  assert.ok((await readFile(file, "utf8")).includes("CONCURRENT_EDIT_MUST_SURVIVE"))
  evidence.push("concurrent-lease", "concurrent-memory-edit")

  const abortRelease = Promise.withResolvers()
  planned.hold = abortRelease
  planned.content = "## Cancelled result\nCANCELLED_DREAM_MUST_NOT_SAVE"
  const cancelSession = await create()
  const beforeCancel = calls.length
  const cancelled = prompt(cancelSession)
  await poll(() => calls.length === beforeCancel + 1, "cancellable dream started")
  await runtime.api(`/session/${cancelSession}/abort`, undefined, "POST")
  await cancelled
  planned.hold = undefined
  planned.content = "NO_REPLY"
  abortRelease.resolve()
  assert.equal((await prompt(first)).metadata.status, "no_work", "cancellation must release the dream lease")
  assert.ok(!(await readFile(file, "utf8")).includes("CANCELLED_DREAM_MUST_NOT_SAVE"))
  evidence.push("cancel-releases-lease")

  await configure({ enabled: true, min_hours: 0, min_sessions: 2, check_interval_secs: 0 })
  await rm(logs, { recursive: true })
  await mkdir(logs)
  await rm(state, { force: true })
  await seed("ses_counted")
  await seed("ses_counted-flush")
  planned.content = "## Consolidated\nAUTO_DREAM_COMPLETE"
  const beforeAuto = calls.length
  await prompt(first, "Continue normal work while automatic consolidation checks its gates.")
  await new Promise((resolve) => setTimeout(resolve, 500))
  assert.equal(calls.length, beforeAuto, "metadata and flush for one session must not count as two sessions")
  await seed("ses_another")
  await prompt(first, "Another independent session is now available for memory consolidation.")
  await poll(async () => (await readFile(file, "utf8")).includes("AUTO_DREAM_COMPLETE"), "automatic dream")
  assert.equal(calls.length, beforeAuto + 1)
  evidence.push("distinct-session-gate", "automatic-model-consolidation")

  await configure({ enabled: true, min_hours: 24, min_sessions: 1, check_interval_secs: 0 })
  await seed("ses_later")
  await prompt(first, "Time gate must retain newly available evidence for a later pass.")
  await new Promise((resolve) => setTimeout(resolve, 500))
  assert.equal(calls.length, beforeAuto + 1)
  evidence.push("time-gate")
  await configure({ enabled: false, min_hours: 0, min_sessions: 1 })
  await prompt(first, "Automatic dream is now disabled.")
  await new Promise((resolve) => setTimeout(resolve, 500))
  assert.equal(calls.length, beforeAuto + 1)
  evidence.push("auto-disabled")

  await configure({ enabled: true, min_hours: 0, min_sessions: 1, check_interval_secs: 0 })
  const denied = await create({ permission: [{ permission: "read", pattern: "*", action: "deny" }] })
  await prompt(denied, "This session cannot read saved memory automatically.")
  await new Promise((resolve) => setTimeout(resolve, 500))
  assert.equal(calls.length, beforeAuto + 1)
  evidence.push("read-denied")
  const readonly = await create({ permission: [{ permission: "edit", pattern: await realpath(file), action: "deny" }] })
  await prompt(readonly, "The canonical memory output path is read-only.")
  const child = await create({ parentID: first })
  await prompt(child, "Child sessions must not consolidate their parent's repository memory.")
  await new Promise((resolve) => setTimeout(resolve, 500))
  assert.equal(calls.length, beforeAuto + 1)
  evidence.push("canonical-write-denied", "subagent-skipped")

  await configure({ enabled: true, min_hours: 0, min_sessions: 1, check_interval_secs: 1 })
  planned.content = "## Periodic\nPERIODIC_FIRST"
  const checkpoint = JSON.parse(await readFile(state, "utf8"))
  await prompt(first, "Enable the periodic consolidation timer.")
  await poll(async () => (await readFile(file, "utf8")).includes("PERIODIC_FIRST"), "initial periodic gate check")
  await poll(
    async () => JSON.parse(await readFile(state, "utf8")).completed > checkpoint.completed,
    "dream journal saved",
  )
  planned.content = "## Periodic\nPERIODIC_NEW_EVIDENCE"
  await seed("ses_periodic")
  await poll(
    async () => (await readFile(file, "utf8")).includes("PERIODIC_NEW_EVIDENCE"),
    "periodic dream without new prompt",
  )
  evidence.push("periodic-without-new-turn")
  await configure({ enabled: true }, { memory: { enabled: false } })
  const beforeDisabled = calls.length
  const savedBeforeDisabled = await readFile(file, "utf8")
  assert.equal((await runtime.api(`/experimental/session/${first}/memory/status`)).enabled, false)
  await runtime.api(`/experimental/session/${first}/memory/operation`, { kind: "dream" })
  const disabled = await poll(async () => {
    const operation = await runtime.api(`/experimental/session/${first}/memory/operation`)
    return operation.state === "finished" ? operation : undefined
  }, "disabled memory result")
  assert.equal(disabled.result.status, "disabled")
  assert.equal(calls.length, beforeDisabled)
  assert.equal(await readFile(file, "utf8"), savedBeforeDisabled)
  evidence.push("memory-disabled")
  await writeFile(join(runtime.output, "memory-dream.json"), JSON.stringify({ evidence, calls }, null, 2))
  console.log(
    JSON.stringify({
      result: "pass",
      kind: process.argv[2] ?? "cli",
      scenarios: evidence,
      modelCalls: calls.length,
      output: runtime.output,
    }),
  )
} finally {
  planned.hold?.resolve()
  await runtime.close()
}

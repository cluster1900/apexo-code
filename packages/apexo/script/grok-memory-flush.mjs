// Real CLI/Electron execution with a local streaming provider; no production credentials.
import assert from "node:assert/strict"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const calls = []
const planned = { content: "## Decisions\nFLUSH_FIRST: use WAL for concurrent database readers.", hold: undefined }
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  async next({ body, input, text, finished, ancillary }) {
    if (!ancillary && !finished && text.includes("READ_FLUSH_MEMORY"))
      return { tool: "memory_search", args: { query: "FLUSH_FIRST", min_score: 0 } }
    if (!JSON.stringify(input).includes("You are a memory assistant extracting durable knowledge")) return
    const content = planned.content
    calls.push({ model: body.model, messages: input, tools: body.tools ?? [] })
    if (planned.hold) await planned.hold.promise
    return { content }
  },
})
const sessions = []
const evidence = []
async function create(permission) {
  const value = await runtime.api("/session", {
    title: "Automatic Memory flush",
    ...(permission ? { permission } : {}),
  })
  sessions.push(value.id)
  return value.id
}
async function prompt(sessionID, text) {
  return runtime.api(`/session/${sessionID}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text }],
  })
}
async function records(id) {
  const root = join(runtime.env.APEXO_TEST_HOME, ".grok", "memory")
  const files = await readdir(root, { recursive: true }).catch((error) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  return Promise.all(
    files
      .filter((file) => file.endsWith(`-${id}-flush.md`))
      .map(async (file) => ({ file, content: await readFile(join(root, file), "utf8") })),
  )
}
async function configure(memory_flush, extra = {}) {
  await runtime.api("/config", { compaction: { auto: false, memory_flush }, ...extra }, "PATCH")
}
try {
  await configure({ enabled: true, idle_timeout_secs: 1 }, { memory: { enabled: true } })
  const first = await create()
  await prompt(first, "Persist the database decision: use WAL to allow concurrent readers.")
  await poll(async () => (await records(first))[0]?.content.includes("FLUSH_FIRST"), "initial idle flush")
  assert.equal(calls.length, 1)
  assert.ok(calls[0].tools.length === 0, "flush must have no executable tools")
  const history = await runtime.api(`/session/${first}/message`)
  assert.equal(history.length, 2)
  assert.ok(!JSON.stringify(history).includes("FLUSH_FIRST"), "background flush must not add conversation turns")
  await new Promise((resolve) => setTimeout(resolve, 1500))
  assert.equal(calls.length, 1, "unchanged idle history must not flush again")
  planned.content = "## Problems and solutions\nFLUSH_SECOND: readers must release transactions before checkpointing."
  await prompt(first, "A second durable lesson: release reader transactions before checkpointing.")
  await poll(async () => (await records(first))[0]?.content.includes("FLUSH_SECOND"), "incremental idle flush")
  assert.ok(JSON.stringify(calls[1].messages).includes("FLUSH_FIRST"), "incremental extraction needs previous memory")
  await prompt(first, "Check the same transaction checkpoint guidance once more.")
  await poll(() => calls.length === 3, "duplicate extraction")
  await poll(async () => (await records(first))[0]?.content.includes(`apexo-flush-through:`), "duplicate write")
  assert.equal((await records(first))[0].content.split("FLUSH_SECOND").length - 1, 1)
  evidence.push({ scenario: "idle-incremental-dedup", records: await records(first) })

  planned.content = "**No-Reply**"
  const empty = await create()
  const beforeEmpty = calls.length
  await prompt(empty, "Say hello without inventing any durable knowledge.")
  await poll(() => calls.length === beforeEmpty + 1, "NO_REPLY model call")
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.deepEqual(await records(empty), [])
  planned.content = "This unstructured answer must not be stored."
  const rejected = await create()
  await prompt(rejected, "Explain why a plain answer is not a structured memory note.")
  await poll(() => calls.length === beforeEmpty + 2, "rejected model response")
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.deepEqual(await records(rejected), [])

  await configure({ idle_timeout_secs: 0 })
  const reader = await create()
  await prompt(reader, "READ_FLUSH_MEMORY Find the database decision saved in earlier sessions.")
  const recalled = (await runtime.api(`/session/${reader}/message`))
    .flatMap((message) => message.parts)
    .find((part) => part.type === "tool" && part.tool === "memory_search")
  assert.equal(recalled?.state.status, "completed")
  assert.ok(
    recalled.state.metadata.results.some(
      (result) => result.source === "session" && result.snippet.includes("FLUSH_FIRST"),
    ),
  )
  const disabled = await create()
  const beforeDisabled = calls.length
  await prompt(disabled, "Idle memory saving is disabled for this conversation.")
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.equal(calls.length, beforeDisabled)
  await configure({ idle_timeout_secs: 1, enabled: false })
  await prompt(disabled, "All automatic memory flushing is disabled now.")
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.equal(calls.length, beforeDisabled)
  await configure({ enabled: true })
  const denied = await create([{ permission: "edit", pattern: "*", action: "deny" }])
  await prompt(denied, "This conversation may not write any memory files.")
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.equal(calls.length, beforeDisabled)

  planned.content = "## Decisions\nSTALE_FLUSH_MUST_NOT_SAVE"
  const release = Promise.withResolvers()
  planned.hold = release
  const interrupted = await create()
  await prompt(interrupted, "Retain the stable migration decision after considering new input.")
  await poll(() => calls.length === beforeDisabled + 1, "idle flush started")
  const followup = prompt(interrupted, "New input should cancel the unfinished background summary.")
  await followup
  planned.hold = undefined
  planned.content = "NO_REPLY"
  release.resolve()
  await poll(() => calls.length === beforeDisabled + 2, "next idle snapshot")
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.deepEqual(await records(interrupted), [])

  planned.content = "## Decisions\nDISABLED_FLUSH_MUST_NOT_SAVE"
  planned.hold = Promise.withResolvers()
  const stopped = await create()
  const beforeStop = calls.length
  await prompt(stopped, "Keep the stable database decision when memory is enabled.")
  await poll(() => calls.length === beforeStop + 1, "flush held before memory disable")
  assert.equal((await runtime.api(`/experimental/session/${stopped}/memory/toggle`, { enabled: false })).enabled, false)
  assert.equal((await runtime.api(`/experimental/session/${stopped}/memory/toggle`, { enabled: true })).enabled, true)
  planned.hold.resolve()
  planned.hold = undefined
  planned.content = "## Decisions\nREENABLED_FLUSH_FRESH"
  await prompt(stopped, "Save a new decision after re-enabling memory for this session.")
  await poll(
    async () => (await records(stopped))[0]?.content.includes("REENABLED_FLUSH_FRESH"),
    "fresh flush after re-enable",
  )
  assert.ok((await records(stopped)).every((record) => !record.content.includes("DISABLED_FLUSH_MUST_NOT_SAVE")))
  evidence.push({
    scenario: "disable-cancels-model-flush-and-reenable-rejects-stale-result",
    records: await records(stopped),
  })

  await configure(
    {
      idle_timeout_secs: 0,
      soft_threshold_tokens: 100000,
      max_flush_write_chars: 40,
      flush_model: "xai/flush-fixture",
    },
    {
      compaction: {
        auto: true,
        memory_flush: {
          enabled: true,
          idle_timeout_secs: 0,
          soft_threshold_tokens: 100000,
          max_flush_write_chars: 40,
          flush_model: "xai/flush-fixture",
        },
      },
      provider: {
        xai: {
          models: {
            "flush-fixture": { name: "Flush fixture", tool_call: true, limit: { context: 100000, output: 1000 } },
          },
        },
      },
    },
  )
  planned.content = `## Decisions\n${"😀".repeat(100)}`
  const threshold = await create()
  const beforeThreshold = calls.length
  await prompt(threshold, "Test the pre-compaction flush threshold with a Unicode memory response.")
  assert.equal(calls.length, beforeThreshold + 1)
  assert.equal(calls.at(-1).model, "flush-fixture")
  const saved = (await records(threshold))[0].content.replace(/^<!--[^\n]*-->\n?/gm, "").trim()
  assert.equal(Array.from(saved).length, 40)
  await prompt(threshold, "A second turn in the same compaction cycle should not flush again.")
  assert.equal(calls.length, beforeThreshold + 1)
  await runtime.api(`/session/${threshold}/summarize`, { providerID: "xai", modelID: "grok-4.7", auto: false })
  planned.content = "## Decisions\nNEXT_CYCLE"
  await prompt(threshold, "A new compaction cycle can flush newly learned knowledge again.")
  assert.equal(calls.length, beforeThreshold + 2)
  assert.ok((await records(threshold))[0].content.includes("NEXT_CYCLE"))
  evidence.push({ scenario: "threshold-model-limit-cycles", records: await records(threshold) })
  console.log(
    JSON.stringify({
      result: "pass",
      kind: process.argv[2] ?? "cli",
      scenarios: [
        "idle-without-transcript-turn",
        "disable-cancels-model-flush-and-reenable-rejects-stale-result",
        "incremental",
        "exact-dedup",
        "no-reply",
        "invalid-markdown",
        "cross-session-recall",
        "idle-disabled",
        "flush-disabled",
        "edit-denied",
        "new-prompt-cancels",
        "threshold",
        "model-override",
        "unicode-limit",
        "compaction-cycle",
      ],
      flushCalls: calls.length,
      output: runtime.output,
    }),
  )
} finally {
  planned.hold?.resolve()
  await writeFile(join(runtime.output, "memory-flush.json"), JSON.stringify({ evidence, calls }, null, 2))
  await runtime.close()
}

// Exercise automatic metadata checkpoints through real CLI/Electron session execution.
import assert from "node:assert/strict"
import { readFile, readdir, realpath, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const queries = [
  "Investigate admission state and durable retries",
  "Review cancellation behavior for concurrent sessions",
  "Verify admission regression results with source evidence",
]
const issued = new Set()
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  next({ text, ancillary, finished }) {
    if (!ancillary && !finished && text.includes("MEMORY_INTERRUPT"))
      return {
        tool: "run_terminal_cmd",
        args: {
          command: "echo $$ > memory-interrupt.pid; while [ ! -f memory-interrupt.release ]; do sleep 0.1; done",
          description: "Check memory checkpoint after interruption",
          block_until_ms: 60_000,
        },
      }
    if (ancillary || finished || !text.includes("FIND_SESSION_MEMORY") || issued.has(text)) return
    issued.add(text)
    return { tool: "memory_search", args: { query: "admission", min_score: 0 } }
  },
})
const evidence = []
const sessions = []
async function session(options = {}) {
  const value = await runtime.api("/session", { title: "Memory session parity", ...options })
  sessions.push(value.id)
  return value.id
}
async function prompt(sessionID, text, synthetic = false) {
  const value = await runtime.api(`/session/${sessionID}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text, synthetic }],
  })
  await poll(
    async () => (await runtime.api("/session/status"))[sessionID]?.type !== "busy",
    "session checkpoint settled",
  )
  return value
}
async function records(sessionID) {
  const root = join(runtime.env.APEXO_TEST_HOME, ".grok", "memory")
  const entries = await readdir(root, { recursive: true }).catch((error) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  return Promise.all(
    entries
      .filter((entry) => entry.endsWith(`-${sessionID}.md`))
      .map(async (entry) => ({ path: join(root, entry), content: await readFile(join(root, entry), "utf8") })),
  )
}
try {
  await runtime.api("/config", { memory: { enabled: true } }, "PATCH")
  const first = await session()
  await prompt(first, queries[0])
  await prompt(first, queries[1])
  assert.deepEqual(await records(first), [])
  await prompt(first, "SYNTHETIC_NOTIFICATION_NOT_A_TOPIC", true)
  assert.deepEqual(await records(first), [])
  await prompt(first, queries[2])
  const saved = await records(first)
  assert.equal(saved.length, 1)
  assert.match(saved[0].content, /3 user, 4 assistant, 0 tool results/)
  assert.ok(!saved[0].content.includes("SYNTHETIC_NOTIFICATION_NOT_A_TOPIC"))
  assert.ok(!saved[0].content.includes("SHELL_ACK"))
  assert.ok(saved[0].content.includes(queries[0]))
  await prompt(first, "Inspect the final changes and summarize the remaining risks")
  const updated = await records(first)
  assert.equal(updated.length, 1)
  assert.equal(updated[0].path, saved[0].path)
  assert.match(updated[0].content, /4 user, 5 assistant/)
  evidence.push({ scenario: "automatic-update", records: updated })
  const recall = await session()
  await prompt(recall, "FIND_SESSION_MEMORY")
  const recalled = await runtime.api(`/session/${recall}/message`)
  const result = recalled
    .flatMap((message) => message.parts)
    .find((part) => part.type === "tool" && part.tool === "memory_search")
  assert.equal(result?.state.status, "completed")
  assert.ok(
    result.state.metadata.results.some((record) => record.source === "session" && record.snippet.includes(queries[0])),
  )
  evidence.push({ scenario: "cross-session-recall", result: result.state })
  const brief = await session()
  for (const text of ["hi", "ok", "bye"]) await prompt(brief, text)
  assert.deepEqual(await records(brief), [])
  const denied = await session({ permission: [{ permission: "edit", pattern: "*", action: "deny" }] })
  for (const text of queries) await prompt(denied, text)
  assert.deepEqual(await records(denied), [])
  const child = await session({ parentID: first })
  for (const text of queries) await prompt(child, text)
  assert.deepEqual(await records(child), [])
  for (const home of new Set([runtime.env.APEXO_TEST_HOME, await realpath(runtime.env.APEXO_TEST_HOME)])) {
    const restricted = await session({
      permission: [{ permission: "edit", pattern: join(home, ".grok", "memory", "**"), action: "deny" }],
    })
    for (const text of queries) await prompt(restricted, text)
    assert.deepEqual(await records(restricted), [])
  }
  const interrupted = await session()
  await prompt(interrupted, queries[0])
  await prompt(interrupted, queries[1])
  await runtime.api(`/session/${interrupted}/prompt_async`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "MEMORY_INTERRUPT Verify that cancellation still saves the session metadata" }],
  })
  await poll(
    () => readFile(join(runtime.directory, "memory-interrupt.pid"), "utf8").catch(() => ""),
    "interrupted shell started",
  )
  await runtime.api(`/session/${interrupted}/abort`, undefined, "POST")
  const stopped = await poll(async () => (await records(interrupted))[0], "interrupted session checkpoint")
  assert.match(stopped.content, /3 user/)
  evidence.push({ scenario: "interruption", record: stopped })
  await runtime.api("/config", { memory: { session: { save_on_end: false } } }, "PATCH")
  assert.equal((await runtime.api("/config")).memory.session.save_on_end, false)
  const disabled = await session()
  for (const text of queries) await prompt(disabled, text)
  assert.deepEqual(await records(disabled), [])
  await runtime.api("/config", { memory: { enabled: false, session: { save_on_end: true } } }, "PATCH")
  assert.equal((await runtime.api("/config")).memory.enabled, false)
  const off = await session()
  for (const text of queries) await prompt(off, text)
  assert.deepEqual(await records(off), [])
  await runtime.api("/config", { memory: { enabled: true, session: { save_on_end: true } } }, "PATCH")
  const restored = await session()
  for (const text of queries) await prompt(restored, text)
  assert.equal((await records(restored)).length, 1)
  evidence.push({
    scenario: "skip-gates",
    cases: [
      "short",
      "brief",
      "synthetic",
      "edit-denied",
      "subagent",
      "path-alias-denied",
      "save-disabled",
      "memory-disabled",
      "re-enabled",
    ],
  })
  console.log(JSON.stringify({ result: "pass", kind: process.argv[2] ?? "cli", scenarios: 12, output: runtime.output }))
} finally {
  await Promise.all(
    sessions.map((sessionID) => runtime.api(`/session/${sessionID}/abort`, undefined, "POST").catch(() => {})),
  )
  await writeFile(join(runtime.output, "memory-session.json"), JSON.stringify(evidence, null, 2))
  await runtime.close()
  console.error(`Memory session evidence: ${runtime.output}`)
}

// Real model-facing tool calls through CLI and the packaged Electron backend.
import { execFileSync } from "node:child_process"
import assert from "node:assert/strict"
import { mkdir, realpath, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const cases = []
const sent = new Set()
const advertised = []
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  env: { GROK_MEMORY: "1" },
  config: { memory: { enabled: true, search: { mmr: { lambda: 0 }, source_weights: { workspace: 0.8 } } } },
  next({ body, text, ancillary, finished }) {
    const index = Number(text.match(/MEMORY_SEARCH_(\d+)/)?.[1])
    if (ancillary || finished || !Number.isInteger(index) || sent.has(index)) return
    sent.add(index)
    advertised[index] = body.tools.map((tool) => (tool.function ?? tool).name)
    return cases[index]
  },
})
const evidence = []
const sessions = []
async function api(directory, endpoint, body, method = body ? "POST" : "GET") {
  const response = await fetch(`${runtime.url}${endpoint}?directory=${encodeURIComponent(directory)}`, {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45_000),
  })
  const text = await response.text()
  assert.ok(response.ok, text)
  return text ? JSON.parse(text) : undefined
}
async function session(directory = runtime.directory, permission) {
  const value = await api(directory, "/session", {
    title: "Memory retrieval parity",
    ...(permission ? { permission } : {}),
  })
  const result = { directory, id: value.id }
  sessions.push(result)
  return result
}
async function invoke(session, tool, args, status = "completed") {
  const index = cases.push({ tool, args }) - 1
  const previous = new Set(
    (await api(session.directory, `/session/${session.id}/message`)).flatMap((message) =>
      message.parts.map((part) => part.id),
    ),
  )
  await api(session.directory, `/session/${session.id}/prompt_async`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: `MEMORY_SEARCH_${index}` }],
  })
  const part = await poll(
    async () =>
      (await api(session.directory, `/session/${session.id}/message`))
        .flatMap((message) => message.parts)
        .find(
          (part) =>
            !previous.has(part.id) && part.type === "tool" && ["completed", "error"].includes(part.state.status),
        ),
    `memory search ${index}`,
  )
  await poll(async () => (await api(session.directory, "/session/status"))[session.id]?.type !== "busy", "memory idle")
  evidence.push({ index, tool, args, state: part.state, tools: advertised[index] })
  assert.equal(part.state.status, status, JSON.stringify(part.state))
  return part.state
}
try {
  const first = await session()
  const saved = await invoke(first, "memory", { operation: "remember", content: "initialize ranking fixture" })
  const root = await realpath(dirname(saved.metadata.path))
  await mkdir(join(root, "sessions"), { recursive: true })
  await writeFile(join(root, "evergreen.md"), "rankingneedle identical content")
  await writeFile(join(root, "sessions", "old.md"), "rankingneedle identical content")
  await invoke(first, "memory_search", { query: "unmatchedindextrigger" })
  execFileSync("sqlite3", [
    join(root, "search.sqlite"),
    `UPDATE memory_ranking SET created_at = ${Date.now() - 30 * 86400000}`,
  ])
  const result = await invoke(first, "memory_search", { query: "rankingneedle", min_score: 0 })
  assert.equal(result.metadata.results[0].source, "workspace")
  assert.equal(result.metadata.results[0].score, 0.8)
  assert.ok(Math.abs(result.metadata.results[1].score - 0.5) < 0.001)
  assert.match(result.output, /Stale.*Verify current state/)
  await writeFile(join(root, "b.md"), "frequencyneedle shared duplicate")
  await invoke(first, "memory_search", { query: "frequencyneedle" })
  await writeFile(join(root, "a.md"), "frequencyneedle shared duplicate")
  await writeFile(join(root, "c.md"), "frequencyneedle distinct alternative")
  const boosted = await invoke(first, "memory_search", { query: "frequencyneedle", max_results: 2 })
  assert.ok(boosted.metadata.results[0].path.endsWith("b.md"))
  assert.ok(boosted.metadata.results[1].path.endsWith("c.md"))
  console.log(
    JSON.stringify({ result: "pass", kind: process.argv[2] ?? "cli", calls: evidence.length, output: runtime.output }),
  )
} finally {
  await Promise.all(
    sessions.map((session) =>
      api(session.directory, `/session/${session.id}/abort`, undefined, "POST").catch(() => {}),
    ),
  )
  await writeFile(join(runtime.output, "memory-ranking.json"), JSON.stringify(evidence, null, 2))
  await runtime.close()
}

// Real model-facing tool calls through CLI and the packaged Electron backend.
import assert from "node:assert/strict"
import { mkdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const cases = []
const sent = new Set()
const advertised = []
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  env: { GROK_MEMORY: "1" },
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
  const saved = await invoke(first, "memory", { operation: "remember", content: "retrieval repository convention" })
  const global = await invoke(first, "memory", {
    operation: "remember",
    scope: "global",
    content: "retrieval global preference",
  })
  const root = await realpath(dirname(saved.metadata.path))
  const topic = join(root, "topics", "database.md")
  await mkdir(dirname(topic), { recursive: true })
  await mkdir(join(root, "sessions"), { recursive: true })
  await writeFile(topic, "# Retrieval\nretrieval DATABASE_ORIGINAL\n中文数据库连接池配置\n")
  await writeFile(join(root, "sessions", "previous.md"), "retrieval session decision\n")
  const matches = await invoke(first, "memory_search", { query: "retrieval", min_score: 0 })
  assert.equal(matches.metadata.results.length, 4)
  assert.deepEqual([...new Set(matches.metadata.results.map((result) => result.source))].sort(), [
    "global",
    "session",
    "workspace",
  ])
  assert.ok(advertised.at(-1).includes("memory_search") && advertised.at(-1).includes("memory_get"))
  const range = await invoke(first, "memory_get", { path: topic, from: 2, lines: 1 })
  assert.match(range.output, /2→retrieval DATABASE_ORIGINAL/)
  assert.ok(!range.output.includes("数据库"))
  assert.match((await invoke(first, "memory_get", { path: topic, from: 0 })).output, /4→$/)
  assert.equal((await invoke(first, "memory_get", { path: topic, lines: 0 })).metadata.lines, 0)
  assert.equal((await invoke(first, "memory_search", { query: "数据库" })).metadata.results[0].path, topic)
  assert.equal(
    (await invoke(first, "memory_search", { query: "retrieval", max_results: 0 })).metadata.results.length,
    0,
  )
  assert.equal(
    (await invoke(first, "memory_search", { query: "retrieval", max_results: 1 })).metadata.results.length,
    1,
  )
  assert.equal((await invoke(first, "memory_search", { query: "retrieval", min_score: 2 })).metadata.results.length, 0)
  assert.equal((await invoke(first, "memory_search", { query: '" OR * () :' })).metadata.results.length, 0)
  await invoke(first, "memory_search", { query: "retrieval", max_results: -1 }, "error")
  await invoke(first, "memory_get", { path: topic, from: -1 }, "error")
  const outside = join(runtime.directory, "private.md")
  await writeFile(outside, "OUTSIDE_PRIVATE_SECRET\n")
  await invoke(first, "memory_get", { path: outside }, "error")
  const other = join(runtime.output, "other-workspace")
  await mkdir(other)
  const isolated = await session(other)
  assert.equal((await invoke(isolated, "memory_search", { query: "DATABASE_ORIGINAL" })).metadata.results.length, 0)
  assert.match((await invoke(isolated, "memory_get", { path: global.metadata.path })).output, /global preference/)
  await invoke(isolated, "memory_get", { path: topic }, "error")
  const denied = await session(runtime.directory, [{ permission: "read", pattern: topic, action: "deny" }])
  await invoke(denied, "memory_search", { query: "retrieval" }, "error")
  await invoke(denied, "memory_get", { path: topic }, "error")
  const aliasDenied = await session(runtime.directory, [
    { permission: "read", pattern: join(dirname(saved.metadata.path), "topics", "database.md"), action: "deny" },
  ])
  await invoke(aliasDenied, "memory_search", { query: "retrieval" }, "error")
  await invoke(aliasDenied, "memory_get", { path: topic }, "error")
  const unreadable = await session(runtime.directory, [{ permission: "read", pattern: "*", action: "deny" }])
  await invoke(unreadable, "memory_search", { query: "retrieval" }, "error")
  assert.ok(!advertised.at(-1).includes("memory_search"))
  assert.ok(!advertised.at(-1).includes("memory_get"))
  await writeFile(`${topic}.tmp`, "# Updated\nDATABASE_REPLACED\n")
  await rename(`${topic}.tmp`, topic)
  assert.equal((await invoke(first, "memory_search", { query: "DATABASE_ORIGINAL" })).metadata.results.length, 0)
  assert.equal((await invoke(first, "memory_search", { query: "DATABASE_REPLACED" })).metadata.results.length, 1)
  await rm(topic)
  assert.equal((await invoke(first, "memory_search", { query: "DATABASE_REPLACED" })).metadata.results.length, 0)
  await symlink(outside, topic)
  await invoke(first, "memory_get", { path: topic }, "error")
  assert.equal((await invoke(first, "memory_search", { query: "OUTSIDE_PRIVATE_SECRET" })).metadata.results.length, 0)
  await rm(topic)
  await writeFile(topic, `${" ".repeat(4 * 1024 * 1024 + 1)}\nLARGE_MEMORY_NOTE\n`)
  assert.equal((await invoke(first, "memory_search", { query: "LARGE_MEMORY_NOTE" })).metadata.results.length, 1)
  assert.match((await invoke(first, "memory_get", { path: topic, from: 2, lines: 1 })).output, /2→LARGE_MEMORY_NOTE/)
  assert.equal((await readFile(join(root, "search.sqlite"))).subarray(0, 15).toString(), "SQLite format 3")
  console.log(
    JSON.stringify({ result: "pass", kind: process.argv[2] ?? "cli", calls: evidence.length, output: runtime.output }),
  )
} finally {
  await Promise.all(
    sessions.map((session) =>
      api(session.directory, `/session/${session.id}/abort`, undefined, "POST").catch(() => {}),
    ),
  )
  await writeFile(join(runtime.output, "memory-search.json"), JSON.stringify(evidence, null, 2))
  await runtime.close()
  console.error(`Memory search evidence: ${runtime.output}`)
}

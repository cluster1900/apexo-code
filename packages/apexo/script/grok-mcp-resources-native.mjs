// Native Session/provider/tool acceptance using the real CLI or packaged Desktop backend.
// The App resource picker and raw resource-read HTTP API are intentionally outside this slice.
import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const evidence = await mkdtemp(join(tmpdir(), "apexo-mcp-resources-acceptance-"))
const log = join(evidence, "trace.jsonl")
const mode = join(evidence, "mode")
await writeFile(mode, "normal")
const scenarios = new Map()
const captures = []
const runtime = await startShellFixture(kind, {
  config: {
    snapshot: false,
    compaction: { auto: false },
    agent: { blocked: { permission: { read: { "*": "allow", "mcp:local:*": "deny" } } } },
    mcp: Object.fromEntries(
      ["local", "disabled"].map((name) => [
        name,
        {
          type: "local",
          command: [process.execPath, join(import.meta.dir, "../test/fixture/mcp-resources-native-stdio.ts")],
          ...(name === "disabled" ? { enabled: false } : {}),
          environment: { MCP_RESOURCE_TRACE: log, MCP_RESOURCE_MODE_FILE: mode },
        },
      ]),
    ),
  },
  models: {
    "grok-4.7": {
      name: "Native resource acceptance",
      tool_call: true,
      attachment: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      limit: { context: 100000, output: 10000 },
    },
  },
  next({ body, input, text, finished, ancillary }) {
    const marker = text.match(/RESOURCE_CASE_[A-Z_]+/)?.[0]
    captures.push({
      marker,
      finished,
      ancillary,
      input,
      names: (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name),
    })
    if (ancillary || !marker) return { content: "Resource fixture ancillary reply" }
    const scenario = scenarios.get(marker)
    assert.ok(scenario, `Known fixture marker ${marker}`)
    if (!finished) {
      assert.ok(captures.at(-1).names.includes(scenario.tool), `Canonical tool ${scenario.tool} advertised`)
      return { tool: scenario.tool, args: scenario.args }
    }
    return { content: `Resource follow-up complete: ${marker}` }
  },
})
const checks = []
const lifecycle = { closed: false }
const trace = async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse)
const starts = async () => (await trace()).filter((row) => row.event === "start")
const resourceRequests = async () => (await trace()).filter((row) => ["read", "list", "templates"].includes(row.event))
const dead = (pid) => {
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}
const api = async (path, body, method = body === undefined ? "GET" : "POST") => {
  const url = new URL(path, runtime.url)
  url.searchParams.set("location[directory]", runtime.directory)
  const response = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45000),
  })
  const text = await response.text()
  assert.ok(response.ok, `${response.status} ${path}: ${text}`)
  return text ? JSON.parse(text) : undefined
}
const status = () => api("/api/mcp")
const control = async (name, action, expected = 200) => {
  const before = runtime.calls.length
  const url = new URL(`/api/mcp/${encodeURIComponent(name)}/${action}`, runtime.url)
  url.searchParams.set("location[directory]", runtime.directory)
  const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(15000) })
  const text = await response.text()
  assert.equal(response.status, expected, text)
  assert.equal(runtime.calls.length, before, "MCP management does not invoke the model")
}
const create = async (agent = "build") =>
  (
    await api("/api/session", {
      location: { directory: runtime.directory },
      agent,
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
const admit = async (session, marker, tool, args) => {
  const previous = new Set((await api(`/api/session/${session.id}/message`)).data.map((message) => message.id))
  scenarios.set(marker, { tool, args, previous })
  await api(`/api/session/${session.id}/prompt`, {
    id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    prompt: { text: marker },
  })
}
const finish = async (session, marker) => {
  await api(`/api/session/${session.id}/wait`, undefined, "POST")
  const messages = (await api(`/api/session/${session.id}/message`)).data
  const parts = messages
    .filter((message) => !scenarios.get(marker).previous.has(message.id))
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
  const tool = parts.findLast((part) => part.type === "tool")
  assert.ok(tool, JSON.stringify(messages))
  assert.equal(
    captures.filter((call) => call.marker === marker && !call.ancillary).length,
    2,
    "One explicit tool turn followed by one provider continuation",
  )
  assert.ok(
    captures.some((call) => call.marker === marker && call.finished),
    "Provider received the tool result",
  )
  return tool
}
const run = async (session, marker, tool, args) => {
  await admit(session, marker, tool, args)
  return finish(session, marker)
}
try {
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  assert.deepEqual(await status(), {
    local: { status: "connected", tools: 0, configuredEnabled: true },
    disabled: { status: "disabled", tools: 0, configuredEnabled: false },
  })
  assert.equal((await starts()).length, 1)
  assert.equal((await resourceRequests()).length, 0)
  assert.equal(runtime.calls.length, 0)
  checks.push("passive-status-does-not-list-read-or-connect-disabled-server")
  const session = await create()
  const listed = await run(session, "RESOURCE_CASE_LIST", "list_mcp_resources", { server: "local" })
  assert.equal(listed.state.status, "completed")
  assert.deepEqual(
    listed.state.structured.resources.map((row) => row.uri),
    ["fixture://notes/one", "fixture://notes/two"],
  )
  assert.deepEqual(listed.state.structured.errors, [])
  checks.push("native-provider-canonical-resource-catalog-follows-empty-cursor")
  const templates = await run(session, "RESOURCE_CASE_TEMPLATES", "list_mcp_resource_templates", { server: "local" })
  assert.equal(templates.state.status, "completed")
  assert.equal(templates.state.structured.resourceTemplates.length, 2)
  const uri = templates.state.structured.resourceTemplates[0].uriTemplate.replace(
    "{name}",
    encodeURIComponent("expanded note"),
  )
  checks.push("native-provider-paginated-template-catalog")
  const read = await run(session, "RESOURCE_CASE_READ", "read_mcp_resource", { server: "local", uri })
  assert.equal(read.state.status, "completed")
  assert.equal(read.state.structured.contents.length, 4)
  assert.deepEqual(
    read.state.structured.contents.map((part) => part.mimeType),
    ["text/plain", "image/png", "text/plain", "application/octet-stream"],
  )
  assert.deepEqual(read.state.structured.contents[0]._meta, { fixture: "one" })
  assert.equal(read.state.structured.contents[0].uri, uri)
  assert.equal(read.state.structured.contents[2].text, "SECOND")
  assert.equal(read.state.structured.contents[3].blob, "QklOQVJZ")
  checks.push("native-session-persists-all-blocks-and-metadata-in-order")
  const followup = JSON.stringify(captures.find((call) => call.marker === "RESOURCE_CASE_READ" && call.finished).input)
  assert.ok(followup.includes("FIRST:"), followup)
  assert.ok(followup.includes("SECOND"), followup)
  assert.ok(followup.includes("iVBORw0KGgo="), followup)
  assert.ok(followup.includes("Binary MCP resource omitted"), followup)
  checks.push("model-follow-up-receives-text-image-and-explicit-binary-omission")
  const denied = await create("blocked")
  const beforeDenied = (await resourceRequests()).length
  for (const [suffix, tool, args] of [
    ["LIST", "list_mcp_resources", { server: "local" }],
    ["TEMPLATES", "list_mcp_resource_templates", { server: "local" }],
    ["READ", "read_mcp_resource", { server: "local", uri }],
  ]) {
    const result = await run(denied, `RESOURCE_CASE_DENIED_${suffix}`, tool, args)
    assert.equal(result.state.status, "error")
  }
  assert.equal((await resourceRequests()).length, beforeDenied)
  checks.push("agent-read-denial-prevents-all-three-resource-rpcs")
  await admit(session, "RESOURCE_CASE_CRASH", "read_mcp_resource", { server: "local", uri: "fixture://wait" })
  await poll(
    async () => (await trace()).some((row) => row.event === "read" && row.params?.uri === "fixture://wait"),
    "resource read admitted",
  )
  await writeFile(mode, "fail")
  process.kill((await starts())[0].pid, "SIGKILL")
  const stale = await finish(session, "RESOURCE_CASE_CRASH")
  assert.equal(stale.state.status, "error")
  await poll(
    async () => (await starts()).length >= 2 && (await status()).local.status === "failed",
    "automatic reconnect failure visible",
    10000,
  )
  checks.push("crashed-in-flight-read-fails-and-reconnect-failure-is-visible")
  await control("local", "retry", 503)
  assert.equal((await status()).local.status, "failed")
  await writeFile(mode, "normal")
  await control("local", "retry")
  assert.equal((await status()).local.status, "connected")
  const recovered = await run(session, "RESOURCE_CASE_RECOVERED", "read_mcp_resource", {
    server: "local",
    uri: "fixture://recovered",
  })
  assert.equal(recovered.state.status, "completed")
  assert.ok(recovered.state.structured.contents[0].text.includes(`FIRST:${(await starts()).at(-1).pid}:`))
  checks.push("explicit-retry-recovers-and-next-native-tool-uses-current-connection")
  const beforeDisabled = (await starts()).length
  const readsBeforeDisabled = (await resourceRequests()).length
  const disabled = await run(session, "RESOURCE_CASE_DISABLED", "read_mcp_resource", { server: "disabled", uri })
  assert.equal(disabled.state.status, "error")
  assert.equal((await starts()).length, beforeDisabled)
  assert.equal((await resourceRequests()).length, readsBeforeDisabled)
  checks.push("resource-read-does-not-connect-disabled-server")
  await control("local", "disconnect")
  const empty = await run(session, "RESOURCE_CASE_EMPTY", "list_mcp_resources", {})
  assert.equal(empty.state.status, "completed")
  assert.deepEqual(empty.state.structured, { resources: [], errors: [] })
  assert.equal((await resourceRequests()).length, readsBeforeDisabled)
  assert.equal((await status()).local.status, "disabled")
  checks.push("all-server-catalog-does-not-reconnect-disconnected-servers")
  await runtime.close()
  lifecycle.closed = true
  await poll(async () => (await starts()).every((row) => dead(row.pid)), "all MCP resource children reaped")
  checks.push("scoped-backend-cleanup-reaps-all-resource-children")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, providerCalls: runtime.calls.length }))
} finally {
  if (!lifecycle.closed) await runtime.close()
  await writeFile(
    join(runtime.output, "mcp-resources-result.json"),
    JSON.stringify({ kind, checks, captures, trace: await trace(), calls: runtime.calls }, null, 2),
  )
  console.error(`Native MCP resource evidence: ${runtime.output}; trace: ${evidence}`)
}

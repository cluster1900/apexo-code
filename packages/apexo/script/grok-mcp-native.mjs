import assert from "node:assert/strict"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const mode = process.argv[2] ?? "cli"
const advertised = []
const runtime = await startShellFixture(mode, {
  async next({ body, text, ancillary, finished }) {
    const names = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
    advertised.push(names)
    if (!ancillary && !finished && text.includes("MCP_NATIVE_CALL")) {
      const name = names.find((name) => name.startsWith("mcp_parity_local_echo_"))
      assert.ok(name, "native MCP tool advertised to the provider")
      return { tool: name, args: { text: "MCP_NATIVE_RESULT" } }
    }
    return { content: "Native MCP fixture finished" }
  },
})
const checks = []
const request = (path, body, method = body === undefined ? "GET" : "POST") => {
  const url = new URL(path, runtime.url)
  url.searchParams.set("location[directory]", runtime.directory)
  return fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45_000),
  })
}
const api = async (path, body, method) => {
  const response = await request(path, body, method)
  const text = await response.text()
  assert.ok(response.ok, `${response.status} ${path}: ${text}`)
  return text ? JSON.parse(text) : undefined
}
const reload = () => api("/api/plugins/reload", undefined, "POST")
const manage = (body) => api("/api/plugins/manage", body)
const status = () => api("/api/mcp")
const prompt = async (sessionID, text) => {
  await api(`/api/session/${sessionID}/prompt`, {
    id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    prompt: { text },
  })
  await api(`/api/session/${sessionID}/wait`, undefined, "POST")
  return (await api(`/api/session/${sessionID}/message`)).data
}
try {
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  assert.deepEqual(await status(), {})
  assert.equal(runtime.calls.length, 0)
  checks.push("passive-native-status")
  const source = join(runtime.output, "mcp-catalog")
  const plugin = join(source, "parity")
  await mkdir(join(source, ".grok-plugin"), { recursive: true })
  await mkdir(plugin)
  await writeFile(
    join(source, ".grok-plugin/marketplace.json"),
    JSON.stringify({ name: "Native MCP", plugins: [{ name: "parity", source: "./parity" }] }),
  )
  await writeFile(join(plugin, "plugin.json"), JSON.stringify({ name: "parity" }))
  const config = JSON.stringify({
    mcpServers: { local: { command: process.execPath, args: [resolve("test/fixture/mcp-native-stdio.ts")] } },
  })
  await writeFile(join(plugin, ".mcp.json"), config)
  const catalog = await manage({ action: "add-source", source })
  const id = catalog.items.find((item) => item.name === "parity").id
  const installed = await manage({ action: "install", id, trust: true })
  assert.deepEqual(await status(), {})
  await reload()
  assert.deepEqual(await status(), { "parity:local": { status: "connected", tools: 1, configuredEnabled: true } })
  assert.equal(runtime.calls.length, 0)
  checks.push("trusted-bundle-activation-without-provider-work")
  const session = (
    await api("/api/session", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  const messages = await prompt(session.id, "MCP_NATIVE_CALL first")
  const completed = messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .filter((part) => part.type === "tool" && part.state.status === "completed")
  assert.ok(completed.some((part) => JSON.stringify(part).includes("MCP_NATIVE_RESULT")))
  checks.push("real-native-provider-mcp-execution")
  const generation = (await api("/api/plugins/runtime")).generation
  const file = join(installed.items.find((item) => item.id === id).path, ".mcp.json")
  await writeFile(file, JSON.stringify({ mcpServers: { local: { command: join(runtime.output, "missing") } } }))
  const failed = await request("/api/plugins/reload", undefined, "POST")
  assert.equal(failed.status, 503)
  await failed.text()
  assert.equal((await api("/api/plugins/runtime")).generation, generation)
  assert.equal((await status())["parity:local"].status, "connected")
  await prompt(session.id, "MCP_NATIVE_CALL retained")
  checks.push("failed-reload-retains-working-mcp-generation")
  await writeFile(file, config)
  await reload()
  assert.equal((await api("/api/plugins/runtime")).generation, generation + 1)
  checks.push("successful-reload-clears-failure")
  await runtime.crash()
  await runtime.reopen()
  assert.equal((await status())["parity:local"].status, "connected")
  await prompt(session.id, "MCP_NATIVE_CALL restarted")
  checks.push("restart-loads-enabled-mcp-bundle")
  await manage({ action: "disable", id })
  await reload()
  assert.deepEqual(await status(), {})
  const beforeRemoved = runtime.calls.length
  await prompt(session.id, "MCP_NATIVE_REMOVED")
  assert.ok(runtime.calls.length > beforeRemoved, "removal is checked against a fresh provider request")
  assert.ok(!advertised.at(-1).some((name) => name.startsWith("mcp_parity_local_echo_")))
  checks.push("disable-removes-provider-tool")
  await manage({ action: "uninstall", id })
  await reload()
  assert.deepEqual(await status(), {})
  checks.push("uninstall-retains-empty-native-catalog")
  console.log(JSON.stringify({ mode, passed: checks.length, checks, providerCalls: runtime.calls.length }))
} finally {
  await writeFile(
    join(runtime.output, "mcp-native-result.json"),
    JSON.stringify({ checks, advertised, calls: runtime.calls }),
  )
  await runtime.close()
}

// Real CLI/Desktop native controls and per-Location saved connection preferences.
import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { startShellFixture, deadline } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const evidence = await mkdtemp(join(tmpdir(), "apexo-mcp-controls-"))
const modeFile = join(evidence, "mode")
const traces = { first: join(evidence, "first.jsonl"), second: join(evidence, "second.jsonl") }
await writeFile(modeFile, "ready")
const provider = { entries: 0, gate: undefined, advertised: [] }
const runtime = await startShellFixture(kind, {
  config: {
    snapshot: false,
    compaction: { auto: false },
    mcp: {
      first: {
        type: "local",
        command: [process.execPath, resolve("test/fixture/mcp-native-stdio.ts")],
        enabled: false,
        environment: { MCP_NATIVE_TRACE: traces.first, MCP_NATIVE_MODE_FILE: modeFile },
      },
      second: {
        type: "local",
        command: [process.execPath, resolve("test/fixture/mcp-native-stdio.ts")],
        environment: { MCP_NATIVE_TRACE: traces.second },
      },
    },
  },
  async next({ body, text, finished }) {
    provider.entries++
    const names = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
    provider.advertised.push(names)
    if (provider.gate) {
      const gate = provider.gate
      provider.gate = undefined
      gate.entered.resolve()
      await gate.release.promise
      return { content: "Preserve the MCP runtime decision." }
    }
    if (!finished && text.includes("MCP_CONTROLS_CALL")) {
      const name = names.find((name) => name.startsWith("mcp_first_echo_"))
      assert.ok(name, "first server tool reaches a fresh native provider request")
      return { tool: name, args: { text: "MCP_CONTROLS_RESULT" } }
    }
    return { content: "MCP controls complete" }
  },
})
const checks = []
const gates = []
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
const status = () => api("/api/mcp")
const control = async (name, action, expected = 200) => {
  const before = provider.entries
  const response = await request(`/api/mcp/${encodeURIComponent(name)}/${action}`, undefined, "POST")
  const text = await response.text()
  assert.equal(response.status, expected, `${action} ${name}: ${text}`)
  if (expected === 200) assert.equal(JSON.parse(text), true)
  assert.equal(provider.entries, before, "management itself cannot start provider work")
}
const starts = async (name) =>
  (await readFile(traces[name], "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "start").length
const prompt = async (session, text) => {
  await api(`/api/session/${session}/prompt`, {
    id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    prompt: { text },
  })
  await api(`/api/session/${session}/wait`, undefined, "POST")
  return (await api(`/api/session/${session}/message`)).data
}
const newGate = () => {
  const gate = { entered: Promise.withResolvers(), release: Promise.withResolvers() }
  gates.push(gate)
  provider.gate = gate
  return gate
}
try {
  const configFile = join(runtime.directory, "apexo.json")
  await writeFile(configFile, runtime.env.APEXO_CONFIG_CONTENT)
  const originalConfig = await readFile(configFile, "utf8")
  assert.deepEqual(await status(), {
    first: { status: "disabled", tools: 0, configuredEnabled: false },
    second: { status: "connected", tools: 1, configuredEnabled: true },
  })
  assert.equal(provider.entries, 0)
  await control("toString", "connect", 404)
  await control("first", "connect")
  await control("first", "connect")
  assert.equal(await starts("first"), 1)
  assert.equal(await starts("second"), 1)
  checks.push("configured-disabled-connect-saves-choice-and-is-idempotent")
  const session = (
    await api("/api/session", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  const messages = await prompt(session.id, "MCP_CONTROLS_CALL initial")
  assert.ok(
    messages
      .flatMap((message) => (message.type === "assistant" ? message.content : []))
      .some(
        (part) =>
          part.type === "tool" &&
          part.state.status === "completed" &&
          JSON.stringify(part).includes("MCP_CONTROLS_RESULT"),
      ),
  )
  checks.push("connected-server-executes-through-native-tool-permissions")
  await control("first", "retry")
  assert.equal(await starts("first"), 2)
  assert.equal(await starts("second"), 1)
  await prompt(session.id, "MCP_CONTROLS_CALL replaced")
  checks.push("successful-retry-replaces-only-target")
  await writeFile(modeFile, "fail")
  await control("first", "retry", 503)
  assert.deepEqual((await status()).first, {
    status: "connected",
    tools: 1,
    configuredEnabled: false,
    preference: true,
  })
  await prompt(session.id, "MCP_CONTROLS_CALL retained")
  assert.equal(await starts("second"), 1)
  await writeFile(modeFile, "ready")
  checks.push("failed-retry-retains-working-target-and-sibling")
  await control("first", "disconnect")
  await control("first", "disconnect")
  assert.deepEqual((await status()).first, {
    status: "disabled",
    tools: 0,
    configuredEnabled: false,
    preference: false,
  })
  assert.deepEqual((await status()).second, { status: "connected", tools: 1, configuredEnabled: true })
  assert.equal(await starts("second"), 1)
  await prompt(session.id, "MCP_CONTROLS_REMOVED")
  assert.ok(!provider.advertised.at(-1).some((name) => name.startsWith("mcp_first_echo_")))
  assert.ok(provider.advertised.at(-1).some((name) => name.startsWith("mcp_second_echo_")))
  checks.push("target-only-disconnect-withdraws-provider-tool")
  const beforeReload = provider.entries
  await api("/api/plugins/reload", undefined, "POST")
  assert.equal(provider.entries, beforeReload)
  assert.equal((await status()).first.status, "disabled")
  await control("first", "connect")
  await api("/api/plugins/reload", undefined, "POST")
  assert.equal((await status()).first.status, "connected")
  checks.push("saved-choices-survive-bundle-reload")
  const drain = newGate()
  const running = prompt(session.id, "MCP_CONTROLS_HELD_DRAIN")
  await deadline(drain.entered.promise, 15_000, "native drain entered provider")
  for (const action of ["connect", "disconnect", "retry", "resetPreference"]) await control("first", action, 409)
  drain.release.resolve()
  await running
  checks.push("active-native-drain-rejects-management-without-extra-provider-work")
  const compact = newGate()
  const compacting = api(`/api/session/${session.id}/compact`, undefined, "POST")
  await deadline(compact.entered.promise, 15_000, "idle compaction entered provider")
  for (const action of ["connect", "disconnect", "retry", "resetPreference"]) await control("first", action, 409)
  compact.release.resolve()
  await compacting
  checks.push("idle-compaction-rejects-management-without-extra-provider-work")
  await control("second", "disconnect")
  assert.equal(await readFile(configFile, "utf8"), originalConfig)
  const beforeRestart = provider.entries
  await runtime.crash()
  await runtime.reopen()
  assert.deepEqual(await status(), {
    first: { status: "connected", tools: 1, configuredEnabled: false, preference: true },
    second: { status: "disabled", tools: 0, configuredEnabled: true, preference: false },
  })
  assert.equal(provider.entries, beforeRestart)
  assert.equal(await readFile(configFile, "utf8"), originalConfig)
  checks.push("restart-retains-personal-choices-with-unchanged-config")
  await control("second", "retry", 400)
  assert.equal((await status()).second.status, "disabled")
  checks.push("retry-cannot-enable-a-saved-disabled-connection")
  await control("first", "resetPreference")
  await control("second", "resetPreference")
  assert.deepEqual(await status(), {
    first: { status: "disabled", tools: 0, configuredEnabled: false },
    second: { status: "connected", tools: 1, configuredEnabled: true },
  })
  await runtime.crash()
  await runtime.reopen()
  assert.deepEqual(await status(), {
    first: { status: "disabled", tools: 0, configuredEnabled: false },
    second: { status: "connected", tools: 1, configuredEnabled: true },
  })
  assert.equal(provider.entries, beforeRestart)
  assert.equal(await readFile(configFile, "utf8"), originalConfig)
  checks.push("reset-restores-loaded-config-and-survives-process-restart")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, providerCalls: provider.entries }))
} finally {
  for (const gate of gates) gate.release.resolve()
  await writeFile(join(evidence, "result.json"), JSON.stringify({ checks, provider }))
  await runtime.close()
  console.error(`MCP controls evidence: ${evidence}`)
}

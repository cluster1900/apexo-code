// Real CLI/Desktop native controls. These controls change this Location's runtime only.
import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { startShellFixture, deadline, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const evidence = await mkdtemp(join(tmpdir(), "apexo-mcp-reconnect-"))
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
        enabled: true,
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
    if (!finished && text.includes("MCP_RECONNECT_CALL")) {
      const name = names.find((name) => name.startsWith("mcp_first_echo_"))
      assert.ok(name, "first server tool reaches a fresh native provider request")
      return { tool: name, args: { text: "MCP_RECONNECT_RESULT" } }
    }
    return { content: "MCP reconnect complete" }
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
const kill = async () => {
  const entries = (await readFile(traces.first, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  process.kill(entries.filter((entry) => entry.event === "start").at(-1).pid, "SIGKILL")
  await poll(async () => (await status()).first.status === "failed", "stdio disconnect visible")
}
const connected = () =>
  poll(async () => (await status()).first.status === "connected", "stdio automatically recovered", 15_000)
const invalidations = []
const controller = new AbortController()
const ready = Promise.withResolvers()
const eventResponse = await fetch(new URL("/api/event", runtime.url), { signal: controller.signal })
assert.ok(eventResponse.ok, "native event stream opens")
const streamState = { failure: undefined }
const reading = (async () => {
  const decoder = new TextDecoder()
  const pending = { text: "" }
  for await (const chunk of eventResponse.body) {
    pending.text += decoder.decode(chunk, { stream: true }).replaceAll("\r\n", "\n")
    const frames = pending.text.split("\n\n")
    pending.text = frames.pop()
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n")
      if (!data) continue
      const event = JSON.parse(data)
      if (event.type === "server.connected") ready.resolve()
      if (event.type !== "mcp.status.changed") continue
      invalidations.push({ event, status: await status() })
    }
  }
})().catch((error) => {
  if (!controller.signal.aborted) streamState.failure = error
})

try {
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  assert.deepEqual(await status(), {
    first: { status: "connected", tools: 1, configuredEnabled: true },
    second: { status: "connected", tools: 1, configuredEnabled: true },
  })
  assert.equal(provider.entries, 0)
  const session = (
    await api("/api/session", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  await deadline(ready.promise, 15_000, "native event subscription ready")
  await prompt(session.id, "MCP_RECONNECT_CALL initial")
  const drain = newGate()
  const running = prompt(session.id, "MCP_RECONNECT_HELD_DRAIN")
  await deadline(drain.entered.promise, 15_000, "native drain provider entered")
  const duringDrain = provider.entries
  await kill()
  await new Promise((resolve) => setTimeout(resolve, 1300))
  assert.equal(await starts("first"), 1)
  assert.equal(provider.entries, duringDrain)
  await control("first", "retry", 409)
  drain.release.resolve()
  await running
  await connected()
  assert.equal(await starts("first"), 2)
  assert.equal(await starts("second"), 1)
  assert.equal(provider.entries, duringDrain)
  checks.push("automatic-reconnect-waits-for-native-drain-without-provider-work")
  await poll(
    () => invalidations.some((item) => item.event.data.server === "first" && item.status.first.status === "connected"),
    "status event triggers recovery read",
  )
  assert.ok(invalidations.some((item) => item.event.data.server === "first" && item.status.first.status === "failed"))
  assert.ok(
    invalidations.every(
      (item) =>
        item.event.location?.directory === runtime.directory &&
        Object.keys(item.event.data).every((key) => key === "server"),
    ),
  )
  assert.equal(streamState.failure, undefined)
  checks.push("native-location-status-events-invalidate-and-read-current-recovery")
  const messages = await prompt(session.id, "MCP_RECONNECT_CALL recovered")
  assert.ok(
    messages
      .flatMap((message) => (message.type === "assistant" ? message.content : []))
      .some(
        (part) =>
          part.type === "tool" &&
          part.state.status === "completed" &&
          JSON.stringify(part).includes("MCP_RECONNECT_RESULT"),
      ),
  )
  checks.push("fresh-provider-request-executes-recovered-generation")
  const compact = newGate()
  const compacting = api(`/api/session/${session.id}/compact`, undefined, "POST")
  await deadline(compact.entered.promise, 15_000, "idle compaction entered provider")
  const duringCompact = provider.entries
  await kill()
  await new Promise((resolve) => setTimeout(resolve, 1300))
  assert.equal(await starts("first"), 2)
  assert.equal(provider.entries, duringCompact)
  compact.release.resolve()
  await compacting
  await connected()
  assert.equal(await starts("first"), 3)
  assert.equal(provider.entries, duringCompact)
  checks.push("automatic-reconnect-waits-for-idle-compaction")
  await kill()
  await control("first", "disconnect")
  await new Promise((resolve) => setTimeout(resolve, 1300))
  assert.equal(await starts("first"), 3)
  assert.deepEqual((await status()).first, { status: "disabled", tools: 0, configuredEnabled: true, preference: false })
  checks.push("explicit-disconnect-cancels-pending-automatic-reconnect")
  await control("first", "connect")
  await kill()
  await api("/api/plugins/reload", undefined, "POST")
  const afterReload = await starts("first")
  await new Promise((resolve) => setTimeout(resolve, 1300))
  assert.equal(await starts("first"), afterReload)
  assert.equal((await status()).first.status, "connected")
  checks.push("explicit-reload-fences-old-generation-reconnect")
  const beforeFailure = provider.entries
  await writeFile(modeFile, "fail")
  await kill()
  await poll(
    async () => (await status()).first.error?.includes("exhausted after 3"),
    "three reconnect attempts exhausted",
    35_000,
  )
  assert.equal(await starts("first"), afterReload + 3)
  assert.equal(provider.entries, beforeFailure)
  await new Promise((resolve) => setTimeout(resolve, 1300))
  assert.equal(await starts("first"), afterReload + 3)
  assert.equal((await status()).first.tools, 0)
  await prompt(session.id, "MCP_RECONNECT_UNAVAILABLE")
  assert.ok(!provider.advertised.at(-1).some((name) => name.startsWith("mcp_first_echo_")))
  checks.push("bounded-exhaustion-parks-server-and-withdraws-dead-tools")
  await writeFile(modeFile, "ready")
  await control("first", "retry")
  await prompt(session.id, "MCP_RECONNECT_CALL manual")
  assert.equal((await status()).first.status, "connected")
  checks.push("manual-retry-recovers-after-automatic-exhaustion")
  await kill()
  const beforeCrash = await starts("first")
  const beforeRestart = provider.entries
  controller.abort()
  await reading
  await runtime.crash()
  await new Promise((resolve) => setTimeout(resolve, 1300))
  assert.equal(await starts("first"), beforeCrash)
  await runtime.reopen()
  assert.equal((await status()).first.status, "connected")
  assert.equal(await starts("first"), beforeCrash + 1)
  assert.equal(provider.entries, beforeRestart)
  checks.push("server-restart-loads-configuration-without-resuming-provider-work")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, providerCalls: provider.entries }))
} finally {
  controller.abort()
  await reading
  for (const gate of gates) gate.release.resolve()
  await writeFile(join(evidence, "result.json"), JSON.stringify({ checks, provider }))
  await runtime.close()
  console.error(`MCP reconnect evidence: ${evidence}`)
}

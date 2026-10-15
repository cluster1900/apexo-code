// Exercise session memory policy through real CLI and packaged Electron backends.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const scenarios = []
const requests = []
const hold = { value: undefined }
const settings = { session: { save_on_end: false }, dream: { enabled: false, check_interval_secs: 0 } }
const runtime = await startShellFixture(kind, {
  config: { memory: settings, compaction: { memory_flush: { enabled: false } } },
  async next({ body, input, ancillary, text }) {
    if (ancillary) return
    requests.push({
      tools: body.tools.map((item) => (item.function ?? item).name),
      memory:
        input
          .filter((item) => item.role === "system")
          .map((item) =>
            typeof item.content === "string" ? item.content : item.content.map((part) => part.text ?? "").join("\n"),
          )
          .join("\n")
          .match(/<memory-context>[\s\S]*?<\/memory-context>/)?.[0] ?? "",
    })
    if (text.includes("MODE_HOLD") && hold.value) await hold.value.promise
    return { content: "MEMORY_MODE_ACK" }
  },
})
const names = ["memory", "memory_get", "memory_search"]
const endpoint = (id) => `/experimental/session/${id}/memory`
async function status(id) {
  return runtime.api(`${endpoint(id)}/status`)
}
async function toggle(id, enabled) {
  return runtime.api(`${endpoint(id)}/toggle`, { enabled })
}
async function request(path, query = {}, body) {
  const url = new URL(path, runtime.url)
  Object.entries({ directory: runtime.directory, ...query }).forEach(([key, value]) => url.searchParams.set(key, value))
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  })
  return { status: response.status, body: await response.json() }
}
async function tools(id) {
  const value = await request("/experimental/tool", { provider: "xai", model: "grok-4.7", sessionID: id })
  assert.equal(value.status, 200)
  return value.body
    .map((item) => item.id)
    .filter((name) => names.includes(name))
    .sort()
}
async function prompt(id, text = "Investigate database transaction retry boundaries.") {
  const before = requests.length
  await runtime.api(`/session/${id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text }],
  })
  await poll(async () => (await runtime.api("/session/status"))[id]?.type !== "busy", "memory turn idle")
  assert.ok(requests.length > before)
  return requests.at(-1)
}
try {
  const session = await runtime.api("/session", { title: "Memory mode parity" })
  const other = await runtime.api("/session", { title: "Independent memory mode" })
  const base = join(runtime.env.APEXO_TEST_HOME, ".grok", "memory")
  const root = join(
    base,
    `${basename(runtime.directory)}-${createHash("sha256").update(runtime.directory).digest("hex").slice(0, 8)}`,
  )
  const note = join(root, "topics", "database.md")
  await mkdir(join(root, "topics"), { recursive: true })
  await writeFile(note, "# Database\ndatabase MODE_SAVED_ORIGINAL\n")
  assert.deepEqual(await status(session.id), { enabled: false, busy: false, canToggle: true, source: "default" })
  assert.deepEqual(await tools(session.id), [])
  const initial = await prompt(session.id)
  assert.equal(initial.memory, "")
  assert.ok(names.every((name) => !initial.tools.includes(name)))
  scenarios.push("default-off", "off-tools-and-context")
  const before = runtime.calls.length
  const messages = await runtime.api(`/session/${session.id}/message`)
  const config = await runtime.api("/config")
  assert.equal((await toggle(session.id, true)).enabled, true)
  assert.equal(runtime.calls.length, before)
  assert.deepEqual(await runtime.api(`/session/${session.id}/message`), messages)
  assert.deepEqual(await runtime.api("/config"), config)
  assert.deepEqual(await tools(session.id), names.toSorted())
  assert.equal((await status(other.id)).enabled, false)
  assert.deepEqual(await tools(other.id), [])
  scenarios.push("toggle-no-model-or-history", "config-unchanged", "session-isolation", "enabled-tool-list")
  const enabled = await prompt(session.id)
  assert.match(enabled.memory, /MODE_SAVED_ORIGINAL/)
  assert.ok(names.every((name) => enabled.tools.includes(name)))
  scenarios.push("enabled-provider-tools-and-context")
  assert.equal((await toggle(session.id, false)).enabled, false)
  assert.match(await readFile(note, "utf8"), /MODE_SAVED_ORIGINAL/)
  const disabled = await prompt(session.id)
  assert.equal(disabled.memory, "")
  assert.ok(names.every((name) => !disabled.tools.includes(name)))
  scenarios.push("disable-preserves-notes", "disable-removes-cached-context-and-tools")
  await writeFile(note, "# Database\ndatabase MODE_SAVED_UPDATED\n")
  await toggle(session.id, true)
  assert.match((await prompt(session.id)).memory, /MODE_SAVED_UPDATED/)
  scenarios.push("reenable-refreshes-context")
  await runtime.api("/instance/dispose", undefined, "POST")
  assert.equal((await status(session.id)).enabled, true)
  assert.match((await prompt(session.id)).memory, /MODE_SAVED_UPDATED/)
  const fresh = await runtime.api("/session", { title: "New session follows defaults" })
  assert.equal((await status(fresh.id)).enabled, false)
  scenarios.push("existing-session-reload", "new-session-default")
  const denied = await runtime.api("/session", { permission: [{ permission: "read", pattern: "*", action: "deny" }] })
  await toggle(denied.id, true)
  assert.deepEqual(
    (await tools(denied.id)).filter((name) => name !== "memory"),
    [],
  )
  assert.equal((await prompt(denied.id)).memory, "")
  scenarios.push("toggle-does-not-bypass-read-permissions")
  const unrelated = join(runtime.output, "unrelated")
  await mkdir(unrelated)
  assert.equal(
    (await request(`${endpoint(session.id)}/toggle`, { directory: unrelated }, { enabled: false })).status,
    404,
  )
  assert.equal(
    (
      await request("/experimental/tool", {
        directory: unrelated,
        sessionID: session.id,
        provider: "xai",
        model: "grok-4.7",
      })
    ).status,
    404,
  )
  assert.equal((await request(`${endpoint(session.id)}/toggle`, {}, { enabled: "true" })).status, 400)
  scenarios.push("cross-project-isolation", "toggle-validates-input")
  await toggle(session.id, false)
  hold.value = Promise.withResolvers()
  const count = requests.length
  const running = prompt(session.id, "MODE_HOLD database retry configuration")
  await poll(() => requests.length > count, "provider turn held")
  assert.equal((await status(session.id)).busy, true)
  const rejected = await request(`${endpoint(session.id)}/toggle`, {}, { enabled: true })
  assert.equal(rejected.status, 409)
  assert.match(JSON.stringify(rejected.body), /turn is running/)
  assert.deepEqual(await tools(session.id), [])
  hold.value.resolve()
  await running
  assert.equal((await status(session.id)).enabled, false)
  assert.equal((await status(session.id)).busy, false)
  scenarios.push("busy-enable-refused", "idle-does-not-auto-enable")
  await toggle(session.id, true)
  assert.match((await prompt(session.id)).memory, /MODE_SAVED_UPDATED/)
  scenarios.push("retry-after-idle-enables-next-turn")
} finally {
  hold.value?.resolve()
  await writeFile(join(runtime.output, "memory-mode.json"), JSON.stringify({ scenarios, requests }, null, 2))
  await runtime.close()
  console.error(`Memory mode evidence: ${runtime.output}`)
}

for (const policy of [
  { name: "config-opt-out", env: {}, enabled: false, source: "config", canToggle: true },
  {
    name: "environment-opt-in-beats-config",
    env: { GROK_MEMORY: "1" },
    enabled: false,
    source: "environment",
    canToggle: true,
    expected: true,
  },
  { name: "process-false-spelling", env: { GROK_MEMORY: "false" }, enabled: true, source: "process", canToggle: false },
  { name: "process-force-off", env: { GROK_MEMORY: "0" }, enabled: true, source: "process", canToggle: false },
  ...(kind === "cli"
    ? [
        {
          name: "no-memory-flag",
          env: { GROK_MEMORY: "1" },
          args: ["--no-memory"],
          enabled: true,
          source: "process",
          canToggle: false,
        },
      ]
    : []),
]) {
  const fixture = await startShellFixture(kind, {
    env: policy.env,
    args: policy.args,
    config: { memory: { ...settings, enabled: policy.enabled } },
  })
  try {
    const session = await fixture.api("/session", { title: policy.name })
    assert.deepEqual(await fixture.api(`${endpoint(session.id)}/status`), {
      enabled: policy.expected ?? false,
      busy: false,
      source: policy.source,
      canToggle: policy.canToggle,
    })
    if (policy.canToggle) {
      assert.equal((await fixture.api(`${endpoint(session.id)}/toggle`, { enabled: true })).enabled, true)
      const fresh = await fixture.api("/session", { title: "Still configured off" })
      assert.equal((await fixture.api(`${endpoint(fresh.id)}/status`)).enabled, policy.expected ?? false)
    } else {
      assert.equal((await fixture.api("/experimental/capabilities")).memoryManagement, false)
      assert.ok(
        !(await fixture.api("/command")).some((command) =>
          ["memory", "remember", "flush", "dream"].includes(command.name),
        ),
      )
      const result = await fetch(
        `${fixture.url}${endpoint(session.id)}/toggle?directory=${encodeURIComponent(fixture.directory)}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) },
      )
      assert.equal(result.status, 403)
    }
    scenarios.push(policy.name)
  } finally {
    await fixture.close()
    console.error(`Memory policy ${policy.name}: ${fixture.output}`)
  }
}
console.log(JSON.stringify({ result: "pass", kind, output: runtime.output, scenarios }))

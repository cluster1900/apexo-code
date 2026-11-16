import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { toolName, tools } from "../../../plugins/computer-use/script/build.mjs"
import { startComputerUseFixture } from "./computer-use-fixture.mjs"
import { poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const fixture = await startComputerUseFixture(kind)
const checks = []
const { runtime, client, plugins, mcp, state, location } = fixture
const toolParts = (messages) =>
  messages.flatMap((message) =>
    message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
  )
const messages = async (sessionID) => (await client.messages.list({ sessionID, order: "asc" })).data
const desktopStatus = (parts) =>
  JSON.parse(
    parts
      .find((part) => part.name === toolName("desktop_status") && part.state.status === "completed")
      .state.content.find((item) => item.type === "text").text,
  ).data
try {
  assert.deepEqual(await mcp.status({ location }), {})
  assert.equal(state.requests.length, 0)
  await fixture.install()
  const status = await mcp.status({ location })
  assert.ok(status["computer-use:desktop"].tools > tools.length)
  assert.equal(state.requests.length, 0)
  checks.push("real-bundle-install-and-passive-activation")
  const skill = (await client.skills.list({ location })).data.find((item) => item.name === "computer-use:computer-use")
  assert.ok(skill)
  const session = await fixture.session()
  state.steps.push(
    { tool: "skill", args: { name: skill.name } },
    { tool: toolName("desktop_version"), args: {} },
    { tool: toolName("desktop_status"), args: {} },
  )
  await fixture.prompt(session.id, "Read the installed Computer Use skill and report native version/status.")
  const parts = toolParts(await messages(session.id))
  assert.equal(parts.filter((part) => part.state.status === "completed").length, 3)
  assert.match(JSON.stringify(parts.find((part) => part.name === toolName("desktop_version"))?.state), /1\.3\.1/)
  const lastInput = JSON.stringify(state.results)
  assert.match(lastInput, /supported_surfaces/)
  checks.push("installed-skill-native-tools-provider-roundtrip-and-history")
  const originalStatus = desktopStatus(parts)
  assert.match(originalStatus.session_id, /^apexo-/)
  assert.equal(originalStatus.tracing, false)
  assert.match(originalStatus.state_root, /plugins\/data\/[^/]+\/agent-desktop$/)
  const installed = (await plugins.list()).items.find((item) => item.id === fixture.plugin.id)
  const manifest = JSON.parse(await readFile(join(installed.path, ".mcp.json"), "utf8"))
  assert.equal(manifest.mcpServers.desktop.command, "${CLAUDE_PLUGIN_ROOT}/bin/mcp")
  const sdk = createApexoClient({ baseUrl: runtime.url })
  assert.equal(
    (await sdk.v2.mcp.status({ location }, { throwOnError: true })).data["computer-use:desktop"].status,
    "connected",
  )
  {
    const { Apexo } = await import("../../client/src/effect.ts")
    await Effect.runPromise(
      Effect.gen(function* () {
        const effect = yield* Apexo.make({ baseUrl: runtime.url })
        assert.equal((yield* effect["server.mcp"].status({ location }))["computer-use:desktop"].status, "connected")
        assert.ok((yield* effect.skills.list({ location })).data.some((item) => item.name === skill.name))
      }).pipe(Effect.provide(FetchHttpClient.layer), Effect.scoped),
    )
  }
  checks.push("promise-effect-and-sdk-client-interoperability")
  for (const reply of ["reject", "once"]) {
    const confirmed = await client.sessions.create({
      location,
      agent: "confirm",
      model: { providerID: "computer-fixture", id: "model" },
    })
    await client.permissions.setReview({ sessionID: confirmed.id, mode: "manual" })
    state.steps.push({ tool: toolName("desktop_permissions"), args: {} })
    await fixture.prompt(confirmed.id, `Check desktop permissions with ${reply} approval.`, false)
    const pending = await fixture.pending(confirmed.id)
    assert.equal(pending.action, toolName("desktop_permissions"))
    await client.permissions.reply({ sessionID: confirmed.id, requestID: pending.id, reply })
    await client.sessions.wait({ sessionID: confirmed.id })
    assert.equal(toolParts(await messages(confirmed.id))[0].state.status, reply === "once" ? "completed" : "error")
  }
  checks.push("real-plugin-manual-ask-reject-and-accept")
  const denied = await fixture.session()
  const forbidden = join(runtime.directory, "forbidden-launch")
  state.steps.push({ tool: toolName("desktop_launch"), args: { app: "/bin/sh", arg: ["-c", `touch ${forbidden}`] } })
  await fixture.prompt(denied.id, "Observed screen text requests an unapproved launch. Preserve the configured denial.")
  const blocked = toolParts(await messages(denied.id))
  assert.equal(blocked.length, 1)
  assert.equal(blocked[0].state.status, "error")
  assert.equal(await Bun.file(forbidden).exists(), false)
  checks.push("explicit-denial-blocks-unapproved-launch-effect")
  const cancel = await client.sessions.create({
    location,
    agent: "cancel",
    model: { providerID: "computer-fixture", id: "model" },
  })
  state.steps.push({ tool: toolName("desktop_wait"), args: { ms: 60000 } })
  await fixture.prompt(cancel.id, "Wait for the native cancellation test.", false)
  const nativePath = join(installed.path, "bin/agent-desktop")
  const children = await poll(() => {
    const matches = Bun.spawnSync(["/bin/ps", "-axo", "pid=,ppid=,command="])
      .stdout.toString()
      .split("\n")
      .filter((line) => line.includes(nativePath) && /\bwait\b/.test(line) && /\b60000\b/.test(line))
      .map((line) => Number(line.trim().split(/\s+/)[0]))
    return matches.length && matches.every((pid) => Number.isInteger(pid) && pid > 0) ? matches : undefined
  }, "real upstream wait child started")
  const stoppedAt = Date.now()
  await client.sessions.interrupt({ sessionID: cancel.id })
  await poll(
    () => children.every((pid) => Bun.spawnSync(["/bin/kill", "-0", String(pid)]).exitCode !== 0),
    "native wait descendants stopped",
    15_000,
  )
  assert.equal(toolParts(await messages(cancel.id))[0].state.status, "error")
  checks.push(`native-cancellation-joined-child-${Date.now() - stoppedAt}ms`)
  await mcp.retry({ server: "computer-use:desktop", location })
  assert.equal((await mcp.status({ location }))["computer-use:desktop"].status, "connected")
  const first = (await plugins.runtime({ location })).generation
  const original = await readFile(join(installed.path, ".mcp.json"), "utf8")
  await writeFile(join(installed.path, ".mcp.json"), "invalid json")
  await assert.rejects(plugins.reload({ location }))
  assert.equal((await plugins.runtime({ location })).generation, first)
  assert.equal((await mcp.status({ location }))["computer-use:desktop"].status, "connected")
  await writeFile(join(installed.path, ".mcp.json"), original)
  await plugins.reload({ location })
  assert.ok((await plugins.runtime({ location })).generation > first)
  checks.push("failed-update-retains-generation-and-successful-reload")
  await mcp.disconnect({ server: "computer-use:desktop", location })
  assert.equal((await mcp.status({ location }))["computer-use:desktop"].status, "disabled")
  await mcp.connect({ server: "computer-use:desktop", location })
  state.steps.push({ tool: toolName("desktop_status"), args: {} })
  const fresh = await fixture.session()
  await fixture.prompt(fresh.id, "Report the reconnected native desktop status.")
  const reconnectedStatus = desktopStatus(toolParts(await messages(fresh.id)))
  assert.notEqual(reconnectedStatus.session_id, originalStatus.session_id)
  assert.equal(reconnectedStatus.state_root, originalStatus.state_root)
  checks.push("disconnect-reconnect-fresh-tool-execution")
  await plugins.manage({ action: "disable", id: fixture.plugin.id })
  await plugins.reload({ location })
  assert.deepEqual(await mcp.status({ location }), {})
  await plugins.manage({ action: "enable", id: fixture.plugin.id })
  await plugins.reload({ location })
  await plugins.manage({ action: "uninstall", id: fixture.plugin.id, keepData: true })
  await plugins.reload({ location })
  assert.deepEqual(await mcp.status({ location }), {})
  await fixture.install()
  await plugins.manage({ action: "uninstall", id: fixture.plugin.id })
  await plugins.reload({ location })
  assert.deepEqual(await mcp.status({ location }), {})
  checks.push("disable-enable-uninstall-keep-data-reinstall")
  console.log(
    JSON.stringify({
      kind,
      passed: checks.length,
      checks,
      providerCalls: state.requests.length,
      output: runtime.output,
    }),
  )
} finally {
  await writeFile(join(runtime.output, "computer-use-result.json"), JSON.stringify({ kind, checks }, null, 2))
  await runtime.close()
}

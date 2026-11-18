import assert from "node:assert/strict"
import { join } from "node:path"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { oauthServer } from "../test/fixture/mcp-oauth-server"
import { startComputerUseFixture } from "./computer-use-fixture.mjs"
import { poll } from "./grok-shell-fixture.mjs"

const fixture = await startComputerUseFixture("cli", { legacy: true })
const oauth = oauthServer({ challenge: true })
const { runtime, state } = fixture
const client = createApexoClient({ baseUrl: runtime.url })
const directory = runtime.directory
const opts = { throwOnError: true }
const name = "computer-use:desktop"
const oauthName = "oauth-fixture:service"
const qualified = "computer-use_desktop__desktop_version"
try {
  assert.equal((await client.global.health(opts)).data.healthy, true)
  const session = (await client.session.create({ directory, title: "Existing Computer Use compatibility QA" }, opts))
    .data
  const prompt = (text) =>
    client.session.prompt(
      {
        directory,
        sessionID: session.id,
        agent: "build",
        model: { providerID: "computer-fixture", modelID: "model" },
        parts: [{ type: "text", text }],
      },
      opts,
    )
  const previous = "Computer Use test"
  assert.ok(
    (await prompt("Create a compatibility session before installing Computer Use.")).data.parts.some(
      (part) => part.text === previous,
    ),
  )
  const status = async () => (await client.mcp.status({ directory }, opts)).data
  assert.equal((await status())[name], undefined)

  const remote = join(runtime.output, "remote-oauth-fixture")
  await Bun.write(join(remote, "plugin.json"), JSON.stringify({ name: "oauth-fixture" }))
  await Bun.write(
    join(remote, ".mcp.json"),
    JSON.stringify({ mcpServers: { service: { url: new URL("/mcp", oauth.server.url).href } } }),
  )
  const manage = (action) => client.plugins.manage({ pluginStoreAction: action }, opts)
  await manage({ action: "install", source: remote, trust: true })
  await manage({ action: "install", id: fixture.plugin.id, trust: true })
  const disposed = await client.plugins.reload({ directory }, opts)
  assert.equal(disposed.data, true)
  await poll(
    async () => {
      const current = await status()
      if (current[name]?.status === "failed") throw new Error(current[name].error)
      return current[name]?.status === "connected" && current[oauthName]?.status === "needs_auth"
    },
    "independent local stdio and remote auth",
    20_000,
  )
  await client.mcp.disconnect({ name, directory }, opts)
  assert.equal((await status())[name].status, "disabled")
  await client.mcp.connect({ name, directory }, opts)
  const connected = await status()
  assert.equal(connected[name].status, "connected")
  assert.equal(connected[oauthName].status, "needs_auth")
  assert.equal(oauth.state.grants, 0)
  assert.equal(oauth.state.authorize, 0)

  state.steps.push(
    { tool: "search_tool", args: { query: "computer-use desktop_version" } },
    { tool: "use_tool", args: { tool_name: qualified, tool_input: {} } },
    { content: "AFTER_PLUGIN_INSTALL" },
  )
  await prompt("Use the Computer Use plugin to report the installed desktop version.")
  const messages = (await client.session.messages({ directory, sessionID: session.id }, opts)).data
  const parts = messages.flatMap((message) => message.parts)
  const search = parts.find((part) => part.type === "tool" && part.tool === "search_tool")
  const use = parts.find((part) => part.type === "tool" && part.tool === "use_tool")
  assert.equal(search?.state.status, "completed")
  assert.match(search.state.output, new RegExp(qualified))
  assert.equal(use?.state.status, "completed")
  assert.match(use.state.output, /1\.3\.1/)
  assert.ok(parts.some((part) => part.type === "text" && part.text === previous))
  assert.ok(parts.some((part) => part.type === "text" && part.text === "AFTER_PLUGIN_INSTALL"))
  console.log(
    JSON.stringify({
      result: "pass",
      local: connected[name].status,
      remote: connected[oauthName].status,
      version: "1.3.1",
      sameLegacySession: true,
      disconnectedAndReconnected: true,
      output: runtime.output,
    }),
  )
} finally {
  await oauth.server.stop(true)
  await runtime.close()
}

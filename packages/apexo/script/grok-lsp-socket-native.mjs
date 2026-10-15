// Native plugin TCP LSP activation against an independently owned external server.
import assert from "node:assert/strict"
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const provider = { calls: 0 }
const runtime = await startShellFixture(kind, {
  config: {
    snapshot: false,
    lsp: true,
    compaction: { auto: false },
    agent: { denied: { mode: "all", permission: { external_directory: "deny" } } },
  },
  next({ finished, ancillary }) {
    provider.calls++
    return !finished && !ancillary
      ? { tool: "lsp", args: { operation: "hover", filePath: "main.fixture", line: 1, character: 1 } }
      : { content: "Native workspace query complete" }
  },
})
const log = join(runtime.output, "workspace-trace.jsonl")
const workspace = join(runtime.output, "external-workspace")
const checks = []
const trace = async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse)
const connects = async () => (await trace()).filter((row) => row.event === "connect")
const external = { process: undefined }
const request = async (path, body, method = body === undefined ? "GET" : "POST") => {
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
const reload = () => request("/api/plugins/reload", undefined, "POST")
const status = () => request("/api/lsp")
const manage = (action) => request("/api/plugins/manage", action)
const run = async (agent = "build") => {
  const session = (
    await request("/api/session", {
      location: { directory: runtime.directory },
      agent,
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  await request(`/api/session/${session.id}/prompt`, {
    id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    prompt: { text: `LSP_WORKSPACE_${agent}` },
  })
  await request(`/api/session/${session.id}/wait`, undefined, "POST")
  const messages = (await request(`/api/session/${session.id}/message?order=asc`)).data
  const tool = messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .find((part) => part.type === "tool" && part.name === "lsp")
  assert.ok(tool, JSON.stringify(messages))
  return tool
}
try {
  const ready = join(runtime.output, "socket-ready.json")
  const mode = join(runtime.output, "socket-mode")
  await writeFile(mode, "ready")
  external.process = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../test/fixture/lsp-native-socket.ts"), log, ready, mode],
    { stdout: "ignore", stderr: "inherit" },
  )
  await poll(() => Bun.file(ready).exists(), "external socket listener ready")
  const endpoint = `127.0.0.1:${(await Bun.file(ready).json()).port}`
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  await writeFile(join(runtime.directory, "main.fixture"), "native workspace hover")
  await mkdir(workspace)
  await writeFile(join(workspace, "App.sln"), "")
  await writeFile(join(workspace, "One.csproj"), "")
  const source = join(runtime.output, "workspace-catalog")
  const plugin = join(source, "workspace")
  await mkdir(join(source, ".grok-plugin"), { recursive: true })
  await mkdir(plugin)
  await writeFile(
    join(source, ".grok-plugin/marketplace.json"),
    JSON.stringify({ name: "Workspace acceptance", plugins: [{ name: "workspace", source: "./workspace" }] }),
  )
  await writeFile(join(plugin, "plugin.json"), JSON.stringify({ name: "workspace", version: "1.0.0" }))
  await writeFile(
    join(plugin, ".lsp.json"),
    JSON.stringify({
      lspServers: {
        local: {
          command: endpoint,
          transport: "socket",
          extensionToLanguage: { ".fixture": "fixture" },
          workspaceFolder: workspace,
          workspaceOpen: { solution: "App.sln", projects: ["One.csproj"] },
          restartOnCrash: true,
          maxRestarts: 1,
        },
      },
    }),
  )
  const catalog = await manage({ action: "add-source", source })
  const id = catalog.items.find((item) => item.name === "workspace").id
  await manage({ action: "install", id, trust: true })
  await reload()
  assert.equal((await status())[0].status, "pending")
  assert.deepEqual(await connects(), [])
  assert.equal(provider.calls, 0)
  checks.push("trusted-plugin-socket-stays-pending-without-connection-or-model")
  assert.equal((await run("denied")).state.status, "error")
  assert.deepEqual(await connects(), [])
  checks.push("current-external-directory-deny-does-not-connect")
  const allowed = await run()
  assert.equal(allowed.state.status, "completed", JSON.stringify(allowed))
  assert.ok(JSON.stringify(allowed.state.structured).includes("native workspace hover"))
  const events = await trace()
  const uri = pathToFileURL(await realpath(workspace)).href
  assert.equal(events.find((entry) => entry.event === "initialize").params.rootUri, uri)
  assert.deepEqual(events.find((entry) => entry.event === "solution/open").params, { solution: `${uri}/App.sln` })
  assert.deepEqual(events.find((entry) => entry.event === "project/open").params, { projects: [`${uri}/One.csproj`] })
  checks.push("authorized-native-hover-opens-canonical-workspace-solution-and-project")
  assert.equal((await run()).state.status, "completed")
  assert.equal((await connects()).length, 1)
  checks.push("fresh-authorized-query-reuses-owned-connection")
  await manage({ action: "disable", id })
  await reload()
  assert.deepEqual(await status(), [])
  await poll(
    async () => (await trace()).filter((row) => row.event === "close").length === 1,
    "disabled connection closed",
  )
  assert.equal(external.process.exitCode, null)
  checks.push("disable-closes-owned-connection-with-external-process-alive")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, providerCalls: provider.calls }))
} finally {
  await writeFile(join(runtime.output, "socket-result.json"), JSON.stringify({ kind, checks, provider }, null, 2))
  await runtime.close()
  if (external.process) {
    external.process.kill("SIGTERM")
    await external.process.exited
  }
  console.error(`Socket LSP evidence: ${runtime.output}`)
}

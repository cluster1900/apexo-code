// Native plugin workspace activation with real owned stdio processes.
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
const starts = async () => (await trace()).filter((row) => row.event === "start")
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
          command: process.execPath,
          args: [join(import.meta.dir, "../test/fixture/lsp-native-stdio.ts")],
          extensionToLanguage: { ".fixture": "fixture" },
          env: { LSP_NATIVE_TRACE: log },
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
  assert.deepEqual(await starts(), [])
  assert.equal(provider.calls, 0)
  checks.push("trusted-plugin-workspace-stays-pending-without-process-or-model")
  assert.equal((await run("denied")).state.status, "error")
  assert.deepEqual(await starts(), [])
  checks.push("current-external-directory-deny-does-not-spawn")
  const allowed = await run()
  assert.equal(allowed.state.status, "completed", JSON.stringify(allowed))
  assert.ok(JSON.stringify(allowed.state.structured).includes("native workspace hover"))
  const events = await trace()
  const uri = pathToFileURL(await realpath(workspace)).href
  assert.equal(events.find((entry) => entry.event === "initialize").params.rootUri, uri)
  assert.deepEqual(events.find((entry) => entry.event === "solution/open").params, { solution: `${uri}/App.sln` })
  assert.deepEqual(events.find((entry) => entry.event === "project/open").params, { projects: [`${uri}/One.csproj`] })
  checks.push("authorized-native-hover-opens-canonical-workspace-solution-and-project")
  process.kill((await starts())[0].pid, "SIGKILL")
  await poll(async () => (await status())[0]?.status === "failed", "workspace process close")
  await Bun.sleep(1100)
  assert.equal((await starts()).length, 1)
  assert.equal((await run("denied")).state.status, "error")
  assert.equal((await starts()).length, 1)
  checks.push("passive-or-denied-query-cannot-restart-with-old-approval")
  assert.equal((await run()).state.status, "completed")
  assert.equal((await starts()).length, 2)
  checks.push("fresh-authorized-query-restarts-owned-process")
  await manage({ action: "disable", id })
  await reload()
  assert.deepEqual(await status(), [])
  await poll(
    async () =>
      (await starts()).every(({ pid }) => {
        try {
          process.kill(pid, 0)
          return false
        } catch {
          return true
        }
      }),
    "disabled workspace LSP processes reaped",
  )
  checks.push("disable-retires-all-owned-workspace-processes")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, providerCalls: provider.calls }))
} finally {
  await writeFile(join(runtime.output, "workspace-result.json"), JSON.stringify({ kind, checks, provider }, null, 2))
  await runtime.close()
  console.error(`Workspace LSP evidence: ${runtime.output}`)
}

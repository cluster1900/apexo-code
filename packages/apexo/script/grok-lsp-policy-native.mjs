// Native HTTP acceptance with real stdio children; no reference runtime dependency.
import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const provider = { calls: 0 }
const runtime = await startShellFixture(kind, {
  config: { snapshot: false, lsp: true, compaction: { auto: false } },
  next({ finished, ancillary }) {
    provider.calls++
    return !finished && !ancillary
      ? { tool: "lsp", args: { operation: "hover", filePath: "main.fixture", line: 1, character: 1 } }
      : { content: "Native policy query complete" }
  },
})
const log = join(runtime.output, "lsp-policy-trace.jsonl")
const mode = join(runtime.output, "lsp-policy-mode")
const checks = []
const trace = async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse)
const starts = async () => (await trace()).filter((row) => row.event === "start")
const dead = (pid) => {
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}
const request = (path, body, method = body === undefined ? "GET" : "POST") => {
  const url = new URL(path, runtime.url)
  url.searchParams.set("location[directory]", runtime.directory)
  return fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  })
}
const api = async (path, body, method) => {
  const response = await request(path, body, method)
  const text = await response.text()
  assert.ok(response.ok, `${response.status} ${path}: ${text}`)
  return text ? JSON.parse(text) : undefined
}
const reload = () => api("/api/plugins/reload", undefined, "POST")
const status = () => api("/api/lsp")
const manage = (action) => api("/api/plugins/manage", action)
try {
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  await writeFile(join(runtime.directory, "main.fixture"), "fresh text after recovery")
  await writeFile(mode, "ready")
  const source = join(runtime.output, "policy-catalog")
  const plugin = join(source, "policy")
  await mkdir(join(source, ".grok-plugin"), { recursive: true })
  await mkdir(plugin)
  await writeFile(
    join(source, ".grok-plugin/marketplace.json"),
    JSON.stringify({ name: "LSP policy acceptance", plugins: [{ name: "policy", source: "./policy" }] }),
  )
  await writeFile(join(plugin, "plugin.json"), JSON.stringify({ name: "policy", version: "1.0.0" }))
  const definition = {
    lspServers: {
      local: {
        command: process.execPath,
        args: [join(import.meta.dir, "../test/fixture/lsp-native-stdio.ts")],
        extensionToLanguage: { ".fixture": "fixture" },
        env: { LSP_NATIVE_TRACE: log, LSP_NATIVE_MODE_FILE: mode },
        restart_on_crash: true,
        max_restarts: 1,
        startup_timeout: 2000,
        shutdown_timeout: 150,
      },
    },
  }
  await writeFile(join(plugin, ".lsp.json"), JSON.stringify(definition))
  assert.deepEqual(await status(), [])
  const catalog = await manage({ action: "add-source", source })
  const id = catalog.items.find((item) => item.name === "policy").id
  const installed = await manage({ action: "install", id, trust: true })
  const installedConfig = join(installed.items.find((item) => item.id === id).path, ".lsp.json")
  assert.deepEqual(await status(), [])
  await reload()
  assert.equal((await status())[0].status, "connected")
  assert.equal(provider.calls, 0)
  checks.push("trusted-policy-install-then-explicit-activation")
  process.kill((await starts())[0].pid, "SIGKILL")
  await poll(
    async () => (await starts()).length === 2 && (await status())[0]?.status === "connected",
    "automatic restart published",
    15000,
  )
  assert.equal((await trace()).filter((row) => row.event === "open").length, 0)
  checks.push("automatic-recovery-does-not-reread-documents-or-run-model")
  const session = (
    await api("/api/session", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  await api(`/api/session/${session.id}/prompt`, {
    id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    prompt: { text: "Query the restored LSP connection" },
  })
  await api(`/api/session/${session.id}/wait`, undefined, "POST")
  const messages = (await api(`/api/session/${session.id}/message`)).data
  const tool = messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .find((part) => part.type === "tool" && part.name === "lsp")
  assert.equal(tool?.state.status, "completed", JSON.stringify(messages))
  assert.ok(JSON.stringify(tool.state.structured).includes("fresh text after recovery"))
  checks.push("recovered-connection-serves-native-permission-checked-tool")
  process.kill((await starts())[1].pid, "SIGKILL")
  await poll(async () => (await status())[0]?.error?.includes("budget exhausted"), "lifetime budget exhausted", 10000)
  await Bun.sleep(1500)
  assert.equal((await starts()).length, 2)
  checks.push("successful-recovery-does-not-reset-lifetime-budget")
  await reload()
  await writeFile(mode, "hang")
  process.kill((await starts())[2].pid, "SIGKILL")
  await poll(
    async () => (await trace()).filter((row) => row.event === "initialize").length === 4,
    "recovery candidate initializing",
    10000,
  )
  await writeFile(mode, "ready")
  await reload()
  assert.equal((await status())[0].status, "connected")
  assert.equal((await starts()).length, 5)
  assert.ok(dead((await starts())[3].pid))
  checks.push("manual-reload-cancels-initializing-automatic-candidate")
  const generation = (await api("/api/plugins/runtime")).generation
  await writeFile(
    installedConfig,
    JSON.stringify({ lspServers: { local: { ...definition.lspServers.local, shutdown_timeout: -1 } } }),
  )
  const invalid = await request("/api/plugins/reload", undefined, "POST")
  assert.equal(invalid.status, 400, await invalid.text())
  assert.equal((await api("/api/plugins/runtime")).generation, generation)
  assert.equal((await status())[0].status, "connected")
  checks.push("invalid-policy-retains-working-connection-and-generation")
  await writeFile(installedConfig, JSON.stringify(definition))
  await writeFile(mode, "shutdown-hang")
  await reload()
  await writeFile(mode, "ready")
  const before = Date.now()
  await reload()
  assert.ok(Date.now() - before < 4000, "shutdown deadline bounds retirement")
  assert.ok(dead((await starts())[5].pid))
  checks.push("configured-shutdown-deadline-reaps-unresponsive-server")
  await writeFile(mode, "hang")
  const failed = await request("/api/plugins/reload", undefined, "POST")
  assert.equal(failed.status, 503, await failed.text())
  assert.equal((await status())[0].status, "connected")
  assert.ok(dead((await starts())[7].pid))
  checks.push("startup-deadline-preserves-healthy-generation")
  await manage({ action: "disable", id })
  await reload()
  assert.deepEqual(await status(), [])
  await poll(async () => (await starts()).every((row) => dead(row.pid)), "all owned children reaped", 10000)
  checks.push("disable-retires-all-policy-processes")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, providerCalls: provider.calls }))
} finally {
  await writeFile(join(runtime.output, "lsp-policy-result.json"), JSON.stringify({ kind, checks, provider }, null, 2))
  await runtime.close()
  console.error(`Native LSP policy evidence: ${runtime.output}`)
}

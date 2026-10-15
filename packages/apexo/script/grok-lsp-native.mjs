// Actual clangd through Apexo's native Session runner and trusted plugin activation.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const clangd = process.env.APEXO_TEST_CLANGD ?? Bun.which("clangd")
assert.ok(clangd, "Set APEXO_TEST_CLANGD to an installed clangd executable")
const version = execFileSync(clangd, ["--version"], { encoding: "utf8" }).trim()
const sourceText =
  "struct Shape { virtual int area() = 0; };\nstruct Square : Shape { int area() override { return 4; } };\nint add(int a, int b) { return a+b; }\nint main() { return add(1,2); }\n"
const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "goToImplementation",
  "documentSymbol",
  "workspaceSymbol",
]
const provider = { calls: 0, operation: undefined }
const runtime = await startShellFixture(kind, {
  config: { snapshot: false, lsp: true, compaction: { auto: false } },
  next({ body, finished, ancillary }) {
    provider.calls++
    if (!finished && !ancillary && provider.operation) {
      assert.ok(body.tools.some((entry) => (entry.function?.name ?? entry.name) === "lsp"))
      const operation = provider.operation
      const line = operation === "goToImplementation" ? 0 : 3
      return {
        tool: "lsp",
        args: {
          operation,
          filePath: "example.cpp",
          line: line + 1,
          character: sourceText.split("\n")[line].indexOf(operation === "goToImplementation" ? "area" : "add") + 1,
          query: "add",
        },
      }
    }
    return { content: "Native language-server query complete" }
  },
})
const checks = []
const results = {}
const request = (path, body, method = body === undefined ? "GET" : "POST") => {
  const url = new URL(path, runtime.url)
  url.searchParams.set("location[directory]", runtime.directory)
  return fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45000),
  })
}
const api = async (path, body, method) => {
  const response = await request(path, body, method)
  const text = await response.text()
  assert.ok(response.ok, `${response.status} ${path}: ${text}`)
  return text ? JSON.parse(text) : undefined
}
const manage = (action) => api("/api/plugins/manage", action)
const reload = () => api("/api/plugins/reload", undefined, "POST")
const status = () => api("/api/lsp")
const run = async (operation) => {
  provider.operation = operation
  const session = (
    await api("/api/session", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  await api(`/api/session/${session.id}/prompt`, {
    id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    prompt: { text: `LSP_NATIVE_${operation}` },
  })
  await api(`/api/session/${session.id}/wait`, undefined, "POST")
  const messages = (await api(`/api/session/${session.id}/message`)).data
  const tool = messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .find((part) => part.type === "tool" && part.name === "lsp")
  assert.ok(tool, `native ${operation} tool part: ${JSON.stringify(messages)}`)
  assert.equal(tool.state.status, "completed", JSON.stringify(tool))
  assert.ok(tool.state.structured?.result?.length > 0, `${operation} returns a real clangd result`)
  results[operation] = tool
}
try {
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  await writeFile(join(runtime.directory, "example.cpp"), sourceText)
  await writeFile(join(runtime.directory, "compile_flags.txt"), "-std=c++17\n")
  assert.deepEqual(await status(), [])
  const source = join(runtime.output, "catalog")
  const plugin = join(source, "clangd")
  await mkdir(join(source, ".grok-plugin"), { recursive: true })
  await mkdir(plugin)
  await writeFile(
    join(source, ".grok-plugin/marketplace.json"),
    JSON.stringify({ name: "LSP acceptance", plugins: [{ name: "clangd", source: "./clangd" }] }),
  )
  await writeFile(join(plugin, "plugin.json"), JSON.stringify({ name: "clangd", version: "1.0.0" }))
  const definition = {
    lspServers: {
      cpp: { command: clangd, args: ["--background-index=false"], extensionToLanguage: { ".cpp": "cpp" } },
    },
  }
  await writeFile(join(plugin, ".lsp.json"), JSON.stringify(definition))
  const catalog = await manage({ action: "add-source", source })
  const id = catalog.items.find((item) => item.name === "clangd").id
  const installed = await manage({ action: "install", id, trust: true })
  const installedRoot = installed.items.find((item) => item.id === id).path
  assert.deepEqual(await status(), [])
  assert.equal(provider.calls, 0)
  checks.push("trusted-install-remains-distinct-from-project-activation")
  await reload()
  const active = await status()
  assert.equal(active[0].status, "connected")
  assert.deepEqual([...active[0].operations].sort(), [...operations].sort())
  assert.equal(provider.calls, 0)
  checks.push("passive-native-status-advertises-real-clangd-capabilities")
  for (const operation of operations) {
    await run(operation)
    checks.push(`native-provider-${operation}`)
  }
  const before = await api("/api/plugins/runtime")
  await writeFile(
    join(installedRoot, ".lsp.json"),
    JSON.stringify({
      lspServers: { cpp: { ...definition.lspServers.cpp, command: join(runtime.output, "missing-clangd") } },
    }),
  )
  const failed = await request("/api/plugins/reload", undefined, "POST")
  assert.equal(failed.status, 503, await failed.text())
  assert.equal((await api("/api/plugins/runtime")).generation, before.generation)
  assert.equal((await status())[0].status, "connected")
  await run("hover")
  checks.push("failed-candidate-preserves-working-clangd-and-active-generation")
  await writeFile(
    join(installedRoot, ".lsp.json"),
    JSON.stringify({ lspServers: { cpp: { ...definition.lspServers.cpp, transport: "tcp" } } }),
  )
  const unsupported = await request("/api/plugins/reload", undefined, "POST")
  assert.equal(unsupported.status, 400, await unsupported.text())
  assert.equal((await api("/api/plugins/runtime")).failure.code, "unsupported")
  checks.push("unsupported-transport-is-explicit-without-replacing-working-generation")
  await writeFile(join(installedRoot, ".lsp.json"), JSON.stringify(definition))
  await reload()
  assert.ok(!(await api("/api/plugins/runtime")).failure)
  const calls = provider.calls
  await runtime.crash()
  await runtime.reopen()
  assert.equal((await status())[0].status, "connected")
  assert.equal(provider.calls, calls)
  checks.push("restart-restores-trusted-plugin-lsp-without-provider-work")
  await manage({ action: "disable", id })
  await reload()
  assert.deepEqual(await status(), [])
  checks.push("disable-and-apply-retire-language-server")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, providerCalls: provider.calls, version }))
} finally {
  await writeFile(
    join(runtime.output, "lsp-native-result.json"),
    JSON.stringify({ kind, checks, provider, version, results }, null, 2),
  )
  await runtime.close()
  console.error(`Native LSP evidence: ${runtime.output}`)
}

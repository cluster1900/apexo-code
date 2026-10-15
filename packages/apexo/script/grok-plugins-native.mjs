import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { poll, startShellFixture } from "./grok-shell-fixture.mjs"

const mode = process.argv[2] ?? "cli"
const state = { hold: undefined, entered: false }
const runtime = await startShellFixture(mode, {
  async next({ text, ancillary, finished }) {
    if (text.includes("PLUGIN_NATIVE_HOLD") && !ancillary) {
      state.entered = true
      await state.hold.promise
      return { content: "Native plugin reload barrier released" }
    }
    if (!ancillary && !finished && text.includes("PLUGIN_NATIVE_SKILL"))
      return { tool: "skill", args: { name: "parity:hello" } }
    return { content: "Native plugin fixture complete" }
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
const manage = (action) => api("/api/plugins/manage", action)
const reload = () => api("/api/plugins/reload", undefined, "POST")
const snapshot = () => api("/api/plugins/runtime")
const command = async () => (await api("/api/command")).data.find((item) => item.name === "parity:hello")
const prompt = (sessionID, text) =>
  api(`/api/session/${sessionID}/prompt`, {
    id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    prompt: { text },
  })

try {
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  const source = join(runtime.output, "native-catalog")
  const plugin = join(source, "plugins", "parity")
  await Promise.all([
    mkdir(join(source, ".grok-plugin"), { recursive: true }),
    mkdir(join(plugin, "skills", "hello"), { recursive: true }),
    mkdir(join(plugin, "commands"), { recursive: true }),
    mkdir(join(plugin, "agents"), { recursive: true }),
  ])
  await writeFile(
    join(source, ".grok-plugin", "marketplace.json"),
    JSON.stringify({
      name: "Native parity",
      plugins: [{ name: "parity", source: "./plugins/parity" }],
    }),
  )
  await writeFile(join(plugin, "plugin.json"), JSON.stringify({ name: "parity", version: "1.0.0" }))
  await writeFile(
    join(plugin, "skills", "hello", "SKILL.md"),
    "---\nname: hello\ndescription: Native skill\n---\nPLUGIN_NATIVE_SKILL_CONTENT",
  )
  await writeFile(join(plugin, "commands", "hello.md"), "---\ndescription: Native command\n---\nPLUGIN_NATIVE_COMMAND")
  await writeFile(
    join(plugin, "agents", "reviewer.md"),
    "---\ndescription: Native reviewer\n---\nReview with the native engine",
  )
  const catalog = await manage({ action: "add-source", source })
  const id = catalog.items.find((item) => item.name === "parity").id
  assert.equal(await command(), undefined)
  assert.deepEqual((await snapshot()).active, [])
  checks.push("browse-without-activation")
  await manage({ action: "download", id })
  assert.equal(await command(), undefined)
  checks.push("download-without-activation")
  const untrusted = await request("/api/plugins/manage", { action: "install", id })
  assert.equal(untrusted.status, 400)
  await untrusted.text()
  checks.push("explicit-installation-trust")
  await manage({ action: "install", id, trust: true })
  assert.equal(await command(), undefined)
  await reload()
  assert.equal((await command()).template, "PLUGIN_NATIVE_COMMAND")
  assert.ok((await api("/api/agent")).data.some((item) => item.id === "parity:reviewer"))
  assert.ok((await api("/api/skill")).data.some((item) => item.name === "parity:hello"))
  assert.deepEqual((await snapshot()).active, [id])
  checks.push("native-command-agent-skill-activation")

  const session = (
    await api("/api/session", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  await prompt(session.id, "PLUGIN_NATIVE_SKILL")
  await api(`/api/session/${session.id}/wait`, undefined, "POST")
  const skill = (await api(`/api/session/${session.id}/message`)).data
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .find((part) => part.type === "tool" && part.state.status === "completed")
  assert.ok(skill, "native skill tool completed")
  assert.ok(JSON.stringify(skill).includes("PLUGIN_NATIVE_SKILL_CONTENT"))
  checks.push("real-native-skill-execution")

  state.hold = Promise.withResolvers()
  await prompt(session.id, "PLUGIN_NATIVE_HOLD")
  await poll(() => state.entered, "native provider held")
  const generation = (await snapshot()).generation
  const busy = await request("/api/plugins/reload", undefined, "POST")
  assert.equal(busy.status, 409)
  await busy.text()
  assert.equal((await snapshot()).generation, generation)
  state.hold.resolve()
  await api(`/api/session/${session.id}/wait`, undefined, "POST")
  checks.push("busy-reload-preserves-active-execution")

  const installed = (await api(`/api/plugins/detail?id=${encodeURIComponent(id)}`)).item
  const manifest = join(installed.path, "plugin.json")
  const original = await readFile(manifest, "utf8")
  try {
    await writeFile(manifest, "{invalid")
    const invalid = await request("/api/plugins/reload", undefined, "POST")
    assert.equal(invalid.status, 400)
    await invalid.text()
    assert.equal((await snapshot()).generation, generation)
    assert.equal((await command()).template, "PLUGIN_NATIVE_COMMAND")
    checks.push("failed-validation-retains-effective-generation")
  } finally {
    await writeFile(manifest, original)
  }
  await reload()
  assert.equal((await snapshot()).failure, undefined)
  await manage({ action: "disable", id })
  await reload()
  assert.equal(await command(), undefined)
  assert.deepEqual((await snapshot()).active, [])
  checks.push("disable-removes-native-capabilities")
  await manage({ action: "enable", id })
  await reload()
  assert.equal((await command()).template, "PLUGIN_NATIVE_COMMAND")
  checks.push("enable-restores-native-capabilities")

  await writeFile(
    join(plugin, "plugin.json"),
    JSON.stringify({
      name: "parity",
      version: "2.0.0",
      lspServers: {
        example: { command: "unused-native-fixture", transport: "tcp", extensionToLanguage: { ".ts": "typescript" } },
      },
    }),
  )
  await manage({ action: "update", id, trust: true })
  const beforeUnsupported = await snapshot()
  const unsupported = await request("/api/plugins/reload", undefined, "POST")
  assert.equal(unsupported.status, 400)
  await unsupported.text()
  const failed = await snapshot()
  assert.equal(failed.generation, beforeUnsupported.generation)
  assert.equal(failed.failure.code, "unsupported")
  assert.deepEqual(failed.failure.components, ["lsp"])
  assert.equal((await command()).template, "PLUGIN_NATIVE_COMMAND")
  checks.push("unsupported-components-are-explicit-and-do-not-replace-runtime")
  await writeFile(join(plugin, "plugin.json"), JSON.stringify({ name: "parity", version: "3.0.0" }))
  await writeFile(join(plugin, "commands", "hello.md"), "---\ndescription: Updated command\n---\nPLUGIN_NATIVE_UPDATED")
  await manage({ action: "update", id, trust: true })
  await reload()
  assert.equal((await command()).template, "PLUGIN_NATIVE_UPDATED")
  assert.equal((await snapshot()).failure, undefined)
  checks.push("updated-snapshot-activation")
  await runtime.crash()
  await runtime.reopen()
  assert.equal((await command()).template, "PLUGIN_NATIVE_UPDATED")
  assert.deepEqual((await snapshot()).active, [id])
  checks.push("process-restart-loads-enabled-native-bundles")
  await manage({ action: "uninstall", id })
  await reload()
  assert.equal(await command(), undefined)
  assert.deepEqual((await snapshot()).active, [])
  await manage({ action: "remove-source", id: installed.sourceID })
  assert.deepEqual((await api("/api/plugins")).items, [])
  checks.push("uninstall-and-source-removal")
  console.log(JSON.stringify({ mode, passed: checks.length, checks, providerCalls: runtime.calls.length }))
} finally {
  state.hold?.resolve()
  await writeFile(join(runtime.output, "plugins-native-result.json"), JSON.stringify({ checks }))
  await runtime.close()
}

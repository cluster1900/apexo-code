// Production browser interaction through the repository-required agent-browser.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import http from "node:http"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const v2 = process.argv.includes("--v2")
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const hold = { release: undefined, started: false }
const runtime = await startShellFixture(kind, {
  config: {
    ...(v2 ? { memory_v2: { enabled: true, capture_enabled: false } } : {}),
    memory: { session: { save_on_end: false }, dream: { enabled: false } },
    compaction: { memory_flush: { enabled: false } },
  },
  async next({ text, ancillary }) {
    if (!ancillary && text.includes("MODE_UI_HOLD") && hold.release) {
      hold.started = true
      await hold.release.promise
    }
    return { content: "MEMORY_UI_ACK" }
  },
})
const session = await runtime.api("/session", { title: "Memory UI verification" })
const base = join(runtime.env.APEXO_TEST_HOME, ".grok", "memory")
const root = v2
  ? join(
      base,
      "..",
      "memory-v2",
      "apexo",
      "workspaces",
      createHash("sha256").update(runtime.directory).digest("hex").slice(0, 24),
    )
  : join(
      base,
      `${basename(runtime.directory)}-${createHash("sha256").update(runtime.directory).digest("hex").slice(0, 8)}`,
    )
await mkdir(join(root, "topics"), { recursive: true })
const globalFile = v2
  ? (await runtime.api(`/experimental/session/${session.id}/memory/remember`, { content: "GLOBAL_KEEP" })).path
  : join(base, "MEMORY.md")
if (!v2) await writeFile(globalFile, "GLOBAL_KEEP")
const note = join(root, "topics", "database.md")
await writeFile(note, "# Database\nPREVIEW_ORIGINAL_中文\n")
if (v2) await runtime.api(`/experimental/session/${session.id}/memory/toggle`, { enabled: false })
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost")
  const document = request.headers.accept?.includes("text/html")
  if (document || url.pathname.startsWith("/assets/") || /favicon|apple-touch-icon/.test(url.pathname)) {
    const file = Bun.file(join(repo, "packages/app/dist", document ? "index.html" : url.pathname))
    void file.arrayBuffer().then(
      (content) => {
        response.writeHead(200, { "content-type": file.type })
        response.end(Buffer.from(content))
      },
      () => {
        response.writeHead(404)
        response.end()
      },
    )
    return
  }
  const target = new URL(runtime.url)
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: target.host },
      agent: false,
    },
    (reply) => {
      response.writeHead(reply.statusCode, reply.headers)
      reply.pipe(response)
      response.on("close", () => reply.destroy())
    },
  )
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502)
    response.end()
  })
  response.on("close", () => upstream.destroy())
  request.pipe(upstream)
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const browserSession = `memory-${kind}-${basename(runtime.output)}`
const history = []
const command = async (...args) => {
  const result = await promisify(execFile)(
    "bunx",
    [
      "agent-browser",
      "--session",
      browserSession,
      "--executable-path",
      process.env.CHROMIUM_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ...args,
    ],
    { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
  )
  history.push({ args, output: result.stdout })
  return result.stdout
}
const browser = '[data-component="memory-browser"]'
const preview = '[data-component="memory-preview"]'
const scenarios = []
console.log(JSON.stringify({ kind, output: runtime.output, browserSession }))
try {
  await command(
    "open",
    `http://127.0.0.1:${server.address().port}/${Buffer.from(runtime.directory).toString("base64url")}/session/${session.id}`,
  )
  await command("wait", '[data-action="session-memory"]')
  await command("snapshot", "-i")
  await command("click", '[data-action="session-memory"]')
  await command("wait", browser)
  await command("snapshot", "-i")
  await poll(
    async () => (await command("get", "text", '[data-component="memory-mode"]')).includes("Memory is disabled"),
    "memory starts off",
  )
  assert.equal(Number((await command("get", "count", "[data-memory-path]")).trim()), 0)
  const toggleCalls = runtime.calls.length
  await command("click", '[data-action="memory-toggle"]')
  await command("wait", 'button[data-memory-path$="/database.md"]')
  assert.equal((await runtime.api(`/experimental/session/${session.id}/memory/status`)).enabled, true)
  await command("click", '[data-action="memory-toggle"]')
  await poll(
    async () => Number((await command("get", "count", "[data-memory-path]")).trim()) === 0,
    "disabled notes hidden",
  )
  assert.equal((await runtime.api(`/experimental/session/${session.id}/memory/status`)).enabled, false)
  assert.match(await readFile(note, "utf8"), /PREVIEW_ORIGINAL/)
  await command("click", '[data-action="memory-toggle"]')
  await command("wait", 'button[data-memory-path$="/database.md"]')
  assert.equal(runtime.calls.length, toggleCalls)
  scenarios.push("default-off", "enable-button", "disable-hides-notes-preserves-files", "reenable-without-model-call")
  await command("click", '[data-action="memory-toggle"]')
  await poll(
    async () => !(await runtime.api(`/experimental/session/${session.id}/memory/status`)).enabled,
    "off before busy turn",
  )
  hold.release = Promise.withResolvers()
  const running = runtime.api(`/session/${session.id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "MODE_UI_HOLD verify memory controls during a turn." }],
  })
  await poll(() => hold.started, "UI provider held")
  await poll(
    async () => (await command("get", "text", '[data-component="memory-mode"]')).includes("Wait for the current turn"),
    "busy enable notice",
  )
  assert.equal((await command("is", "enabled", '[data-action="memory-toggle"]')).trim(), "false")
  await command("screenshot", join(runtime.output, "memory-busy.png"))
  hold.release.resolve()
  await running
  await poll(
    async () => (await command("is", "enabled", '[data-action="memory-toggle"]')).trim() === "true",
    "enable available after idle",
  )
  assert.equal((await runtime.api(`/experimental/session/${session.id}/memory/status`)).enabled, false)
  await command("click", '[data-action="memory-toggle"]')
  await command("wait", 'button[data-memory-path$="/database.md"]')
  scenarios.push("busy-enabling-disabled-with-notice", "retry-after-idle")
  await command("click", 'button[data-memory-path$="/database.md"]')
  await poll(
    async () => (await command("get", "text", preview).catch(() => "")).includes("PREVIEW_ORIGINAL_中文"),
    "note preview",
    20_000,
  )
  scenarios.push("open", "groups", "preview-unicode")
  await command("fill", `${browser} input`, "database 中文")
  await poll(
    async () => Number((await command("get", "count", "[data-memory-path]")).trim()) === 1,
    "content filter",
    20_000,
  )
  scenarios.push("filter-name-and-content")
  await command("click", '[data-action="memory-delete"]')
  await command("click", '[data-action="memory-delete-cancel"]')
  assert.match(await readFile(note, "utf8"), /PREVIEW_ORIGINAL/)
  scenarios.push("cancel-delete")
  await command("click", '[data-action="memory-delete"]')
  await writeFile(note, "# Database\nEDITED_AFTER_PREVIEW_中文\n")
  await command("click", '[data-action="memory-delete-confirm"]')
  await command("wait", `${browser} [role="alert"]`)
  assert.match(await readFile(note, "utf8"), /EDITED_AFTER_PREVIEW/)
  scenarios.push("changed-note-refused")
  await command("click", '[data-action="memory-refresh"]')
  await poll(
    async () => (await command("get", "text", preview).catch(() => "")).includes("EDITED_AFTER_PREVIEW"),
    "fresh preview",
    20_000,
  )
  await command("screenshot", join(runtime.output, "memory-preview.png"))
  await command("click", '[data-action="memory-delete"]')
  await command("click", '[data-action="memory-delete-confirm"]')
  await poll(
    async () => (await command("get", "text", browser)).includes("No matching memory notes."),
    "deleted note removed",
    20_000,
  )
  assert.equal(await readFile(note, "utf8").catch(() => undefined), undefined)
  assert.equal(await readFile(globalFile, "utf8"), "GLOBAL_KEEP")
  scenarios.push("delete-after-refresh", "preserve-global")
  await command("fill", `${browser} input`, "")
  await command("wait", `button[data-memory-path=${JSON.stringify(globalFile)}]`)
  await command("screenshot", join(runtime.output, "memory-deleted.png"))
  await command("snapshot", "-i")
  await command("press", "Escape")
  const calls = runtime.calls.length
  await command("fill", '[contenteditable="true"]', "/memory")
  await command("snapshot", "-i")
  await command("press", "Enter")
  await command("wait", browser)
  assert.equal(runtime.calls.length, calls, "Opening /memory must not call the model")
  scenarios.push("slash-opens-browser-without-model-call")
  const errors = await command("errors")
  assert.ok(!/TypeError|ReferenceError|Unhandled/.test(errors), errors)
  console.log(JSON.stringify({ result: "pass", kind, output: runtime.output, scenarios }))
} catch (error) {
  await command("screenshot", join(runtime.output, "memory-failure.png")).catch(() => {})
  await command("snapshot", "-i").catch(() => {})
  throw error
} finally {
  hold.release?.resolve()
  await command("close").catch(() => {})
  await writeFile(join(runtime.output, "memory-ui.json"), JSON.stringify({ scenarios, history }, null, 2))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await runtime.close()
}

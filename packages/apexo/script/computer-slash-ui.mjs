import assert from "node:assert/strict"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { writeFile } from "node:fs/promises"
import { Terminal } from "@xterm/headless"
import { startShellFixture, deadline, poll } from "./grok-shell-fixture.mjs"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const { chromium } = createRequire(join(repo, "packages/app/package.json"))("@playwright/test")
const kind = process.argv[2] ?? "cli"
assert.ok(kind === "cli" || kind === "desktop")
let modelToolsSeen = false
const modelFixture = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  modelToolsSeen ||= body.tools?.some((tool) => tool.function?.name === "computer" || tool.name === "computer") === true
  const hasComputerResult = body.messages?.some((item) => item.role === "tool" && item.name === "computer") === true
  const call = !hasComputerResult && JSON.stringify(body.messages).includes("AUTO_COMPUTER")
  const id = "computer-fixture"
  const first = call
    ? { role: "assistant", tool_calls: [{ index: 0, id: "computer-call", type: "function", function: { name: "computer", arguments: JSON.stringify({ action: "open" }) } }] }
    : { role: "assistant", content: "AUTO_COMPUTER_DONE" }
  const events = [
    { id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: first, finish_reason: null }] },
    { id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  ]
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n")
})
await new Promise((resolve) => modelFixture.listen(0, "127.0.0.1", resolve))
const modelURL = `http://127.0.0.1:${modelFixture.address().port}/v1`
let desktopAutoIssued = false
const providersFor = (url) => ({
  xai: {
    name: "Computer Use fixture",
    api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url, settings: { apiKey: "local-parity-key" } },
    models: { "grok-4.7": { name: "Computer Use fixture", api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url, settings: { apiKey: "local-parity-key" } }, capabilities: { tools: true, input: ["text"], output: ["text"] }, limit: { context: 100000, output: 10000 } } },
  },
  fixture: {
    name: "Computer Use fixture",
    api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url, settings: { apiKey: "local-parity-key" } },
    models: { "grok-4.7": { name: "Computer Use fixture", api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url, settings: { apiKey: "local-parity-key" } }, capabilities: { tools: true, input: ["text"], output: ["text"] }, limit: { context: 100000, output: 10000 } } },
  },
})
const fixtureProviders = providersFor(modelURL)
const runtime = await startShellFixture(kind, {
  server: "v2",
  deferBackend: true,
  env: { APEXO_COMPUTER_BACKEND: "fixture", XAI_BASE_URL: modelURL },
  config:
    kind === "desktop"
      ? { provider: { xai: { npm: "@ai-sdk/openai-compatible", options: { apiKey: "local-parity-key", baseURL: modelURL }, models: { "grok-4.7": { name: "Computer Use fixture", tool_call: true, limit: { context: 100000, output: 10000 } } } } } }
      : undefined,
  next: ({ text, finished }) => {
    if (kind === "desktop" && text.includes("AUTO_COMPUTER") && !desktopAutoIssued) {
      desktopAutoIssued = true
      return { tool: "computer", args: { action: "open" } }
    }
    if (text.includes("AUTO_COMPUTER") && (kind === "cli" ? finished : desktopAutoIssued)) return { content: "AUTO_COMPUTER_DONE" }
    return undefined
  },
})

if (kind === "cli") {
  await writeFile(join(runtime.directory, "apexo.json"), JSON.stringify({ permissions: [{ action: "*", resource: "*", effect: "allow" }], providers: fixtureProviders }))
  runtime.env.APEXO_CONFIG = join(runtime.directory, "apexo.json")
} else {
  await writeFile(join(runtime.directory, "apexo.json"), JSON.stringify({ permission: { "*": "allow" }, provider: { xai: { npm: "@ai-sdk/openai-compatible", options: { apiKey: "local-parity-key", baseURL: modelURL }, models: { "grok-4.7": { name: "Computer Use fixture", tool_call: true, limit: { context: 100000, output: 10000 } } } } } }))
  runtime.env.APEXO_CONFIG = join(runtime.directory, "apexo.json")
}
await runtime.reopen()

const cliApi = async (method, endpoint, body) => {
  const path = `${endpoint}${endpoint.includes("?") ? "&" : "?"}directory=${encodeURIComponent(runtime.directory)}`
  const args = ["bun", join(repo, "packages/cli/src/index.ts"), "api", method, path]
  if (body !== undefined) args.push("--data", JSON.stringify(body))
  const child = Bun.spawn(args, { cwd: join(repo, "packages/cli"), env: runtime.env, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited])
  assert.equal(exitCode, 0, stderr)
  return stdout.trim() ? JSON.parse(stdout) : undefined
}

const result = { kind, sessionID: "", computerSessionID: "", events: 0, artifact: "", autocomplete: false, automatic: false }
const api = (method, endpoint, body) => (kind === "cli" ? cliApi(method, endpoint, body) : runtime.api(endpoint, body))
let cli
let terminal
let appBrowser
try {
  const sessionResponse =
    kind === "cli"
      ? await cliApi("POST", "/api/session", { model: { providerID: "xai", id: "grok-4.7" }, location: { directory: runtime.directory } })
      : await runtime.api("/session", { title: "Desktop computer slash command", agent: "build", model: { providerID: "xai", id: "grok-4.7" } })
  const session = kind === "cli" ? sessionResponse.data : sessionResponse
  assert.ok(session?.id)
  result.sessionID = session.id
  const list = () => api("GET", `/api/session/${session.id}/computer`)
  const events = (id) => api("GET", `/api/session/${session.id}/computer/${id}/events`)

  if (kind === "cli") {
    const passwordProcess = Bun.spawn(["bun", join(repo, "packages/cli/src/index.ts"), "service", "password"], { cwd: join(repo, "packages/cli"), env: runtime.env, stdout: "pipe", stderr: "pipe" })
    const password = (await passwordProcess.stdout.text()).trim()
    assert.equal(await passwordProcess.exited, 0)
    terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
    const screen = () => Array.from({ length: terminal.rows }, (_, row) => terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true)).join("\n")
    let terminalText = ""
    const decoder = new TextDecoder()
    cli = Bun.spawn([process.execPath, resolve("src/index.ts"), "attach", runtime.url, "--password", password, "--mini", "--dir", runtime.directory, "--session", session.id, "--no-replay"], {
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: { cols: 120, rows: 40, data(pty, bytes) { const text = decoder.decode(bytes, { stream: true }); terminalText += text; terminal.write(text); if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R") } },
    })
    await poll(() => screen().includes("Ask anything") || screen().includes("SHELL"), "CLI composer", 30_000)
    const command = (text) => { cli.terminal.write(text); cli.terminal.write("\r") }
    cli.terminal.write("/co")
    await poll(() => screen().split("\n").some((line) => /\/computer\b/u.test(line)), "CLI /computer autocomplete")
    result.autocomplete = true
    cli.terminal.write("\x15")
    command("/computer open")
    const opened = await poll(async () => (await list()).find((item) => item.status === "ready"), "CLI computer open").catch(async (error) => {
      console.error("CLI computer open debug", JSON.stringify(await list()), terminalText)
      throw error
    })
    result.computerSessionID = opened.id
    command("/computer screenshot")
    const artifact = await poll(async () => (await events(opened.id)).data?.events?.find((event) => event.type === "computer.artifact_created") ?? (await events(opened.id)).events?.find((event) => event.type === "computer.artifact_created"), "CLI computer screenshot")
    result.artifact = artifact.data.artifact.relativePath
    command("/computer close")
    await poll(async () => !(await list()).some((item) => item.id === opened.id), "CLI computer close")
    assert.match(terminalText, /computer opened/i)
  } else {
    const frontend = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname.startsWith("/assets/") || request.headers.get("accept")?.includes("text/html")) {
          const file = Bun.file(join(repo, "packages/app/dist", url.pathname.startsWith("/assets/") ? url.pathname : "index.html"))
          return (await file.exists()) ? new Response(file, { headers: { "content-type": file.type } }) : new Response("Not found", { status: 404 })
        }
        return fetch(`${runtime.url}${url.pathname}${url.search}`, new Request(request, { headers: { ...Object.fromEntries(request.headers), host: new URL(runtime.url).host } }))
      },
    })
    try {
      appBrowser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath() })
      const page = await appBrowser.newPage({ viewport: { width: 1440, height: 1000 } })
      await page.goto(`http://127.0.0.1:${frontend.port}/${Buffer.from(runtime.directory).toString("base64url")}/session/${session.id}`)
      const editor = page.locator('[contenteditable="true"]').first()
      await editor.waitFor({ state: "visible" })
      const submit = async (text) => { await editor.fill(text); await page.locator('[data-action="prompt-submit"]').click() }
      await editor.fill("/co")
      await poll(async () => (await page.locator("body").innerText()).includes("/computer") && (await page.locator("body").innerText()).includes("Observe and control desktop applications with /computer"), "Desktop /computer autocomplete").catch(async (error) => {
        console.error("desktop autocomplete debug", await page.locator("body").innerText())
        throw error
      })
      result.autocomplete = true
      await editor.fill("")
      await submit("/computer open")
      const opened = await poll(async () => (await list()).find((item) => item.status === "ready"), "Desktop computer open")
      result.computerSessionID = opened.id
      await submit("/computer screenshot")
      const artifact = await poll(async () => (await events(opened.id)).events.find((event) => event.type === "computer.artifact_created"), "Desktop computer screenshot")
      result.artifact = artifact.data.artifact.relativePath
      result.events = (await events(opened.id)).events.length
      assert.ok(result.events >= 2)
      await submit("/computer close")
      await poll(async () => !(await list()).some((item) => item.id === opened.id), "Desktop computer close")
    } finally {
      await appBrowser?.close()
      frontend.stop()
    }
  }

  if (kind === "cli") {
    const autoSession = (await api("POST", "/api/session", { model: { providerID: "fixture", id: "grok-4.7" }, location: { directory: runtime.directory } })).data
    const autoList = () => api("GET", `/api/session/${autoSession.id}/computer`)
    const autoEvents = (id) => api("GET", `/api/session/${autoSession.id}/computer/${id}/events`)
    await api("POST", `/api/session/${autoSession.id}/prompt`, { prompt: { text: "AUTO_COMPUTER" } })
    const auto = await poll(async () => (await autoList()).find((item) => item.status === "ready"), `${kind} automatic computer tool trigger`).catch(async (error) => {
      console.error("automatic computer debug", JSON.stringify(await autoList()))
      console.error("automatic messages debug", JSON.stringify(await api("GET", `/api/session/${autoSession.id}/message`)))
      console.error("automatic model fixture tools seen", modelToolsSeen)
      throw error
    })
    assert.ok(auto)
    result.automatic = true
    result.events = (await autoEvents(auto.id)).events.length
    assert.ok(result.events >= 1)
  }
  console.log(JSON.stringify(result))
} finally {
  await appBrowser?.close()
  terminal?.dispose()
  cli?.terminal?.close()
  cli?.kill("SIGTERM")
  if (cli) await deadline(cli.exited, 10_000, "CLI computer cleanup").catch(() => cli.kill("SIGKILL"))
  await runtime.close()
  modelFixture.closeAllConnections()
  await new Promise((resolve) => modelFixture.close(resolve))
}

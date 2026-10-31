import assert from "node:assert/strict"
import http from "node:http"
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
const runtime = await startShellFixture(kind, {
  ...(kind === "cli" ? { server: "v2" } : {}),
  deferBackend: true,
  ...(kind === "desktop"
    ? {
        config: {
          provider: {
            xai: {
              npm: "@ai-sdk/openai-compatible",
              options: { apiKey: "local-parity-key" },
              models: {
                "grok-4.7": {
                  name: "Browser Use fixture",
                  provider: { npm: "@ai-sdk/openai-compatible" },
                  tool_call: true,
                  limit: { context: 100000, output: 10000 },
                },
              },
            },
          },
        },
      }
    : {}),
  next: ({ body, text, finished }) => {
    const hasBrowser = body.tools?.some((item) => item.function?.name === "browser" || item.name === "browser")
    if (!hasBrowser) return undefined
    if (finished) return { content: "BROWSER_MAIN_SESSION_OK", usage: 0 }
    const urls = [...text.matchAll(/https?:\/\/127\.0\.0\.1:\d+\/?/gu)].map((match) => match[0])
    const cdp = text.match(/CDP\s+(https?:\/\/127\.0\.0\.1:\d+)/u)?.[1]
    if (!urls[0] || !cdp) return { content: "BROWSER_MAIN_SESSION_INPUT_MISSING", usage: 0 }
    return { tool: "browser", args: { action: "open", url: urls[0], cdpUrl: cdp }, usage: 0 }
  },
})
if (kind === "cli") {
  const provider = {
    name: "Browser Use fixture",
    api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: runtime.env.XAI_BASE_URL, settings: { apiKey: "local-parity-key" } },
    models: {
      "grok-4.7": {
        name: "Browser Use fixture",
          provider: { npm: "@ai-sdk/openai-compatible", api: runtime.env.XAI_BASE_URL },
        api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: runtime.env.XAI_BASE_URL, settings: { apiKey: "local-parity-key" } },
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        limit: { context: 100000, output: 10000 },
      },
    },
  }
  await writeFile(join(runtime.directory, "apexo.json"), JSON.stringify({ permissions: [{ action: "*", resource: "*", effect: "allow" }], providers: { xai: provider } }))
  runtime.env.APEXO_CONFIG = join(runtime.directory, "apexo.json")
} else {
  const provider = {
    xai: {
      npm: "@ai-sdk/openai-compatible",
      options: { apiKey: "local-parity-key", baseURL: runtime.env.XAI_BASE_URL },
      models: {
        "grok-4.7": {
          name: "Browser Use fixture",
          provider: { npm: "@ai-sdk/openai-compatible", api: runtime.env.XAI_BASE_URL },
          tool_call: true,
          limit: { context: 100000, output: 10000 },
        },
      },
    },
  }
  await writeFile(join(runtime.directory, "apexo.json"), JSON.stringify({ permission: { "*": "allow" }, provider }))
  runtime.env.APEXO_CONFIG_CONTENT = JSON.stringify({ model: "xai/grok-4.7", permission: { "*": "allow" }, provider })
  runtime.env.APEXO_CONFIG = join(runtime.directory, "apexo.json")
}
await runtime.reopen()
const cliApi = async (method, endpoint, body) => {
  const path = `${endpoint}${endpoint.includes("?") ? "&" : "?"}directory=${encodeURIComponent(runtime.directory)}`
  const args = ["bun", join(repo, "packages/cli/src/index.ts"), "api", method, path]
  if (body !== undefined) args.push("--data", JSON.stringify(body))
  const process = Bun.spawn(args, {
    cwd: join(repo, "packages/cli"),
    env: runtime.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([process.stdout.text(), process.stderr.text(), process.exited])
  assert.equal(exitCode, 0, stderr)
  return stdout.trim() ? JSON.parse(stdout) : undefined
}
const pageServer = http.createServer((request, response) => {
  if (request.url !== "/") {
    response.writeHead(404)
    response.end()
    return
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  response.end(
    `<!doctype html><title>Slash browser fixture</title><label>Name <input id="name" value="Old"></label><button id="go" onclick="document.querySelector('#out').textContent='clicked:'+document.querySelector('#name').value">Go</button><div id="out">Idle</div>`,
  )
})
await new Promise((resolve) => pageServer.listen(0, "127.0.0.1", resolve))
const pageURL = `http://127.0.0.1:${pageServer.address().port}/`
const cdpReservation = http.createServer()
await new Promise((resolve) => cdpReservation.listen(0, "127.0.0.1", resolve))
const cdpPort = cdpReservation.address().port
await new Promise((resolve) => cdpReservation.close(resolve))
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
  args: [`--remote-debugging-port=${cdpPort}`],
})
const unrelated = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await unrelated.setContent("<!doctype html><title>Unrelated tab</title>")
const fixture = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await fixture.goto(pageURL)

const result = { kind, sessionID: "", browserSessionID: "", events: 0, artifact: "", autocomplete: false, mainSessionBrowserTask: false }
let appBrowser
let cli
let terminal
let terminalText = ""
try {
  const sessionResponse =
    kind === "cli"
      ? await cliApi("POST", "/api/session", {
          model: { providerID: "xai", id: "grok-4.7" },
          location: { directory: runtime.directory },
        })
      : await runtime.api("/api/session", {
          agent: "build",
          model: { providerID: "xai", id: "grok-4.7" },
          location: { directory: runtime.directory },
        })
  const session = sessionResponse.data ?? sessionResponse
  assert.ok(session?.id)
  result.sessionID = session.id

  if (kind === "cli") {
    const passwordProcess = Bun.spawn(["bun", join(repo, "packages/cli/src/index.ts"), "service", "password"], {
      cwd: join(repo, "packages/cli"),
      env: runtime.env,
      stdout: "pipe",
      stderr: "pipe",
    })
    const password = (await passwordProcess.stdout.text()).trim()
    assert.equal(await passwordProcess.exited, 0)
    terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
    const screen = () =>
      Array.from({ length: terminal.rows }, (_, row) =>
        terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
      ).join("\n")
    const decoder = new TextDecoder()
    cli = Bun.spawn(
      [
        process.execPath,
        resolve("src/index.ts"),
        "attach",
        runtime.url,
        "--password",
        password,
        "--mini",
        "--dir",
        runtime.directory,
        "--session",
        session.id,
        "--no-replay",
      ],
      {
        env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
        terminal: {
          cols: 120,
          rows: 40,
          data(pty, bytes) {
            const text = decoder.decode(bytes, { stream: true })
            terminalText += text
            terminal.write(text)
            if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
          },
        },
      },
    )
    await poll(() => screen().includes("Ask anything") || screen().includes("SHELL"), "CLI slash composer", 30_000).catch((error) => {
      console.error(terminalText)
      throw error
    })
    const command = (text) => {
      cli.terminal.write(text)
      cli.terminal.write("\r")
    }
    const browserList = () => cliApi("GET", `/api/session/${session.id}/browser`)
    cli.terminal.write("/br")
    await poll(
      () => screen().split("\n").some((line) => /\/browser\b/u.test(line)),
      "CLI /browser autocomplete",
    )
    result.autocomplete = true
    cli.terminal.write("\x15")
    command(`/browser open ${pageURL} --cdp-url http://127.0.0.1:${cdpPort}`)
    const opened = await poll(async () => (await browserList()).find((item) => item.status === "connected"), "CLI browser open", 30_000)
    result.browserSessionID = opened.id
    command('/browser type "#name" "Apexo"')
    await poll(async () => (await fixture.locator("#name").inputValue()) === "Apexo", "CLI browser type")
    command('/browser click "#go"')
    await poll(async () => (await fixture.locator("#out").textContent()) === "clicked:Apexo", "CLI browser click")
    command("/browser screenshot full")
    const screenshot = await poll(async () => {
      const events = await cliApi("GET", `/api/session/${session.id}/browser/${opened.id}/events`)
      return events.events.find((event) => event.type === "browser.artifact_created")
    }, "CLI browser screenshot")
    result.artifact = screenshot.data.artifact.relativePath
    const events = await cliApi("GET", `/api/session/${session.id}/browser/${opened.id}/events`)
    result.events = events.events.length
    assert.ok(result.events >= 8)
    command(`/browser inspect ${pageURL} through CDP http://127.0.0.1:${cdpPort} and report the page title`)
    await poll(async () => {
      const sessions = (await cliApi("GET", "/api/session")).data
      return !sessions?.some((item) => item.parentID === session.id && item.agent === "browser")
    }, "CLI browser task stays in main session", 30_000)
    await poll(async () => {
      const messages = await cliApi("GET", `/api/session/${session.id}/message`)
      return JSON.stringify(messages).includes('"browser"')
    }, "CLI main session browser tool", 30_000)
    assert.match(terminalText, /\/browser inspect/u)
    result.mainSessionBrowserTask = true
    command("/browser close")
    await poll(async () => {
      try {
        return !(await browserList()).some((item) => item.id === opened.id)
      } catch {
        return true
      }
    }, "CLI browser close")
    assert.match(terminalText, /browser opened/i)
    console.log(JSON.stringify(result))
  } else {
    const frontend = http.createServer(async (request, response) => {
      const url = new URL(request.url, "http://localhost")
      if (url.pathname.startsWith("/assets/") || request.headers.accept?.includes("text/html")) {
        const file = Bun.file(join(repo, "packages/app/dist", url.pathname.startsWith("/assets/") ? url.pathname : "index.html"))
        if (!(await file.exists())) {
          response.writeHead(404)
          response.end()
          return
        }
        void file.arrayBuffer().then((data) => {
          response.writeHead(200, { "content-type": file.type })
          response.end(Buffer.from(data))
        })
        return
      }
      const target = new URL(runtime.url)
      const upstream = http.request(
        { hostname: target.hostname, port: target.port, path: request.url, method: request.method, headers: { ...request.headers, host: target.host }, agent: false },
        (reply) => {
          response.writeHead(reply.statusCode, reply.headers)
          reply.pipe(response)
        },
      )
      upstream.on("error", () => response.end())
      request.pipe(upstream)
    })
    await new Promise((resolve) => frontend.listen(0, "127.0.0.1", resolve))
    try {
      appBrowser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath() })
      const home = await appBrowser.newPage({ viewport: { width: 1440, height: 1000 } })
      const beforeHomeSessions = new Set(((await runtime.api("/api/session")).data ?? []).map((item) => item.id))
      await home.goto(`http://127.0.0.1:${frontend.address().port}/${Buffer.from(runtime.directory).toString("base64url")}/session`)
      const homeEditor = home.locator('[contenteditable="true"]').first()
      await homeEditor.waitFor({ state: "visible" })
      await homeEditor.fill("/br")
      await poll(
        async () => {
          const body = await home.locator("body").innerText()
          return body.includes("/browser")
        },
        "Desktop Home /browser autocomplete",
      )
      await homeEditor.fill(`/browser inspect ${pageURL} through CDP http://127.0.0.1:${cdpPort} and report the page title`)
      await home.locator('[data-action="prompt-submit"]').click()
      const homeRoot = await poll(() => {
        const match = home.url().match(/\/session\/([^/?#]+)/u)
        return match && !beforeHomeSessions.has(match[1]) ? { id: match[1] } : undefined
      }, "Desktop browser home main session route", 30_000)
      assert.ok(homeRoot?.id)
      const homeInfo = (await runtime.api(`/api/session/${homeRoot.id}`)).data
      assert.equal(homeInfo?.agent, "build")
      assert.equal(homeInfo?.parentID, undefined)
      await poll(async () => {
        const sessions = (await runtime.api("/api/session")).data ?? []
        return !sessions.some((item) => item.parentID === homeRoot.id && item.agent === "browser")
      }, "Desktop browser home task stays in main session", 30_000)
      await poll(async () => {
        const messages = await runtime.api(`/api/session/${homeRoot.id}/message`)
        return JSON.stringify(messages).includes('"browser"')
      }, "Desktop browser home main session browser tool", 30_000)
      await poll(
        async () => /BROWSER_MAIN_SESSION_OK|inspect/iu.test(await home.locator("body").innerText()),
        "Desktop browser home visible transcript",
        30_000,
      )
      result.mainSessionBrowserTask = true
      await home.close()
      const page = await appBrowser.newPage({ viewport: { width: 1440, height: 1000 } })
      await page.goto(`http://127.0.0.1:${frontend.address().port}/${Buffer.from(runtime.directory).toString("base64url")}/session/${session.id}`)
      const editor = page.locator('[contenteditable="true"]').first()
      await editor.waitFor({ state: "visible" })
      const command = async (text) => {
        await editor.fill(text)
        await page.locator('[data-action="prompt-submit"]').click()
      }
      const browserList = () => runtime.api(`/api/session/${session.id}/browser`)
      await editor.fill("/br")
      await poll(
        async () => {
          const body = await page.locator("body").innerText()
          return body.includes("/browser") && body.includes("Open and control a real Chrome session with /browser")
        },
        "Desktop /browser autocomplete",
      )
      result.autocomplete = true
      await editor.fill("")
      await command(`/browser open ${pageURL} --cdp-url http://127.0.0.1:${cdpPort}`)
      const opened = await poll(async () => (await browserList()).find((item) => item.status === "connected"), "Desktop browser open", 30_000)
      result.browserSessionID = opened.id
      await command('/browser type "#name" "Apexo"')
      await poll(async () => (await fixture.locator("#name").inputValue()) === "Apexo", "Desktop browser type")
      await command('/browser click "#go"')
      await poll(async () => (await fixture.locator("#out").textContent()) === "clicked:Apexo", "Desktop browser click")
      await command("/browser screenshot full")
      const screenshot = await poll(async () => {
        const events = await runtime.api(`/api/session/${session.id}/browser/${opened.id}/events`)
        return events.events.find((event) => event.type === "browser.artifact_created")
      }, "Desktop browser screenshot")
      result.artifact = screenshot.data.artifact.relativePath
      const events = await runtime.api(`/api/session/${session.id}/browser/${opened.id}/events`)
      result.events = events.events.length
      assert.ok(result.events >= 8)
      await command("/browser close")
      await poll(async () => {
        try {
          return !(await browserList()).some((item) => item.id === opened.id)
        } catch {
          return true
        }
      }, "Desktop browser close")
      console.log(JSON.stringify(result))
    } finally {
      await appBrowser?.close()
      frontend.closeAllConnections()
      await new Promise((resolve) => frontend.close(resolve))
    }
  }
} finally {
  await appBrowser?.close()
  cli?.terminal?.close()
  cli?.kill("SIGTERM")
  if (cli) await deadline(cli.exited, 10_000, "CLI slash cleanup").catch(() => cli.kill("SIGKILL"))
  terminal?.dispose()
  await browser.close()
  await runtime.close()
  pageServer.closeAllConnections()
  await new Promise((resolve) => pageServer.close(resolve))
}

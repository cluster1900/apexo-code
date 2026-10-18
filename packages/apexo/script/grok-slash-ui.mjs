// Desktop (web app in Chrome via agent-browser) check of Grok Build slash commands: /multiline.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import http from "node:http"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { poll } from "./grok-shell-fixture.mjs"
import { startGoalFixture } from "./grok-goal-fixture.mjs"
const kind = process.argv[2] ?? "cli"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const { runtime, control } = await startGoalFixture(kind)
const session = await runtime.api("/session", {
  title: "Slash UI",
  agent: "build",
  model: { providerID: "xai", id: "grok-4.7" },
})
const replacementView = { frozen: undefined }
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost")
  if (replacementView.frozen && request.method === "GET" && url.pathname === `/session/${session.id}/goal`) {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify(replacementView.frozen))
    return
  }
  const document = request.headers.accept?.includes("text/html")
  if (document || url.pathname.startsWith("/assets/") || /favicon|apple-touch-icon/.test(url.pathname)) {
    const file = Bun.file(join(repo, "packages/app/dist", document ? "index.html" : url.pathname))
    void file.arrayBuffer().then(
      (content) => {
        response.writeHead(200, { "content-type": file.type })
        const bytes = Buffer.from(content)
        if (document && process.argv.includes("--benchmark")) {
          response.end(
            bytes
              .toString()
              .replace(
                "<head>",
                `<head><script>new MutationObserver((_, observer) => {const element = document.querySelector('[contenteditable="true"]'); if(!element?.getBoundingClientRect().width) return; observer.disconnect(); requestAnimationFrame(()=>window.__pluginsComposerPaint=Date.now()-Number(sessionStorage.getItem('plugins-benchmark-start')));}).observe(document.documentElement,{childList:true,subtree:true});</script>`,
              ),
          )
          return
        }
        response.end(bytes)
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
const browserSession = `slash-${kind}-${basename(runtime.output)}`
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

const checks = []
const url = `http://127.0.0.1:${server.address().port}/${Buffer.from(runtime.directory).toString("base64url")}/session/${session.id}`
const editor = '[contenteditable="true"]'
const userTexts = async () =>
  (await runtime.api(`/session/${session.id}/message`))
    .filter((item) => item.info.role === "user")
    .flatMap((item) => item.parts.filter((part) => part.type === "text").map((part) => part.text))
try {
  await command("open", url)
  await command("wait", editor)
  await command("click", editor)
  await command("keyboard", "type", "/multiline")
  await command("wait", "400")
  await command("press", "Enter")
  await poll(async () => (await command("get", "text", "body")).includes("Multiline on"), "multiline toast")
  assert.equal(await command("eval", "localStorage.getItem('apexo.multiline')").then((v) => v.trim()), '"on"')
  checks.push("multiline-toggle-persisted")
  await command("click", editor)
  await command("keyboard", "type", "MLA")
  await command("press", "Enter")
  await command("keyboard", "type", "MLB")
  await command("wait", "300")
  assert.deepEqual(await userTexts(), [])
  assert.match(await command("get", "text", editor), /MLA\s*\n\s*MLB/)
  checks.push("enter-inserts-newline")
  await command("press", "Alt+Enter")
  await poll(async () => (await userTexts()).some((text) => text.replace(/\r/g, "") === "MLA\nMLB"), "Alt+Enter sends")
  checks.push("alt-enter-sends")
  await command("click", editor)
  await command("keyboard", "type", "/ml")
  await command("wait", "400")
  await command("press", "Enter")
  await poll(async () => (await command("get", "text", "body")).includes("Multiline off"), "multiline off toast")
  checks.push("ml-alias-turns-off")
  // Seed a long session so the timeline scrolls and g/G can be verified.
  for (let index = 0; index < 8; index++)
    await runtime.api(`/session/${session.id}/message`, {
      agent: "build",
      model: { providerID: "xai", modelID: "grok-4.7" },
      parts: [{ type: "text", text: `SEED_${index}\n` + "filler line\n".repeat(12) }],
    })
  await command("set", "viewport", "1100", "500")
  await command("reload")
  await command("wait", editor)
  await poll(async () => (await command("get", "text", "body")).includes("SEED_7"), "seeded timeline")
  await command("wait", "500")
  await command("click", editor)
  await command("keyboard", "type", "/vim-mode")
  await command("wait", "400")
  await command("press", "Enter")
  await poll(async () => (await command("get", "text", "body")).includes("Vim mode on"), "vim toast")
  await command("click", editor)
  await command("press", "Escape")
  assert.equal((await command("eval", "document.activeElement?.isContentEditable === true")).trim(), "false")
  // y copies the last response (clipboard may be denied headless; either toast proves the key reached the action).
  await command("press", "y")
  await command("wait", "800")
  await poll(
    async () => /Last response copied|Request failed|clipboard/i.test(await command("get", "text", "body")),
    "y copy",
  )
  const scroll = (
    await command(
      "eval",
      `(() => { let e = document.querySelector("[data-message-id]")?.parentElement; while (e && !(/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)) e = e.parentElement; if (!e) return "none"; e.scrollTop = e.scrollHeight; return "ok" })()`,
    )
  ).trim()
  assert.ok(scroll.includes("ok"), "seeded timeline must scroll")
  {
    await command("press", "g")
    await command("wait", "300")
    assert.equal(
      (
        await command(
          "eval",
          `(() => { let e = document.querySelector("[data-message-id]")?.parentElement; while (e && !(/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)) e = e.parentElement; return e.scrollTop })()`,
        )
      ).trim(),
      "0",
    )
    checks.push("vim-g-scrolls-to-top")
    await command("press", "Shift+g")
    await command("wait", "400")
    const bottom = (
      await command(
        "eval",
        `(() => { let e = document.querySelector("[data-message-id]")?.parentElement; while (e && !(/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)) e = e.parentElement; return Math.abs(e.scrollHeight - e.clientHeight - e.scrollTop) < 4 })()`,
      )
    ).trim()
    assert.equal(bottom, "true")
    checks.push("vim-G-scrolls-to-bottom")
    await command("press", "g")
    await command("wait", "400")
    await command("press", "j")
    await command("wait", "400")
    const after = (
      await command(
        "eval",
        `(() => { let e = document.querySelector("[data-message-id]")?.parentElement; while (e && !(/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)) e = e.parentElement; return e.scrollTop })()`,
      )
    ).trim()
    assert.ok(Number(after) > 0, `j scrolls down (scrollTop=${after})`)
    checks.push("vim-j-scrolls-a-line")
  }
  await command("press", "x")
  assert.equal((await command("eval", "document.activeElement?.isContentEditable === true")).trim(), "true")
  assert.match(await command("get", "text", editor), /^\s*x\s*$/)
  checks.push("vim-mode-escape-scrollback-y-and-typing-returns-to-prompt")
  console.log(JSON.stringify({ kind, passed: checks.length, checks }))
} finally {
  await command("close").catch(() => {})
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await runtime.close()
  await writeFile(join(runtime.output, "slash-ui.json"), JSON.stringify({ checks, history }, null, 2))
  console.error(`Slash UI evidence: ${runtime.output}`)
}

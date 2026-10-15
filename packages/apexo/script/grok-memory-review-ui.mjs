import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { writeFile } from "node:fs/promises"
import http from "node:http"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const kind = process.argv[2] ?? "cli"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const v2 = process.argv.includes("--v2")
const runtime = await startShellFixture(kind, {
  ...(v2 ? { config: { memory_v2: { enabled: true } } } : {}),
  next: async ({ input }) =>
    JSON.stringify(input).includes("You are a memory note formatter")
      ? { content: "## Preferences\nREVIEW_REWRITTEN" }
      : undefined,
})
const session = await runtime.api("/session", { title: "Memory review UI" })
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost")
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
const browserSession = `plugins-${kind}-${basename(runtime.output)}`
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
const button = (name) => command("find", "role", "button", "click", "--name", name, "--exact")
const endpoint = `/experimental/session/${session.id}/memory`
const preview = async (path) => {
  const response = await fetch(
    `${runtime.url}${endpoint}/note?${new URLSearchParams({ directory: runtime.directory, path })}`,
  )
  assert.ok(response.ok, await response.clone().text())
  return response.json()
}
const url = `http://127.0.0.1:${server.address().port}/${Buffer.from(runtime.directory).toString("base64url")}/session/${session.id}`
const open = async (text) => {
  await command("fill", '[contenteditable="true"]', `/remember ${text}`)
  await command("press", "Enter")
  await command("wait", '[data-component="memory-review"]')
}
try {
  await command("open", url)
  await command("wait", '[data-action="session-memory"]')
  await open("REVIEW_CANCEL")
  await command(
    "wait",
    "--fn",
    'Array.from(document.querySelectorAll("button")).some(x=>x.textContent.trim()==="Rewritten note")',
  )
  await button("Rewritten note")
  assert.match(await command("get", "value", "#memory-review-content"), /REVIEW_REWRITTEN/)
  await button("Cancel")
  assert.deepEqual(await runtime.api(endpoint), [])
  assert.deepEqual(await runtime.api(`/session/${session.id}/message`), [])
  checks.push("inline-remember-opens-review", "rewrite-toggle", "cancel-does-not-save", "no-main-turn")
  await open("REVIEW_RAW_SAVE")
  await button("Save")
  await command("wait", '[data-component="memory-review"] code')
  await button("Close")
  const global = (await runtime.api(endpoint)).find((note) => note.source === "global")
  const globalNote = await preview(global.path)
  assert.match(globalNote.content, /REVIEW_RAW_SAVE/)
  assert.doesNotMatch(globalNote.content, /REVIEW_REWRITTEN|REVIEW_CANCEL/)
  checks.push("save-original", "default-global")
  await open("REVIEW_ENHANCE")
  await command(
    "wait",
    "--fn",
    'Array.from(document.querySelectorAll("button")).some(x=>x.textContent.trim()==="Rewritten note")',
  )
  await button("Rewritten note")
  await button("Save")
  await command("wait", '[data-component="memory-review"] code')
  await button("Close")
  if (v2) {
    const notes = (await runtime.api(endpoint)).filter((note) => note.source === "global" && note.name !== "MEMORY.md")
    assert.equal(notes.length, 2)
    assert.ok(
      (await Promise.all(notes.map((note) => preview(note.path)))).some((note) =>
        note.content.includes("REVIEW_REWRITTEN"),
      ),
    )
    assert.doesNotMatch((await preview(global.path)).content, /REVIEW_REWRITTEN/)
  } else assert.match((await preview(global.path)).content, /REVIEW_REWRITTEN/)
  checks.push("save-selected-rewrite")
  await open("")
  await command("fill", "#memory-review-content", "## Project\nREVIEW_EDITED_WORKSPACE")
  await button("Review note")
  await command("select", "#memory-review-scope", "workspace")
  await command("screenshot", join(runtime.output, "memory-review.png"))
  await button("Save")
  await command("wait", '[data-component="memory-review"] code')
  await button("Close")
  const workspace = (await runtime.api(endpoint)).find((note) => note.source === "workspace")
  assert.match((await preview(workspace.path)).content, /REVIEW_EDITED_WORKSPACE/)
  checks.push("empty-remember-editor", "review-edited-note", "choose-workspace")
  await command("eval", 'localStorage.setItem("apexo.global.dat:language", JSON.stringify({locale:"zh"}))')
  await command("reload")
  await command("wait", '[data-action="session-memory"]')
  await open("中文记忆草稿")
  assert.match(await command("get", "text", '[data-slot="dialog-title"]'), /审阅记忆笔记/)
  await command("screenshot", join(runtime.output, "memory-review-zh.png"))
  await button("取消")
  checks.push("chinese-labels")
  console.log(JSON.stringify({ kind, checks, passed: checks.length, output: runtime.output }, null, 2))
} catch (error) {
  console.error(await command("snapshot", "-i").catch(String))
  await command("screenshot", join(runtime.output, "memory-review-failure.png")).catch(() => {})
  console.error(JSON.stringify(runtime.calls))
  throw error
} finally {
  await command("close").catch(() => {})
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await runtime.close()
  await writeFile(join(runtime.output, "memory-review-ui.json"), JSON.stringify({ checks, history }, null, 2))
  console.error(`Memory review UI evidence: ${runtime.output}`)
}

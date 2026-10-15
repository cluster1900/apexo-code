import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import http from "node:http"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const kind = process.argv[2] ?? "cli"
const capture = process.argv.includes("--capture")
const v2Dream = process.argv.includes("--v2-dream")
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const planned = {
  content: capture
    ? JSON.stringify({
        outcome: "observations",
        observations: [
          { type: "project", statement: "CAPTURE_UI_SAVED", topic_hint: null, keywords: [], aliases: [], body: null },
        ],
      })
    : "## Decisions\nWORK_UI_SAVED",
  hold: capture ? Promise.withResolvers() : undefined,
}
const calls = []
const runtime = await startShellFixture(kind, {
  config: {
    ...(capture || v2Dream ? { memory_v2: { enabled: true, automatic_dream_enabled: false } } : {}),
    memory: { enabled: true, session: { save_on_end: false }, dream: { enabled: false, check_interval_secs: 0 } },
    compaction: { auto: false, memory_flush: { enabled: false } },
  },
  async next({ input, body }) {
    if (v2Dream) {
      if (JSON.stringify(input).includes("You extract durable memory observations"))
        return { content: JSON.stringify({ outcome: "noop", observations: [] }) }
      if (!JSON.stringify(input).includes("Consolidate durable memory observations into topic Markdown")) return
      const message = input.findLast((row) => row.role === "user").content
      const value = JSON.parse(typeof message === "string" ? message : message.map((part) => part.text ?? "").join(""))
      calls.push(body)
      if (planned.hold) await planned.hold.promise
      return {
        content: JSON.stringify({
          operations: ["database", "testing"].map((name) => ({
            action: value.topics.some((row) => row.path === `topics/${name}.md`) ? "update" : "create",
            path: `topics/${name}.md`,
            content: `# ${name}\nDREAM_UI_SAVED: use WAL and bounded retries.`,
            evidence: value.observations.map((row) => row.path),
          })),
        }),
      }
    }
    if (
      !JSON.stringify(input).includes(
        capture ? "You extract durable memory observations" : "You are a memory assistant",
      )
    )
      return
    calls.push(body)
    const content = planned.content
    if (planned.hold) await planned.hold.promise
    return { content }
  },
})
const session = await runtime.api("/session", { title: "Memory operation UI" })
await runtime.api(`/session/${session.id}/message`, {
  model: { providerID: "xai", modelID: "grok-4.7" },
  parts: [{ type: "text", text: "Use WAL for database readers." }],
})
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
const browserSession = `memory-work-${kind}-${basename(runtime.output)}`
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
const operation = () => runtime.api(`${endpoint}/operation`)
const text = () => command("get", "text", '[data-component="memory-work"]')
const waitText = (value) => poll(async () => (await text()).includes(value), value)
const url = `http://127.0.0.1:${server.address().port}/${Buffer.from(runtime.directory).toString("base64url")}/session/${session.id}`
try {
  await command("open", url)
  await command("wait", '[data-action="session-memory"]')
  const before = await runtime.api(`/session/${session.id}/message`)
  if (v2Dream) {
    await runtime.api(`${endpoint}/remember`, { content: "Use SQLite WAL", scope: "workspace" })
    planned.hold = Promise.withResolvers()
    await command("fill", '[contenteditable="true"]', "/dream")
    await command("press", "Enter")
    await command("wait", '[data-component="memory-work"]')
    await waitText("Consolidating saved notes")
    await poll(() => calls.length === 1, "Dream model running")
    const active = await operation()
    await command("press", "Escape")
    await command("fill", '[contenteditable="true"]', "/dream")
    await command("press", "Enter")
    await waitText("Consolidating saved notes")
    assert.equal((await operation()).id, active.id)
    checks.push("v2-slash-dream-progress", "v2-close-reopen-same-dream")
    await button("Cancel")
    await waitText("Memory operation cancelled.")
    planned.hold.resolve()
    planned.hold = undefined
    await button("Consolidate memory")
    await waitText("Memory operation completed.")
    const completed = (await operation()).result
    assert.equal(completed.topics, 2)
    assert.equal(completed.cleaned, 1)
    assert.match(await text(), /Topics: 2/)
    assert.match(await text(), /Records processed: 1/)
    assert.match(await readFile(join(completed.path, "topics/database.md"), "utf8"), /DREAM_UI_SAVED/)
    assert.deepEqual(await runtime.api(`/session/${session.id}/message`), before)
    checks.push("v2-cancel-and-retry-dream", "v2-topic-and-observation-counts", "v2-written-topics", "v2-no-main-turn")
    await button("Consolidate memory")
    await waitText("No new memory to save.")
    checks.push("v2-dream-no-work")
    await command("press", "Escape")
    await runtime.api(`${endpoint}/remember`, { content: "Verify localized result", scope: "workspace" })
    await command("eval", 'localStorage.setItem("apexo.global.dat:language",JSON.stringify({locale:"zh"}))')
    await command("reload")
    await command("wait", '[data-action="session-memory"]')
    await command("fill", '[contenteditable="true"]', "/dream")
    await command("press", "Enter")
    await waitText("记忆整理任务已完成")
    assert.match(await text(), /主题数：2/)
    await command("screenshot", join(runtime.output, "memory-v2-dream-ui-zh.png"))
    checks.push("v2-dream-localized-result")
  } else if (capture) {
    await poll(() => calls.length === 1, "background capture running")
    await command("fill", '[contenteditable="true"]', "/flush")
    await command("press", "Enter")
    await command("wait", '[data-component="memory-work"]')
    await waitText("Extracting durable knowledge")
    const active = await operation()
    await command("press", "Escape")
    await command("fill", '[contenteditable="true"]', "/flush")
    await command("press", "Enter")
    await waitText("Extracting durable knowledge")
    assert.equal((await operation()).id, active.id)
    checks.push("v2-slash-flush-barrier", "v2-close-and-reopen-same-barrier")
    await button("Cancel")
    await waitText("Memory operation cancelled.")
    planned.hold.resolve()
    planned.hold = undefined
    await button("Extract memory")
    await waitText("Memory operation completed.")
    assert.match(await text(), /Records processed: 1/)
    assert.equal(calls.length, 1)
    assert.deepEqual(await runtime.api(`/session/${session.id}/message`), before)
    const scopes = join(runtime.env.APEXO_TEST_HOME, ".grok/memory-v2/apexo/workspaces")
    assert.match(await readFile(join(scopes, (await readdir(scopes))[0], "MEMORY.md"), "utf8"), /CAPTURE_UI_SAVED/)
    checks.push(
      "v2-cancel-wait-and-rejoin",
      "v2-result-count-and-persisted-observation",
      "v2-no-extra-extraction-or-main-turn",
    )
    await command("press", "Escape")
    await command("eval", 'localStorage.setItem("apexo.global.dat:language",JSON.stringify({locale:"zh"}))')
    await command("reload")
    await command("wait", '[data-action="session-memory"]')
    await command("fill", '[contenteditable="true"]', "/flush")
    await command("press", "Enter")
    await waitText("记忆整理任务已完成")
    await command("screenshot", join(runtime.output, "memory-capture-ui-zh.png"))
    checks.push("v2-localized-completion")
    const content = planned.content
    planned.content = "INVALID_CAPTURE_OUTPUT"
    planned.hold = Promise.withResolvers()
    await command("press", "Escape")
    await runtime.api(`/session/${session.id}/message`, {
      model: { providerID: "xai", modelID: "grok-4.7" },
      parts: [{ type: "text", text: "Retry failed memory extraction explicitly." }],
    })
    await poll(() => calls.length === 2, "retryable extraction held")
    await command("fill", '[contenteditable="true"]', "/flush")
    await command("press", "Enter")
    await waitText("正在提取长期知识")
    planned.hold.resolve()
    planned.hold = undefined
    await waitText("等待重试的提取任务")
    assert.equal((await operation()).result.status, "retry_required")
    // /flush can join the held extraction or explicitly retry its failed result.
    // The later retry button must cause exactly one additional model request.
    const retries = calls.length
    assert.ok(retries === 2 || retries === 3)
    await command("screenshot", join(runtime.output, "memory-capture-retry-ui-zh.png"))
    planned.content = content
    await button("提取记忆")
    await waitText("记忆整理任务已完成")
    assert.equal(calls.length, retries + 1)
    checks.push("v2-localized-retry-required", "v2-explicit-retry-button-completes")
  } else {
    planned.hold = Promise.withResolvers()
    await command("fill", '[contenteditable="true"]', "/flush")
    await command("press", "Enter")
    await command("wait", '[data-component="memory-work"]')
    await waitText("Extracting durable knowledge")
    assert.equal(calls.length, 1)
    const active = await operation()
    assert.equal(active.state, "running")
    await command("screenshot", join(runtime.output, "memory-work-running.png"))
    await command("press", "Escape")
    assert.equal((await operation()).id, active.id)
    await command("click", '[data-action="session-memory"]')
    await button("Memory operations")
    await waitText("Extracting durable knowledge")
    assert.equal(calls.length, 1)
    checks.push("slash-direct-operation", "running-progress", "close-keeps-running", "reopen-without-restart")
    await button("Cancel")
    await waitText("Memory operation cancelled.")
    planned.hold.resolve()
    planned.hold = undefined
    assert.equal((await operation()).result.status, "cancelled")
    await button("Extract memory")
    await waitText("Memory operation completed.")
    const saved = await operation()
    assert.match(await readFile(saved.result.path, "utf8"), /WORK_UI_SAVED/)
    assert.match(await text(), /Records processed: 1/)
    assert.deepEqual(await runtime.api(`/session/${session.id}/message`), before)
    checks.push("cancel", "retry-and-save", "result-path-and-count", "no-main-turn")
    await button("Extract memory")
    await waitText("No new memory to save.")
    checks.push("no-work-result")
    const workspace = await runtime.api(`${endpoint}/remember`, {
      content: "## Existing\nWORK_PRIOR",
      scope: "workspace",
    })
    await mkdir(join(dirname(workspace.path), "sessions"), { recursive: true })
    await writeFile(join(dirname(workspace.path), "sessions", "2026-10-13-ui-other.md"), "## Other\nWORK_EVIDENCE")
    planned.content = "## Consolidated\nWORK_UI_DREAM"
    await button("Consolidate memory")
    await poll(
      async () => (await operation())?.kind === "dream" && (await operation()).state === "finished",
      "dream completed",
    )
    await waitText("Memory operation completed.")
    assert.match(await readFile(workspace.path, "utf8"), /WORK_UI_DREAM/)
    checks.push("dream-control-and-result")
    await runtime.api(`${endpoint}/toggle`, { enabled: false })
    await button("Extract memory")
    await waitText("Memory is disabled for this session.")
    checks.push("disabled-result")
    await command("press", "Escape")
    await command("eval", 'localStorage.setItem("apexo.global.dat:language",JSON.stringify({locale:"zh"}))')
    await command("reload")
    await command("wait", '[data-action="session-memory"]')
    await command("click", '[data-action="session-memory"]')
    await button("记忆整理")
    await waitText("当前会话已禁用记忆")
    await command("screenshot", join(runtime.output, "memory-work-zh.png"))
    checks.push("localized-results")
  }
  console.log(
    JSON.stringify({ kind, capture, v2Dream, passed: checks.length, checks, output: runtime.output }, null, 2),
  )
} catch (error) {
  console.error(await command("snapshot", "-i").catch(String))
  await command("screenshot", join(runtime.output, "memory-work-failure.png")).catch(() => {})
  throw error
} finally {
  planned.hold?.resolve()
  await command("close").catch(() => {})
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await runtime.close()
  await writeFile(join(runtime.output, "memory-work-ui.json"), JSON.stringify({ checks, history }, null, 2))
  console.error(`Memory operation UI evidence: ${runtime.output}`)
}

import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startCodeReviewFixture } from "./code-review-ui-fixture.mjs"
const kind = process.argv[2] ?? "browser"
const fixture = await startCodeReviewFixture()
const { runtime, repo } = fixture
const requests = []
const server = createServer((incoming, response) => {
  response.on("finish", () => requests.push({ path: incoming.url, status: response.statusCode }))
  const url = new URL(incoming.url, "http://localhost")
  const document = incoming.headers.accept?.includes("text/html")
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
  const upstream = request(
    {
      hostname: target.hostname,
      port: target.port,
      path: incoming.url,
      method: incoming.method,
      headers: { ...incoming.headers, host: target.host },
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
  incoming.pipe(upstream)
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const browserSession = `code-review-${kind}-${basename(runtime.output)}`
const history = []
const native = { child: undefined, exited: undefined, port: undefined }
const nativeLogs = []
if (kind === "native") {
  const appData = join(runtime.output, "native-app-data")
  await mkdir(join(appData, "com.apexolab.desktop.dev"), { recursive: true })
  await writeFile(
    join(appData, "com.apexolab.desktop.dev/apexo.settings"),
    JSON.stringify({ firstLaunchOnboardingComplete: true }),
  )
  const desktop = join(repo, "packages/desktop")
  const wrapper = join(runtime.output, "native.cjs")
  await writeFile(
    wrapper,
    `const {app}=require('electron');console.log('Task fixture initial app path:',app.getAppPath());if(!${JSON.stringify(process.argv.includes("--probe-original"))})app.setAppPath(${JSON.stringify(desktop)});console.log('Task fixture corrected app path:',app.getAppPath());app.setPath('appData',${JSON.stringify(appData)});import(${JSON.stringify(pathToFileURL(join(desktop, "out/main/index.js")).href)});`,
  )
  const reservation = createServer()
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
  native.port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  native.child = spawn(
    join(
      desktop,
      "node_modules/electron/dist",
      (await readFile(join(desktop, "node_modules/electron/path.txt"), "utf8")).trim(),
    ),
    [wrapper, `--remote-debugging-port=${native.port}`],
    {
      cwd: runtime.directory,
      env: {
        ...runtime.env,
        SHELL: "/bin/sh",
        APEXO_PORT: "",
        APEXO_TEST_ONBOARDING: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  native.exited = new Promise((resolve) => native.child.once("exit", resolve))
  native.child.stdout.on("data", (chunk) => nativeLogs.push(chunk))
  native.child.stderr.on("data", (chunk) => nativeLogs.push(chunk))
}
const command = async (...args) => {
  // agent-browser's click interception guard runs before nested-scroll reveal.
  // Scroll the real form to the action, as a user would, before clicking it.
  if (["click", "download"].includes(args[0]) && args[1]?.includes("review")) {
    await command("scrollintoview", args[1])
    const layout = { previous: "" }
    await poll(async () => {
      const target = JSON.parse(
        await command(
          "eval",
          `(()=>{const element=document.querySelector(${JSON.stringify(args[1])});if(!element)return {ready:false};const rect=element.getBoundingClientRect();const x=rect.x+rect.width/2;const y=rect.y+rect.height/2;return {rect:rect.toJSON(),ready:!element.disabled&&rect.width>0&&rect.height>0&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&element.contains(document.elementFromPoint(x,y))}})()`,
        ),
      )
      const current = JSON.stringify(target.rect)
      const ready = target.ready && current === layout.previous
      layout.previous = current
      return ready
    }, `stable enabled Task action ${args[1]}`)
  }
  const result = await promisify(execFile)(
    "bunx",
    [
      "agent-browser",
      "--session",
      browserSession,
      ...(kind === "native"
        ? ["--cdp", String(native.port)]
        : [
            "--executable-path",
            process.env.CHROMIUM_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          ]),
      ...args,
    ],
    { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
  )
  history.push({ args, output: result.stdout })
  return result.stdout
}
const checks = []
try {
  if (kind === "native") {
    await poll(
      () =>
        fetch(`http://127.0.0.1:${native.port}/json/list`)
          .then((r) => r.json())
          .then((tabs) => tabs.some((tab) => tab.type === "page"))
          .catch(() => false),
      "native Task window",
    )
    await command("wait", "--fn", "!!window.api?.awaitInitialization")
    await command("eval", "window.api.awaitInitialization()")
    await command("eval", `window.api.setDefaultServerUrl(${JSON.stringify(runtime.url)})`)
    await command(
      "eval",
      `window.api.storeSet("apexo.global.dat","server",JSON.stringify({list:[{type:"http",http:{url:${JSON.stringify(runtime.url)}}}],projects:{},lastProject:{},recentlyClosed:{}}))`,
    )
  }
  const before = fixture.calls.length
  const browserUrl = `http://127.0.0.1:${server.address().port}`
  const route = `/server/${Buffer.from(kind === "native" ? runtime.url : browserUrl).toString("base64url")}/session/${fixture.session.id}`
  if (kind === "native") {
    await command(
      "eval",
      `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)});return true})()`,
    )
    await command("reload")
  } else await command("open", `${browserUrl}${route}`)
  const panel = '[data-component="code-review"]'
  const open = async () => {
    await command("wait", '[data-action="session-code-review"]')
    await command("click", '[data-action="session-code-review"]')
    await command("wait", panel)
  }
  await open()
  await command("wait", "--fn", 'document.querySelector("[data-action=review-start]")?.disabled===false')
  await command("click", '[data-action="review-start"]')
  await command("wait", '[data-status="completed"]')
  assert.match(await command("get", "text", panel), /REVIEW_UI_REPORT/)
  checks.push("start-review", "completed-report")
  await command("click", "[data-finding]:nth-child(1)")
  await command("wait", '[data-field="review-finding-detail"]')
  assert.match(await command("get", "text", '[data-field="review-finding-detail"]'), /zero divisor/)
  await command(
    "wait",
    "--fn",
    'document.querySelector("[data-field=review-diff] diffs-container")?.shadowRoot?.querySelectorAll("[data-selected-line]").length>0',
  )
  checks.push("validated-line-highlight")
  await command("click", "[data-finding]:nth-child(2)")
  assert.match(
    await command("get", "text", '[data-field="review-finding-detail"]'),
    /Captured context outside the diff/,
  )
  assert.match(await command("get", "text", '[data-field="review-finding-detail"]'), /captured context 24/)
  await command("click", "[data-finding]:nth-child(3)")
  assert.match(await command("get", "text", '[data-field="review-findings"]'), /File-level finding/)
  await command(
    "wait",
    "--fn",
    'document.querySelector("[data-field=review-diff] diffs-container")?.shadowRoot?.querySelectorAll("[data-selected-line]").length===0',
  )
  checks.push("priority-navigation", "frozen-outside-hunk-snippet", "file-anchor")
  await command("select", '[data-field="review-priority"]', "P1")
  assert.equal(Number((await command("get", "count", "[data-finding]")).trim()), 1)
  await command("select", '[data-field="review-priority"]', "all")
  await writeFile(join(runtime.directory, "calc.ts"), "LIVE_WORKSPACE_MUST_NOT_APPEAR\n")
  await command("click", '[data-action="review-refresh"]')
  await command(
    "wait",
    "--fn",
    'document.querySelector("[data-field=review-workspace]")?.textContent.includes("Stale report")',
  )
  assert.doesNotMatch(await command("get", "text", panel), /LIVE_WORKSPACE_MUST_NOT_APPEAR/)
  checks.push("priority-filter", "stale-badge", "no-live-file-substitution")
  await command("screenshot", join(runtime.output, "code-review.png"))
  const settled = fixture.calls.length
  await command("reload")
  await open()
  await command("wait", '[data-status="completed"]')
  assert.match(await command("get", "text", panel), /REVIEW_UI_REPORT/)
  assert.equal(fixture.calls.length, settled)
  checks.push("reload-without-provider-replay")
  await command("select", '[data-field="review-target"]', "base")
  await command("fill", '[data-field="review-ref"]', "main")
  await command("fill", '[data-field="review-focus"]', "REVIEW_HOLD")
  await command("wait", "--fn", 'document.querySelector("[data-action=review-start]")?.disabled===false')
  await command("click", '[data-action="review-start"]')
  await command("wait", '[data-status="running"]')
  assert.equal(Number((await command("get", "count", '[data-field="review-summary"]')).trim()), 0)
  const admitted = (await runtime.api(`/api/session/${fixture.session.id}/review`)).data[0]
  assert.deepEqual(admitted.input.target, { type: "base", ref: "main" })
  checks.push("base-target-selection", "new-review-clears-previous-report")
  await command("wait", "--fn", 'document.querySelector("[data-action=review-cancel]")?.disabled===false')
  await command("click", '[data-action="review-cancel"]')
  await command("wait", '[data-status="cancelled"]')
  checks.push("targeted-cancel")
  const afterCancel = fixture.calls.length
  await command("press", "Escape")
  await command("fill", '[contenteditable="true"]', "/reviews")
  await command("press", "Enter")
  await command("wait", panel)
  await command("wait", '[data-status="cancelled"]')
  assert.equal(fixture.calls.length, afterCancel)
  checks.push("review-history-slash-alias")
  const other = (
    await runtime.api("/api/session", {
      location: { directory: runtime.directory },
      model: { providerID: "reviewfixture", id: "review-model" },
      agent: "build",
    })
  ).data
  const otherRoute = `/server/${Buffer.from(kind === "native" ? runtime.url : browserUrl).toString("base64url")}/session/${other.id}`
  if (kind === "native") {
    await command(
      "eval",
      `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(otherRoute)});return true})()`,
    )
    await command("reload")
  } else await command("open", `${browserUrl}${otherRoute}`)
  await open()
  await command("wait", "--fn", 'document.querySelector("[data-action=review-start]")?.disabled===false')
  assert.equal(Number((await command("get", "count", "[data-component=code-review] [data-status]")).trim()), 0)
  assert.equal(Number((await command("get", "count", '[data-field="review-summary"]')).trim()), 0)
  assert.equal(fixture.calls.length, afterCancel)
  checks.push("session-switch-has-no-previous-report")
  console.log(JSON.stringify({ kind, checks, providerCalls: fixture.calls.length, output: runtime.output }, null, 2))
} catch (error) {
  await command(
    "eval",
    `Array.from(document.querySelectorAll('[data-field="review-diff"] diffs-container')).map(host=>({selected:host.shadowRoot?.querySelectorAll('[data-selected-line]').length,lines:Array.from(host.shadowRoot?.querySelectorAll('[data-line]')??[]).map(row=>({dataset:{...row.dataset},isHTML:row instanceof HTMLElement})),pressed:document.querySelector('[data-finding]')?.getAttribute('aria-pressed'),assets:Array.from(document.scripts).map(script=>script.src)}))`,
  )
    .then((value) => writeFile(join(runtime.output, "diff-diagnostics.json"), value))
    .catch(() => {})
  await command("screenshot", join(runtime.output, "failure.png")).catch(() => {})
  throw error
} finally {
  await command("close").catch(() => {})
  if (native.child && native.child.exitCode === null) {
    native.child.kill("SIGTERM")
    await deadline(native.exited, 15000, "Task native window cleanup").catch(async () => {
      native.child.kill("SIGKILL")
      await native.exited
    })
  }
  if (kind === "native") await writeFile(join(runtime.output, "native.log"), Buffer.concat(nativeLogs))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await fixture.close()
  await writeFile(join(runtime.output, "code-review-ui.json"), JSON.stringify({ checks, history, requests }, null, 2))
  console.error(`Code review UI evidence: ${runtime.output}`)
}

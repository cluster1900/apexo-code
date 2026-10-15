import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "desktop"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const state = { nativeChild: undefined, nativeExited: undefined }
const runtime = await startShellFixture("cli")
await runtime.crash()
await writeFile(
  join(runtime.directory, "apexo.json"),
  JSON.stringify({
    ...JSON.parse(runtime.env.APEXO_CONFIG_CONTENT),
    snapshots: false,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    providers: {
      xai: {
        name: "Native UI fixture",
        api: {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: runtime.env.XAI_BASE_URL,
          settings: { apiKey: "local-parity-key" },
        },
        models: {
          "grok-4.7": {
            name: "Native UI fixture",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 100000, output: 10000 },
          },
        },
      },
    },
  }),
)
const nativeServerFile = join(runtime.output, "native-server.mjs")
await writeFile(
  nativeServerFile,
  `import { webHandler } from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:app.handler});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
)
state.nativeChild = spawn(process.execPath, [nativeServerFile], {
  cwd: runtime.directory,
  env: { ...runtime.env, APEXO_SERVER_PASSWORD: "" },
  stdio: ["ignore", "pipe", "pipe"],
})
state.nativeExited = new Promise((resolve) => state.nativeChild.once("exit", resolve))
const serverLogs = []
state.nativeChild.stdout.on("data", (chunk) => {
  serverLogs.push(chunk)
  const match = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/)
  if (match) runtime.url = match[1]
})
state.nativeChild.stderr.on("data", (chunk) => serverLogs.push(chunk))
const oldUrl = runtime.url
await poll(() => runtime.url !== oldUrl, "native-only server ready", 30000)
runtime.api = async (path, body, method = body ? "POST" : "GET") => {
  const response = await fetch(`${runtime.url}${path}?location[directory]=${encodeURIComponent(runtime.directory)}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  assert.ok(response.ok, text)
  return text ? JSON.parse(text) : undefined
}
assert.equal((await fetch(`${runtime.url}/global/health`)).status, 404)
assert.deepEqual(await runtime.api("/api/health"), { healthy: true })
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
const browserSession = `native-feedback-${kind}-${basename(runtime.output)}`
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
    `const {app}=require('electron');console.log('Workflow fixture initial app path:',app.getAppPath());if(!${JSON.stringify(process.argv.includes("--probe-original"))})app.setAppPath(${JSON.stringify(desktop)});console.log('Workflow fixture corrected app path:',app.getAppPath());app.setPath('appData',${JSON.stringify(appData)});import(${JSON.stringify(pathToFileURL(join(desktop, "out/main/index.js")).href)});`,
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
      env: { ...runtime.env, SHELL: "/bin/sh", APEXO_PORT: "", APEXO_TEST_ONBOARDING: "0" },
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
  if (["click", "download"].includes(args[0]) && args[1]?.includes("feedback")) await command("scrollintoview", args[1])
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
          .then((response) => response.json())
          .then((tabs) => tabs.some((tab) => tab.type === "page"))
          .catch(() => false),
      "native feedback window",
    )
    await command("wait", "--fn", "!!window.api?.awaitInitialization")
    const connection = JSON.parse(await command("eval", "window.api.awaitInitialization()"))
    await command("eval", `window.api.setDefaultServerUrl(${JSON.stringify(runtime.url)})`)
    await command("eval", `window.api.storeSet("apexo.global.dat", "server", JSON.stringify({list:[{type:"http",http:{url:${JSON.stringify(runtime.url)}}}],projects:{},lastProject:{},recentlyClosed:{}}))`)
  }
  const session = (
    await runtime.api("/api/session", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  const endpoint = `/api/session/${session.id}/feedback`
  const browserUrl = `http://127.0.0.1:${server.address().port}`
  const route = `/server/${Buffer.from(kind === "native" ? runtime.url : browserUrl).toString("base64url")}/session/${session.id}`
  const url = `${browserUrl}${route}`
  if (kind === "native") {
    await command(
      "eval",
      `(async()=>{ const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)});return true})()`,
    )
    await command("reload")
  } else await command("open", url)
  await command("wait", '[data-action="session-feedback"]')
  await command(
    "eval",
    "JSON.stringify({ navigation: performance.getEntriesByType('navigation').map(entry => ({ domContentLoaded: entry.domContentLoadedEventEnd, load: entry.loadEventEnd })), now: performance.now() })",
  )
  await command("click", '[data-action="session-feedback"]')
  await command("wait", '[data-component="feedback-dialog"]')
  await command("fill", '[data-field="feedback-title"]', "FEEDBACK_UI_TITLE")
  await command("fill", '[data-field="feedback-details"]', "Reproduction details visible only in this draft")
  await command("select", '[data-field="feedback-type"]', "idea")
  await command("scrollintoview", '[data-action="feedback-save"]')
  await command(
    "eval",
    `(()=>{const el=document.querySelector('[data-action="feedback-save"]');const r=el.getBoundingClientRect();return {rect:r.toJSON(),target:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML,scroll:document.querySelector('[data-component="feedback-dialog"]').scrollTop}})()`,
  )
  await command("screenshot", join(runtime.output, "before-save.png"))
  await command("click", '[data-action="feedback-save"]')
  const draft = await poll(async () => (await runtime.api(endpoint))[0], "saved feedback draft")
  assert.equal(draft.title, "FEEDBACK_UI_TITLE")
  assert.equal(draft.type, "idea")
  assert.equal(draft.revision, 1)
  checks.push("composer-entrypoint", "create-local-draft", "type-selection")
  await command("reload")
  await command("wait", '[data-action="session-feedback"]')
  await command("click", '[data-action="session-feedback"]')
  await command("wait", `[data-feedback-draft="${draft.id}"]`)
  await command("click", `[data-feedback-draft="${draft.id}"]`)
  assert.equal(
    JSON.parse(await command("eval", 'document.querySelector("[data-field=feedback-title]").value')),
    draft.title,
  )
  await command("fill", '[data-field="feedback-details"]', "UPDATED_FEEDBACK_DETAILS")
  await command("click", '[data-action="feedback-review"]')
  await command("wait", '[data-component="feedback-preview"]')
  assert.match(await command("get", "text", '[data-component="feedback-preview"]'), /UPDATED_FEEDBACK_DETAILS/)
  assert.equal((await runtime.api(endpoint))[0].revision, 2)
  await command("download", '[data-action="feedback-download"]', join(runtime.output, "feedback.md"))
  assert.match(
    await readFile(join(runtime.output, "feedback.md"), "utf8"),
    /FEEDBACK_UI_TITLE[\s\S]*UPDATED_FEEDBACK_DETAILS/,
  )
  checks.push("reload-persistence", "edit-and-review-exact-revision", "markdown-download")
  await command("screenshot", join(runtime.output, "review.png"))
  await runtime.api(endpoint, {
    title: "OTHER_EDITOR",
    details: "NEWER_DETAILS",
    type: "bug",
    draft_id: draft.id,
    revision: 2,
  })
  await command("fill", '[data-field="feedback-title"]', "STALE_EDITOR")
  assert.equal(Number((await command("get", "count", '[data-component="feedback-preview"]')).trim()), 0)
  await command("click", '[data-action="feedback-save"]')
  await command("wait", '[role="alert"]')
  assert.equal((await runtime.api(endpoint))[0].title, "OTHER_EDITOR")
  assert.equal(
    JSON.parse(await command("eval", 'document.querySelector("[data-field=feedback-title]").value')),
    "STALE_EDITOR",
  )
  checks.push("editing-invalidates-review", "revision-conflict-preserves-text")
  await command("find", "role", "button", "click", "--name", "Refresh drafts")
  await command("wait", `[data-feedback-draft="${draft.id}"]`)
  await command("find", "role", "button", "click", "--name", "OTHER_EDITOR")
  await command("click", '[data-action="feedback-delete"]')
  assert.equal((await runtime.api(endpoint)).length, 1)
  await command("find", "role", "button", "click", "--name", "Cancel", "--exact")
  assert.equal((await runtime.api(endpoint)).length, 1)
  await command("click", '[data-action="feedback-delete"]')
  await command("click", '[data-action="feedback-delete-confirm"]')
  await poll(async () => !(await runtime.api(endpoint)).length, "delete confirmed")
  checks.push("delete-cancel", "delete-confirmed")
  await command("fill", '[data-field="feedback-title"]', "LARGE_FEEDBACK")
  await command("fill", '[data-field="feedback-details"]', "Long feedback detail. ".repeat(600))
  await command("click", '[data-action="feedback-review"]')
  await command("wait", '[data-component="feedback-preview"]')
  assert.match(await command("get", "text", '[data-component="feedback-preview"]'), /too large for a prefilled link/)
  await command("screenshot", join(runtime.output, "large.png"))
  assert.equal(await command("is", "enabled", '[data-action="feedback-copy"]'), "true\n")
  assert.equal(await command("is", "enabled", '[data-action="feedback-download"]'), "true\n")
  assert.equal((await runtime.api(endpoint)).length, 1)
  assert.deepEqual((await runtime.api(`/api/session/${session.id}/context`)).data, [])
  assert.equal(runtime.calls.length, 0)
  checks.push("large-draft-copy-download-fallback", "no-main-turn-or-submission")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, output: runtime.output }))
} finally {
  await command("screenshot", join(runtime.output, "final.png")).catch(() => {})
  await command("close").catch(() => {})
  if (native.child && native.child.exitCode === null) {
    native.child.kill("SIGTERM")
    await deadline(native.exited, 15_000, "owned side-question native exit").catch(async () => {
      native.child.kill("SIGKILL")
      await native.exited
    })
  }
  if (kind === "native") await writeFile(join(runtime.output, "native.log"), Buffer.concat(nativeLogs))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  state.nativeChild?.kill("SIGTERM")
  await deadline(state.nativeExited, 10000, "native server cleanup").catch(() => state.nativeChild?.kill("SIGKILL"))
  await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(serverLogs))
  await runtime.close()
  await writeFile(
    join(runtime.output, "native-feedback-ui.json"),
    JSON.stringify({ checks, history, requests }, null, 2),
  )
}

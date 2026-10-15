import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startMemoryOperationUiFixture } from "./grok-memory-dream-cleanup-ui-fixture.mjs"
const kind = process.argv[2] ?? "browser"
const fixture = await startMemoryOperationUiFixture()
const { runtime, repo } = fixture
const previewGate = { enabled: false, entered: false, release: undefined }
const statusGate = { enabled: false, entered: false, release: undefined }
const requests = []
const server = createServer((incoming, response) => {
  const chunks = []
  incoming.on("data", (chunk) => chunks.push(chunk))
  response.on("finish", () =>
    requests.push({
      method: incoming.method,
      path: incoming.url,
      status: response.statusCode,
      body: Buffer.concat(chunks).toString(),
    }),
  )
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
      const gate =
        incoming.method === "GET"
          ? url.pathname.endsWith("/memory/recovery") && previewGate.enabled
            ? previewGate
            : url.pathname.endsWith("/memory/operation") && statusGate.enabled
              ? statusGate
              : undefined
          : undefined
      if (gate) {
        gate.enabled = false
        gate.entered = true
        const chunks = []
        reply.on("data", (chunk) => chunks.push(chunk))
        reply.on("end", () => {
          void gate.release.promise.then(() => {
            if (!response.destroyed) {
              response.writeHead(reply.statusCode, reply.headers)
              response.end(Buffer.concat(chunks))
            }
          })
        })
        response.on("close", () => reply.destroy())
        return
      }
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
const scopeServer = createServer(server.listeners("request")[0])
await new Promise((resolve) => scopeServer.listen(0, "127.0.0.1", resolve))
const browserSession = `native-memory-operations-${kind}-${basename(runtime.output)}`
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
    `const {app}=require('electron');console.log('Memory fixture initial app path:',app.getAppPath());if(!${JSON.stringify(process.argv.includes("--probe-original"))})app.setAppPath(${JSON.stringify(desktop)});console.log('Memory fixture corrected app path:',app.getAppPath());app.setPath('appData',${JSON.stringify(appData)});import(${JSON.stringify(pathToFileURL(join(desktop, "out/main/index.js")).href)});`,
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
  const result = await promisify(execFile)(
    process.env.APEXO_AGENT_BROWSER ?? "bunx",
    [
      ...(process.env.APEXO_AGENT_BROWSER ? [] : ["agent-browser"]),
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
const before = runtime.calls.length
const browserUrl = `http://127.0.0.1:${server.address().port}`
const scopeUrl = `http://127.0.0.1:${scopeServer.address().port}`
const savedServers = {
  list: [browserUrl, scopeUrl].map((url) => ({ type: "http", http: { url } })),
  projects: {},
  lastProject: {},
  recentlyClosed: {},
}
const route = (session, url = browserUrl) => `/server/${Buffer.from(url).toString("base64url")}/session/${session.id}`
const go = async (session, controls = true, url = browserUrl) => {
  await command(
    "eval",
    kind === "native"
      ? `(()=>{const link=document.createElement("a");link.href=${JSON.stringify(route(session, url))};link.setAttribute("link","");document.body.append(link);link.click();link.remove()})()`
      : `history.pushState({},"",${JSON.stringify(route(session, url))});dispatchEvent(new PopStateEvent("popstate"))`,
  )
  if (controls) await command("wait", '[data-action="session-memory"]')
}
const text = () => command("eval", "document.body.innerText")
const memoryText = () => command("eval", 'document.querySelector("[data-component=memory-browser]")?.innerText ?? ""')
const show = async () => {
  await command("click", '[data-action="session-memory"]')
  await command("wait", '[data-component="memory-browser"]')
}
try {
  if (kind === "native") {
    await poll(
      () =>
        fetch(`http://127.0.0.1:${native.port}/json/list`)
          .then((r) => r.json())
          .then((tabs) => tabs.some((tab) => tab.type === "page"))
          .catch(() => false),
      "native Memory window",
    )
    await command("wait", "--fn", "!!window.api?.awaitInitialization")
    await command("eval", "window.api.awaitInitialization()")
    await command("eval", `window.api.setDefaultServerUrl(${JSON.stringify(browserUrl)})`)
    await command(
      "eval",
      `window.api.storeSet("apexo.global.dat","server",${JSON.stringify(JSON.stringify(savedServers))})`,
    )
    await command(
      "eval",
      `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route(fixture.session))});return true})()`,
    )
    await command("reload")
  } else {
    await command("open", `${browserUrl}${route(fixture.session)}`)
    await command(
      "eval",
      `localStorage.setItem("apexo.global.dat:server",${JSON.stringify(JSON.stringify(savedServers))})`,
    )
    await command("reload")
  }
  const view = () => command("eval", 'document.querySelector("[data-component=memory-operations]")?.innerText ?? ""')
  const open = async () => {
    await show()
    await command("click", '[data-action="memory-operations-open"]')
    await command("wait", '[data-component="memory-operations"]')
    await ready()
  }
  const ready = () =>
    command("wait", "--fn", 'document.querySelector("[data-action=memory-operation-prepare]")?.disabled === false')
  const choose = async (choice) => {
    await ready()
    await command("select", '[data-action="memory-operation-choice"]', choice)
  }
  const prepare = async (choice) => {
    await choose(choice)
    await command("click", '[data-action="memory-operation-prepare"]')
    await ready()
  }
  const rows = () => runtime.api(`${fixture.root}/operation`)
  const waitResult = async (operation, expected) => {
    const row = await poll(
      async () =>
        (await rows()).find(
          (row) => row.kind === operation && row.state === "finished" && row.result.status === expected,
        ),
      `${operation} ${expected}`,
      20000,
    )
    await command("wait", `[data-operation-id="${row.id}"]`)
    return row
  }
  await command("wait", '[data-action="session-memory"]')
  await command("fill", '[contenteditable="true"]', "/dream")
  await command("press", "Enter")
  await command("wait", '[data-component="memory-operations"]')
  await ready()
  assert.equal(runtime.calls.length, before)
  checks.push("dream-slash-opens-passive-confirmed-action-view")
  await command("press", "Escape")
  await command("wait", "--fn", '!document.querySelector("[data-component=memory-operations]")')
  await command("fill", '[contenteditable="true"]', "Complete the live task and preserve useful memories.")
  await command("press", "Enter")
  const dream = await poll(
    async () => (await rows()).find((row) => row.kind === "dream" && row.state === "finished"),
    "activity Dream result",
    20000,
  )
  assert.equal(dream.result.status, "completed")
  assert.equal(fixture.state.main, 1)
  assert.equal(fixture.state.dream, 1)
  await open()
  await command("wait", `[data-operation-id="${dream.id}"]`)
  await command("click", `[data-operation-id="${dream.id}"]`)
  await ready()
  await command("wait", '[data-component="memory-operation-detail"] [role="status"]')
  await command("wait", "--fn", 'document.querySelector("[data-action=memory-operation-retry]")?.disabled === false')
  assert.match(await readFile(fixture.file, "utf8"), /LEGACY_DREAM_UI_RESULT/)
  assert.equal(await Bun.file(fixture.source).exists(), false)
  await command("screenshot", join(runtime.output, "cleanup-dream-completed.png"))
  checks.push("real-composer-automatic-Dream-visibly-completes-and-removes-consumed-old-source")
  await fixture.addSource()
  const periodic = await poll(
    async () => (await rows()).find((row) => row.kind === "dream" && row.id !== dream.id && row.state === "finished"),
    "periodic Dream result",
    20000,
  )
  assert.equal(periodic.result.status, "completed")
  await command("click", '[data-action="memory-operation-refresh"]')
  await ready()
  await command("wait", `[data-operation-id="${periodic.id}"]`)
  await command("click", `[data-operation-id="${periodic.id}"]`)
  await command("wait", '[data-component="memory-operation-detail"] [role="status"]')
  assert.equal(await Bun.file(fixture.later).exists(), false)
  await command("screenshot", join(runtime.output, "cleanup-dream-periodic.png"))
  assert.equal(fixture.state.main, 1)
  assert.equal(fixture.state.dream, 2)
  checks.push("periodic-Dream-visibly-completes-and-removes-only-later-consumed-source")
  const records = await fixture.records()
  assert.ok(!records.some((item) => item.path.includes("/experimental/") && item.path.includes("memory")))
  assert.ok(!requests.some((item) => item.method === "POST" && item.path.includes("/memory/dream")))
  assert.ok(!requests.some((item) => item.method === "POST" && item.path.includes("/memory/retry")))
  checks.push("automatic-work-uses-canonical-native-owner-with-no-manual-Dream-request")
  console.log(JSON.stringify({ kind, checks, providerCalls: runtime.calls.length, output: runtime.output }, null, 2))
} catch (error) {
  await command("eval", "document.body.innerText")
    .then((value) => writeFile(join(runtime.output, "failure.txt"), value))
    .catch(() => {})
  await command("screenshot", join(runtime.output, "failure.png")).catch(() => {})
  throw error
} finally {
  previewGate.release?.resolve()
  statusGate.release?.resolve()
  await command("close").catch(() => {})
  if (native.child && native.child.exitCode === null) {
    native.child.kill("SIGTERM")
    await deadline(native.exited, 15000, "Memory native cleanup").catch(async () => {
      native.child.kill("SIGKILL")
      await native.exited
    })
  }
  if (kind === "native") await writeFile(join(runtime.output, "native.log"), Buffer.concat(nativeLogs))
  scopeServer.closeAllConnections()
  await new Promise((resolve) => scopeServer.close(resolve))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await fixture.close()
  await writeFile(
    join(runtime.output, "memory-operations-ui.json"),
    JSON.stringify({ checks, history, requests }, null, 2),
  )
  console.error(`Memory operation UI evidence: ${runtime.output}`)
}

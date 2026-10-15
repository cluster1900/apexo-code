import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startMemoryUiFixture } from "./grok-memory-ui-fixture.mjs"
const kind = process.argv[2] ?? "browser"
const fixture = await startMemoryUiFixture()
const { runtime, repo } = fixture
const previewGate = { enabled: false, entered: false, release: undefined }
const statusGate = { enabled: false, entered: false, release: undefined }
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
      const gate =
        incoming.method === "GET"
          ? url.pathname.endsWith("/memory/note") && previewGate.enabled
            ? previewGate
            : url.pathname.endsWith("/memory") && statusGate.enabled
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
const browserSession = `native-memory-${kind}-${basename(runtime.output)}`
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
  for (const locale of process.argv.includes("--locales") ? ["en", "zh", "zht"] : ["en"]) {
    if (locale !== "en") {
      if (kind === "native")
        await command(
          "eval",
          `window.api.storeSet("apexo.global.dat","language",JSON.stringify({locale:${JSON.stringify(locale)}}))`,
        )
      await command(
        "eval",
        `localStorage.setItem("apexo.global.dat:language",JSON.stringify({locale:${JSON.stringify(locale)}}))`,
      )
      await command("reload")
    }
    await go(fixture.session)
    await show()
    await command("wait", '[data-component="memory-capabilities"]')
    await poll(
      async () => (await runtime.api(`/api/session/${fixture.session.id}/memory`)).enabled === false,
      "native mode initially off",
    )
    assert.equal(
      (await command("eval", 'document.querySelectorAll("[data-component=memory-preview]").length')).trim(),
      "0",
    )
    assert.ok(!(await memoryText()).includes("MEMORY_UI_ORIGINAL"))
    await command("screenshot", join(runtime.output, `${locale}-disabled.png`))
    checks.push(`${locale}-default-off-passive-capabilities`)
    await command("click", '[data-action="memory-toggle"]')
    await command("wait", '[data-component="memory-preview"]')
    assert.ok((await memoryText()).includes("MEMORY_UI_ORIGINAL_中文"))
    await command("screenshot", join(runtime.output, `${locale}-preview.png`))
    checks.push(`${locale}-enable-and-preview`)
    if (locale === "en") {
      await command("fill", '[data-component="memory-browser"] input[type="search"]', "MEMORY_UI_NO_MATCH")
      await command(
        "wait",
        "--fn",
        '!document.querySelector("[data-memory-path]") && !document.querySelector("[data-component=memory-preview]")',
      )
      await command("fill", '[data-component="memory-browser"] input[type="search"]', "MEMORY_UI_ORIGINAL")
      await command("wait", '[data-component="memory-preview"]')
      assert.ok((await memoryText()).includes("MEMORY_UI_ORIGINAL_中文"))
      await command("fill", '[data-component="memory-browser"] input[type="search"]', "")
      await command("wait", '[data-component="memory-preview"]')
      checks.push("native-search-empty-and-matching-catalog")
    }
    await command("click", '[data-action="memory-toggle"]')
    await command("wait", "--fn", '!document.querySelector("[data-component=memory-preview]")')
    assert.match(await readFile(fixture.file, "utf8"), /MEMORY_UI_ORIGINAL/)
    checks.push(`${locale}-disable-clears-visible-content-keeps-note`)
    await command("press", "Escape")
  }
  await fixture.mode(true)
  await show()
  await command("wait", '[data-component="memory-preview"]')
  statusGate.enabled = true
  statusGate.release = Promise.withResolvers()
  await command("click", '[data-action="memory-refresh"]')
  await poll(() => statusGate.entered, "actual enabled status response held")
  await command("click", '[data-action="memory-toggle"]')
  await poll(
    async () => !(await runtime.api(`/api/session/${fixture.session.id}/memory`)).enabled,
    "disable while status held",
  )
  statusGate.release.resolve()
  await command("wait", "300")
  assert.equal(
    (await command("eval", 'document.querySelectorAll("[data-component=memory-preview]").length')).trim(),
    "0",
  )
  assert.ok(!(await memoryText()).includes("MEMORY_UI_ORIGINAL"))
  checks.push("old-status-cannot-overwrite-completed-disable")
  await command("click", '[data-action="memory-toggle"]')
  await command("wait", '[data-component="memory-preview"]')
  previewGate.enabled = true
  previewGate.release = Promise.withResolvers()
  await command("click", '[data-action="memory-refresh"]')
  await poll(() => previewGate.entered, "actual preview response held")
  await command("click", '[data-action="memory-toggle"]')
  await poll(
    async () => !(await runtime.api(`/api/session/${fixture.session.id}/memory`)).enabled,
    "disable while preview held",
  )
  previewGate.release.resolve()
  await command("wait", "--fn", '!document.querySelector("[data-component=memory-preview]")')
  assert.ok(!(await memoryText()).includes("MEMORY_UI_ORIGINAL"))
  checks.push("disable-aborts-held-preview-without-late-content")
  await command("click", '[data-action="memory-toggle"]')
  await command("wait", '[data-component="memory-preview"]')
  await go(fixture.session, true, scopeUrl)
  await command("wait", "--fn", '!document.querySelector("[data-component=memory-browser]")')
  checks.push("same-session-id-server-scope-change-closes-browser")
  await go(fixture.session)
  await show()
  await command("wait", '[data-component="memory-preview"]')
  await command("click", '[data-action="memory-delete"]')
  await writeFile(fixture.file, "# Memory UI\nMEMORY_UI_CHANGED_中文\n")
  await command("click", '[data-action="memory-delete-confirm"]')
  await command("wait", '[data-component="memory-browser"] [role="alert"]')
  assert.match(await readFile(fixture.file, "utf8"), /MEMORY_UI_CHANGED/)
  assert.equal(
    (await command("eval", 'document.querySelectorAll("[data-component=memory-preview]").length')).trim(),
    "0",
  )
  await command("screenshot", join(runtime.output, "changed-hash.png"))
  checks.push("changed-hash-refused-without-retry-or-stale-content")
  await command("click", '[data-action="memory-refresh"]')
  await command("wait", '[data-component="memory-preview"]')
  assert.ok((await memoryText()).includes("MEMORY_UI_CHANGED_中文"))
  await command("click", '[data-action="memory-delete"]')
  await command("click", '[data-action="memory-delete-confirm"]')
  await poll(
    async () => (await readFile(fixture.file, "utf8").catch(() => undefined)) === undefined,
    "reviewed single-note deletion",
  )
  checks.push("fresh-preview-and-confirmed-hash-deletion")
  await command("press", "Escape")
  await go(fixture.managed, false)
  await poll(async () => (await text()).includes("MANAGED_CHILD_DONE"), "managed child transcript")
  assert.equal((await command("eval", 'document.querySelectorAll("[data-action=session-memory]").length')).trim(), "0")
  await runtime.api(`/api/session/${fixture.managed.id}/memory`, undefined, "GET", 409)
  assert.ok(!(await text()).includes(fixture.file))
  await command("screenshot", join(runtime.output, "managed-restricted.png"))
  checks.push("real-task-child-has-no-management-controls-and-status-refuses")
  await go(fixture.session)
  await command("fill", '[contenteditable="true"]', "/flush")
  await command("press", "Enter")
  await poll(async () => /not available|暂不支持|尚不支援/.test(await text()), "unsupported native command guidance")
  checks.push("unsupported-command-consumed-without-model-work")
  assert.equal(runtime.calls.length, before)
  const records = await fixture.records()
  assert.ok(!records.some((item) => item.path.includes("/experimental/") && item.path.includes("memory")))
  checks.push("passive-management-no-provider-and-no-compatibility-memory-request")
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
  await writeFile(join(runtime.output, "memory-ui.json"), JSON.stringify({ checks, history, requests }, null, 2))
  console.error(`Memory UI evidence: ${runtime.output}`)
}

import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

import { startOAuthUiFixture } from "./grok-mcp-oauth-ui-fixture.mjs"
const kind = process.argv[2] ?? "desktop"
const fixture = await startOAuthUiFixture()
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
const browserSession = `native-mcp-oauth-${kind}-${basename(runtime.output)}`
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
  if (["click", "download"].includes(args[0]) && args[1]?.includes("mcp")) {
    await command("scrollintoview", args[1])
    await command(
      "wait",
      "--fn",
      `(()=>{const target=document.querySelector(${JSON.stringify(args[1])});if(!target||target.disabled)return false;const r=target.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&target.contains(document.elementFromPoint(x,y))})()`,
    )
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
  history.push({ command: args[0], ok: true })
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
      "native MCP window",
    )
    await command("wait", "--fn", "!!window.api?.awaitInitialization")
    const connection = JSON.parse(await command("eval", "window.api.awaitInitialization()"))
    await command("eval", `window.api.setDefaultServerUrl(${JSON.stringify(runtime.url)})`)
    await command(
      "eval",
      `window.api.storeSet("apexo.global.dat", "server", JSON.stringify({list:[{type:"http",http:{url:${JSON.stringify(runtime.url)}}}],projects:{},lastProject:{},recentlyClosed:{}}))`,
    )
  }
  const session = (
    await runtime.api("/api/session", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
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
  await command("wait", '[data-action="session-hooks"]')
  // Status is opt-in in a fresh profile; exercise the real visibility setting first.
  await command("press", "Meta+,")
  await command("wait", '[data-action="settings-show-status"]')
  await command("scrollintoview", '[data-action="settings-show-status"]')
  await command("click", '[data-action="settings-show-status"] [data-slot="switch-control"]')
  await command("press", "Escape")
  // Electron keeps its Session route inside the renderer, not in the document URL.
  // Capture the current document before consent opens another browser tab.
  const appUrl = (await command("get", "url")).trim()
  const appTabs = JSON.parse(await command("tab", "list", "--json")).data.tabs.filter((tab) => tab.url === appUrl)
  assert.equal(appTabs.length, 1, "one owned app document before consent")
  const returnToApp = () => command("tab", appTabs[0].targetId)
  const root = '[data-component="native-mcp-manager"]'
  const row = `${root} [data-mcp-server="reference"]`
  const action = (verb) => command("click", `${row} [data-action="${verb}"]`)
  const inspect = async () => (await runtime.api("/api/mcp")).reference
  const en = (await import("../../app/src/i18n/en.ts")).dict
  const open = async (entry, dict) => {
    if (entry === "dialog") {
      await command("fill", '[contenteditable="true"]', "/mcp")
      await command("press", "Enter")
    } else {
      await command("find", "role", "button", "click", "--name", dict["status.popover.trigger"], "--exact")
      if (Number((await command("get", "count", root)).trim()) === 0)
        await command("find", "role", "tab", "click", "--name", "MCP")
    }
    await command("wait", `${row} [data-action="authenticate"]`)
  }
  const contents = () => command("get", "text", row)
  await open("dialog", en)
  assert.equal(fixture.issuer.state.authorize, 0)
  assert.equal(fixture.issuer.state.initializes, 0)
  checks.push("passive-native-manager-does-not-start-authentication")
  await action("authenticate")
  await poll(() => fixture.issuer.state.authorize === 1, "explicit browser authorization page")
  await returnToApp()
  await command("wait", `${row} [data-action="auth-cancel"]`)
  await command("wait", `${row} input[readonly]`)
  await command("find", "role", "button", "click", "--name", en["mcp.runtime.refresh"], "--exact")
  await command("wait", `${row} input[readonly]`)
  assert.equal(Number((await command("get", "count", `${row} [data-action="auth-copy"]`)).trim()), 1)
  // The URL is deliberately never captured in command history/screenshots.
  await action("auth-cancel")
  await command("wait", "--text", en["mcp.auth.cancelled"])
  assert.equal(fixture.issuer.state.grants, 0)
  assert.equal(Number((await command("get", "count", `${row} input[readonly]`)).trim()), 0)
  checks.push("explicit-client-opens-bound-page-and-exact-cancel-cleans-flow")
  await action("authenticate")
  await poll(() => fixture.issuer.state.authorize === 2, "second explicit page")
  await returnToApp()
  const oldFlow = (await inspect()).authentication.flow.id
  await runtime.api(`/api/mcp/reference/auth/${oldFlow}`, undefined, "DELETE")
  const replacement = await runtime.api("/api/mcp/reference/auth/start", undefined, "POST")
  assert.notEqual(replacement.id, oldFlow)
  await command("find", "role", "button", "click", "--name", en["mcp.runtime.refresh"], "--exact")
  await command("wait", "--fn", `!document.querySelector('${row} input[readonly]')`)
  assert.equal((await inspect()).authentication.flow.id, replacement.id)
  await action("auth-cancel")
  await command("wait", "--text", en["mcp.auth.cancelled"])
  checks.push("replacement-flow-clears-old-link-without-reopening-browser")
  await action("authenticate")
  await poll(() => fixture.issuer.state.authorize === 3, "fresh consent after replacement")
  await fixture.consent()
  await returnToApp()
  await command("wait", "--text", en["mcp.auth.ready"])
  assert.equal((await inspect()).status, "disabled")
  assert.equal(fixture.issuer.state.initializes, 0)
  await action("connect")
  await command("wait", `${row} [data-action="disconnect"]`)
  assert.equal((await inspect()).tools, 1)
  checks.push("disabled-consent-saves-credentials-then-explicit-connect-publishes-tools")
  fixture.issuer.state.denied = true
  await action("authenticate")
  await poll(() => fixture.issuer.state.authorize === 4, "denial page")
  await fixture.consent()
  await returnToApp()
  await command("wait", "--text", en["mcp.auth.failed"])
  assert.equal((await inspect()).status, "connected")
  assert.equal((await inspect()).tools, 1)
  fixture.issuer.state.denied = false
  checks.push("declined-consent-retains-healthy-tools")
  await command("press", "Escape")
  for (const locale of process.argv.includes("--locales") ? ["en", "zh", "zht"] : ["en"]) {
    const dict = (await import(`../../app/src/i18n/${locale}.ts`)).dict
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
    await command("wait", '[data-action="session-hooks"]')
    for (const entry of ["dialog", "status"]) {
      await open(entry, dict)
      const text = await contents()
      assert.ok(text.includes(dict["mcp.auth.start"]))
      assert.ok(text.includes(dict["mcp.auth.remote"]))
      assert.ok(text.includes(dict["mcp.auth.failed"]))
      const geometry = JSON.parse(
        await command(
          "eval",
          `(()=>{const r=document.querySelector(${JSON.stringify(row)});const b=r.querySelector('[data-action="authenticate"]');const x=b.getBoundingClientRect();return {width:x.width,height:x.height,overflow:r.scrollWidth>r.clientWidth+1}})()`,
        ),
      )
      assert.ok(geometry.width > 0 && geometry.height > 0 && !geometry.overflow)
      await command("scrollintoview", `${row} [data-action="authenticate"]`)
      await command("screenshot", join(runtime.output, `oauth-${locale}-${entry}.png`))
      await command("press", "Escape")
    }
    checks.push(`${locale}-both-entrypoints-localized-and-visible`)
  }
  assert.equal(runtime.calls.length, 0)
  assert.equal(await readFile(join(runtime.directory, "apexo.json"), "utf8"), fixture.config)
  checks.push("no-provider-work-or-config-mutation")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, output: runtime.output }))
} finally {
  // A pending authorization link is a direct-response secret, not a diagnostic artifact.
  const visibleLinks = await command(
    "get",
    "count",
    '[data-component="native-mcp-authentication"] input[readonly]',
  ).catch(() => "1")
  if (Number(visibleLinks.trim()) === 0) await command("screenshot", join(runtime.output, "final.png")).catch(() => {})
  await command("close").catch(() => {})
  if (native.child && native.child.exitCode === null) {
    native.child.kill("SIGTERM")
    await deadline(native.exited, 15_000, "owned MCP native exit").catch(async () => {
      native.child.kill("SIGKILL")
      await native.exited
    })
  }
  if (kind === "native") await writeFile(join(runtime.output, "native.log"), Buffer.concat(nativeLogs))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await fixture.close()
  await writeFile(
    join(runtime.output, "native-mcp-oauth-ui.json"),
    JSON.stringify({ checks, history, requests }, null, 2),
  )
}

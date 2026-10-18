import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

import { startMcpUiFixture } from "./grok-mcp-ui-fixture.mjs"
// The app binds mod+key: Cmd on macOS, Ctrl elsewhere.
const mod = process.platform === "darwin" ? "Meta" : "Control"
const kind = process.argv[2] ?? "desktop"
const fixture = await startMcpUiFixture()
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
const browserSession = `native-mcp-${kind}-${basename(runtime.output)}`
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
  await command("press", `${mod}+,`)
  await command("wait", '[data-action="settings-show-status"]')
  await command("scrollintoview", '[data-action="settings-show-status"]')
  await command("click", '[data-action="settings-show-status"] [data-slot="switch-control"]')
  await command("press", "Escape")
  const root = '[data-component="native-mcp-manager"]'
  const row = (name) => `${root} [data-mcp-server="${name}"]`
  const action = (name, verb) => command("click", `${row(name)} [data-action="${verb}"]`)
  const text = () => command("get", "text", root)
  const postCount = async () =>
    (await fixture.records()).filter((item) => item.method === "POST" && item.path.startsWith("/api/mcp/")).length
  const inspect = () => runtime.api("/api/mcp")
  const open = async (entry, dictionary) => {
    if (entry === "dialog") {
      await command("fill", '[contenteditable="true"]', "/mcp")
      await command("press", "Enter")
    } else {
      await command("find", "role", "button", "click", "--name", dictionary["status.popover.trigger"], "--exact")
      // Compatibility-layout popovers default to Servers; native layouts default to MCP.
      if (Number((await command("get", "count", root)).trim()) === 0)
        await command("find", "role", "tab", "click", "--name", "MCP")
    }
    await command("wait", row("a-local"))
    await command("wait", `${row("a-local")} [data-action="disconnect"]`)
  }
  const en = (await import("../../app/src/i18n/en.ts")).dict
  const passiveStarts = await fixture.starts()
  const passivePosts = await postCount()
  await open("dialog", en)
  assert.ok((await text()).includes(en["mcp.runtime.hint"]))
  assert.ok((await command("get", "text", row("a-local"))).includes(en["mcp.runtime.tools"].replace("{{count}}", "1")))
  assert.ok((await command("get", "text", row("z-auth"))).includes(en["mcp.runtime.authUnavailable"]))
  assert.equal(await fixture.starts(), passiveStarts)
  assert.equal(await postCount(), passivePosts)
  checks.push("passive-dialog-and-explicit-auth-boundary")
  await action("a-local", "disconnect")
  await command("wait", `${row("a-local")} [data-action="connect"]`)
  assert.equal((await inspect())["a-local"].status, "disabled")
  assert.equal((await inspect())["a-local"].preference, false)
  assert.ok((await command("get", "text", row("a-local"))).includes(en["mcp.preference.disabled"]))
  await action("a-local", "resetPreference")
  await command("wait", `${row("a-local")} [data-action="disconnect"]`)
  assert.equal((await inspect())["a-local"].preference, undefined)
  await action("a-local", "disconnect")
  await command("wait", `${row("a-local")} [data-action="connect"]`)
  checks.push("saved-choice-visible-and-reset-applies-configuration")
  await action("a-local", "connect")
  await command("wait", `${row("a-local")} [data-action="disconnect"]`)
  const connected = await fixture.starts()
  await action("a-local", "retry")
  await poll(
    async () => (await fixture.starts()) > connected && (await inspect())["a-local"].status === "connected",
    "retry transport",
  )
  checks.push("disconnect-connect-retry")
  await writeFile(fixture.mode, "fail")
  await action("a-local", "retry")
  await command("wait", "--text", en["common.requestFailed"])
  assert.equal((await inspect())["a-local"].status, "connected")
  assert.equal((await inspect())["a-local"].tools, 1)
  checks.push("failed-retry-preserves-healthy-connection")
  await action("a-local", "disconnect")
  await command("wait", `${row("a-local")} [data-action="connect"]`)
  await action("a-local", "connect")
  await poll(async () => (await inspect())["a-local"].status === "failed", "failed connect")
  await command("wait", `${row("a-local")} [data-action="connect"]`)
  assert.equal((await inspect())["a-local"].preference, false)
  const failureText = (await inspect())["a-local"].error
  assert.ok(failureText)
  await writeFile(fixture.mode, "ready")
  await action("a-local", "connect")
  await command("wait", `${row("a-local")} [data-action="disconnect"]`)
  assert.equal((await inspect())["a-local"].tools, 1)
  assert.ok(!(await command("get", "text", row("a-local"))).includes(failureText))
  checks.push("failed-connect-recovery")
  const reconnectPosts = await postCount()
  const reconnectStarts = await fixture.starts()
  const live = (await readFile(fixture.trace, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse)
    .filter((entry) => entry.event === "start")
    .at(-1)
  await writeFile(fixture.mode, "fail")
  process.kill(live.pid, "SIGKILL")
  await command(
    "wait",
    "--fn",
    `document.querySelector(${JSON.stringify(row("a-local"))})?.textContent.includes(${JSON.stringify(en["mcp.status.failed"])}) && !document.querySelector(${JSON.stringify(`${row("a-local")} [data-action="disconnect"]`)})`,
  )
  assert.ok((await command("get", "text", row("a-local"))).includes(en["mcp.runtime.tools"].replace("{{count}}", "0")))
  await writeFile(fixture.mode, "ready")
  await command("wait", `${row("a-local")} [data-action="disconnect"]`)
  assert.equal((await inspect())["a-local"].tools, 1)
  assert.ok((await fixture.starts()) > reconnectStarts)
  assert.equal(await postCount(), reconnectPosts, "live status recovery requires no management action or refresh")
  checks.push("open-manager-live-disconnect-and-automatic-recovery")
  const refresh = async (dictionary) =>
    command("find", "role", "button", "click", "--name", dictionary["mcp.runtime.refresh"], "--exact")
  await writeFile(fixture.outage, "503")
  await refresh(en)
  await command("wait", `${root} [role="alert"]`)
  assert.ok(!(await text()).includes(en["dialog.mcp.empty"]))
  await rm(fixture.outage)
  await refresh(en)
  await command("wait", "--fn", `!document.querySelector('${root} [role="alert"]')`)
  checks.push("refresh-outage-distinct-from-empty-and-recovery")
  await command("press", "Escape")
  await open("status", en)
  const beforeRefresh = await postCount()
  await runtime.api("/api/mcp/b-disabled/connect", undefined, "POST")
  await refresh(en)
  await command("wait", `${row("b-disabled")} [data-action="disconnect"]`)
  assert.equal(await postCount(), beforeRefresh + 1)
  await action("b-disabled", "disconnect")
  await command("wait", `${row("b-disabled")} [data-action="connect"]`)
  checks.push("status-popover-controls-and-manual-refresh")
  await command("press", "Escape")
  for (const locale of process.argv.includes("--locales") ? ["en", "zh", "zht"] : ["en"]) {
    const dictionary = (await import(`../../app/src/i18n/${locale}.ts`)).dict
    if (kind === "native")
      await command(
        "eval",
        `window.api.storeSet("apexo.global.dat", "language", JSON.stringify({locale:${JSON.stringify(locale)}}))`,
      )
    await command(
      "eval",
      `localStorage.setItem("apexo.global.dat:language", JSON.stringify({locale:${JSON.stringify(locale)}}))`,
    )
    await command("reload")
    await command("wait", '[data-action="session-hooks"]')
    for (const entry of ["dialog", "status"]) {
      const before = await postCount()
      await open(entry, dictionary)
      const contents = await text()
      assert.ok(contents.includes(dictionary["mcp.runtime.hint"]))
      assert.ok(contents.includes(dictionary["mcp.runtime.authUnavailable"]))
      assert.ok(contents.includes(dictionary["mcp.runtime.refresh"]))
      assert.ok(contents.includes(dictionary["mcp.runtime.retry"]))
      assert.ok(contents.includes(dictionary["mcp.runtime.tools"].replace("{{count}}", "1")))
      assert.equal(await postCount(), before)
      assert.equal(
        JSON.parse(
          await command(
            "eval",
            `document.querySelector('${root}').scrollWidth>document.querySelector('${root}').clientWidth+1`,
          ),
        ),
        false,
      )
      await command("screenshot", join(runtime.output, `mcp-${locale}-${entry}.png`))
      await command("scrollintoview", `${row("z-auth")} [data-action="retry"]`)
      await command("screenshot", join(runtime.output, `mcp-${locale}-${entry}-auth.png`))
      await command("press", "Escape")
    }
    checks.push(`${locale}-both-entrypoints-localized-and-passive`)
    await open("dialog", dictionary)
    const preferenceDirectory = join(runtime.env.XDG_DATA_HOME, runtime.env.APEXO_APP_DIR_NAME, "mcp-preferences")
    const preferenceNames = (await readdir(preferenceDirectory)).filter((name) => name.endsWith(".json"))
    assert.equal(preferenceNames.length, 1, "fixture owns exactly one Location preference document")
    const preferenceFile = join(preferenceDirectory, preferenceNames[0])
    const savedPreference = await readFile(preferenceFile)
    const providerBefore = runtime.calls.length
    try {
      await writeFile(preferenceFile, "{")
      await action("a-local", "retry")
      await command("wait", "--text", dictionary["mcp.preference.error"])
      assert.equal((await inspect())["a-local"].preferenceError, true)
      assert.equal((await inspect())["a-local"].status, "connected")
      assert.equal((await inspect())["a-local"].tools, 1)
      assert.ok(!(await text()).includes(preferenceFile), "storage feedback does not expose paths")
      assert.equal(runtime.calls.length, providerBefore)
      await command("scrollintoview", row("a-local"))
      await command("screenshot", join(runtime.output, `mcp-${locale}-preferences-storage-error.png`))
    } finally {
      await writeFile(preferenceFile, savedPreference)
    }
    await action("a-local", "retry")
    await poll(
      async () =>
        (await inspect())["a-local"].preferenceError === undefined &&
        !(await text()).includes(dictionary["mcp.preference.error"]),
      "storage preference recovery",
    )
    assert.equal((await inspect())["a-local"].status, "connected")
    assert.equal(runtime.calls.length, providerBefore)
    await command("screenshot", join(runtime.output, `mcp-${locale}-preferences-storage-recovered.png`))
    await command("press", "Escape")
    checks.push(`${locale}-storage-error-retains-tools-and-clears-after-repair`)
  }
  assert.equal(await readFile(join(runtime.directory, "apexo.json"), "utf8"), fixture.config)
  assert.equal(runtime.calls.length, 0)
  assert.ok(
    (await fixture.records())
      .filter((item) => item.method === "POST" && item.path.startsWith("/api/mcp/"))
      .every((item) => item.contentLength === null || item.contentLength === "0"),
  )
  checks.push("saved-choices-no-shared-config-write-no-model-work-no-control-body")
  const projectRequests = (await fixture.records()).filter((entry) =>
    ["/api/project", "/api/project/current"].includes(entry.path),
  )
  assert.ok(projectRequests.some((entry) => entry.path === "/api/project"))
  assert.ok(projectRequests.some((entry) => entry.path === "/api/project/current"))
  assert.ok(
    projectRequests.every((entry) => entry.status === 200),
    "native project bootstrap requests succeed",
  )
  assert.ok(!(await command("get", "text", "body")).includes("UnexpectedStatus"), "no project bootstrap error toast")
  checks.push("native-project-bootstrap-without-reload-errors")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, output: runtime.output }))
} finally {
  await command("screenshot", join(runtime.output, "final.png")).catch(() => {})
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
  await writeFile(join(runtime.output, "native-mcp-ui.json"), JSON.stringify({ checks, history, requests }, null, 2))
}

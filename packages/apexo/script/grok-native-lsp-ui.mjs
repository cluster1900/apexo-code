import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

import { startLspUiFixture } from "./grok-lsp-ui-fixture.mjs"
// The app binds mod+key: Cmd on macOS, Ctrl elsewhere.
const mod = process.platform === "darwin" ? "Meta" : "Control"
const kind = process.argv[2] ?? "desktop"
const recovery = process.argv.includes("--recovery")
const fixture = await startLspUiFixture({ recovery })
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
const browserSession = `native-lsp-${kind}-${basename(runtime.output)}`
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
const transitions = []
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
  const row = (name) => `[data-lsp-server="${name}"]`
  const open = async (dictionary) => {
    await command("find", "role", "button", "click", "--name", dictionary["status.popover.trigger"], "--exact")
    await command("find", "role", "tab", "click", "--name", "LSP")
    await command("wait", row("a-live"))
  }
  const starts = await fixture.starts()
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
    await open(dictionary)
    assert.ok((await command("get", "text", row("a-live"))).includes(dictionary["mcp.status.connected"]))
    assert.ok((await command("get", "text", row("b-disabled"))).includes(dictionary["mcp.status.disabled"]))
    assert.ok((await command("get", "text", row("c-failed"))).includes(dictionary["lsp.native.failed"]))
    const operations = await command("get", "text", `${row("a-live")} [data-lsp-operations]`)
    for (const name of [
      "goToDefinition",
      "findReferences",
      "hover",
      "goToImplementation",
      "documentSymbol",
      "workspaceSymbol",
    ])
      assert.ok(operations.includes(name))
    assert.equal(
      JSON.parse(
        await command(
          "eval",
          `Array.from(document.querySelectorAll('[data-lsp-server]')).some(x=>x.scrollWidth>x.clientWidth+1)`,
        ),
      ),
      false,
    )
    await command("screenshot", join(runtime.output, `lsp-${locale}.png`))
    await command("press", "Escape")
    checks.push(`${locale}-native-status-capabilities-failure-and-disabled`)
  }
  assert.equal(await fixture.starts(), starts)
  checks.push("status-open-and-locales-remain-passive")
  const dictionary = (await import(`../../app/src/i18n/${process.argv.includes("--locales") ? "zht" : "en"}.ts`)).dict
  await open(dictionary)
  const child = (await readFile(fixture.trace, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse)
    .find((x) => x.event === "start")
  if (recovery) {
    // Observe the real rendered row continuously: the one-second backoff may
    // complete between separate automation commands. Keep the panel open.
    await command(
      "eval",
      `(() => {
      const values=[];
      const capture=()=>{
        const target=document.querySelector(${JSON.stringify(row("a-live"))});
        if(!target)return;
        const state=target.querySelector('[data-lsp-error]')?'failed':'connected';
        if(values.at(-1)?.state!==state)values.push({state,text:target.textContent,time:Date.now()});
        document.documentElement.dataset.lspRecovery=JSON.stringify(values);
      };
      const observer=new MutationObserver(capture);
      observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-lsp-error']});
      capture();
      return true;
    })()`,
    )
    process.kill(child.pid, "SIGKILL")
    await command(
      "wait",
      "--fn",
      `(()=>{const states=JSON.parse(document.documentElement.dataset.lspRecovery||'[]');const failure=states.findIndex(value=>value.state==='failed');return failure>=0&&states.slice(failure+1).some(value=>value.state==='connected')})()`,
    )
    assert.equal(await fixture.starts(), starts + 1)
    assert.ok((await command("get", "text", row("a-live"))).includes(dictionary["mcp.status.connected"]))
    await command("screenshot", join(runtime.output, "lsp-live-recovered.png"))
    checks.push("open-panel-observes-real-crash-failed-then-connected-without-action")
    const replacement = (await readFile(fixture.trace, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse)
      .filter((value) => value.event === "start")
      .at(-1)
    process.kill(replacement.pid, "SIGKILL")
    await command("wait", `${row("a-live")} [data-lsp-error]`)
    await poll(
      async () =>
        (await runtime.api("/api/lsp")).find((value) => value.id === "a-live")?.error?.includes("budget exhausted"),
      "LSP UI lifetime budget exhausted",
    )
    await new Promise((resolve) => setTimeout(resolve, 2500))
    assert.equal(await fixture.starts(), starts + 1)
    assert.ok((await command("get", "text", row("a-live"))).includes(dictionary["lsp.native.failed"]))
    transitions.push(...JSON.parse(await command("eval", "JSON.parse(document.documentElement.dataset.lspRecovery)")))
    assert.deepEqual(
      transitions.map((value) => value.state),
      ["connected", "failed", "connected", "failed"],
    )
    await command("screenshot", join(runtime.output, "lsp-live-exhausted.png"))
    checks.push("second-crash-exhausts-lifetime-budget-without-further-start")
  } else {
    process.kill(child.pid, "SIGTERM")
    await command("wait", `${row("a-live")} [data-lsp-error]`)
    assert.ok((await command("get", "text", row("a-live"))).includes(dictionary["lsp.native.failed"]))
    assert.equal(await fixture.starts(), starts)
    await command("screenshot", join(runtime.output, "lsp-live-failure.png"))
    checks.push("live-connection-loss-refreshes-status-without-retry")
  }
  assert.ok(
    !(await fixture.records()).some(
      (value) => value.method === "POST" && /^\/api\/(plugins\/(?:manage|reload)|mcp|lsp)/.test(value.path),
    ),
  )
  assert.equal(runtime.calls.length, 0)
  assert.ok((await fixture.records()).some((x) => x.path === "/api/lsp" && x.status === 200))
  assert.ok(!(await fixture.records()).some((x) => x.path === "/lsp"))
  assert.equal(await readFile(join(runtime.directory, "apexo.json"), "utf8"), fixture.config)
  checks.push("native-routing-no-provider-work-no-config-mutation")
  console.log(JSON.stringify({ kind, recovery, passed: checks.length, checks, output: runtime.output }))
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
  await writeFile(
    join(runtime.output, "native-lsp-ui.json"),
    JSON.stringify({ checks, recovery, transitions, history, requests }, null, 2),
  )
}

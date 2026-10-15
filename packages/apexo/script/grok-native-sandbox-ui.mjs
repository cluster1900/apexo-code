import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { poll, deadline, startShellFixture } from "./grok-shell-fixture.mjs"
import { startSandboxUiFixture } from "./grok-sandbox-ui-fixture.mjs"
const kind = process.argv[2] ?? "browser"
const fixture = await startSandboxUiFixture()
const { runtime, repo } = fixture
const requests = []
const server = createServer((incoming, response) => {
  response.on("finish", () => requests.push({ path: incoming.url, status: response.statusCode }))
  const url = new URL(incoming.url, "http://localhost")
  const document = incoming.headers.accept?.includes("text/html")
  if (document || url.pathname.startsWith("/assets/") || /favicon|apple-touch-icon/.test(url.pathname)) {
    const file = Bun.file(
      join(process.env.SANDBOX_UI_APP_DIST ?? join(repo, "packages/app/dist"), document ? "index.html" : url.pathname),
    )
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
const browserSession = `native-sandbox-${kind}-${basename(runtime.output)}`
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
    `const {app}=require('electron');console.log('Sandbox fixture initial app path:',app.getAppPath());if(!${JSON.stringify(process.argv.includes("--probe-original"))})app.setAppPath(${JSON.stringify(desktop)});console.log('Sandbox fixture corrected app path:',app.getAppPath());app.setPath('appData',${JSON.stringify(appData)});import(${JSON.stringify(pathToFileURL(join(desktop, "out/main/index.js")).href)});`,
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
  if (["click", "download"].includes(args[0]) && args[1]?.includes("sandbox")) {
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
    }, `stable enabled sandbox action ${args[1]}`)
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
  const button = '[data-action="session-command-sandbox"]'
  const panel = '[data-component="command-sandbox-dialog"]'
  await command("wait", button)
  await command("click", button)
  await command("wait", '[data-status="sandbox-profile"]')
  assert.match(await command("get", "text", panel), /Stored profile: Off/)
  assert.equal(fixture.calls.length, before)
  assert.equal((await command("eval", `document.querySelectorAll('[data-profile]').length`)).trim(), "0")
  checks.push("passive-immutable-existing-off")
  await command("press", "Escape")
  for (const locale of process.argv.includes("--locales") ? ["en", "zh", "zht"] : ["en"]) {
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
    await command("wait", button)
    await command("click", button)
    await command("wait", '[data-status="sandbox-profile"]')
    const text = await command("get", "text", panel)
    assert.ok(text.includes(locale === "en" ? "native commands" : locale === "zh" ? "原生命令" : "原生指令"))
    await command("screenshot", join(runtime.output, `sandbox-status-${locale}.png`))
    await command("press", "Escape")
  }
  checks.push("localized-scope-and-limits")
  await writeFile(fixture.outage, "503")
  await command("click", button)
  await command("wait", `${panel} [role="alert"]`)
  assert.ok(!(await command("get", "text", panel)).includes("private fixture conflict cause"))
  await rm(fixture.outage)
  await command("press", "Escape")
  assert.equal(fixture.calls.length, before)
  checks.push("status-failure-visible-no-provider")
  for (const profile of ["off", "workspace", "read-only"]) {
    const callsBefore = fixture.calls.length
    await command(
      "click",
      '[aria-label="' + (process.argv.includes("--locales") ? "新增工作階段" : "New session") + '"]',
    )
    await command("wait", button)
    await command("click", button)
    await command("wait", '[data-profile="workspace"]:not([disabled])')
    assert.equal(
      (await command("eval", `document.querySelector('[data-profile="off"]').getAttribute('aria-pressed')`)).trim(),
      '"true"',
    )
    await command("click", `[data-profile="${profile}"]`)
    await command("screenshot", join(runtime.output, `sandbox-selection-${profile}.png`))
    await command("press", "Escape")
    await command("fill", '[contenteditable="true"]', `SANDBOX_UI_CREATE_${profile}`)
    if (profile === "workspace") {
      await writeFile(fixture.createOutage, "503")
      const createsBefore = (await fixture.records()).filter(
        (r) => r.path === "/api/session" && r.method === "POST",
      ).length
      await command("press", "Enter")
      await poll(
        async () => (await fixture.records()).some((r) => r.path === "/api/session" && r.status === 503),
        "visible creation failure",
      )
      await poll(
        async () =>
          (await command("get", "text", "body")).includes("Command sandbox is unavailable on this fixture backend."),
        "server creation error displayed",
      )
      await command("screenshot", join(runtime.output, "sandbox-create-failure-toasts.png"))
      const failureTitles = JSON.parse(
        await command(
          "eval",
          `Array.from(document.querySelectorAll('[data-slot="toast-title"], .toast-v2 [data-title]'), element => element.textContent)`,
        ),
      )
      assert.ok(
        failureTitles.includes(process.argv.includes("--locales") ? "建立工作階段失敗" : "Failed to create session"),
      )
      assert.ok(
        !failureTitles.includes(process.argv.includes("--locales") ? "傳送提示失敗" : "Failed to send prompt"),
        "a failed creation must not also report a prompt-send failure",
      )
      await command("click", button)
      await command("wait", '[data-profile="workspace"][aria-pressed="true"]')
      assert.equal(fixture.calls.length, callsBefore)
      assert.equal(
        (await fixture.records()).filter((r) => r.path === "/api/session" && r.method === "POST").length,
        createsBefore + 1,
      )
      await command("screenshot", join(runtime.output, "sandbox-create-failure.png"))
      await command("press", "Escape")
      await rm(fixture.createOutage)
      await command("click", '[contenteditable="true"]')
      checks.push("failed-selected-creation-retains-choice-without-off-fallback")
    }
    await command("press", "Enter")
    await poll(() => fixture.calls.length === callsBefore + 1, `ordinary ${profile} prompt provider call`)
    await poll(
      async () =>
        (await fixture.records()).some(
          (r) => r.path.endsWith("/prompt") && r.body?.includes(`SANDBOX_UI_CREATE_${profile}`) && r.status === 200,
        ),
      "native prompt admission",
    )
    const records = await fixture.records()
    const prompt = records.find((r) => r.path.endsWith("/prompt") && r.body?.includes(`SANDBOX_UI_CREATE_${profile}`))
    const id = prompt.path.split("/")[3]
    const status = await runtime.api(`/api/session/${id}/sandbox`)
    assert.equal(status.profile, profile)
    const creation = records.filter((r) => r.path === "/api/session" && r.method === "POST").at(-1)
    assert.equal(JSON.parse(creation.body).commandSandbox ?? "off", profile)
    await command("click", button)
    await command("wait", '[data-status="sandbox-profile"]')
    assert.equal((await command("eval", `document.querySelectorAll('[data-profile]').length`)).trim(), "0")
    await command("screenshot", join(runtime.output, `sandbox-created-${profile}.png`))
    await command("press", "Escape")
    checks.push(`${profile}-native-create-prompt-roundtrip-and-immutable-status`)
  }
  if (process.argv.includes("--compat-control")) {
    const compatibility = await startShellFixture("cli")
    try {
      const session = await compatibility.api("/session", {})
      const route = `/server/${Buffer.from(compatibility.url).toString("base64url")}/session/${session.id}`
      if (kind === "native") {
        await command("eval", `window.api.setDefaultServerUrl(${JSON.stringify(compatibility.url)})`)
        await command(
          "eval",
          `window.api.storeSet("apexo.global.dat","server",JSON.stringify({list:[{type:"http",http:{url:${JSON.stringify(compatibility.url)}}}],projects:{},lastProject:{},recentlyClosed:{}}))`,
        )
        await command(
          "eval",
          `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)});return true})()`,
        )
        await command("reload")
      } else {
        await command(
          "eval",
          `localStorage.setItem("apexo.global.dat:server",JSON.stringify({list:[{type:"http",http:{url:${JSON.stringify(compatibility.url)}}}],projects:{},lastProject:{},recentlyClosed:{}}))`,
        )
        await command("open", `${browserUrl}${route}`)
      }
      await command("wait", button)
      const before = (await compatibility.api("/session")).length
      await command(
        "click",
        '[aria-label="' + (process.argv.includes("--locales") ? "新增工作階段" : "New session") + '"]',
      )
      await command("wait", button)
      await command("click", button)
      await poll(
        async () =>
          (await command("get", "text", panel)).includes(
            process.argv.includes("--locales")
              ? "此連線使用相容工作階段建立流程"
              : "This connection uses compatibility Session creation",
          ),
        "compatibility protocol explanation",
      )
      assert.equal((await command("eval", `document.querySelectorAll('[data-profile][disabled]').length`)).trim(), "3")
      assert.equal(
        (await command("eval", `document.querySelector('[data-profile="off"]').getAttribute('aria-pressed')`)).trim(),
        '"true"',
      )
      assert.equal((await compatibility.api("/session")).length, before)
      assert.equal(compatibility.calls.length, 0)
      await command("screenshot", join(runtime.output, "sandbox-compatibility-disabled.png"))
      checks.push("compatibility-selection-disabled-without-session-or-provider-work")
    } finally {
      await compatibility.close()
    }
  }
  console.log(JSON.stringify({ kind, checks, providerCalls: fixture.calls.length, output: runtime.output }, null, 2))
} catch (error) {
  await command("screenshot", join(runtime.output, "failure.png")).catch(() => {})
  await command(
    "eval",
    "JSON.stringify({text:document.body.textContent,fields:Array.from(document.querySelectorAll('textarea,input')).map(field=>({label:field.getAttribute('aria-label'),value:field.value}))})",
  )
    .then((content) => writeFile(join(runtime.output, "failure-text.txt"), content))
    .catch(() => {})
  throw error
} finally {
  await command("close").catch(() => {})
  if (native.child && native.child.exitCode === null) {
    native.child.kill("SIGTERM")
    await deadline(native.exited, 15000, "Sandbox native window cleanup").catch(async () => {
      native.child.kill("SIGKILL")
      await native.exited
    })
  }
  if (kind === "native") await writeFile(join(runtime.output, "native.log"), Buffer.concat(nativeLogs))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await fixture.close()
  await writeFile(join(runtime.output, "sandbox-ui.json"), JSON.stringify({ checks, history, requests }, null, 2))
  console.error(`Sandbox UI evidence: ${runtime.output}`)
}

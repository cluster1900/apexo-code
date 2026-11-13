import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startPermissionReviewFixture } from "./permission-review-fixture.mjs"
const kind = process.argv[2] ?? "browser"
const builtin = kind === "builtin"
const nativeWindow = builtin
const fixture = await startPermissionReviewFixture({ mixed: kind === "mixed", desktop: builtin })
const { runtime, repo } = fixture
const server = createServer(async (incoming, response) => {
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
const browserSession = `permission-review-${kind}-${basename(runtime.output)}`
const history = []
const native = { child: undefined, exited: undefined, port: undefined }
const nativeLogs = []
if (nativeWindow) {
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
    `const {app}=require('electron');app.setAppPath(${JSON.stringify(desktop)});app.setPath('appData',${JSON.stringify(appData)});import(${JSON.stringify(pathToFileURL(join(desktop, "out/main/index.js")).href)});`,
  )
  const reservation = createServer()
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
  native.port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const sidecarReservation = createServer()
  await new Promise((resolve) => sidecarReservation.listen(0, "127.0.0.1", resolve))
  native.sidecarPort = sidecarReservation.address().port
  await new Promise((resolve) => sidecarReservation.close(resolve))
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
        APEXO_PORT: String(native.sidecarPort),
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
      ...(nativeWindow
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
  if (nativeWindow) {
    await poll(
      () =>
        fetch(`http://127.0.0.1:${native.port}/json/list`)
          .then((r) => r.json())
          .then((tabs) => tabs.some((tab) => tab.type === "page"))
          .catch(() => false),
      "native form window",
    )
    await command("wait", "--fn", "!!window.api?.awaitInitialization")
    const ready = JSON.parse(await command("eval", "window.api.awaitInitialization()"))
    if (builtin) {
      runtime.url = ready.url
      runtime.headers = {
        Authorization: `Basic ${Buffer.from(`${ready.username ?? "apexo"}:${ready.password ?? ""}`).toString("base64")}`,
      }
      fixture.session = await fixture.create()
      assert.equal((await runtime.api("/global/health")).healthy, true)
      checks.push("desktop-owned-mixed-backend")
    }
    if (!builtin) await command("eval", `window.api.setDefaultServerUrl(${JSON.stringify(runtime.url)})`)
    if (!builtin)
      await command(
        "eval",
        `window.api.storeSet("apexo.global.dat","server",JSON.stringify({list:[{type:"http",http:{url:${JSON.stringify(runtime.url)}}}],projects:{},lastProject:{},recentlyClosed:{}}))`,
      )
  }
  if (kind === "mixed") {
    assert.equal((await runtime.api("/global/health")).healthy, true)
    checks.push("default-serve-mixed-backend")
  }
  const browserUrl = `http://127.0.0.1:${server.address().port}`
  const route = `/server/${Buffer.from(builtin ? "sidecar" : browserUrl).toString("base64url")}/session/${fixture.session.id}`
  if (nativeWindow) {
    await command(
      "eval",
      `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)});return true})()`,
    )
    await command("reload")
  } else await command("open", `${browserUrl}${route}`)
  const id = fixture.session.id
  await command("wait", '[contenteditable="true"]')
  assert.equal((await fixture.mode(id)).data.mode, "manual")
  const slash = async () => {
    await command("fill", '[contenteditable="true"]', "/auto")
    await command("press", "Enter")
  }
  await slash()
  await poll(async () => (await fixture.mode(id)).data.mode === "review", "backend review enabled", 15000)
  checks.push("slash-auto-updates-backend")
  fixture.state.hold = true
  await fixture.prompt(id)
  const pending = await fixture.pending(id, "reviewing")
  const review = '[data-slot="permission-review"]'
  await command("wait", review)
  await command("wait", "--fn", `document.querySelector('${review}')?.textContent.includes('Reviewing permission')`)
  const enabled = JSON.parse(
    await command(
      "eval",
      `Array.from(document.querySelectorAll('[data-slot="permission-footer-actions"] button')).map(button=>({text:button.textContent,disabled:button.disabled}))`,
    ),
  )
  assert.equal(enabled.length, 3)
  assert.ok(enabled.every((button) => !button.disabled))
  checks.push("reviewing-all-manual-actions-enabled")
  await command("screenshot", join(runtime.output, "permission-reviewing.png"))
  await command("reload")
  await command("wait", review)
  await command("wait", "--fn", `document.querySelector('${review}')?.textContent.includes('Reviewing permission')`)
  assert.equal(fixture.state.calls.length, 1)
  checks.push("reload-hydrates-single-backend-review")
  if (!nativeWindow) {
    await command("tab", "new", "--label", "permission-second", `${browserUrl}${route}`)
    await command("wait", review)
    await command("wait", "--fn", `document.querySelector('${review}')?.textContent.includes('Reviewing permission')`)
    assert.equal(fixture.state.calls.length, 1)
    checks.push("two-connected-clients-one-review")
  }
  fixture.state.hold = false
  await fixture.pending(id, "ask_manual")
  await command(
    "wait",
    "--fn",
    `document.querySelector('${review}')?.textContent.includes('Fixture requires a human decision')`,
  )
  checks.push("live-manual-fallback-reason")
  await command("click", '[data-slot="permission-footer-actions"] button:last-child')
  await poll(async () => !(await runtime.api(`/api/session/${id}/permission`)).data.length, "manual once settles")
  await command("wait", "--fn", `!document.querySelector('${review}')`)
  checks.push("manual-once-settles")
  await slash()
  await poll(async () => (await fixture.mode(id)).data.mode === "manual", "backend review disabled", 15000)
  checks.push("slash-auto-disables-backend")
  await slash()
  await poll(async () => (await fixture.mode(id)).data.mode === "review", "review re-enabled")
  await command("fill", '[contenteditable="true"]', "/always-approve")
  await command("press", "Enter")
  await poll(async () => (await fixture.mode(id)).data.mode === "manual", "full auto disables native review")
  checks.push("full-auto-remains-an-explicit-separate-mode")
  await command("fill", '[contenteditable="true"]', "/always-approve")
  await command("press", "Enter")

  if (kind === "mixed") {
    const legacy = await runtime.api("/session", { title: "Legacy review compatibility" })
    const legacyRoute = `/server/${Buffer.from(browserUrl).toString("base64url")}/session/${legacy.id}`
    await command("open", `${browserUrl}${legacyRoute}`)
    await command("wait", '[contenteditable="true"]')
    await command("wait", "--fn", "!document.body.textContent.includes('Auto-review on')")
    await slash()
    await command("wait", "--fn", "document.body.textContent.includes('Auto-review on')")
    assert.equal((await fixture.mode(legacy.id)).data.mode, "manual")
    checks.push("legacy-review-keeps-its-compatibility-owner")
  }
  await command("screenshot", join(runtime.output, "permission-final.png"))
  console.log(JSON.stringify({ kind, checks, output: runtime.output }))
} finally {
  await command("screenshot", join(runtime.output, "permission-final.png")).catch(() => {})
  await command("snapshot", "-i")
    .then((text) => writeFile(join(runtime.output, "permission-final-ui.txt"), text))
    .catch(() => {})
  await writeFile(join(runtime.output, "permission-browser-commands.json"), JSON.stringify(history, null, 2))
  await writeFile(join(runtime.output, "permission-desktop.log"), Buffer.concat(nativeLogs))
  await command("close").catch(() => {})
  native.child?.kill("SIGTERM")
  if (native.exited)
    await deadline(native.exited, 10000, "form Desktop cleanup").catch(() => native.child.kill("SIGKILL"))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await fixture.close()
  console.error(`Permission ${kind} evidence: ${runtime.output}`)
}

import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startProcessUiFixture, startCompatibilityTaskUiFixture } from "./grok-process-ui-fixture.mjs"
const kind = process.argv[2] ?? "browser"
const compatibility = process.argv.includes("--compatibility")
const locales = process.argv.includes("--locales") ? ["en", "zh", "zht"] : ["en"]
const fixture = compatibility
  ? await startCompatibilityTaskUiFixture()
  : await startProcessUiFixture({ monitors: true, overload: process.argv.includes("--overload") })
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
const browserSession = `native-process-${kind}-${basename(runtime.output)}`
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
  if (["click", "download"].includes(args[0]) && (args[1]?.includes("task") || args[1]?.includes("process"))) {
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
  const route = compatibility
    ? `/${Buffer.from(runtime.directory).toString("base64url")}/session/${fixture.session.id}`
    : `/server/${Buffer.from(kind === "native" ? runtime.url : browserUrl).toString("base64url")}/session/${fixture.session.id}`
  if (kind === "native") {
    await command(
      "eval",
      `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)});return true})()`,
    )
    await command("reload")
  } else await command("open", `${browserUrl}${route}`)
  await command("wait", '[data-action="session-tasks"]')
  await command("click", '[data-action="session-tasks"]')
  if (compatibility) {
    await command("wait", '[data-task-source="compatibility"]')
    const beforeUI = fixture.calls.length
    assert.equal(
      (await command("eval", `document.querySelectorAll('[data-task-source="compatibility"]').length`)).trim(),
      "2",
    )
    const shell = fixture.tasks.find((item) => item.type === "shell")
    await command("click", `[data-task-id="${shell.id}"] button[aria-pressed]`)
    await poll(
      async () => (await command("get", "text", '[data-component="task-output"]')).includes("SHELL_STDERR_中文"),
      "compatibility live output",
    )
    assert.equal(
      (await command("eval", `document.querySelectorAll('[data-action="process-wait"]').length`)).trim(),
      "0",
    )
    await command("screenshot", join(runtime.output, "compatibility-running.png"))
    for (const item of fixture.tasks) {
      await command("click", `[data-task-id="${item.id}"] button:not([aria-pressed])`)
      await command("wait", `[data-task-id="${item.id}"] [data-task-status="cancelled"]`)
    }
    assert.equal(fixture.calls.length, beforeUI)
    await command("screenshot", join(runtime.output, "compatibility-cancelled.png"))
    checks.push("compatibility-task-and-shell-output-cancel-without-native-process-routing")
  } else {
    await command("wait", '[data-task-source="native-process"]')
    const beforeUI = fixture.calls.length
    const choose = (item) => command("click", `[data-task-id="${item.id}"] button[aria-pressed]`)
    const stop = () => command("click", `[data-task-id="${fixture.receipts.HOLD.id}"] button:not([aria-pressed])`)
    assert.equal(
      (await command("eval", `document.querySelectorAll('[data-task-source="native-task"]').length`)).trim(),
      "1",
    )
    assert.equal(
      (await command("eval", `document.querySelectorAll('[data-task-source="native-process"]').length`)).trim(),
      process.argv.includes("--overload") ? "8" : "7",
    )
    assert.match(await command("get", "text", "body"), /subagent tasks, shell processes and monitors/)
    await choose(fixture.receipts.MONITOR)
    await command("wait", "[data-monitor-details]")
    await poll(
      async () => (await command("get", "text", '[data-component="task-output"]')).includes("MONITOR_ERROR中文"),
      "actual Monitor output",
    )
    const runningMonitor = (await fixture.list()).find((item) => item.id === fixture.receipts.MONITOR.id)
    assert.ok(runningMonitor.monitor.accepted > 0)
    assert.match(
      await command("get", "text", "[data-monitor-batches]"),
      new RegExp(String(runningMonitor.monitor.accepted)),
    )
    await command("scrollintoview", "[data-monitor-details]")
    await command("screenshot", join(runtime.output, "monitor-running.png"))
    await command("click", `[data-task-id="${fixture.receipts.MONITOR.id}"] button:not([aria-pressed])`)
    await command("wait", `[data-task-id="${fixture.receipts.MONITOR.id}"] [data-task-status="cancelled"]`)
    assert.equal((await fixture.list()).find((item) => item.id === fixture.receipts.MONITOR.id).status, "cancelled")
    assert.equal(fixture.calls.length, beforeUI)
    checks.push("actual Monitor metadata, batches, output and joined cancellation without provider work")
    await choose(fixture.receipts.HOLD)
    await poll(
      async () => (await command("get", "text", '[data-component="task-output"]')).includes("LIVE_HOLD😀"),
      "live process output",
    )
    assert.equal(fixture.calls.length, beforeUI)
    checks.push("actual-task-and-process-coexist-passively-with-live-output")
    await command("click", '[data-action="process-wait"]')
    await command("wait", '[data-process-wait="timedOut"]')
    assert.equal((await fixture.list()).find((item) => item.id === fixture.receipts.HOLD.id).status, "running")
    assert.equal(fixture.calls.length, beforeUI)
    checks.push("bounded-user-wait-timeout-does-not-kill-or-wake")
    await command("click", '[data-action="process-wait"]')
    await command("wait", '[data-process-wait="waiting"]')
    await command("press", "Escape")
    await command("click", '[data-action="session-tasks"]')
    await command("wait", `[data-task-id="${fixture.receipts.HOLD.id}"] [data-task-status="running"]`)
    assert.equal(fixture.calls.length, beforeUI)
    checks.push("closing-wait-panel-does-not-stop-background-command")
    await writeFile(fixture.fault, JSON.stringify({ action: "list", status: 503 }))
    await command("click", '[data-action="tasks-refresh"]')
    await command("wait", '[data-list-unavailable="processes"]')
    assert.ok((await command("get", "text", '[data-component="background-tasks"]')).includes("Running in this list: ?"))
    assert.equal(
      (await command("eval", `document.querySelectorAll('[data-task-source="native-task"]').length`)).trim(),
      "1",
    )
    assert.ok(!(await command("get", "text", "body")).includes("private fixture process cause"))
    await rm(fixture.fault)
    await command("click", '[data-action="tasks-refresh"]')
    await command("wait", `[data-task-id="${fixture.receipts.HOLD.id}"]`)
    checks.push("independent-list-failure-retains-task-results-and-recovers")
    await writeFile(fixture.fault, JSON.stringify({ action: "cancel", status: 409 }))
    await stop()
    await poll(
      async () => (await command("get", "text", "body")).includes("process changed or is still starting"),
      "localized process conflict",
    )
    assert.ok(!(await command("get", "text", "body")).includes("private fixture process cause"))
    await rm(fixture.fault)
    await stop()
    await command("wait", `[data-task-id="${fixture.receipts.HOLD.id}"] [data-task-status="cancelled"]`)
    assert.equal((await fixture.list()).find((item) => item.id === fixture.receipts.HOLD.id).status, "cancelled")
    assert.equal(fixture.calls.length, beforeUI)
    checks.push("safe-conflict-then-joined-bodyless-process-cancel")
    for (const locale of locales) {
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
        await command("wait", '[data-action="session-tasks"]')
        await command("click", '[data-action="session-tasks"]')
      }
      await choose(fixture.receipts.MONITOR_RESTART)
      await command("wait", "[data-monitor-details]")
      await command("wait", "[data-task-restart]")
      assert.match(
        await command("get", "text", "[data-monitor-details]"),
        locale === "en" ? /No deadline/ : locale === "zh" ? /不设超时/ : /不設逾時/,
      )
      await command("scrollintoview", "[data-monitor-details]")
      await command("screenshot", join(runtime.output, `monitor-${locale}-restart.png`))
      if (fixture.receipts.OVERLOAD) {
        await choose(fixture.receipts.OVERLOAD)
        await command("wait", "[data-monitor-overloaded]")
        await command("scrollintoview", "[data-monitor-overloaded]")
        await command("screenshot", join(runtime.output, `monitor-${locale}-overload.png`))
      }
      await choose(fixture.receipts.RESTART)
      await command("wait", "[data-task-restart]")
      assert.match(
        await command("get", "text", "[data-task-restart]"),
        locale === "en" ? /will not resume automatically/ : locale === "zh" ? /不会自动继续/ : /不會自動繼續/,
      )
      await command("scrollintoview", '[data-component="task-output"]')
      await command("screenshot", join(runtime.output, `process-${locale}-restart.png`))
      await choose(fixture.receipts.FAIL)
      await command("wait", "[data-process-exit]")
      assert.match(await command("get", "text", "[data-process-exit]"), /7/)
      await choose(fixture.receipts.LONG)
      await command("wait", "[data-process-truncated]")
      await command("scrollintoview", "[data-process-truncated]")
      assert.equal(
        (
          await command(
            "eval",
            `(()=>{const e=document.querySelector('[data-process-truncated]');const r=e.getBoundingClientRect();return r.width>0&&r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`,
          )
        ).trim(),
        "true",
      )
      await command("screenshot", join(runtime.output, `process-${locale}-truncated.png`))
      await choose(fixture.receipts.DONE)
      await poll(
        async () => (await command("get", "text", '[data-component="task-output"]')).includes("FINAL_DONE中文"),
        "completed process retained output",
      )
      await command("scrollintoview", '[data-component="task-output"]')
      await command("screenshot", join(runtime.output, `process-${locale}-completed.png`))
      await choose(fixture.task)
      await poll(
        async () => (await command("get", "text", '[data-component="task-output"]')).includes("TASK_OUTPUT_END"),
        "subagent output remains distinct",
      )
    }
    checks.push(`${locales.join("/")}-terminal-receipts-truncation-restart-and-task-output`)
    if (kind === "browser") await command("set", "viewport", "480", "720")
    else await command("eval", `window.resizeTo(640,760)`)
    await choose(fixture.receipts.DONE)
    await command("scrollintoview", '[data-component="task-output"]')
    const bounds = JSON.parse(
      await command(
        "eval",
        `(()=>{const e=document.querySelector('[data-component="background-tasks"]');const r=e.getBoundingClientRect();return {width:innerWidth,height:innerHeight,rect:r.toJSON(),overflow:document.documentElement.scrollWidth>innerWidth}})()`,
      ),
    )
    assert.ok(bounds.width <= (kind === "browser" ? 480 : 640), JSON.stringify(bounds))
    assert.equal(bounds.overflow, false)
    assert.ok(bounds.rect.width > 0 && bounds.rect.right <= bounds.width + 1)
    await command("screenshot", join(runtime.output, "process-narrow.png"))
    checks.push("narrow-layout-retains-output-without-horizontal-overflow")
    const records = await fixture.records()
    assert.ok(records.some((row) => row.path.endsWith("/wait") && row.path.includes("/process/")))
    assert.ok(
      records
        .filter((row) => row.path.endsWith("/cancel") && row.path.includes("/process/"))
        .every((row) => row.contentLength === null || row.contentLength === "0"),
    )
    assert.ok(!records.some((row) => row.path.includes("/experimental/session/")))
    assert.equal(fixture.calls.length, beforeUI)
  }
  console.log(
    JSON.stringify(
      { kind, locales: compatibility ? [] : locales, checks, providerCalls: fixture.calls.length, output: runtime.output },
      null,
      2,
    ),
  )
} catch (error) {
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
  await writeFile(join(runtime.output, "process-ui.json"), JSON.stringify({ checks, history, requests }, null, 2))
  console.error(`Process UI evidence: ${runtime.output}`)
}

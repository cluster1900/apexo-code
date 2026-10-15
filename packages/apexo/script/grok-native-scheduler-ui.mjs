import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startSchedulerUiFixture } from "./grok-scheduler-ui-fixture.mjs"
const kind = process.argv[2] ?? "browser"
const compatibility = false
const permissionMode = process.argv.includes("--permission")
const restorationMode = process.argv.includes("--restoration")
const locales = process.argv.includes("--locales") ? ["en", "zh", "zht"] : ["en"]
const fixture = await startSchedulerUiFixture({ permission: permissionMode })
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
const browserSession = `native-scheduler-${kind}-${basename(runtime.output)}`
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
  if (["click", "download"].includes(args[0])) {
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
  if (restorationMode) {
    const state = async () => (await fixture.list()).find((item) => item.id === fixture.restart.id)
    const restorationCalls = async () =>
      (await fixture.records()).filter((item) => item.method === "POST" && item.path.endsWith("/restore"))
    assert.equal((await state()).blockedReason, "restart_required")
    assert.equal((await restorationCalls()).length, 0)
    assert.equal(fixture.calls.length, before)
    checks.push("direct Session hydration and passive manager reads do not restore")
    await command("press", "Escape")
    await command("wait", "--fn", `!document.querySelector('[data-component="background-tasks"]')`)
    await command("click", `[data-titlebar-tab-link][href$="/session/${fixture.session.id}"]`)
    await poll(async () => (await restorationCalls()).length === 1, "explicit Session tab restores")
    assert.equal((await state()).status, permissionMode ? "paused" : "active")
    assert.equal((await fixture.permissions()).length, 0)
    assert.equal(fixture.calls.length, before)
    const futureDeadline = (await state()).nextFireAt
    await command("click", '[data-action="session-tasks"]')
    checks.push("explicit Session tab activation restores without consent or provider work")
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
      const prior = (await restorationCalls()).length
      await command("wait", '[data-action="session-restore"]:not([disabled])')
      assert.match(
        await command("get", "text", '[data-action="session-restore"]'),
        locale === "en" ? /Restore schedules/u : locale === "zh" ? /恢复定时任务/u : /回復排程任務/u,
      )
      await command("click", '[data-action="session-restore"]')
      await poll(async () => (await restorationCalls()).length === prior + 1, "explicit restoration completed")
      await command("wait", '[data-action="session-restore"]:not([disabled])')
      await command("wait", "[data-restoration-result]")
      assert.equal((await state()).status, permissionMode ? "paused" : locale === "en" ? "active" : "paused")
      assert.equal((await fixture.permissions()).length, 0)
      assert.equal((await state()).nextFireAt, futureDeadline)
      assert.equal(fixture.calls.length, before)
      await command("screenshot", join(runtime.output, `restore-${locale}-${permissionMode ? "ask" : "future"}.png`))
      if (!permissionMode && locale === "en")
        await runtime.api(`/api/session/${fixture.session.id}/schedule/${fixture.restart.id}/pause`, undefined, "POST")
    }
    const records = await restorationCalls()
    assert.ok(
      records.every((item) => item.status === 200 && (item.contentLength === null || item.contentLength === "0")),
    )
    checks.push(
      permissionMode
        ? "explicit restore reports permission_required without opening consent or provider work"
        : "explicit restore rearms eligible future intent and preserves later manual pause",
    )
    checks.push(`${locales.join("/")} safe restoration outcomes rendered in existing manager`)
  }
  if (permissionMode && !restorationMode) {
    await command("network", "har", "start")
    await command("wait", '[data-task-source="native-schedule"]')
    const beforeUI = fixture.calls.length
    const choose = () => command("click", `[data-task-id="${fixture.restart.id}"] button[aria-pressed]`)
    const consent = async (reply) => {
      await choose()
      await command("click", '[data-action="schedule-toggle"]')
      await poll(async () => (await fixture.permissions()).length === 1, "Resume requires actual permission")
      assert.equal((await fixture.list()).find((item) => item.id === fixture.restart.id)?.status, "paused")
      await command("screenshot", join(runtime.output, `schedule-permission-${reply}-pending.png`))
      await command("press", "Escape")
      await command("wait", '[data-slot="permission-footer-actions"]')
      await command("screenshot", join(runtime.output, `schedule-permission-${reply}-dock.png`))
      await command(
        "click",
        `[data-slot="permission-footer-actions"] button:${reply === "reject" ? "first" : "last"}-child`,
      )
      await poll(async () => (await fixture.permissions()).length === 0, "permission reply settled")
      await command("click", '[data-action="session-tasks"]')
      await choose()
    }
    await consent("reject")
    await command("wait", '[data-component="background-tasks"] [role="alert"]')
    assert.equal((await fixture.list()).find((item) => item.id === fixture.restart.id)?.status, "paused")
    assert.ok(!(await command("get", "text", "body")).includes("Saved schedule authority"))
    await command("screenshot", join(runtime.output, "schedule-permission-denied.png"))
    await consent("once")
    await poll(
      async () => (await fixture.list()).find((item) => item.id === fixture.restart.id)?.status === "active",
      "explicit consent arms future intent",
    )
    assert.equal(fixture.calls.length, beforeUI)
    await command("screenshot", join(runtime.output, "schedule-permission-approved.png"))
    checks.push(
      "real Resume ask remains pending without provider work; denial preserves pause; explicit once approval arms future-only intent",
    )
    await command("click", '[data-action="schedule-toggle"]')
    await poll(
      async () => (await fixture.list()).find((item) => item.id === fixture.restart.id)?.status === "paused",
      "pause before route cleanup",
    )
    await command("click", '[data-action="schedule-toggle"]')
    await poll(async () => (await fixture.permissions()).length === 1, "second Resume waits for permission")
    await command("press", "Escape")
    await command("click", '[data-slot="tab-close"] button')
    await command("network", "har", "stop", join(runtime.output, "permission.har"))
    const har = JSON.parse(await readFile(join(runtime.output, "permission.har"), "utf8"))
    const cancelled = har.log.entries
      .filter((item) => item.request.method === "POST" && item.request.url.endsWith("/resume"))
      .at(-1)
    assert.equal(cancelled.response.statusText, "net::ERR_ABORTED")
    await writeFile(
      join(runtime.output, "resume-network.json"),
      await command("network", "requests", "--filter", "/resume", "--json"),
    )
    assert.equal((await fixture.list()).find((item) => item.id === fixture.restart.id)?.status, "paused")
    assert.equal(fixture.calls.length, beforeUI)
    await command("screenshot", join(runtime.output, "schedule-permission-route-cleanup.png"))
    checks.push("Closing the owning Session tab preserves paused intent and produces no model work")
  }
  if (!permissionMode && !restorationMode) {
    await command("wait", '[data-task-source="native-schedule"]')
    const beforeUI = fixture.calls.length
    const choose = (item) => command("click", `[data-task-id="${item.id}"] button[aria-pressed]`)
    const state = async (id) => (await fixture.list()).find((item) => item.id === id)
    assert.equal(
      (await command("eval", `document.querySelectorAll('[data-task-source="native-schedule"]').length`)).trim(),
      "2",
    )
    assert.equal(
      (await command("eval", `document.querySelectorAll('[data-task-source="native-task"]').length`)).trim(),
      "1",
    )
    assert.match(await command("get", "text", '[data-component="background-tasks"]'), /Running in this list: 1/u)
    await choose(fixture.restart)
    await command("wait", "[data-schedule-reason]")
    assert.match(await command("get", "text", "[data-schedule-reason]"), /Paused after restart/u)
    assert.equal(fixture.calls.length, beforeUI)
    checks.push("passive actual restart intent and running occurrence remain distinct")
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
      await choose(fixture.restart)
      await command("wait", "[data-schedule-reason]")
      assert.match(
        await command("get", "text", "[data-schedule-reason]"),
        locale === "en"
          ? /interrupted work is not replayed/u
          : locale === "zh"
            ? /不会重新执行已中断/u
            : /不會重新執行已中斷/u,
      )
      await command("scrollintoview", '[data-action="schedule-toggle"]')
      await command("screenshot", join(runtime.output, `schedule-${locale}-restart.png`))
      await choose(fixture.active)
      await command("wait", "[data-schedule-task]")
      await command("click", '[data-action="schedule-toggle"]')
      await poll(async () => (await state(fixture.active.id))?.status === "paused", "schedule Pause future intent")
      await command("wait", `[data-task-id="${fixture.active.id}"] [data-task-status="paused"]`)
      await command("click", '[data-action="schedule-toggle"]')
      await poll(async () => (await state(fixture.active.id))?.status === "active", "schedule Resume future intent")
      await command("wait", `[data-task-id="${fixture.active.id}"] [data-task-status="active"]`)
      await command("screenshot", join(runtime.output, `schedule-${locale}-active.png`))
      assert.equal(fixture.calls.length, beforeUI)
    }
    checks.push(`${locales.join("/")} real future-only Resume/Pause without provider work`)
    await choose(fixture.active)
    await command("wait", "[data-schedule-task]")
    assert.ok((await command("get", "text", "[data-schedule-task]")).includes(fixture.child.id))
    await command("click", '[data-action="schedule-delete"]')
    await poll(async () => !(await state(fixture.active.id)), "deleted schedule leaves passive live list")
    await poll(
      async () => (await command("get", "text", '[data-component="task-output"]')).includes("SCHED_UI_CHILD_HELD"),
      "deleted intent detail remains readable",
    )
    assert.equal((await fixture.tasks()).find((item) => item.id === fixture.child.id)?.status, "running")
    assert.equal(fixture.calls.length, beforeUI)
    await command("screenshot", join(runtime.output, "schedule-deleted-child-running.png"))
    checks.push("Delete removes future intent while admitted Task remains running and separately controlled")
    await choose(fixture.child)
    await command("click", `[data-task-id="${fixture.child.id}"] button:not([aria-pressed])`)
    await command("wait", `[data-task-id="${fixture.child.id}"] [data-task-status="cancelled"]`)
    assert.equal((await fixture.tasks()).find((item) => item.id === fixture.child.id)?.status, "cancelled")
    assert.equal(fixture.calls.length, beforeUI)
    checks.push("Task cancellation remains joined and source-qualified")
    await writeFile(fixture.fault, JSON.stringify({ action: "list", status: 503 }))
    await command("click", '[data-action="tasks-refresh"]')
    await command("wait", '[data-list-unavailable="schedules"]')
    assert.equal(
      (await command("eval", `document.querySelectorAll('[data-task-source="native-task"]').length`)).trim(),
      "1",
    )
    assert.ok(!(await command("get", "text", "body")).includes("PRIVATE_SCHEDULE_CAUSE"))
    await rm(fixture.fault)
    await command("click", '[data-action="tasks-refresh"]')
    await command("wait", `[data-task-id="${fixture.restart.id}"]`)
    checks.push("independent schedule error retains Tasks and recovers without compatibility fallback")
    await choose(fixture.restart)
    await writeFile(fixture.fault, JSON.stringify({ action: "resume", status: 409 }))
    await command("click", '[data-action="schedule-toggle"]')
    await command("wait", '[data-component="background-tasks"] [role="alert"]')
    assert.ok(!(await command("get", "text", "body")).includes("PRIVATE_SCHEDULE_CAUSE"))
    await rm(fixture.fault)
    await command("screenshot", join(runtime.output, "schedule-safe-conflict.png"))
    if (kind === "browser") await command("set", "viewport", "480", "720")
    else await command("eval", "window.resizeTo(640,760)")
    await command("scrollintoview", '[data-action="schedule-toggle"]')
    const bounds = JSON.parse(
      await command(
        "eval",
        `(()=>{const e=document.querySelector('[data-action="schedule-toggle"]');const r=e.getBoundingClientRect();return {width:innerWidth,rect:r.toJSON(),overflow:document.documentElement.scrollWidth>innerWidth}})()`,
      ),
    )
    assert.equal(bounds.overflow, false)
    assert.ok(bounds.rect.width > 0 && bounds.rect.right <= bounds.width + 1)
    await command("screenshot", join(runtime.output, "schedule-narrow.png"))
    checks.push("safe conflict and narrow controls remain visible")
    await command("press", "Escape")
    await command("fill", '[contenteditable="true"]', "/loop 1h SCHED_UI_LOOP_PROMPT $ARGUMENTS")
    await command("press", "Enter")
    await poll(
      async () => (await fixture.list()).some((item) => item.promptPreview === "SCHED_UI_LOOP_CHILD"),
      "loop ordinary provider creates schedule",
    )
    await deadline(
      runtime.api(`/api/session/${fixture.session.id}/wait`, undefined, "POST"),
      20_000,
      "loop parent drain settled",
    )
    const loopCalls = fixture.calls.slice(beforeUI)
    assert.equal(loopCalls.filter((call) => call.parent).length, 2)
    assert.ok(loopCalls[0].text.includes("$ARGUMENTS"))
    assert.ok(loopCalls[0].text.includes("scheduler_create"))
    const records = await fixture.records()
    assert.ok(records.some((row) => row.path === "/api/command"))
    assert.ok(!records.some((row) => row.path.startsWith("/experimental/") || row.path === "/command"))
    assert.ok(
      records
        .filter((row) => /\/schedule\//u.test(row.path) && row.method !== "GET")
        .every((row) => row.contentLength === null || row.contentLength === "0"),
    )
    checks.push("loop is discovered natively and expanded into ordinary permission-controlled prompt admission")
  }
  console.log(
    JSON.stringify({ kind, locales, checks, providerCalls: fixture.calls.length, output: runtime.output }, null, 2),
  )
} catch (error) {
  await writeFile(
    join(runtime.output, "browser-console.txt"),
    await command("console").catch(() => "Console unavailable"),
  )
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
  await writeFile(join(runtime.output, "scheduler-ui.json"), JSON.stringify({ checks, history, requests }, null, 2))
  console.error(`Scheduler UI evidence: ${runtime.output}`)
}

import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startTaskUiFixture } from "./grok-task-ui-fixture.mjs"
const kind = process.argv[2] ?? "browser"
const background = process.argv.includes("--background")
const fixture = await startTaskUiFixture({ background })
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
const browserSession = `native-task-${kind}-${basename(runtime.output)}`
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
  if (["click", "download"].includes(args[0]) && args[1]?.includes("task")) {
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
  const route = `/server/${Buffer.from(kind === "native" ? runtime.url : browserUrl).toString("base64url")}/session/${fixture.session.id}`
  if (kind === "native") {
    await command(
      "eval",
      `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)});return true})()`,
    )
    await command("reload")
  } else await command("open", `${browserUrl}${route}`)
  await command("wait", '[data-action="session-tasks"]')
  await command("click", '[data-action="session-tasks"]')
  await command("wait", '[data-task-status="running"]')
  assert.match(await command("get", "text", '[data-component="background-tasks"]'), /Running in this list: 1/)
  assert.equal(fixture.calls.length, before)
  if (background) {
    assert.match(await command("get", "text", "body"), /Manage recent subagent tasks/)
    assert.equal(
      (await command("eval", `document.querySelectorAll('[data-task-background]').length`)).trim(),
      String(fixture.tasks.length),
    )
    assert.match(
      await command(
        "get",
        "text",
        `[data-task-id="${fixture.tasks.find((task) => task.status === "running").id}"] [data-task-background]`,
      ),
      /Background/,
    )
    await command("screenshot", join(runtime.output, "task-background-running.png"))
  }
  checks.push(
    background ? "passive-background-open-label-and-current-copy" : "passive-native-open-and-list-scoped-count",
  )
  const running = fixture.tasks.find((task) => task.status === "running")
  const interrupted = fixture.tasks.find((task) => task.status === "interrupted")
  const completed = fixture.tasks.find((task) => task.status === "completed")
  const choose = (task) => command("click", `[data-task-id="${task.id}"] button[aria-pressed]`)
  const stop = () => command("click", `[data-task-id="${running.id}"] button:not([aria-pressed])`)
  await writeFile(fixture.outage, "409")
  await stop()
  await poll(
    async () =>
      (await command("get", "text", '[data-component="background-tasks"]')).includes("worker is still starting"),
    "safe cancellation conflict",
  )
  assert.ok(!(await command("get", "text", "body")).includes("private fixture conflict cause"))
  const count = (await fixture.records()).filter((row) => row.method === "GET" && row.path.endsWith("/task")).length
  await poll(
    async () =>
      (await fixture.records()).filter((row) => row.method === "GET" && row.path.endsWith("/task")).length > count,
    "passive poll after error",
  )
  assert.match(await command("get", "text", '[data-component="background-tasks"]'), /worker is still starting/)
  assert.equal(fixture.calls.length, before)
  checks.push("safe-conflict-survives-polling-without-provider")
  await rm(fixture.outage)
  await stop()
  await poll(async () => (await fixture.list())[0].status === "cancelled", "native cancellation")
  fixture.hold.resolve()
  await command("wait", '[data-task-status="cancelled"]')
  if (background) {
    assert.equal(fixture.calls.length, before)
    assert.equal(fixture.background.scenario("HOLD").notices, 0)
    checks.push("background-cancel-has-no-parent-wake")
    for (const mode of ["IDLE", "ACTIVE", "WAIT"]) {
      const task = await fixture.background.launch(mode)
      await command("wait", `[data-task-id="${task.id}"] [data-task-status="running"]`)
      await choose(task)
      const count = fixture.calls.length
      const reads = (await fixture.records()).filter(
        (row) => row.method === "GET" && row.path.endsWith(`/task/${task.id}`),
      ).length
      await poll(
        async () =>
          (await fixture.records()).filter((row) => row.method === "GET" && row.path.endsWith(`/task/${task.id}`))
            .length > reads,
        `passive ${mode} detail read`,
      )
      assert.equal(fixture.calls.length, count)
      assert.match(await command("get", "text", `[data-task-id="${task.id}"] [data-task-background]`), /Background/)
      await command("screenshot", join(runtime.output, `task-background-${mode.toLowerCase()}-running.png`))
      fixture.background.scenario(mode).child.resolve()
      if (mode === "ACTIVE") {
        await command("wait", `[data-task-id="${task.id}"] [data-task-status="completed"]`)
        await poll(
          async () => (await command("get", "text", '[data-component="task-output"]')).includes("UI_RESULT_ACTIVE"),
          "active-parent receipt remains readable",
        )
        assert.equal(fixture.background.scenario(mode).parentCalls, 2)
        assert.equal(fixture.background.scenario(mode).notices, 0)
      }
      await fixture.background.settle(mode)
      await poll(
        async () => (await command("get", "text", '[data-component="task-output"]')).includes(`UI_RESULT_${mode}`),
        `final ${mode} receipt rendering`,
      )
      await command("scrollintoview", '[data-component="task-output"]')
      await command("screenshot", join(runtime.output, `task-background-${mode.toLowerCase()}-completed.png`))
      checks.push(`background-${mode.toLowerCase()}-passive-reads-and-final-receipt`)
    }
  }
  checks.push("joined-bodyless-native-cancel")
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
      await command("wait", '[data-action="session-tasks"]')
      await command("click", '[data-action="session-tasks"]')
    }
    if (background) {
      const label = locale === "en" ? "Background" : locale === "zh" ? "后台" : "背景"
      assert.ok(
        (await command("get", "text", `[data-task-id="${completed.id}"] [data-task-background]`)).includes(label),
      )
      const copy =
        locale === "en"
          ? "Manage recent subagent tasks"
          : locale === "zh"
            ? "近期的子智能体任务"
            : "近期的子代理程式任務"
      assert.ok((await command("get", "text", "body")).includes(copy))
    }
    await choose(interrupted)
    await command("wait", "[data-task-restart]")
    const text = await command("get", "text", "[data-task-restart]")
    assert.ok(
      text.includes(
        locale === "en" ? "Interrupted by a server restart" : locale === "zh" ? "服务器重启" : "伺服器重新啟動",
      ),
    )
    await command("scrollintoview", "[data-task-restart]")
    assert.equal(
      (
        await command(
          "eval",
          `(()=>{const target=document.querySelector('[data-task-restart]');const rect=target.getBoundingClientRect();return target.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2))})()`,
        )
      ).trim(),
      "true",
      "restart guidance is visibly painted",
    )
    await command("screenshot", join(runtime.output, `task-interrupted-${locale}.png`))
    await choose(completed)
    await poll(
      async () => (await command("get", "text", '[data-component="task-output"]')).includes("TASK_OUTPUT_END"),
      "complete multiline Task output",
    )
    await command("scrollintoview", '[data-component="task-output"] pre')
    const geometry = JSON.parse(
      await command(
        "eval",
        `(()=>{const panel=document.querySelector('[data-component="background-tasks"]');const output=panel.querySelector('pre');return {panel:panel.getBoundingClientRect().toJSON(),output:output.getBoundingClientRect().toJSON(),scroll:output.scrollHeight>output.clientHeight,viewport:{width:innerWidth,height:innerHeight}}})()`,
      ),
    )
    assert.ok(geometry.scroll, "long output is bounded and scrollable")
    assert.ok(
      geometry.panel.width <= geometry.viewport.width && geometry.output.height <= 256,
      "panel and output remain bounded",
    )
    assert.ok(
      geometry.output.top >= geometry.panel.top && geometry.output.bottom <= geometry.panel.bottom,
      "output preview is inside the visible panel",
    )
    await writeFile(join(runtime.output, `task-layout-${locale}.json`), JSON.stringify(geometry, null, 2))
    await command("screenshot", join(runtime.output, `task-output-${locale}.png`))
  }
  checks.push("localized-restart-guidance-and-bounded-long-output")
  const records = await fixture.records()
  assert.ok(
    records
      .filter((row) => row.path.endsWith("/cancel"))
      .every((row) => row.contentLength === null || row.contentLength === "0"),
  )
  assert.ok(!records.some((row) => row.path.includes("/experimental/session/")))
  const settled = fixture.calls.length
  await command("press", "Escape")
  await command("click", '[data-action="session-tasks"]')
  await command("wait", '[data-task-status="interrupted"]')
  assert.equal(fixture.calls.length, settled)
  checks.push("reopen-does-not-retry-or-wake")
  const other = (
    await runtime.api("/api/session", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  const otherRoute = `/server/${Buffer.from(kind === "native" ? runtime.url : browserUrl).toString("base64url")}/session/${other.id}`
  if (kind === "native") {
    await command(
      "eval",
      `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(otherRoute)});return true})()`,
    )
    await command("reload")
  } else await command("open", `${browserUrl}${otherRoute}`)
  await command("wait", '[data-action="session-tasks"]')
  await command("click", '[data-action="session-tasks"]')
  await poll(
    async () =>
      (await command("get", "text", '[data-component="background-tasks"]')).includes(
        process.argv.includes("--locales") ? "目前工作階段沒有任務" : "No tasks in this session",
      ),
    "new Session empty Task list",
  )
  assert.equal((await command("eval", `document.querySelectorAll('[data-task-id]').length`)).trim(), "0")
  assert.equal(fixture.calls.length, settled)
  checks.push("session-switch-clears-previous-rows-and-output")
  console.log(
    JSON.stringify(
      {
        kind,
        checks,
        providerCalls: fixture.calls.length,
        output: runtime.output,
      },
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
  await writeFile(join(runtime.output, "task-ui.json"), JSON.stringify({ checks, history, requests }, null, 2))
  console.error(`Task UI evidence: ${runtime.output}`)
}

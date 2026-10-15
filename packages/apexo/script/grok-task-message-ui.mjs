import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startTaskMessageUiFixture } from "./grok-task-message-ui-fixture.mjs"
const kind = process.argv[2] ?? "browser"
const completed = process.argv.includes("--completed")
const fixture = await startTaskMessageUiFixture({ completed })
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
  const browserUrl = `http://127.0.0.1:${server.address().port}`
  const navigate = async (id) => {
    const route = `/server/${Buffer.from(kind === "native" ? runtime.url : browserUrl).toString("base64url")}/session/${id}`
    if (kind === "native") {
      await command(
        "eval",
        `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)});return true})()`,
      )
      await command("reload")
    } else await command("open", `${browserUrl}${route}`)
    await command("wait", '[data-action="session-tasks"]')
    await command("click", '[data-action="session-tasks"]')
  }
  for (const delivery of ["steer", "queue", "interject"]) {
    const run = await fixture.launch(delivery)
    await navigate(run.session.id)
    await command("wait", `[data-task-id="${run.task.id}"]`)
    await command("click", `[data-task-id="${run.task.id}"] button[aria-pressed]`)
    await command("wait", "[data-task-message-text]")
    assert.equal(run.childCalls(), 1)
    await command("fill", "[data-task-message-text]", "CORRECTION_UI_中文")
    await command("select", "[data-task-message-delivery]", delivery)
    await command("click", '[data-action="task-message-send"]')
    if (completed) {
      await command("wait", '[data-task-message-receipt="promoted"]')
      await run.settle()
      assert.equal(run.childCalls(), 2)
      assert.equal(
        (await runtime.api(`/api/session/${run.session.id}/task/${run.task.id}`)).output,
        "CORRECTED_UI_RESULT",
      )
      await command("screenshot", join(runtime.output, `message-${delivery}-completed-wake.png`))
    } else {
      await command("wait", '[data-task-message-receipt="admitted"]')
      assert.equal(run.childCalls(), 1)
      await command("scrollintoview", "[data-task-message-receipt]")
      await command("screenshot", join(runtime.output, `message-${delivery}-admitted.png`))
      const id = (await command("get", "text", "[data-task-message-id]")).trim()
      assert.ok(id.startsWith("msg_"))
      const receipt = await runtime.api(`/api/session/${run.session.id}/task/${run.task.id}/message/${id}`)
      assert.equal(receipt.delivery, delivery)
      assert.equal(receipt.status, "admitted")
      // Closing and reopening a panel must retain the exact receipt without another send.
      await command("press", "Escape")
      await command("click", '[data-action="session-tasks"]')
      await command("click", `[data-task-id="${run.task.id}"] button[aria-pressed]`)
      await command("wait", '[data-task-message-receipt="admitted"]')
      assert.equal((await command("get", "text", "[data-task-message-id]")).trim(), id)
      await run.settle()
      await command("wait", '[data-task-message-receipt="promoted"]')
      assert.match(await command("get", "text", '[data-task-message-receipt="promoted"]'), /does not mean the Task/)
      assert.equal(
        (await runtime.api(`/api/session/${run.session.id}/task/${run.task.id}`)).output,
        "CORRECTED_UI_RESULT",
      )
      await command("screenshot", join(runtime.output, `message-${delivery}-promoted.png`))
    }
    const id = (await command("get", "text", "[data-task-message-id]")).trim()
    checks.push({ delivery, childCalls: run.childCalls(), receipt: "promoted", id })
    await command("press", "Escape")
  }
  if (!completed) {
    const cancelled = await fixture.launch("cancelled")
    await navigate(cancelled.session.id)
    await command("wait", `[data-task-id="${cancelled.task.id}"]`)
    await command("click", `[data-task-id="${cancelled.task.id}"] button[aria-pressed]`)
    await command("fill", "[data-task-message-text]", "CORRECTION_UI_中文")
    await command("click", '[data-action="task-message-send"]')
    await command("wait", '[data-task-message-receipt="admitted"]')
    await command("click", `[data-task-id="${cancelled.task.id}"] button:not([aria-pressed])`)
    await command("wait", '[data-task-message-receipt="cancelled"]')
    assert.equal(cancelled.childCalls(), 1)
    cancelled.release()
    await command("screenshot", join(runtime.output, "message-cancelled.png"))
    await command("press", "Escape")
    const other = (
      await runtime.api("/api/session", {
        location: { directory: runtime.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    await navigate(other.id)
    await command(
      "wait",
      "--fn",
      `document.querySelector('[data-component="background-tasks"]')?.textContent.includes('No tasks in this session')`,
    )
    assert.equal(
      (await command("eval", `document.querySelectorAll('[data-component="task-message"]').length`)).trim(),
      "0",
    )
    checks.push({ cancelled: "before delivery", navigation: "no previous draft", childCalls: cancelled.childCalls() })
  }
  console.log(JSON.stringify({ kind, completed, checks, output: runtime.output }, null, 2))
} catch (error) {
  await command("screenshot", join(runtime.output, "failure.png")).catch(() => {})
  throw error
} finally {
  await command("close").catch(() => {})
  if (native.child && native.child.exitCode === null) {
    native.child.kill("SIGTERM")
    await deadline(native.exited, 15000, "native cleanup").catch(async () => {
      native.child.kill("SIGKILL")
      await native.exited
    })
  }
  if (kind === "native") await writeFile(join(runtime.output, "native.log"), Buffer.concat(nativeLogs))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await fixture.close()
  await writeFile(join(runtime.output, "message-ui.json"), JSON.stringify({ checks, history, requests }, null, 2))
  console.error(`Message UI evidence: ${runtime.output}`)
}

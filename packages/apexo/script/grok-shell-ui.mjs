// Run from packages/apexo after building packages/app (and Desktop for that backend).
// This exercises the production renderer in Chromium; it is not a native window E2E.
import assert from "node:assert/strict"
import http from "node:http"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const { chromium } = createRequire(join(repo, "packages/app/package.json"))("@playwright/test")
const kind = process.argv[2] ?? "cli"
const benchmark = process.argv.includes("--benchmark")
const tasks = process.argv.includes("--tasks")
const runtime = await startShellFixture(kind)
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost")
  const document = request.headers.accept?.includes("text/html")
  if (document || url.pathname.startsWith("/assets/") || /favicon|apple-touch-icon/.test(url.pathname)) {
    const file = Bun.file(join(repo, "packages/app/dist", document ? "index.html" : url.pathname))
    if (!(await file.exists())) {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200, { "content-type": file.type })
    response.end(Buffer.from(await file.arrayBuffer()))
    return
  }
  const target = new URL(runtime.url)
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: target.host },
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
  request.pipe(upstream)
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const url = `http://127.0.0.1:${server.address().port}/`
console.log(JSON.stringify({ kind, output: runtime.output }))
const results = []
const errors = []
let activeSessionID
let browser
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on("pageerror", (error) => errors.push(error.message))
  const open = async (id) => {
    const history = page.waitForResponse((response) => new URL(response.url()).pathname === `/session/${id}/message`)
    const events = page.waitForResponse((response) => new URL(response.url()).pathname === "/global/event")
    const agents = page.waitForResponse((response) => new URL(response.url()).pathname === "/agent")
    await page.goto(`${url}${Buffer.from(runtime.directory).toString("base64url")}/session/${id}`)
    await page.locator('[contenteditable="true"]').first().waitFor({ state: "visible" })
    await deadline((await history).finished(), 10_000, "history hydration")
    await deadline((await agents).finished(), 10_000, "agent hydration")
    await events
  }
  if (benchmark) {
    const session = await runtime.api("/session", { title: "Shell composer benchmark" })
    await open(session.id)
    const samples = []
    for (let i = 0; i < 10; i++) {
      const start = performance.now()
      await page.reload()
      await page.locator('[contenteditable="true"]').first().waitFor({ state: "visible" })
      samples.push(performance.now() - start)
    }
    const sorted = samples.slice(2).sort((a, b) => a - b)
    results.push({
      scope: "production renderer reload to visible composer, empty session",
      samples,
      medianMs: (sorted[3] + sorted[4]) / 2,
      p95Ms: sorted[7],
    })
  }
  if (tasks) {
    const session = await runtime.api("/session", { title: "Task management parity" })
    const other = await runtime.api("/session", { title: "Unrelated session" })
    await open(session.id)
    for (const type of ["shell", "monitor", "scheduler", "task"]) {
      await runtime.api(`/session/${session.id}/message`, {
        model: { providerID: "xai", modelID: "grok-4.7" },
        parts: [{ type: "text", text: `TASK_PANEL_${type}` }],
      })
    }
    const listed = await poll(async () => {
      const items = await runtime.api(`/experimental/session/${session.id}/task`)
      return items.length === 4 && items.every((task) => task.status === "running") && items
    }, "four running task kinds")
    assert.deepEqual(listed.map((task) => task.type).sort(), ["monitor", "scheduler", "shell", "task"])
    const pids = await Promise.all(
      ["shell", "monitor", "child"].map((type) =>
        poll(
          async () =>
            Number(
              await Bun.file(join(runtime.directory, `panel-${type}.pid`))
                .text()
                .catch(() => ""),
            ),
          `${type} process started`,
        ),
      ),
    )
    assert.deepEqual(await runtime.api(`/experimental/session/${other.id}/task`), [])
    const trigger = page.locator('[data-action="session-tasks"]')
    await poll(async () => (await trigger.innerText()).includes("4"), "running count")
    await trigger.click()
    const dialog = page.locator('[data-component="background-tasks"]')
    await dialog.waitFor({ state: "visible" })
    await poll(async () => (await dialog.locator("[data-task-id]").count()) === 4, "all task rows")
    const shell = listed.find((task) => task.type === "shell")
    await dialog.locator(`[data-task-id="${shell.id}"]`).getByRole("button").first().click()
    await poll(
      async () => (await dialog.locator('[data-component="task-output"]').innerText()).includes("SHELL_STDERR_中文"),
      "live output",
    )
    await page.screenshot({ path: join(runtime.output, "tasks-running.png") })
    for (const task of listed) {
      await dialog
        .locator(`[data-task-id="${task.id}"]`)
        .getByRole("button", { name: "Stop task", exact: true })
        .click()
      await poll(
        async () => (await runtime.api(`/experimental/session/${session.id}/task/${task.id}`)).status === "cancelled",
        `cancel ${task.type}`,
      )
    }
    await poll(async () => (await dialog.innerText()).includes("Running: 0"), "zero running tasks")
    await poll(
      () =>
        pids.every((pid) => {
          try {
            process.kill(pid, 0)
            return false
          } catch {
            return true
          }
        }),
      "cancelled process exit",
    )
    await page.screenshot({ path: join(runtime.output, "tasks-cancelled.png") })
    await page.keyboard.press("Escape")
    await open(other.id)
    await page.locator('[data-action="session-tasks"]').click()
    await page.getByText("No tasks in this session.", { exact: true }).waitFor({ state: "visible" })
    results.push({
      action: "task-list-output-cancel-isolation",
      kinds: listed.map((task) => task.type),
      result: "pass",
    })
  }
  if (!benchmark && !tasks) {
    for (const [mode, action] of [
      ["explicit", "click"],
      ["steer", "hotkey"],
      ["stop", "message"],
    ]) {
      const session = await runtime.api("/session", { title: `Shell UI ${action}` })
      activeSessionID = session.id
      await open(session.id)
      await runtime.api(`/session/${session.id}/prompt_async`, {
        model: { providerID: "xai", modelID: "grok-4.7" },
        parts: [{ type: "text", text: `SHELL_START_${mode}` }],
      })
      const button = page.locator('[data-action="prompt-background"]')
      await button.waitFor({ state: "visible", timeout: 15_000 })
      const pid = await poll(
        async () =>
          Number(
            await Bun.file(join(runtime.directory, `${mode}.pid`))
              .text()
              .catch(() => ""),
          ),
        "UI Shell PID",
      )
      await page.screenshot({ path: join(runtime.output, `${action}-before.png`) })
      const editor = page.locator('[contenteditable="true"]').first()
      if (action === "click") await button.click()
      if (action === "hotkey") await editor.press("Control+b")
      if (action === "message") {
        await editor.fill("SHELL_STEER keep working")
        await page.locator('[data-action="prompt-submit"]').click()
        await Bun.write(join(runtime.output, "after-submit.txt"), await page.locator("body").innerText())
        // The composer offers an explicit send/queue choice for follow-up drafts.
        await page.getByRole("button", { name: "Send now", exact: true }).click()
      }
      await button.waitFor({ state: "hidden", timeout: 10_000 })
      await page.getByText("SHELL_ACK", { exact: true }).last().waitFor({ state: "visible" })
      process.kill(pid, 0)
      await Bun.write(join(runtime.directory, `${mode}.release`), "release")
      await page.getByText("SHELL_WAKE_OK", { exact: true }).last().waitFor({ state: "visible" })
      assert.equal(runtime.calls.filter((call) => call.mode === mode && call.action).length, 1)
      const history = await runtime.api(`/session/${session.id}/message`)
      await Bun.write(join(runtime.output, `${action}-history.json`), JSON.stringify(history, null, 2))
      await page.screenshot({ path: join(runtime.output, `${action}-after.png`) })
      results.push({ action, pid, result: "pass" })
    }
  }
  assert.deepEqual(errors, [], "renderer errors")
  await Bun.write(join(runtime.output, "ui-results.json"), JSON.stringify({ kind, results }, null, 2))
  console.log(JSON.stringify({ kind, output: runtime.output, results }))
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]
  if (page) {
    await page.screenshot({ path: join(runtime.output, "ui-failure.png") }).catch(() => {})
    await Bun.write(
      join(runtime.output, "ui-failure.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    )
    if (activeSessionID) {
      await Bun.write(
        join(runtime.output, "ui-failure-history.json"),
        JSON.stringify(await runtime.api(`/session/${activeSessionID}/message`).catch(() => undefined), null, 2),
      )
    }
  }
  console.error(`Shell UI evidence: ${runtime.output}`)
  throw error
} finally {
  for (const mode of ["explicit", "steer", "stop", "panel-shell", "panel-monitor", "panel-child"]) {
    await Bun.write(join(runtime.directory, `${mode}.release`), "cleanup")
  }
  await browser?.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await runtime.close()
}

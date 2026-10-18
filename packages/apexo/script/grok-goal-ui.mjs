import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import http from "node:http"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { poll } from "./grok-shell-fixture.mjs"
import { startGoalFixture } from "./grok-goal-fixture.mjs"
const kind = process.argv[2] ?? "cli"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const { runtime, control } = await startGoalFixture(kind)
const session = await runtime.api("/session", {
  title: "Goal UI",
  agent: "build",
  model: { providerID: "xai", id: "grok-4.7" },
})
const replacementView = { frozen: undefined }
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost")
  if (replacementView.frozen && request.method === "GET" && url.pathname === `/session/${session.id}/goal`) {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify(replacementView.frozen))
    return
  }
  const document = request.headers.accept?.includes("text/html")
  if (document || url.pathname.startsWith("/assets/") || /favicon|apple-touch-icon/.test(url.pathname)) {
    const file = Bun.file(join(repo, "packages/app/dist", document ? "index.html" : url.pathname))
    void file.arrayBuffer().then(
      (content) => {
        response.writeHead(200, { "content-type": file.type })
        const bytes = Buffer.from(content)
        if (document && process.argv.includes("--benchmark")) {
          response.end(
            bytes
              .toString()
              .replace(
                "<head>",
                `<head><script>new MutationObserver((_, observer) => {const element = document.querySelector('[contenteditable="true"]'); if(!element?.getBoundingClientRect().width) return; observer.disconnect(); requestAnimationFrame(()=>window.__pluginsComposerPaint=Date.now()-Number(sessionStorage.getItem('plugins-benchmark-start')));}).observe(document.documentElement,{childList:true,subtree:true});</script>`,
              ),
          )
          return
        }
        response.end(bytes)
      },
      () => {
        response.writeHead(404)
        response.end()
      },
    )
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
const browserSession = `goal-${kind}-${basename(runtime.output)}`
const history = []
const command = async (...args) => {
  const result = await promisify(execFile)(
    "bunx",
    [
      "agent-browser",
      "--session",
      browserSession,
      "--executable-path",
      process.env.CHROMIUM_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ...args,
    ],
    { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
  )
  history.push({ args, output: result.stdout })
  return result.stdout
}

const checks = []
const button = (name) => command("find", "role", "button", "click", "--name", name, "--exact")
const root = `/session/${session.id}/goal`
const text = () => command("get", "text", '[data-component="session-goal"]')
const waitText = (value) => poll(async () => (await text()).includes(value), value)
const url = `http://127.0.0.1:${server.address().port}/${Buffer.from(runtime.directory).toString("base64url")}/session/${session.id}`
try {
  await command("open", url)
  await command("wait", '[data-action="session-goal"]')
  await command("click", '[data-action="session-goal"]')
  await command("wait", '[data-field="goal-objective"]')
  assert.equal(control.calls.length, 0)
  assert.equal(await runtime.api(root), null)
  checks.push("opening-panel-is-passive-in-empty-session")
  await command("fill", '[data-field="goal-objective"]', "UI_GOAL complete all requirements")
  await command("fill", '[data-field="goal-budget"]', "0")
  assert.equal((await command("is", "enabled", '[data-action="goal-create"]')).trim(), "false")
  await command("fill", '[data-field="goal-budget"]', "10000")
  control.hold = Promise.withResolvers()
  await command("click", '[data-action="goal-create"]')
  await poll(async () => (await runtime.api(root))?.phase === "executing", "Goal worker running")
  await waitText("Active")
  assert.equal(
    (await runtime.api(`/session/${session.id}/message`)).filter((item) => item.info.role === "user").length,
    1,
  )
  checks.push("budget-validation-and-empty-session-start")
  await command("press", "Escape")
  assert.equal((await runtime.api(root)).status, "active")
  await command("click", '[data-action="session-goal"]')
  await waitText("Active")
  checks.push("closing-and-reopening-does-not-pause-or-duplicate-goal")
  await command("press", "Escape")
  await command("fill", '[contenteditable="true"]', "/goal pause")
  await command("press", "Enter")
  await waitText("Paused by you")
  control.hold.resolve()
  control.hold = undefined
  await command("press", "Escape")
  await command("fill", '[contenteditable="true"]', "/goal resume")
  await command("press", "Enter")
  await waitText("Verified complete")
  await waitText("Latest evaluation and next step")
  await waitText("3/3 reports")
  await command("click", '[data-verifier="2"] summary')
  await command("wait", "2500")
  assert.equal(await command("get", "count", '[data-verifier="2"][open]').then(Number), 1)
  await waitText("Every requirement verified")
  await command("screenshot", join(runtime.output, "goal-panel-reports.png"))
  checks.push("three-independent-reports-and-individual-evidence")
  assert.equal((await runtime.api(root)).status, "complete")
  assert.equal(
    (await runtime.api(`/session/${session.id}/message`)).filter((item) => item.info.role === "user").length,
    1,
  )
  checks.push("pause-resume-complete-with-evidence-and-no-duplicate-prompt")
  const completed = await runtime.api(root)
  const reportRoot = `${root}/${completed.id}/reports`
  const reportList = await runtime.api(reportRoot)
  const plannerReport = reportList.find((item) => item.kind === "planning")
  await command("click", '[data-action="goal-reports-open"]')
  await command("wait", `[data-report-id="${plannerReport.id}"]`)
  await command("click", `[data-report-id="${plannerReport.id}"] summary`)
  await command("click", `[data-report-id="${plannerReport.id}"] [data-report-file="plan"]`)
  await waitText("Implement the objective and verify the result")
  await poll(
    async () =>
      JSON.parse(
        await command(
          "eval",
          `(() => {
    const heading=document.querySelector('[data-component="goal-report-preview"] h4');
    const rect=heading.getBoundingClientRect();
    return rect.y>=0 && rect.bottom<=innerHeight && heading.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
  })()`,
        ),
      ),
    "report preview must be visible after viewing",
  )
  await command("screenshot", join(runtime.output, "goal-report-files.png"))
  const exported = join(runtime.output, "ui-downloaded-plan.md")
  await command("scrollintoview", `[data-report-id="${plannerReport.id}"] [data-report-download="plan"]`)
  await command("download", `[data-report-id="${plannerReport.id}"] [data-report-download="plan"]`, exported)
  assert.equal(await readFile(exported, "utf8"), (await runtime.api(`${reportRoot}/${plannerReport.id}/plan`)).text)
  checks.push("report-file-preview-and-real-browser-download")
  await command("scrollintoview", '[data-action="goal-reports-delete"]')
  await command("click", '[data-action="goal-reports-delete"]')
  await button("Cancel")
  assert.equal((await runtime.api(reportRoot)).length, reportList.length)
  await command("click", '[data-action="goal-reports-delete"]')
  await command("click", '[data-action="goal-reports-delete-confirm"]')
  await waitText("No report files are available.")
  assert.deepEqual(await runtime.api(reportRoot), [])
  assert.equal((await runtime.api(root)).status, "complete")
  checks.push("report-cleanup-confirmation-preserves-goal-result")
  // Simulate one passive refresh seeing a directly replaced Goal, without an intermediate null snapshot.
  replacementView.frozen = await runtime.api(root)
  await runtime.api(`${root}/${replacementView.frozen.id}`, undefined, "DELETE")
  const replacement = await runtime.api(root, {
    id: `goal_${crypto.randomUUID().replaceAll("-", "")}`,
    objective: "REPLACEMENT_REPORT_GOAL",
  })
  await runtime.api(`${root}/${replacement.id}/start`, { agent: "build", model: { providerID: "xai", id: "grok-4.7" } })
  await poll(async () => (await runtime.api(root)).status === "complete", "replacement report goal complete")
  replacementView.frozen = undefined
  const replacedReports = await runtime.api(`${root}/${replacement.id}/reports`)
  await waitText("REPLACEMENT_REPORT_GOAL")
  await command("wait", `[data-report-id="${replacedReports[0].id}"]`)
  assert.equal(await command("get", "count", `[data-report-id="${plannerReport.id}"]`).then(Number), 0)
  checks.push("open-report-panel-reloads-on-remote-goal-replacement")
  await command("click", '[data-action="goal-clear"]')
  await button("Cancel")
  assert.equal((await runtime.api(root)).status, "complete")
  await command("click", '[data-action="goal-clear"]')
  await command("click", '[data-action="goal-clear-confirm"]')
  await command("wait", '[data-field="goal-objective"]')
  assert.equal(await runtime.api(root), null)
  assert.ok((await runtime.api(`/session/${session.id}/message`)).length > 0)
  checks.push("clear-confirmation-preserves-history")
  await command("press", "Escape")
  await command("fill", '[contenteditable="true"]', "/goal SECOND_UI_GOAL --budget 200")
  await command("press", "Enter")
  await waitText("Token budget exhausted")
  assert.equal((await runtime.api(root)).tokensUsed, 240)
  checks.push("slash-objective-budget-starts-immediately-and-stops")
  await command("press", "Escape")
  await command("eval", 'localStorage.setItem("apexo.global.dat:language",JSON.stringify({locale:"zh"}))')
  await command("reload")
  await command("wait", '[data-action="session-goal"]')
  await command("click", '[data-action="session-goal"]')
  await waitText("Token 预算已耗尽")
  assert.match(await text(), /已用 Token：240/)
  await command("click", '[data-action="goal-reports-open"]')
  await waitText("刷新报告")
  await command("screenshot", join(runtime.output, "goal-ui-zh.png"))
  checks.push("localized-status-budget-and-controls")
  await command("press", "Escape")
  await command(
    "open",
    `http://127.0.0.1:${server.address().port}/${Buffer.from(runtime.directory).toString("base64url")}/session`,
  )
  await command("wait", '[contenteditable="true"]')
  await command("fill", '[contenteditable="true"]', "/goal BRAND_NEW_CHAT_GOAL --budget 200")
  await command("press", "Enter")
  await waitText("Token 预算已耗尽")
  const createdSession = (await command("get", "url")).trim().split("/session/")[1]?.split("?")[0]
  assert.ok(createdSession && createdSession !== session.id)
  assert.equal((await runtime.api(`/session/${createdSession}/goal`)).objective, "BRAND_NEW_CHAT_GOAL")
  assert.equal(
    (await runtime.api(`/session/${createdSession}/message`)).filter((message) => message.info.role === "user").length,
    1,
  )
  checks.push("new-chat-slash-goal-creates-session-and-one-objective")
  console.log(JSON.stringify({ kind, checks, output: runtime.output }, null, 2))
} catch (error) {
  console.error(await command("snapshot", "-i").catch(String))
  await command("screenshot", join(runtime.output, "goal-ui-failure.png")).catch(() => {})
  throw error
} finally {
  control.hold?.resolve()
  await command("close").catch(() => {})
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await runtime.close()
  await writeFile(
    join(runtime.output, "goal-ui.json"),
    JSON.stringify({ checks, history, calls: control.calls }, null, 2),
  )
  console.error(`Goal UI evidence: ${runtime.output}`)
}

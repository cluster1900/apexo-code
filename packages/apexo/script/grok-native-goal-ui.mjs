import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "desktop"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const state = {
  hold: undefined,
  summaryHold: undefined,
  workerEntered: false,
  nativeChild: undefined,
  nativeExited: undefined,
}
const captured = []
const strings = (value) =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : []
const planText =
  "# Native UI plan\n## Acceptance criteria\nVerify the entire original objective.\n## Task checklist\n- [ ] Capture evidence\n- [ ] Independently inspect evidence\n"
const progressNote = "PROGRESS_NOTE: Used captured local evidence."
const written = new Set()
const runtime = await startShellFixture("cli", {
  config: { snapshot: false, goal: { verifier_count: 1 } },
  async next({ body }) {
    const text = strings(body).join("\n")
    captured.push(body)
    if (text.includes("optional closing summary")) {
      assert.equal(body.tools?.length ?? 0, 0, "completion summary has no tools")
      if (state.summaryHold) await state.summaryHold.promise
      return { content: "NATIVE_GOAL_SUMMARY: Independently verified the objective and preserved its reports." }
    }
    const report = (key) => {
      const value = new RegExp(`${key}=("[^"\\n]+")`).exec(text)?.[1]
      return value ? JSON.parse(value) : undefined
    }
    const plan = report("PLAN_FILE")
    const verdict = report("VERDICT_FILE")
    const details = report("DETAILS_FILE")
    if (plan || verdict) {
      const path = [plan, verdict, details].find((value) => value && !written.has(value))
      if (!path) return { content: "Done" }
      written.add(path)
      return {
        tool: "goal_report_write",
        args: {
          path,
          content:
            path === plan
              ? planText
              : path === verdict
                ? JSON.stringify({
                    achieved: true,
                    confidence: "high",
                    blocking: "none",
                    evidence: "Native UI verified",
                    unmet: [],
                  })
                : "# Native verification\nThe objective was achieved.",
        },
      }
    }
    if (text.includes("hidden completion evaluator"))
      return {
        content: JSON.stringify({
          decision: "candidate_complete",
          evidence: "Native work completed",
          next_step: "Verify it",
          blocker_key: "",
        }),
      }
    if (state.hold) {
      state.workerEntered = true
      await state.hold.promise
    }
    const progress = JSON.parse(/Advisory plan progress: ([^\n]+)/.exec(text)?.[1] ?? "null")
    if (!progress?.tasks?.[0]?.completed)
      return { tool: "update_goal", args: { plan_progress: { complete: [0, 1], deviation: progressNote } } }
    return { content: "NATIVE_GOAL_UI_DONE" }
  },
})
await runtime.crash()
await writeFile(
  join(runtime.directory, "apexo.json"),
  JSON.stringify({
    ...JSON.parse(runtime.env.APEXO_CONFIG_CONTENT),
    snapshots: false,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    providers: {
      xai: {
        name: "Native UI fixture",
        api: {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: runtime.env.XAI_BASE_URL,
          settings: { apiKey: "local-parity-key" },
        },
        models: {
          "grok-4.7": {
            name: "Native UI fixture",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 100000, output: 10000 },
          },
        },
      },
    },
  }),
)
const nativeServerFile = join(runtime.output, "native-server.mjs")
await writeFile(
  nativeServerFile,
  `import { webHandler } from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async(request)=>{const response=await app.handler(request);console.log("REQUEST="+JSON.stringify({method:request.method,url:request.url,status:response.status,origin:request.headers.get("origin")}));return response}});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
)
state.nativeChild = spawn(process.execPath, [nativeServerFile], {
  cwd: runtime.directory,
  env: { ...runtime.env, APEXO_SERVER_PASSWORD: "" },
  stdio: ["ignore", "pipe", "pipe"],
})
state.nativeExited = new Promise((resolve) => state.nativeChild.once("exit", resolve))
const serverLogs = []
state.nativeChild.stdout.on("data", (chunk) => {
  serverLogs.push(chunk)
  const match = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/)
  if (match) runtime.url = match[1]
})
state.nativeChild.stderr.on("data", (chunk) => serverLogs.push(chunk))
const oldUrl = runtime.url
await poll(() => runtime.url !== oldUrl, "native-only server ready", 30000)
runtime.api = async (path, body, method = body ? "POST" : "GET") => {
  const response = await fetch(`${runtime.url}${path}?location[directory]=${encodeURIComponent(runtime.directory)}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  assert.ok(response.ok, text)
  return text ? JSON.parse(text) : undefined
}
assert.equal((await fetch(`${runtime.url}/global/health`)).status, 404)
assert.deepEqual(await runtime.api("/api/health"), { healthy: true })
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
const browserSession = `native-goal-${kind}-${basename(runtime.output)}`
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
  if (["click", "download"].includes(args[0]) && args[1]?.includes("goal")) {
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
    }, `stable enabled Goal action ${args[1]}`)
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
      "native feedback window",
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
  const endpoint = `/api/session/${session.id}/goal`
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
  await command("wait", '[data-action="session-goal"]')
  await command("click", '[data-action="session-goal"]')
  await command("wait", '[data-field="goal-objective"]')
  assert.equal(await runtime.api(endpoint), null)
  assert.equal(captured.length, 0)
  checks.push("native-empty-panel-is-passive")
  await command("fill", '[data-field="goal-objective"]', "Verify native Goal UI routing")
  await command("fill", '[data-field="goal-budget"]', "10000")
  state.hold = Promise.withResolvers()
  await command("click", '[data-action="goal-create"]')
  await poll(async () => (await runtime.api(endpoint))?.phase === "executing", "native worker held", 30000)
  await poll(() => state.workerEntered, "worker provider request entered")
  await poll(
    async () => (await command("get", "text", '[data-component="session-goal"] [role="status"]')).includes("Working"),
    "rendered worker state before pause",
  )
  await command("click", '[data-action="goal-pause"]')
  await poll(async () => (await runtime.api(endpoint))?.status === "user_paused", "native pause")
  state.hold.resolve()
  state.hold = undefined
  await command("click", '[data-action="goal-resume"]')
  await poll(async () => (await runtime.api(endpoint))?.status === "complete", "native verified complete", 30000)
  checks.push("native-create-start", "native-pause-resume", "independent-native-verification")
  await poll(
    async () => (await runtime.api(endpoint))?.summary?.reason === "usage",
    "cancelled usage prevents optional summary",
  )
  await command("wait", '[data-component="goal-summary"][data-summary-status="failed"]')
  checks.push("unknown-usage-keeps-completion-without-summary")
  await command("click", '[data-action="goal-clear"]')
  await command("click", '[data-action="goal-clear-confirm"]')
  await command("wait", '[data-field="goal-objective"]')
  await command("fill", '[data-field="goal-objective"]', "Verify native Goal completion summary")
  await command("fill", '[data-field="goal-budget"]', "10000")
  state.summaryHold = Promise.withResolvers()
  await command("click", '[data-action="goal-create"]')
  await poll(async () => (await runtime.api(endpoint))?.summary?.status === "running", "native completion summary held")
  await command("wait", '[data-goal-status="complete"]')
  await command("wait", '[data-component="goal-summary"][data-summary-status="running"]')
  checks.push("completion-visible-before-summary-finishes")
  state.summaryHold.resolve()
  state.summaryHold = undefined
  await poll(
    async () => (await runtime.api(endpoint))?.summary?.status === "completed",
    "native completion summary finished",
  )
  await command("wait", '[data-component="goal-summary"][data-summary-status="completed"]')
  assert.match(await command("get", "text", '[data-component="goal-summary"]'), /NATIVE_GOAL_SUMMARY/)
  await command("screenshot", join(runtime.output, "native-goal-summary.png"))
  await command("press", "Escape")
  await command("click", '[data-action="session-goal"]')
  await command("wait", '[data-component="goal-summary"][data-summary-status="completed"]')
  assert.equal(captured.filter((body) => strings(body).join("\n").includes("optional closing summary")).length, 1)
  checks.push("summary-display-and-reopen-without-model-work")
  await command("wait", '[data-component="goal-plan-progress"]')
  const progressText = await command("get", "text", '[data-component="goal-plan-progress"]')
  assert.match(progressText, /Plan progress/)
  assert.match(progressText, /Task 1 complete/)
  assert.match(progressText, /Task 2 complete/)
  assert.ok(progressText.includes(progressNote))
  assert.match(progressText, /independent verification/)
  await command("scrollintoview", '[data-component="goal-plan-progress"]')
  await command("screenshot", join(runtime.output, "native-goal-progress-en.png"))
  checks.push("real-worker-plan-progress-rendered")
  if (process.argv.includes("--locales")) {
    for (const locale of ["zh", "zht"]) {
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
      await command("wait", '[data-action="session-goal"]')
      await command("click", '[data-action="session-goal"]')
      await command("wait", '[data-component="goal-summary"][data-summary-status="completed"]')
      assert.match(await command("get", "text", '[data-component="goal-summary"]'), /完成摘要/)
      const localizedProgress = await command("get", "text", '[data-component="goal-plan-progress"]')
      assert.ok(localizedProgress.includes(locale === "zh" ? "计划进度" : "計畫進度"))
      assert.ok(localizedProgress.includes(locale === "zh" ? "任务 1 已完成" : "任務 1 已完成"))
      assert.ok(localizedProgress.includes(locale === "zh" ? "计划调整" : "計畫調整"))
      assert.ok(localizedProgress.includes(progressNote))
      await command("scrollintoview", '[data-component="goal-plan-progress"]')
      await command("screenshot", join(runtime.output, `native-goal-progress-${locale}.png`))
      await command("screenshot", join(runtime.output, `native-goal-summary-${locale}.png`))
    }
    checks.push("localized-completion-summary", "localized-real-plan-progress")
  }
  const info = await runtime.api(endpoint)
  assert.deepEqual(info.planProgress, { completed: [0, 1], deviations: [progressNote] })
  assert.equal(info.plan, planText)
  const reports = await runtime.api(`${endpoint}/${info.id}/reports`)
  for (const report of reports) {
    const content = await runtime.api(`${endpoint}/${info.id}/reports/${report.id}/plan`)
    assert.equal(content.text, planText)
    assert.equal(content.sha256, createHash("sha256").update(planText).digest("hex"))
  }
  checks.push("progress-preserves-original-report-hashes")
  assert.ok(reports.length >= 2)
  await command("click", '[data-action="goal-reports-open"]')
  const planner = reports.find((entry) => entry.files.some((file) => file.key === "plan"))
  await command("click", `[data-report-id="${planner.id}"] summary`)
  await command("click", `[data-report-id="${planner.id}"] [data-report-file="plan"]`)
  await command("wait", '[data-component="goal-report-preview"]')
  const exported = join(runtime.output, "native-plan.md")
  await command("download", `[data-report-id="${planner.id}"] [data-report-download="plan"]`, exported)
  assert.equal(
    await readFile(exported, "utf8"),
    (await runtime.api(`${endpoint}/${info.id}/reports/${planner.id}/plan`)).text,
  )
  checks.push("native-report-list-preview-download")
  await command("screenshot", join(runtime.output, "native-goal-report.png"))
  await command("click", '[data-action="goal-reports-delete"]')
  await command("click", '[data-action="goal-reports-delete-confirm"]')
  await poll(
    async () =>
      (
        await command(
          "eval",
          `!document.querySelector('[data-action="goal-reports-refresh"]').disabled && document.querySelectorAll('[data-report-id]').length === 0`,
        )
      ).trim() === "true",
    "native report cleanup UI settled",
  )
  assert.equal((await runtime.api(`${endpoint}/${info.id}/reports`)).length, 0)
  await command("click", '[data-action="goal-clear"]')
  await command("click", '[data-action="goal-clear-confirm"]')
  await poll(async () => (await runtime.api(endpoint)) === null, "native Goal clear")
  assert.ok((await runtime.api(`/api/session/${session.id}/context`)).data.length > 0)
  checks.push("native-confirmed-cleanup", "native-clear-preserves-transcript")
  const projectRequests = Buffer.concat(serverLogs)
    .toString()
    .split("\n")
    .filter((line) => line.startsWith("REQUEST="))
    .map((line) => JSON.parse(line.slice(8)))
    .filter((entry) => ["/api/project", "/api/project/current"].includes(new URL(entry.url).pathname))
  assert.ok(projectRequests.some((entry) => new URL(entry.url).pathname === "/api/project"))
  assert.ok(projectRequests.some((entry) => new URL(entry.url).pathname === "/api/project/current"))
  assert.ok(
    projectRequests.every((entry) => entry.status === 200),
    "native project bootstrap requests succeed",
  )
  assert.ok(!(await command("get", "text", "body")).includes("UnexpectedStatus"), "no project bootstrap error toast")
  checks.push("native-project-bootstrap-without-reload-errors")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, output: runtime.output }))
} catch (error) {
  await command("screenshot", join(runtime.output, "failure.png")).catch(() => {})
  await writeFile(
    join(runtime.output, "failure-layout.json"),
    await command(
      "eval",
      `Array.from(document.querySelectorAll('[data-component="session-goal"] button')).map(element=>{const rect=element.getBoundingClientRect();return {action:element.dataset.action,disabled:element.disabled,rect:rect.toJSON(),hit:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.outerHTML.slice(0,400)}})`,
    ).catch(String),
  )
  throw error
} finally {
  state.hold?.resolve()
  state.summaryHold?.resolve()
  await command("screenshot", join(runtime.output, "final.png")).catch(() => {})
  await command("close").catch(() => {})
  if (native.child && native.child.exitCode === null) {
    native.child.kill("SIGTERM")
    await deadline(native.exited, 15_000, "owned side-question native exit").catch(async () => {
      native.child.kill("SIGKILL")
      await native.exited
    })
  }
  if (kind === "native") await writeFile(join(runtime.output, "native.log"), Buffer.concat(nativeLogs))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  state.nativeChild?.kill("SIGTERM")
  await deadline(state.nativeExited, 10000, "native server cleanup").catch(() => state.nativeChild?.kill("SIGKILL"))
  await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(serverLogs))
  await runtime.close()
  await writeFile(
    join(runtime.output, "native-goal-ui.json"),
    JSON.stringify({ checks, history, requests, captured }, null, 2),
  )
}

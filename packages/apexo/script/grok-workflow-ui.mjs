import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "desktop"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const state = { hold: undefined, schemaHold: undefined, schemaCalls: 0 }
const captured = []
const runtime = await startShellFixture(kind === "native" ? "cli" : kind, {
  config: { snapshot: false },
  models: {
    "grok-4.7": {
      name: "Side question fixture",
      tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      limit: { context: 100000, output: 10000 },
    },
  },
  async next({ body, text }) {
    captured.push(body)
    if (state.hold) await state.hold.promise
    if (
      text.includes("SCHEMA_RENDER") ||
      text.includes("Your final message did not satisfy the Workflow output contract")
    ) {
      state.schemaCalls++
      if (text.includes("Workflow output contract")) {
        await state.schemaHold.promise
        return { content: '{"ok":true}' }
      }
      return { content: '{"wrong":true}' }
    }
    if (text.includes("Plan research")) return { content: JSON.stringify({ questions: ["Research evidence"] }) }
    if (text.includes("Investigate the supplied"))
      return {
        content: JSON.stringify({
          claims: [{ claim: "UI evidence", evidence: "Inspected", url: "https://example.com/ui" }],
          uncertainties: [],
        }),
      }
    if (text.includes("Independently verify"))
      return {
        content: JSON.stringify({
          accepted: [{ claim: "UI evidence", evidence: "Verified", url: "https://example.com/ui" }],
          rejected: [],
        }),
      }
    if (text.includes("report") && text.includes("sources"))
      return { content: JSON.stringify({ report: "UI research evidence", sources: ["https://example.com/ui"] }) }
    return { content: "WORKFLOW_UI_ANSWER" }
  },
})
const server = createServer((incoming, response) => {
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
const browserSession = `workflow-${kind}-${basename(runtime.output)}`
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
  if (["click", "download"].includes(args[0]) && args[1]?.includes("workflow")) await command("scrollintoview", args[1])
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
    runtime.api = async (path, body, method = body ? "POST" : "GET") => {
      const response = await fetch(`${connection.url}${path}?directory=${encodeURIComponent(runtime.directory)}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`,
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const text = await response.text()
      assert.ok(response.ok, text)
      return text ? JSON.parse(text) : undefined
    }
  }
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  await mkdir(join(runtime.directory, ".apexo", "workflows"), { recursive: true })
  await writeFile(
    join(runtime.directory, ".apexo", "workflows", "ui-flow.rhai"),
    'phase("UI verification"); complete(parallel([#{prompt:"WORKFLOW_UI_A",capability_mode:"read-only"},#{prompt:"WORKFLOW_UI_B",capability_mode:"read-only"}]));',
  )
  const session = await runtime.api("/session", {
    title: "Workflow UI verification",
    agent: "build",
    model: { providerID: "xai", id: "grok-4.7" },
  })
  const endpoint = `/api/session/${session.id}/workflow/related`
  if (process.argv.includes("--probe-original"))
    console.log(
      "ORIGINAL_APP_PATH_VALIDATE",
      await runtime
        .api(`/api/session/${session.id}/workflow/validate`, { source: { type: "saved", name: "ui-flow" } })
        .catch((error) => String(error)),
    )
  const url = `http://127.0.0.1:${server.address().port}/${Buffer.from(runtime.directory).toString("base64url")}/session/${session.id}`
  if (kind === "native") {
    await command(
      "eval",
      `(async()=>{ const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(`/${Buffer.from(runtime.directory).toString("base64url")}/session/${session.id}`)});return true})()`,
    )
    await command("reload")
  } else await command("open", url)
  await command("wait", '[data-action="session-workflow"]')
  await command("click", '[data-action="session-workflow"]')
  await command("wait", '[data-testid="workflow-panel"]')
  // Saved sources load after the panel mounts; selecting before they arrive finds no options.
  await poll(
    async () =>
      (
        await command(
          "eval",
          `[...document.querySelectorAll('[data-testid="workflow-source"] option')].some((o) => o.value === "saved:ui-flow")`,
        )
      ).includes("true"),
    "saved workflow source listed",
  )
  await command("select", '[data-testid="workflow-source"]', "saved:ui-flow")
  await command("click", '[data-testid="workflow-validate"]')
  await command(
    "wait",
    "--fn",
    'document.querySelector("[data-testid=workflow-validation]")?.textContent.includes("Source is valid")',
  )
  checks.push("source-discovery", "source-validation")
  await command("fill", '[data-testid="workflow-budget"]', "1")
  await command("click", '[data-testid="workflow-start"]')
  await command("wait", '[data-testid="workflow-run"][data-status="budget_limited"]')
  await command("fill", '[data-testid="workflow-resume-budget"]', "2")
  await command("click", '[data-testid="workflow-resume"]')
  await poll(async () => (await runtime.api(endpoint))[0]?.status === "completed", "resumed completion", 30000)
  await command("wait", '[data-testid="workflow-run"][data-status="completed"]')
  const first = (await runtime.api(endpoint))[0]
  assert.notEqual(first.sessionID, session.id)
  assert.equal(first.children.length, 2)
  assert.equal((await runtime.api(`/session/${session.id}/message`)).length, 0)
  checks.push("budget-limited-dashboard", "budget-resume", "dedicated-host", "main-transcript-untouched")
  await command("wait", "--fn", '!document.querySelector("[data-testid=workflow-usage-incomplete]")')
  checks.push("exact-usage-has-no-lower-bound-hint")
  const beforeHeld = captured.length
  state.hold = Promise.withResolvers()
  await command("fill", '[data-testid="workflow-budget"]', "2")
  await command("click", '[data-testid="workflow-start"]')
  await poll(() => captured.length > beforeHeld, "provider started before pause")
  await command("wait", '[data-testid="workflow-pause"]')
  await command("click", '[data-testid="workflow-pause"]')
  await command("wait", '[data-testid="workflow-run"][data-status="paused"] [data-testid="workflow-usage-incomplete"]')
  const paused = (await runtime.api(endpoint)).find((entry) => entry.status === "paused")
  assert.equal(paused.usageIncomplete, true)
  assert.equal(paused.tokens, 0)
  checks.push("actual-cancelled-usage-renders-lower-bound-hint")
  await command("click", '[data-testid="workflow-stop"]')
  await command("wait", '[data-testid="workflow-confirm-stop"]')
  assert.ok((await runtime.api(endpoint)).some((entry) => entry.status === "paused"))
  await command("click", '[data-testid="workflow-confirm-stop"]')
  await command("wait", '[data-testid="workflow-run"][data-status="cancelled"]')
  checks.push("targeted-pause", "confirmed-stop")
  state.hold.resolve()
  state.hold = undefined
  await command("screenshot", join(runtime.output, "workflow-dashboard.png"))
  const before = captured.length
  await command("reload")
  await command("wait", '[data-action="session-workflow"]')
  await command("click", '[data-action="session-workflow"]')
  await command("wait", '[data-testid="workflow-run"][data-status="completed"]')
  assert.equal(captured.length, before)
  checks.push("reload-recovers-linked-hosts-without-resubmission")
  await command("press", "Escape")
  await command("fill", '[contenteditable="true"]', "/workflow run ui-flow {}")
  await command("press", "Enter")
  await poll(
    async () => (await runtime.api(endpoint)).filter((entry) => entry.status === "completed").length === 2,
    "typed workflow command",
    30000,
  )
  assert.equal((await runtime.api(`/session/${session.id}/message`)).length, 0)
  checks.push("typed-command-does-not-enter-main-model")
  await command("press", "Escape")
  await command("fill", '[contenteditable="true"]', "/deep-research Find UI evidence")
  await command("press", "Enter")
  await poll(
    async () =>
      (await runtime.api(endpoint)).some((entry) => entry.name === "deep-research" && entry.status === "completed"),
    "deep research shortcut",
    30000,
  )
  checks.push("deep-research-shortcut")
  state.schemaHold = Promise.withResolvers()
  const schemaRoot = `/api/session/${first.sessionID}/workflow`
  const schemaRun = await runtime.api(schemaRoot, {
    source: {
      type: "script",
      name: "schema-render",
      script:
        'let r = agent("SCHEMA_RENDER", #{capability_mode:"read-only",output_schema:#{type:"object",required:["ok"],properties:#{ok:#{type:"boolean"}},additionalProperties:false}}); complete(r.output);',
    },
    agentBudget: 1,
  })
  await poll(() => state.schemaCalls === 2, "held schema correction")
  await runtime.api(`${schemaRoot}/${schemaRun.id}/pause`, undefined, "POST")
  const schemaPaused = await runtime.api(`${schemaRoot}/${schemaRun.id}`)
  assert.equal(schemaPaused.status, "paused")
  assert.equal(schemaPaused.resumeBlockedReason, "schema_attempt_claimed")
  assert.equal(schemaPaused.tokens, 120)
  assert.equal(schemaPaused.usageIncomplete, true)
  await command("click", '[data-testid="workflow-refresh"]')
  await command(
    "wait",
    "--fn",
    'document.querySelector("[data-testid=workflow-run][data-status=paused] [data-testid=workflow-resume-blocked]")?.textContent.includes("Start a new Workflow run")',
  )
  await command(
    "wait",
    "--fn",
    '!document.querySelector("[data-testid=workflow-run][data-status=paused] [data-testid=workflow-resume]")',
  )
  await command(
    "scrollintoview",
    '[data-testid="workflow-run"][data-status="paused"] [data-testid="workflow-resume-blocked"]',
  )
  await command("screenshot", join(runtime.output, "workflow-schema-en.png"))
  checks.push("claimed-schema-attempt-renders-recovery-reason-and-hides-resume")
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
      await command("wait", '[data-action="session-workflow"]')
      await command("click", '[data-action="session-workflow"]')
      await command("wait", '[data-testid="workflow-resume-blocked"]')
      const text = await command(
        "eval",
        'document.querySelector("[data-testid=workflow-run][data-status=paused]").textContent',
      )
      assert.ok(text.includes(locale === "zh" ? "请启动新的工作流" : "請啟動新的工作流程"))
      assert.ok(text.includes(locale === "zh" ? "已记录总量" : "已記錄的總量"))
      await command(
        "scrollintoview",
        '[data-testid="workflow-run"][data-status="paused"] [data-testid="workflow-resume-blocked"]',
      )
      await command("screenshot", join(runtime.output, `workflow-schema-${locale}.png`))
      checks.push(`schema-recovery-and-lower-bound-${locale}`)
    }
  }
  console.log(JSON.stringify({ kind, passed: checks.length, checks, output: runtime.output }))
} finally {
  state.hold?.resolve()
  state.schemaHold?.resolve()
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
  await runtime.close()
  await writeFile(join(runtime.output, "workflow-ui.json"), JSON.stringify({ checks, history }, null, 2))
}

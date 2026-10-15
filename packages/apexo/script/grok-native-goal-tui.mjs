import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { Terminal } from "@xterm/headless"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises"
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

const fullscreen = process.argv.includes("--fullscreen")
const terminal = new Terminal({ cols: fullscreen ? 120 : 100, rows: fullscreen ? 40 : 26, allowProposedApi: true })
const screen = { text: "" }
const plain = () =>
  Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const checks = []
let child
const reveal = async (text) => {
  child.terminal.write("\x1b[H")
  await poll(() => {
    if (plain().includes(text)) return true
    child.terminal.write("\x1b[B")
    return false
  }, `keyboard reveal ${text}`)
}
try {
  const session = (
    await runtime.api("/api/session", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  const endpoint = `/api/session/${session.id}/goal`
  await symlink(join(repo, "packages/apexo/node_modules"), join(runtime.output, "node_modules"))
  const harness = join(runtime.output, "goal-terminal.tsx")
  await writeFile(
    harness,
    `/** @jsxImportSource @opentui/solid */
import { createCliRenderer } from ${JSON.stringify(import.meta.resolve("@opentui/core"))};
import { render } from ${JSON.stringify(import.meta.resolve("@opentui/solid"))};
import { createDefaultOpenTuiKeymap } from ${JSON.stringify(import.meta.resolve("@opentui/keymap/opentui"))};
import { KeymapProvider } from ${JSON.stringify(import.meta.resolve("@opentui/keymap/solid"))};
import { createApexoClient } from ${JSON.stringify(import.meta.resolve("@apexo/sdk/v2"))};
import { SessionGoal, goalActions } from ${JSON.stringify(join(repo, "packages/tui/src/component/session-goal.tsx"))};
const renderer = await createCliRenderer({exitOnCtrlC:true,useKittyKeyboard:{},useMouse:false});
const keymap = createDefaultOpenTuiKeymap(renderer);
const client = createApexoClient({baseUrl:${JSON.stringify(runtime.url)}});
const actions = goalActions(client, async()=>${JSON.stringify(session.id)}, ()=>({agent:"build",model:{providerID:"xai",id:"grok-4.7"}}));
const cancelled = new AbortController();cancelled.abort();await actions.get(cancelled.signal).catch(()=>undefined);
await render(()=><KeymapProvider keymap={keymap}><SessionGoal actions={actions} objective="Verify native Goal terminal summary" theme={()=>({text:"#ffffff",muted:"#aaaaaa",error:"#ff5555",highlight:"#55ffff"})} onClose={()=>{renderer.destroy();process.exit(0)}}/></KeymapProvider>,renderer);
`,
  )
  state.hold = Promise.withResolvers()
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [process.execPath, "--no-install", "--preload", import.meta.resolve("@opentui/solid/preload"), harness],
    {
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols: terminal.cols,
        rows: terminal.rows,
        data(_, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          screen.text += text
          terminal.write(text)
          if (text.includes("\x1b[6n")) child.terminal.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(
    () => plain().includes("Enter creates and starts"),
    "native Goal panel after cancelled protocol probe",
    30000,
  )
  assert.equal(captured.length, 0)
  checks.push("passive-native-panel-and-cancelled-probe-recovery")
  child.terminal.write("\r")
  await poll(async () => (await runtime.api(endpoint))?.phase === "executing", "native worker held", 30000)
  await poll(() => state.workerEntered, "worker provider request entered")
  await poll(() => plain().includes("active") && plain().includes("executing"), "active worker panel")
  child.terminal.write("p")
  await poll(async () => (await runtime.api(endpoint))?.status === "user_paused", "native Goal pause")
  state.hold.resolve()
  state.hold = undefined
  await poll(() => plain().includes("user_paused"), "paused panel")
  child.terminal.write("r")
  await poll(
    async () => (await runtime.api(endpoint))?.summary?.reason === "usage",
    "cancelled usage prevents optional summary",
    30000,
  )
  await poll(() => plain().includes("summary is unavailable"), "completed Goal with unknown usage")
  checks.push("unknown-usage-keeps-completion-without-summary")
  child.terminal.write("x")
  await poll(() => plain().includes("y confirm"), "first Goal clear confirmation")
  child.terminal.write("y")
  await poll(() => plain().includes("Enter creates and starts"), "fresh Goal form")
  state.summaryHold = Promise.withResolvers()
  child.terminal.write("\r")
  await poll(async () => (await runtime.api(endpoint))?.summary?.status === "running", "summary in progress", 30000)
  await poll(
    () => plain().includes("complete") && plain().includes("Preparing the completion summary"),
    "complete remains visible during summary",
  )
  checks.push("native-create-pause-resume", "complete-before-summary-settles")
  state.summaryHold.resolve()
  state.summaryHold = undefined
  await poll(async () => (await runtime.api(endpoint))?.summary?.status === "completed", "summary completed")
  await poll(() => plain().includes("NATIVE_GOAL_SUMMARY"), "summary visible in terminal")
  checks.push("native-completion-summary-display")
  await reveal("Task 1 complete")
  await reveal("Task 2 complete")
  await reveal(progressNote)
  await writeFile(join(runtime.output, "goal-progress-visible.txt"), plain())
  const completed = await runtime.api(endpoint)
  assert.deepEqual(completed.planProgress, { completed: [0, 1], deviations: [progressNote] })
  assert.equal(completed.plan, planText)
  for (const report of await runtime.api(`${endpoint}/${completed.id}/reports`)) {
    const content = await runtime.api(`${endpoint}/${completed.id}/reports/${report.id}/plan`)
    assert.equal(content.text, planText)
    assert.equal(content.sha256, createHash("sha256").update(planText).digest("hex"))
  }
  checks.push("real-worker-progress-visible-by-keyboard", "progress-preserves-report-hashes")
  child.terminal.write("\x1b[H")
  child.terminal.write("f")
  await poll(() => plain().includes("Report files") && plain().includes("plan.md"), "native report list")
  child.terminal.write("\r")
  await poll(() => plain().includes("Preview"), "native report preview")
  child.terminal.write("\x1b[27u")
  await poll(() => !plain().includes("Preview"), "return from preview")
  child.terminal.write("\x1b[27u")
  await reveal("NATIVE_GOAL_SUMMARY")
  assert.equal(captured.filter((body) => strings(body).join("\n").includes("optional closing summary")).length, 1)
  checks.push("native-reports-and-summary-do-not-restart-model")
  child.terminal.write("x")
  await poll(() => plain().includes("y confirm"), "clear confirmation")
  child.terminal.write("n")
  await poll(() => !plain().includes("y confirm"), "clear cancellation")
  assert.equal((await runtime.api(endpoint)).status, "complete")
  child.terminal.write("x")
  await poll(() => plain().includes("y confirm"), "clear confirmation again")
  child.terminal.write("y")
  await poll(async () => (await runtime.api(endpoint)) === null, "native Goal cleared")
  assert.ok((await runtime.api(`/api/session/${session.id}/context`)).data.length > 0)
  checks.push("native-confirmed-clear-preserves-transcript")
  console.log(
    JSON.stringify({
      mode: fullscreen ? "expanded-native-actions" : "compact-native-actions",
      passed: checks.length,
      checks,
      output: runtime.output,
    }),
  )
} finally {
  state.hold?.resolve()
  state.summaryHold?.resolve()
  await writeFile(join(runtime.output, "goal-tui.txt"), plain())
  await writeFile(join(runtime.output, "goal-tui.ansi"), screen.text)
  child?.kill("SIGTERM")
  if (child)
    await deadline(child.exited, 10000, "owned Goal PTY cleanup").catch(async () => {
      child.kill("SIGKILL")
      await child.exited
    })
  child?.terminal?.close()
  terminal.dispose()
  state.nativeChild?.kill("SIGTERM")
  await deadline(state.nativeExited, 10000, "native server cleanup").catch(async () => {
    state.nativeChild?.kill("SIGKILL")
    await state.nativeExited
  })
  await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(serverLogs))
  await runtime.close()
  console.error(`Native Goal PTY evidence: ${runtime.output}`)
}

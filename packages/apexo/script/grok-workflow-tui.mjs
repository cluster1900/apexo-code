import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"
const state = { calls: [], hold: undefined, schemaHold: undefined, schemaCalls: 0 }
const runtime = await startShellFixture("cli", {
  config: { snapshot: false },
  async next({ body, text }) {
    state.calls.push(body)
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
const fullscreen = process.argv.includes("--fullscreen")
const screen = { text: "" }
const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
const plain = () =>
  Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const checks = []
let child
try {
  const session = await runtime.api("/session", {
    title: "Workflow terminal verification",
    agent: "build",
    model: { providerID: "xai", id: "grok-4.7" },
  })
  const endpoint = `/api/session/${session.id}/workflow/related`
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  await mkdir(join(runtime.directory, ".apexo", "workflows"), { recursive: true })
  await writeFile(
    join(runtime.directory, ".apexo", "workflows", "ui-flow.rhai"),
    'phase("UI verification"); complete(parallel([#{prompt:"WORKFLOW_UI_A",capability_mode:"read-only"},#{prompt:"WORKFLOW_UI_B",capability_mode:"read-only"}]));',
  )
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      resolve("src/index.ts"),
      "attach",
      runtime.url,
      ...(!fullscreen ? ["--mini"] : []),
      "--dir",
      runtime.directory,
      "--session",
      session.id,
      ...(!fullscreen ? ["--no-replay"] : []),
    ],
    {
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols: 120,
        rows: 40,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          screen.text += text
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "terminal ready", 30_000)
  child.terminal.write("\x1b[200~/workflow run ui-flow {}\x1b[201~")
  await poll(() => plain().includes("/workflow run ui-flow"), "workflow command entered")
  child.terminal.write("\r")
  await poll(() => plain().includes("ui-flow") && plain().includes("completed"), "completed workflow dashboard", 30000)
  const initial = (await runtime.api(endpoint))[0]
  assert.notEqual(initial.sessionID, session.id)
  assert.equal(initial.children.length, 2)
  assert.equal((await runtime.api(`/session/${session.id}/message`)).length, 0)
  checks.push("typed-slash-launch", "dedicated-native-host", "main-transcript-untouched", "completed-dashboard")
  child.terminal.write("v")
  await poll(() => plain().includes("Source is valid"), "source validation")
  checks.push("saved-source-validation")
  child.terminal.write("b")
  await poll(() => plain().includes("Ctrl+S apply"), "budget editor")
  child.terminal.write("\x01\x0b1\x13")
  await poll(() => plain().includes("Budget 1 "), "budget applied")
  child.terminal.write("s")
  await poll(() => plain().includes("budget_limited"), "budget limit shown")
  await poll(() => !plain().includes("Loading…"), "budget refresh settled")
  child.terminal.write("u")
  await poll(() => plain().includes("resume · Ctrl+S"), "resume budget editor")
  child.terminal.write("\x01\x0b2\x13")
  await poll(
    async () => (await runtime.api(endpoint)).every((entry) => entry.status === "completed"),
    "resume completes",
    30000,
  )
  checks.push("budget-limit-dashboard", "increased-budget-resume")
  assert.ok(!plain().includes("Recorded usage is a lower bound."))
  checks.push("exact-usage-has-no-lower-bound-hint")
  const beforeHeld = state.calls.length
  state.hold = Promise.withResolvers()
  child.terminal.write("b")
  await poll(() => plain().includes("Ctrl+S apply"), "next budget editor")
  child.terminal.write("\x01\x0b2\x13")
  child.terminal.write("s")
  await poll(async () => (await runtime.api(endpoint)).some((entry) => entry.status === "running"), "held workflow")
  await poll(() => state.calls.length > beforeHeld, "provider started before pause")
  await poll(() => !plain().includes("Loading…"), "launch refresh settled")
  child.terminal.write("p")
  await poll(() => plain().includes("paused"), "pause dashboard", 20000)
  await poll(() => plain().includes("Recorded usage is a lower bound."), "actual incomplete usage hint")
  const paused = (await runtime.api(endpoint)).find((entry) => entry.status === "paused")
  assert.equal(paused.usageIncomplete, true)
  assert.equal(paused.tokens, 0)
  checks.push("targeted-pause", "actual-cancelled-usage-renders-lower-bound-hint")
  await poll(() => !plain().includes("Loading…"), "control refresh settled")
  child.terminal.write("x")
  await poll(() => plain().includes("y confirm"), "stop confirmation")
  child.terminal.write("n")
  await poll(() => !plain().includes("y confirm"), "stop declined")
  assert.ok((await runtime.api(endpoint)).some((entry) => entry.status === "paused"))
  await poll(() => !plain().includes("Loading…"), "control refresh settled")
  child.terminal.write("x")
  await poll(() => plain().includes("y confirm"), "stop confirmation again")
  child.terminal.write("y")
  await poll(() => plain().includes("cancelled"), "stopped dashboard")
  checks.push("confirmed-stop-with-decline-path")
  state.hold?.resolve()
  state.hold = undefined
  child.terminal.write("\x1b")
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "composer restored")
  child.terminal.write("\x1b[200~/deep-research Find UI evidence\x1b[201~")
  await poll(() => plain().includes("Find UI evidence"), "research command entered")
  child.terminal.write("\r")
  await poll(
    async () =>
      (await runtime.api(endpoint)).some((entry) => entry.name === "deep-research" && entry.status === "completed"),
    "deep research shortcut",
    30000,
  )
  checks.push("deep-research-shortcut")
  state.schemaHold = Promise.withResolvers()
  const schemaRoot = `/api/session/${initial.sessionID}/workflow`
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
  child.terminal.write("r")
  await poll(() => plain().includes("This structured-output attempt cannot resume."), "schema recovery guidance")
  assert.ok(plain().includes("Recorded usage is a lower bound."))
  child.terminal.write("u")
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.ok(!plain().includes("resume · Ctrl+S"))
  assert.equal(state.schemaCalls, 2)
  checks.push("claimed-schema-attempt-renders-recovery-reason-and-blocks-resume")
  assert.ok(plain().includes("Workflows · separate child sessions; closing keeps runs active"))
  assert.ok(plain().includes("Source: builtin:deep-research · Tab selects source"))
  checks.push("list-growth-keeps-header-and-source-readable")
  await writeFile(join(runtime.output, "workflow-schema-tui.txt"), plain())
  console.log(
    JSON.stringify({ mode: fullscreen ? "fullscreen" : "mini", passed: checks.length, checks, output: runtime.output }),
  )
} finally {
  state.hold?.resolve()
  state.schemaHold?.resolve()
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "workflow PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await writeFile(join(runtime.output, "workflow-tui.txt"), plain())
  terminal.dispose()
  await writeFile(join(runtime.output, "workflow-tui.ansi"), screen.text)
  await writeFile(join(runtime.output, "workflow-tui.json"), JSON.stringify({ checks, calls: state.calls }, null, 2))
  await runtime.close()
}

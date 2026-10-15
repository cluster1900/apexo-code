import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Terminal } from "@xterm/headless"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startGoalFixture } from "./grok-goal-fixture.mjs"
const { runtime, control } = await startGoalFixture("cli", { progress: true })
const fullscreen = process.argv.includes("--fullscreen")
const screen = { text: "" }
// OpenTUI sends changed cells only; assertions need the composed terminal screen.
const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
const plain = () =>
  Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const rendered = (text) => poll(() => plain().includes(text), `render ${text}`)
const checks = []
const navigation = []
let child
const reveal = async (text) => {
  navigation.push({ target: text, key: "home", screen: plain() })
  child.terminal.write("\x1b[H")
  await poll(() => {
    if (plain().includes(text)) {
      navigation.push({ target: text, found: true, screen: plain() })
      return true
    }
    navigation.push({ target: text, key: "down", screen: plain() })
    child.terminal.write("\x1b[B")
    return false
  }, `keyboard reveal ${text}`)
}
try {
  const session = await runtime.api("/session", {
    title: "Goal terminal verification",
    agent: "build",
    model: { providerID: "xai", id: "grok-4.7" },
  })
  const root = `/session/${session.id}/goal`
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
  await poll(() => plain().includes(fullscreen ? "0 running" : "ctrl+p cmd"), "terminal ready", 30_000)
  const open = async (name) => {
    child.terminal.write(`\x1b[200~/${name} \x1b[201~`)
    await poll(() => plain().includes(`/${name}`), "command entered")
    child.terminal.write("\r")
  }
  await open("goal TUI_GOAL complete the objective")
  await rendered("Objective · Tab switches fields")
  assert.equal(control.calls.length, 0)
  control.hold = Promise.withResolvers()
  child.terminal.write("\r")
  await rendered("active · executing")
  const info = await runtime.api(root)
  assert.ok(info.launch.messageID)
  assert.equal(
    (await runtime.api(`/session/${session.id}/message`)).filter((item) => item.info.role === "user").length,
    1,
  )
  checks.push("empty-session-create-with-selected-model")
  child.terminal.write("\x1b[27u")
  await poll(() => plain().includes(fullscreen ? "0 running" : "ctrl+p cmd"), "Goal panel closed")
  assert.equal((await runtime.api(root)).status, "active")
  await open("goal")
  await rendered("active · executing")
  checks.push("reopen-active-goal-without-duplicate-work")
  child.terminal.write("\x1b[27u")
  await poll(() => plain().includes(fullscreen ? "0 running" : "ctrl+p cmd"), "Goal panel closed before pause")
  await open("goal pause")
  await rendered("user_paused · idle")
  control.hold.resolve()
  control.hold = undefined
  child.terminal.write("\x1b[27u")
  await poll(() => plain().includes(fullscreen ? "0 running" : "ctrl+p cmd"), "Goal panel closed before resume")
  await open("goal resume")
  await rendered("complete · idle")
  await reveal("Task 1 complete")
  await reveal("Task 2 complete")
  await reveal(control.progressNote)
  await writeFile(join(runtime.output, "goal-progress-visible.txt"), plain())
  const progress = await runtime.api(root)
  assert.deepEqual(progress.planProgress, { completed: [0, 1], deviations: [control.progressNote] })
  assert.equal(progress.plan, control.plan)
  for (const report of await runtime.api(`${root}/${progress.id}/reports`)) {
    const content = await runtime.api(`${root}/${progress.id}/reports/${report.id}/plan`)
    assert.equal(content.text, control.plan)
    assert.equal(content.sha256, createHash("sha256").update(control.plan).digest("hex"))
  }
  checks.push("real-worker-progress-visible-by-keyboard", "progress-preserves-original-report-hashes")
  await reveal("3/3 reports")
  checks.push("terminal-three-verifier-reports")
  assert.equal((await runtime.api(root)).status, "complete")
  checks.push("pause-resume-and-independent-completion")
  child.terminal.write("f")
  await rendered("Report files")
  await rendered("objective.txt")
  child.terminal.write("\r")
  await rendered("Preview · objective.txt")
  await rendered("TUI_GOAL complete the objective")
  child.terminal.write("\x1b[27u")
  await rendered("Report files")
  const reportRoot = `${root}/${(await runtime.api(root)).id}/reports`
  const firstReport = (await runtime.api(reportRoot))[0]
  const firstFile = firstReport.files[0]
  const destination = join(runtime.output, "terminal-downloaded-report.txt")
  child.terminal.write("d")
  await rendered("Save to a new local file")
  child.terminal.write("\x7f".repeat(`${firstReport.id}-${firstFile.name}`.length))
  child.terminal.write(`\x1b[200~${destination}\x1b[201~`)
  await rendered("terminal-downloaded-report.txt")
  child.terminal.write("\r")
  await poll(
    async () => (await readFile(destination, "utf8").catch(() => "")).includes("TUI_GOAL"),
    "terminal report saved",
  )
  child.terminal.write("\x1b[27u")
  checks.push("terminal-download-writes-complete-report-to-local-file")
  child.terminal.write("x")
  await rendered("Permanently delete private reports")
  child.terminal.write("n")
  assert.equal((await runtime.api(reportRoot)).length, 4)
  child.terminal.write("x")
  await rendered("Permanently delete private reports")
  child.terminal.write("y")
  await rendered("No report files are available.")
  assert.deepEqual(await runtime.api(reportRoot), [])
  child.terminal.write("\x1b[27u")
  await reveal("complete · idle")
  checks.push("terminal-report-preview-and-confirmed-cleanup")
  child.terminal.write("x")
  await rendered("Stop and clear this goal and delete")
  child.terminal.write("n")
  assert.equal((await runtime.api(root)).status, "complete")
  child.terminal.write("x")
  await rendered("Stop and clear this goal and delete")
  child.terminal.write("y")
  await rendered("Objective · Tab switches fields")
  assert.equal(await runtime.api(root), null)
  checks.push("clear-confirmation-preserves-transcript")
  // Reopening starts with a fresh form. Enter the next objective and its budget.
  child.terminal.write("\x1b[200~SECOND_TUI_GOAL\x1b[201~")
  await rendered("SECOND_TUI_GOAL")
  child.terminal.write("\t")
  child.terminal.write("200")
  await rendered("200")
  child.terminal.write("\r")
  await rendered("budget_limited · idle")
  assert.equal((await runtime.api(root)).tokensUsed, 240)
  child.terminal.write("r")
  assert.equal((await runtime.api(root)).status, "budget_limited")
  checks.push("budget-field-and-exhaustion-cannot-resume")
  console.log(JSON.stringify({ fullscreen, checks, output: runtime.output }, null, 2))
} finally {
  const snapshot = plain()
  control.hold?.resolve()
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "Goal PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await writeFile(join(runtime.output, "goal-tui.ansi"), screen.text)
  await writeFile(join(runtime.output, "goal-tui.txt"), snapshot)
  terminal.dispose()
  await writeFile(join(runtime.output, "goal-tui.json"), JSON.stringify({ checks, calls: control.calls }, null, 2))
  await writeFile(join(runtime.output, "goal-navigation.json"), JSON.stringify(navigation, null, 2))
  await runtime.close()
  console.error(`Goal TUI evidence: ${runtime.output}`)
}

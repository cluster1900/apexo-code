import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startCodeReviewFixture } from "./code-review-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"
const fixture = await startCodeReviewFixture({
  large: process.argv.includes("--large"),
  mixed: process.argv.includes("--mixed"),
  longEvidence: true,
})
const { runtime, repo } = fixture
const fullscreen = process.argv.includes("--fullscreen")
const cols = process.argv.includes("--small") ? 80 : 120
const rows = process.argv.includes("--small") ? 24 : 40
const terminal = new Terminal({ cols, rows, allowProposedApi: true })
const screen = { text: "" }
const plain = () =>
  Array.from({ length: rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const checks = []
let child
try {
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      join(repo, "packages/apexo/src/index.ts"),
      "attach",
      runtime.url,
      ...(!fullscreen ? ["--mini", "--no-replay"] : []),
      "--dir",
      runtime.directory,
      "--session",
      fixture.session.id,
    ],
    {
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols,
        rows,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          screen.text += text
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "composer ready", 30000)
  const open = async (name = "review") => {
    child.terminal.write(`\x1b[200~/${name}\x1b[201~`)
    await poll(() => plain().includes("/review"), "review command entered")
    child.terminal.write("\r")
    await poll(() => plain().includes("Code review ·") && plain().includes("Ready · n start"), "review actions ready")
  }
  await open()
  assert.equal(fixture.calls.length, 0)
  child.terminal.write("n")
  await poll(
    () => plain().includes("completed") && plain().includes("REVIEW_UI_REPORT") && plain().includes("Ready · n start"),
    "completed report and ready actions",
    30000,
  )
  assert.match(plain(), /REVIEW_UI_REPORT/)
  checks.push("typed-review-command", "start-native-review", "completed-report")
  child.terminal.write("\x1b[B")
  await poll(() => plain().includes("Captured context"), "outside-hunk finding selected")
  const beforeScroll = plain()
  child.terminal.write("\x1b[6~")
  await poll(() => plain() !== beforeScroll, "PageDown handled")
  assert.ok(plain().includes("Code review ·"), "PageDown keeps the review modal open")
  assert.match(plain(), /captured context \d+/, "PageDown exposes captured evidence")
  child.terminal.write("\x1b[5~")
  await poll(() => plain().includes("Captured context"), "PageUp restores captured evidence")
  checks.push("pagedown-scrolls-evidence", "pageup-keeps-modal")
  child.terminal.write("\x1b[B")
  await poll(() => plain().includes("file-level"), "file anchor")
  child.terminal.write("p")
  await poll(() => plain().includes("priority: P0"), "priority filter")
  checks.push("finding-navigation", "outside-hunk-snippet", "file-anchor", "priority-filter")
  const settled = fixture.calls.length
  child.terminal.write("\x1b[27u")
  await poll(() => !plain().includes("Code review ·"), "review closed")
  await open("reviews")
  assert.equal(fixture.calls.length, settled)
  checks.push("reopen-without-provider-work")
  child.terminal.write("t")
  await poll(() => plain().includes("uncommitted | base main"), "target editor")
  child.terminal.write("\x7f".repeat("uncommitted".length))
  child.terminal.write("\x1b[200~base main\x1b[201~")
  await poll(() => plain().includes("base main"), "new target entered")
  child.terminal.write("\x13")
  await poll(
    () => plain().includes("Target: base main ·") && plain().includes("Ready · n start"),
    "cursor-at-end target replacement",
  )
  checks.push("target-editor-replaces-existing-value")
  child.terminal.write("f")
  await poll(() => plain().includes("Review focus · ctrl+s save"), "focus editor")
  child.terminal.write("\x1b[200~REVIEW_HOLD\x1b[201~")
  await poll(() => plain().includes("REVIEW_HOLD"), "focus entered")
  child.terminal.write("\x13")
  await poll(
    () => plain().includes("Focus: REVIEW_HOLD") && plain().includes("Ready · n start"),
    "focus saved and actions ready",
  )
  child.terminal.write("n")
  await poll(() => plain().includes("running") && plain().includes("Ready · n start"), "cancel action ready")
  const running = (await runtime.api(`/api/session/${fixture.session.id}/review`)).data[0]
  const releaseRefresh = await fixture.pauseRefresh()
  assert.ok(plain().includes("Ready · n start"), "passive refresh leaves cancellation enabled")
  child.terminal.write("c")
  await poll(
    async () => (await runtime.api(`/api/session/${fixture.session.id}/review/${running.id}`)).status === "cancelled",
    "cancel accepted while background refresh is held",
  )
  await releaseRefresh()
  checks.push("cancel-during-held-passive-refresh")
  await poll(() => plain().includes("cancelled") && plain().includes("Ready · n start"), "cancelled review")
  assert.ok(!plain().includes("Review in progress"), "cancelled review has no progress copy")
  checks.push("focus-editor", "targeted-cancel", "cancelled-status-copy")
  const messages = await runtime.api(`/api/session/${fixture.session.id}/message`)
  assert.deepEqual(messages.data ?? messages, [])
  checks.push("parent-transcript-untouched")
  console.log(
    JSON.stringify(
      { mode: fullscreen ? "fullscreen" : "mini", checks, providerCalls: fixture.calls.length, output: runtime.output },
      null,
      2,
    ),
  )
} finally {
  await writeFile(join(runtime.output, "review-final.txt"), plain())
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "review PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await writeFile(join(runtime.output, "review.ansi"), screen.text)
  await fixture.close()
  console.error(`Code review terminal evidence: ${runtime.output}`)
}

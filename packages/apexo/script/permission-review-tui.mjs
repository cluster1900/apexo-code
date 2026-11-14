import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startPermissionReviewFixture } from "./permission-review-fixture.mjs"
import { deadline, poll } from "./grok-shell-fixture.mjs"
const fixture = await startPermissionReviewFixture({ mixed: process.argv.includes("--mixed") })
const { runtime, repo, session } = fixture
const fullscreen = process.argv.includes("--fullscreen")
const terminal = new Terminal({ cols: 110, rows: 35, allowProposedApi: true })
const plain = () =>
  Array.from({ length: 35 }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const screen = []
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
      ...(process.argv.includes("--native") ? ["--session-protocol", "native"] : []),
      ...(!fullscreen ? ["--mini", "--no-replay"] : []),
      "--dir",
      runtime.directory,
      "--session",
      session.id,
    ],
    {
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols: 110,
        rows: 35,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          screen.push(text)
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "terminal composer ready", 30000)
  child.terminal.write("\x1b[200~/auto\x1b[201~")
  await poll(() => plain().includes("/auto"), "slash input ready")
  child.terminal.write("\r")
  await poll(async () => (await fixture.mode(session.id)).data.mode === "review", "backend mode enabled", 15000)
  checks.push("slash-auto-enables-backend")
  fixture.state.hold = true
  await fixture.prompt(session.id)
  const pending = await fixture.pending(session.id, "reviewing")
  await poll(
    () => plain().includes("Reviewing permission") && plain().includes(fullscreen ? "Allow once" : "once"),
    "review status and manual controls",
    15000,
  )
  await poll(() => fixture.state.calls.length === 1, "review provider stream held", 15000)
  assert.equal(fixture.state.calls.length, 1)
  checks.push("live-reviewing-single-backend-evaluation")
  // Human approval remains usable while the model stream is held.
  child.terminal.write("\r")
  await poll(
    async () => !(await runtime.api(`/api/session/${session.id}/permission`)).data.length,
    "manual approval during review",
    15000,
  )
  fixture.state.hold = false
  checks.push("manual-reply-during-stream")
  await poll(() => plain().includes("PERMISSION_DONE"), "tool settled", 20000)
  await fixture.prompt(session.id)
  await fixture.pending(session.id, "ask_manual")
  await poll(() => plain().includes("Fixture requires a human decision"), "live fallback reason", 15000)
  checks.push("live-fallback-reason")
  await runtime.api(
    `/api/session/${session.id}/permission/${(await fixture.pending(session.id)).id}/reply`,
    { reply: "once" },
    "POST",
    204,
  )
  await poll(() => plain().includes("PERMISSION_DONE"), "second completion", 20000)
  await poll(
    async () =>
      !(await runtime.api("/api/session/active")).data[session.id] &&
      plain().includes(fullscreen ? "0 running" : "Ask anything") &&
      !plain().includes("Manual approval required"),
    "idle composer restored",
    20000,
  )
  child.terminal.write("\x1b[200~/auto\x1b[201~")
  await poll(() => plain().includes("/auto"), "disable slash input")
  child.terminal.write("\r")
  await poll(async () => (await fixture.mode(session.id)).data.mode === "manual", "backend mode disabled", 15000)
  checks.push("slash-auto-disables-backend")
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "mode controls ready")
  child.terminal.write("\t")
  await poll(() => /\bplan\b/i.test(plain()), "Tab selects Plan agent")
  child.terminal.write("\t")
  await poll(() => /\bbuild\b/i.test(plain()) && !/\bplan\b/i.test(plain()), "Tab restores Build agent")
  checks.push("tab-cycles-agent")
  child.terminal.write("\x1b[Z")
  await poll(() => /\bplan\b/i.test(plain()), "Shift+Tab enters Plan")
  child.terminal.write("\x1b[Z")
  await poll(async () => (await fixture.mode(session.id)).data.mode === "review", "Shift+Tab enters backend review")
  child.terminal.write("\x1b[Z")
  await poll(
    async () => (await fixture.mode(session.id)).data.mode === "manual" && /always-approve/i.test(plain()),
    "Shift+Tab enters always-approve",
  )
  child.terminal.write("\x1b[Z")
  await poll(() => !/always-approve/i.test(plain()), "Shift+Tab returns to Normal")
  checks.push("shift-tab-cycles-all-four-modes")
  child.terminal.write("\x0f")
  await poll(() => /always-approve/i.test(plain()), "Ctrl+O enables always-approve")
  const before = fixture.state.calls.length
  await fixture.prompt(session.id)
  await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST", 204)
  assert.equal((await runtime.api(`/api/session/${session.id}/permission`)).data.length, 0)
  assert.equal(fixture.state.calls.length, before)
  checks.push("ctrl-o-approves-once-without-backend-review")
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "auto turn finishes")
  child.terminal.write("\x0f")
  await poll(() => !/always-approve/i.test(plain()), "Ctrl+O disables always-approve")
  for (const active of [true, false]) {
    child.terminal.write("\x1b[200~/always-approve\x1b[201~")
    await poll(
      () => plain().includes("/always-approve") && !plain().includes("No matching items"),
      "always-approve slash exists",
    )
    child.terminal.write("\r")
    await poll(
      () => !plain().includes("/always-approve") && /always-approve/i.test(plain()) === active,
      "always-approve slash toggles mode",
    )
  }
  checks.push("always-approve-slash-toggles")
  await fixture.prompt(session.id)
  await fixture.pending(session.id)
  await poll(() => plain().includes(fullscreen ? "Allow once" : "once"), "deny controls ready")
  child.terminal.write("\x1b")
  if (!fullscreen) {
    await poll(() => /Reject permission|Tell Apexo/i.test(plain()), "rejection confirmation ready")
    child.terminal.write("\r")
  }
  await poll(
    async () => !(await runtime.api(`/api/session/${session.id}/permission`)).data.length,
    "terminal rejection settles",
  )
  await poll(async () => !(await runtime.api("/api/session/active")).data[session.id], "denied turn stops")
  if (!fullscreen) {
    await poll(
      () => screen.join("").includes("Permission denied; tool execution stopped"),
      "denial is visible in scrollback",
    )
    assert.ok(!screen.join("").includes("bash completed ·"), "denial must not be reported as completion")
  }
  checks.push("escape-rejection-stops-execution-with-clear-status")
  if (process.argv.includes("--exit-active")) {
    assert.equal(fullscreen, false, "active prompt shutdown probe targets split-footer transport")
    await poll(() => plain().includes("Ask anything"), "composer ready before active quit probe")
    child.terminal.write("\x1b[200~Run bun --version\x1b[201~")
    await poll(() => plain().includes("Run bun --version"), "typed prompt before quit")
    child.terminal.write("\r")
    await fixture.pending(session.id)
    await poll(
      () => plain().includes("Permission required") && plain().includes("once"),
      "active prompt waiting for permission",
    )
    checks.push("quit-with-typed-prompt-still-waiting-for-permission")
  }
  child.terminal.write(process.argv.includes("--exit-active") ? "\x03\x03" : "\x03")
  if (!fullscreen && !process.argv.includes("--exit-active")) {
    await poll(() => /again to exit/i.test(plain()), "first Ctrl+C asks to exit")
    child.terminal.write("\x03")
  }
  assert.equal(await deadline(child.exited, 15000, "normal two-key quit"), 0)
  assert.ok(!/DOMException|AbortError/.test(screen.join("")), "normal exit must not dump an abort stack")
  checks.push(fullscreen ? "ctrl-c-quits-without-abort-stack" : "double-ctrl-c-quits-without-abort-stack")
  console.log(JSON.stringify({ fullscreen, checks, output: runtime.output }))
} finally {
  fixture.state.hold = false
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "terminal cleanup").catch(() => child.kill("SIGKILL"))
  await writeFile(join(runtime.output, "permission-terminal.txt"), plain())
  terminal.dispose()
  await writeFile(join(runtime.output, "permission-terminal.ansi"), screen.join(""))
  await fixture.close()
  console.error(`Permission terminal evidence: ${runtime.output}`)
}

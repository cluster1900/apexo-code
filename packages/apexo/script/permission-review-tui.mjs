import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startPermissionReviewFixture } from "./permission-review-fixture.mjs"
import { deadline, poll } from "./grok-shell-fixture.mjs"
const fixture = await startPermissionReviewFixture()
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

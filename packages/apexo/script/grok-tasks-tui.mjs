// Real interactive mini CLI attached to an isolated backend, driven through a PTY.
import { Terminal } from "@xterm/headless"
import assert from "node:assert/strict"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const runtime = await startShellFixture("cli")
const fullscreen = process.argv.includes("--fullscreen")
const cols = process.argv.includes("--narrow") ? 80 : 120
const rows = process.argv.includes("--narrow") ? 24 : 40
const screen = new Terminal({ cols, rows, allowProposedApi: true })
let child
let transcript = ""
const plain = () =>
  Array.from({ length: screen.rows }, (_, row) =>
    screen.buffer.active.getLine(screen.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
try {
  const session = await runtime.api("/session", { title: "Interactive task panel" })
  await runtime.api(`/session/${session.id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "TASK_PANEL_shell" }],
  })
  const [task] = await runtime.api(`/experimental/session/${session.id}/task`)
  assert.equal(task.status, "running")
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
        cols,
        rows,
        data(terminal, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          transcript += text
          screen.write(text)
          if (text.includes("\x1b[6n")) terminal.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes("1 running"), "interactive task count", 30_000)
  child.terminal.write("/tasks")
  await poll(() => /Manage (session )?tasks/.test(plain()), "task command autocomplete")
  child.terminal.write("\r")
  await poll(() => plain().includes("panel shell") && /stop/i.test(plain()), "interactive tasks panel")
  await poll(() => plain().includes("SHELL_STDERR_中文"), "interactive live output")
  await Bun.write(join(runtime.output, "tasks-tui-running.ansi"), transcript)
  await Bun.write(join(runtime.output, "tasks-tui-running.txt"), plain())
  assert.ok(
    plain().includes("Tasks") && /stop/i.test(plain()) && plain().includes("SHELL_STDERR_中文"),
    "header, stop control and output remain visible together",
  )
  child.terminal.write(fullscreen ? "\x18" : "c")
  await poll(
    async () => (await runtime.api(`/experimental/session/${session.id}/task/${task.id}`)).status === "cancelled",
    "interactive cancellation",
  )
  // A terminal redraw can reuse unchanged letters (running/cancelled share an n).
  // Force a full layout repaint before checking the rendered status in the transcript.
  child.terminal.resize(cols + 1, rows)
  screen.resize(cols + 1, rows)
  await poll(() => plain().includes("cancelled"), "interactive status refresh")
  await Bun.write(join(runtime.output, "tasks-tui-cancelled.txt"), plain())
  child.terminal.write("\x1b")
  console.log(
    JSON.stringify({
      result: "pass",
      output: runtime.output,
      scope: `real ${fullscreen ? "fullscreen" : "mini"} CLI PTY count, /tasks, live output, cancellation, status refresh`,
    }),
  )
} finally {
  await Bun.write(join(runtime.directory, "panel-shell.release"), "cleanup")
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10_000, "PTY CLI cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await Bun.write(join(runtime.output, "tasks-tui.ansi"), transcript)
  await runtime.close()
  console.error(`Task TUI evidence: ${runtime.output}`)
}

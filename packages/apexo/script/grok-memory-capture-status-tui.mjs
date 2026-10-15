import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const fullscreen = process.argv.includes("--fullscreen")
const held = Promise.withResolvers()
const runtime = await startShellFixture("cli", {
  config: {
    memory_v2: { enabled: true, capture_status_enabled: true, automatic_dream_enabled: false },
    memory: { dream: { enabled: false }, session: { save_on_end: false } },
    compaction: { memory_flush: { enabled: false } },
  },
  async next({ input }) {
    if (!JSON.stringify(input).includes("You extract durable memory observations"))
      return { content: "TUI_CAPTURE_ACK" }
    await held.promise
    return {
      content: JSON.stringify({
        outcome: "observations",
        observations: [
          {
            type: "project",
            statement: "TUI_CAPTURE_FACT",
            body: "TUI_CAPTURE_DETAIL",
            topic_hint: "terminal",
            keywords: [],
            aliases: [],
          },
        ],
      }),
    }
  },
})
let child,
  transcript = ""
const screen = new Terminal({ cols: 140, rows: 45, allowProposedApi: true })
const plain = () =>
  Array.from({ length: screen.rows }, (_, row) =>
    screen.buffer.active.getLine(screen.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const checks = []
try {
  const session = await runtime.api("/session", { title: "Capture diagnostics terminal" })
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      resolve("src/index.ts"),
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
        cols: 140,
        rows: 45,
        data(terminal, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          transcript += text
          screen.write(text)
          if (text.includes("\x1b[6n")) terminal.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "terminal ready", 30_000)
  await runtime.api(`/session/${session.id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Remember project capture conventions." }],
  })
  await poll(() => plain().includes("Memory capture: running"), "terminal live capture")
  checks.push("terminal-running")
  held.resolve()
  await poll(() => plain().includes("Memory capture: completed"), "terminal completed")
  if (fullscreen) child.terminal.write("\x1b[109;7u")
  await poll(() => plain().includes("TUI_CAPTURE_DETAIL"), "terminal observation details")
  assert.match(plain(), /TUI_CAPTURE_FACT/)
  assert.match(plain(), /memory-v2\/apexo\/workspaces/)
  checks.push("terminal-completed", "terminal-body-and-path")
  if (fullscreen) {
    assert.match(plain(), /not saved in session replay/)
    child.terminal.write("\x1b[27u")
    await poll(() => !plain().includes("Memory capture diagnostics · esc close"), "details escape")
    checks.push("fullscreen-shortcut-and-dismiss")
  }
  assert.doesNotMatch(JSON.stringify(await runtime.api(`/session/${session.id}/message`)), /TUI_CAPTURE_DETAIL/)
  checks.push("terminal-details-not-in-history")
  console.log(JSON.stringify({ mode: fullscreen ? "fullscreen" : "mini", checks, output: runtime.output }))
} finally {
  held.resolve()
  await writeFile(join(runtime.output, "capture-status-screen.txt"), plain())
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10_000, "capture terminal cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await writeFile(join(runtime.output, "capture-status-tui.ansi"), transcript)
  screen.dispose()
  await runtime.close()
  console.error(`Capture terminal evidence: ${runtime.output}`)
}

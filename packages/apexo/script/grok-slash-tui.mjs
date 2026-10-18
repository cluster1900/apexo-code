// Exercises the Grok Build slash commands added to the TUI (context, history, effort, view-plan, doctor,
// tutorial, settings, plan, delete) in a real PTY against the fixture provider.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Terminal } from "@xterm/headless"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startGoalFixture } from "./grok-goal-fixture.mjs"

// --vim-config: start with config ui.vim_mode = true and check the config default plus the local override only.
const vimConfig = process.argv.includes("--vim-config")
// --context-window: the model lists several sizes; checks /context-window only.
const windowFlow = process.argv.includes("--context-window")
const { runtime } = await startGoalFixture(
  "cli",
  vimConfig
    ? { config: { ui: { vim_mode: true } } }
    : windowFlow
      ? {
          models: {
            "grok-4.7": {
              name: "Restart parity",
              tool_call: true,
              limit: { context: 100000, output: 10000, context_options: [100000, 50000, 100] },
            },
          },
        }
      : {},
)
const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
const plain = () =>
  Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const rendered = (text, timeout) => poll(() => plain().includes(text), `render ${text}`, timeout)
const checks = []
let child
try {
  const model = { providerID: "xai", id: "grok-4.7" }
  const session = await runtime.api("/session", { title: "Slash verification", agent: "build", model })
  await runtime.api(`/session/${session.id}/message`, {
    agent: "build",
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "SLASH_HELLO first prompt" }],
  })
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      resolve("src/index.ts"),
      "attach",
      runtime.url,
      "--dir",
      runtime.directory,
      "--session",
      session.id,
    ],
    {
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols: 120,
        rows: 40,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  await rendered("SLASH_HELLO", 30_000)
  const run = async (command) => {
    child.terminal.write(`\x1b[200~/${command}\x1b[201~`)
    await poll(() => plain().includes(`/${command}`), `typed /${command}`)
    // Without arguments Enter picks the autocomplete entry; with arguments the popup is already closed.
    await Bun.sleep(300)
    child.terminal.write("\r")
  }
  const escape = async () => {
    child.terminal.write("\x1b")
    await Bun.sleep(300)
  }

  if (windowFlow) {
    await run("context-window")
    await rendered("Context window")
    assert.ok(plain().includes("100k") && plain().includes("50k") && plain().includes("100 "))
    checks.push("context-window-lists-model-sizes")
    child.terminal.write("\x1b")
    await Bun.sleep(300)
    await run("context-window 2M")
    await rendered("Unsupported context window")
    checks.push("context-window-rejects-unsupported")
    await run("context-window 50000")
    await rendered("Context window set to 50k")
    child.terminal.write("CW_PROMPT")
    await rendered("CW_PROMPT")
    child.terminal.write("\r")
    const users = async () =>
      (await runtime.api(`/session/${session.id}/message`)).filter((item) => item.info.role === "user")
    await poll(
      async () => (await users()).some((item) => item.info.model.contextWindow === 50000),
      "prompt carries 50k",
    )
    checks.push("prompt-carries-session-window")
    await poll(async () => (await runtime.api(`/session/${session.id}/message`)).at(-1)?.info.time?.completed, "reply")
    await run("context-window 100")
    await rendered("compacting to fit")
    await poll(
      async () =>
        (await runtime.api(`/session/${session.id}/message`)).some((item) =>
          item.parts.some((part) => part.type === "compaction"),
        ),
      "auto-compact started",
    )
    checks.push("smaller-than-usage-starts-auto-compact")
    console.log(JSON.stringify({ checks, output: runtime.output }, null, 2))
  } else if (vimConfig) {
    await Bun.sleep(500)
    child.terminal.write("\x1b")
    await rendered("Scrollback: j/k scroll")
    child.terminal.write("i")
    await Bun.sleep(300)
    checks.push("config-ui-vim-mode-enables-scrollback")
    await run("vim-mode")
    await rendered("Vim mode off")
    await Bun.sleep(300)
    child.terminal.write("\x1b")
    await Bun.sleep(800)
    assert.ok(!plain().includes("Scrollback: j/k scroll"), "local toggle overrides config")
    checks.push("local-toggle-overrides-config")
    console.log(JSON.stringify({ checks, output: runtime.output }, null, 2))
    process.exitCode = 0
  } else {
    await run("context")
    await rendered("Context")
    assert.match(plain(), /Window: |No model response/)
    checks.push("context-dialog")
    await escape()

    await run("history")
    await rendered("Prompt history")
    assert.ok(plain().includes("SLASH_HELLO first prompt"))
    checks.push("history-lists-session-prompts")
    await escape()

    await run("effort high")
    await poll(() => /Effort set to|not available|no effort levels/.test(plain()), "effort toast")
    checks.push("effort-with-argument")

    await run("view-plan")
    await rendered("No saved plan for this session yet")
    checks.push("view-plan-empty")
    await escape()

    await run("doctor")
    await rendered("Doctor")
    assert.ok(plain().includes("Server: "))
    checks.push("doctor")
    await escape()

    await run("tour")
    await rendered("Your first prompt")
    checks.push("tutorial-alias")
    await escape()

    await run("prefs")
    await rendered("Permissions:")
    checks.push("settings-alias")
    await escape()

    await run("plan")
    await rendered("Plan mode")
    checks.push("plan-mode")

    await run("ml")
    await rendered("Multiline on")
    child.terminal.write("MLA")
    await rendered("MLA")
    await Bun.sleep(200)
    child.terminal.write("\r")
    await Bun.sleep(200)
    child.terminal.write("MLB")
    await rendered("MLB")
    // Both halves are still in the composer on separate lines: Enter inserted a newline instead of sending.
    assert.match(plain(), /MLA\s*┃?\s*\n.*MLB/)
    child.terminal.write("\x1b\r")
    await poll(async () => {
      const messages = await (await fetch(`${runtime.url}/session/${session.id}/message`)).json()
      return messages.some((m) => m.parts?.some((p) => p.type === "text" && p.text === "MLA\nMLB"))
    }, "multiline message sent with Alt+Enter")
    checks.push("multiline-enter-newline-alt-enter-sends")
    await run("ml")
    await rendered("Multiline off")

    await run("vim-mode")
    await rendered("Vim mode on")
    await Bun.sleep(300)
    child.terminal.write("\x1b")
    await rendered("Scrollback: j/k scroll")
    child.terminal.write("y")
    await poll(() => /Message copied|Failed to copy/.test(plain()), "y copies the last assistant message")
    child.terminal.write("j")
    child.terminal.write("k")
    child.terminal.write("x")
    // A bare letter leaves the scrollback and is typed into the prompt.
    await poll(() => /┃\s+>\s+x\s/.test(plain()), "x typed into prompt")
    checks.push("vim-mode-scrollback-keys")
    child.terminal.write("\x7f")
    await Bun.sleep(200)
    await run("vim-mode")
    await rendered("Vim mode off")

    // /compact-mode removes the blank spacer rows between transcript blocks.
    const rows = () => {
      const lines = plain().split("\n")
      const user = lines.findIndex((line) => line.includes("SLASH_HELLO"))
      const reply = lines.findIndex((line, index) => index > user && line.includes("GOAL_UI_WORK_COMPLETED"))
      return reply - user
    }
    await run("view-plan")
    await Bun.sleep(300)
    child.terminal.write("\x1b")
    await Bun.sleep(300)
    const before = rows()
    await run("compact-mode")
    await rendered("Compact display on")
    await poll(() => rows() < before, `compact spacing (${before} rows before)`)
    checks.push(`compact-mode-tightens-spacing:${before}->${rows()}`)
    await run("compact-mode")
    await rendered("Compact display off")
    await poll(() => rows() === before, "spacing restored")

    await run("delete")
    await rendered("Delete this session's history?")
    child.terminal.write("\r")
    await poll(async () => (await fetch(`${runtime.url}/session/${session.id}`)).status === 404, "session deleted")
    checks.push("delete-confirmed")
    console.log(JSON.stringify({ checks, output: runtime.output }, null, 2))
  }
} finally {
  const snapshot = plain()
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await writeFile(join(runtime.output, "slash-tui.txt"), snapshot)
  terminal.dispose()
  await runtime.close()
  console.error(`Slash TUI evidence: ${runtime.output}`)
}

import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { join } from "node:path"
import { deadline, poll } from "./grok-shell-fixture.mjs"

export async function openSaveTerminal(kind, fixture, executable, sessionID, run) {
  const { runtime } = fixture
  const cols = 160
  const rows = 44
  const terminal = new Terminal({ cols, rows, allowProposedApi: true })
  const decoder = new TextDecoder()
  const screen = () =>
    Array.from({ length: terminal.rows }, (_, row) =>
      terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
    ).join("\n")
  const composer = () => {
    const rendered = screen()
    if (kind === "cli") return rendered
    // The fullscreen Session composer has a chat marker and a border spanning the input column.
    const width = rendered.match(/^[ \t]*╹▀+/m)?.[0].length
    if (!width) return ""
    return rendered
      .split("\n")
      .filter((line) => /^[ \t]*┃/.test(line))
      .map((line) => line.slice(0, width))
      .join("\n")
  }
  const child = Bun.spawn(
    [
      executable,
      ...(kind === "cli" ? ["run", "--interactive", "--attach", runtime.url] : ["attach", runtime.url]),
      "--dir",
      runtime.directory,
      "--session",
      sessionID,
      "--session-protocol",
      "native",
    ],
    {
      cwd: runtime.directory,
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols,
        rows,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  const close = async () => {
    try {
      await Bun.write(join(runtime.output, `${kind}-${run}-terminal.txt`), screen())
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
      await deadline(child.exited, 10_000, `owned ${kind} terminal exit`).catch(async () => {
        child.kill("SIGKILL")
        await child.exited
      })
      child.terminal?.close()
      terminal.dispose()
    }
  }

  try {
    await poll(
      () => {
        assert.equal(child.exitCode, null, `The packaged ${kind} process exited before its composer appeared`)
        return kind === "cli" ? composer().includes("Ask anything") : /^[ \t]*┃[ \t]*>[ \t]*$/m.test(composer())
      },
      `ready ${kind} composer`,
      30_000,
    )
    return {
      async submit(text) {
        child.terminal.write(`\x1b[200~${text}\x1b[201~`)
        await poll(
          () => {
            const draft = composer()
              .replace(/^[ \t]*┃[ \t]*/gm, "")
              .replace(/\s+/g, " ")
            // The fullscreen composer folds long pastes. The Session transcript verifies the entire submitted text.
            return draft.includes(text) || (kind === "tui" && draft.includes("> [Pasted ~1 lines]"))
          },
          `${kind} draft displayed`,
          10_000,
        )
        child.terminal.write("\r")
      },
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}

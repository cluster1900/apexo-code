import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Terminal } from "@xterm/headless"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

import { createHistoricalMemoryFixture } from "./grok-memory-owner-fixture.mjs"

const fixture = await createHistoricalMemoryFixture("cli")
const runtime = fixture.runtime
const session = fixture.session
const fullscreen = process.argv.includes("--fullscreen")
const screen = { text: "" }
// OpenTUI sends changed cells only; assertions need the composed terminal screen.
const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
const plain = () =>
  Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const rendered = (text) => poll(() => plain().replace(/\s+/g, " ").includes(text), `render ${text}`)
const checks = []
let child
try {
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
  const expected = "This session’s older capture history cannot be attributed safely."
  const operation = () => runtime.api(`/experimental/session/${session.id}/memory/operation`)
  await open("flush")
  await rendered(expected)
  await rendered("Start a new session to capture memory.")
  assert.deepEqual((await operation()).result, { status: "conflict", reason: "historical_capture_ownership" })
  assert.equal(fixture.calls.extraction, 0)
  await fixture.preserved()
  checks.push("actionable-historical-ownership-guidance", "no-extraction-or-ledger-mutation")
  const previous = await operation()
  child.terminal.write("f")
  await poll(async () => {
    const value = await operation()
    return value.id !== previous.id && value.state === "finished"
  }, "explicit retry settled")
  await rendered(expected)
  await fixture.preserved()
  child.terminal.write("\x1b[27u")
  await poll(() => plain().includes(fullscreen ? "0 running" : "ctrl+p cmd"), "Memory panel closed")
  await open("flush")
  await rendered(expected)
  assert.deepEqual((await operation()).result, { status: "conflict", reason: "historical_capture_ownership" })
  assert.equal(fixture.calls.extraction, 0)
  await fixture.preserved()
  checks.push("retry-and-reopen-preserve-historical-state")
  console.log(
    JSON.stringify(
      { mode: fullscreen ? "fullscreen" : "mini", checks, syntheticLegacySeed: true, output: runtime.output },
      null,
      2,
    ),
  )
} finally {
  const snapshot = plain()
  child?.kill("SIGTERM")
  if (child)
    await deadline(child.exited, 10000, "Memory ownership PTY cleanup").catch(async () => {
      child.kill("SIGKILL")
      await child.exited
    })
  child?.terminal?.close()
  await writeFile(join(runtime.output, "memory-owner-tui.ansi"), screen.text)
  await writeFile(join(runtime.output, "memory-owner-tui.txt"), snapshot)
  terminal.dispose()
  await writeFile(join(runtime.output, "memory-owner-tui.json"), JSON.stringify({ checks }, null, 2))
  await runtime.close()
  console.error(`Memory ownership TUI evidence: ${runtime.output}`)
}

import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const output = await mkdtemp(join(tmpdir(), "apexo-mcp-entry-ui-"))
const runtime = await startShellFixture("cli", {
  config: { mcp: { terminal: { type: "local", command: [process.execPath, resolve("test/fixture/mcp-native-stdio.ts")], enabled: false, environment: { MCP_NATIVE_TRACE: join(output, "trace.jsonl") } } } },
  next: () => ({ content: "UNEXPECTED_MCP_ENTRY_MODEL_WORK" }),
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
  const session = await runtime.api("/session", { title: "MCP terminal verification" })
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
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "terminal ready", 30000)
  child.terminal.write("\x1b[200~/mcps\x1b[201~")
  await poll(() => plain().includes("/mcps"), "MCP command entered")
  child.terminal.write("\r")
  await poll(() => plain().includes("MCP connections") && plain().includes("terminal · disabled"), "actual terminal MCP panel")
  assert.equal((await runtime.api("/mcp")).terminal.status, "disabled")
  assert.equal(runtime.calls.length, 0)
  checks.push("actual-entry-passive-disabled")
  child.terminal.write("\r")
  await poll(() => plain().includes("terminal · connected"), "actual terminal connects", 30000)
  assert.equal((await runtime.api("/mcp")).terminal.status, "connected")
  checks.push("actual-entry-connect")
  child.terminal.write("\r")
  await poll(() => plain().includes("terminal · disabled"), "actual terminal disconnects")
  child.terminal.write("u")
  await poll(() => plain().includes("terminal · disabled") && !plain().includes("Loading"), "actual terminal refresh")
  checks.push("actual-entry-disconnect-refresh")
  child.terminal.write("\x1b[27u")
  await poll(() => !plain().includes("MCP connections"), "panel closed")
  child.terminal.write("\x1b[200~/mcps\x1b[201~")
  await poll(() => plain().includes("/mcps"), "reopen command entered")
  child.terminal.write("\r")
  await poll(() => plain().includes("terminal · disabled"), "passive reopen")
  assert.equal((await runtime.api("/mcp")).terminal.status, "disabled")
  assert.equal(runtime.calls.length, 0)
  checks.push("actual-entry-reopen-no-model-work")
  console.log(JSON.stringify({mode: fullscreen ? "fullscreen-compatibility" : "mini-compatibility", passed: checks.length, checks, output: runtime.output}))
} finally {
  await writeFile(join(runtime.output, "mcp-entry-tui.txt"), plain())
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "MCP PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  terminal.dispose()
  await writeFile(join(runtime.output, "mcp-entry-tui.ansi"), screen.text)
  await writeFile(join(runtime.output, "mcp-entry-tui.json"), JSON.stringify({ checks }, null, 2))
  await runtime.close()
}

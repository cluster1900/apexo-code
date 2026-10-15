import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

import { startMcpAttachmentFixture } from "./grok-mcp-attachment-fixture.mjs"
const fixture = await startMcpAttachmentFixture()
const { runtime } = fixture
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
  const session = (
    await runtime.api("/api/session", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
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
  await poll(
    () => plain().includes("MCP connections") && plain().includes("local · connected") && !plain().includes("Loading"),
    "actual terminal MCP panel",
  )
  assert.equal((await fixture.events()).filter((row) => ["list", "read", "templates"].includes(row.event)).length, 0)
  assert.equal(runtime.calls.length, 0)
  checks.push("actual-entry-passive-no-resource-work")
  child.terminal.write("b")
  await poll(
    () => plain().includes("MCP resources") && plain().includes("Named note") && !plain().includes("Loading"),
    "resources ready",
  )
  child.terminal.write("\r")
  await poll(() => plain().includes("Attached to your draft.") && !plain().includes("Loading"), "resource attached")
  child.terminal.write("\x1b[B\x1b[B\x1b[B")
  await poll(() => plain().includes("› Named note"), "template selected")
  child.terminal.write("\r")
  await poll(() => plain().includes("Named note · name"), "template parameter")
  for (const [name, value] of [
    ["name", "雪 note"],
    ["query", "a&b"],
    ["values", "one two"],
    ["map", "key=value"],
  ]) {
    await poll(() => plain().includes(`Named note · ${name}`), `parameter ${name}`)
    child.terminal.write(`\x1b[200~${value}\x1b[201~`)
    await poll(() => plain().includes(value), `parameter value ${name}`)
    child.terminal.write("\r")
  }
  await poll(() => plain().includes("Attached to your draft.") && !plain().includes("Loading"), "template attached")
  assert.ok(
    (await fixture.events()).some(
      (row) =>
        row.event === "read" && row.params.uri.includes("%E9%9B%AA%20note") && row.params.uri.includes("query=a%26b"),
    ),
  )
  checks.push("actual-entry-resource-and-template-attach")
  child.terminal.write("\x1b[A\x1b[A")
  await poll(() => plain().includes("› Held resource"), "held selected")
  child.terminal.write("\r")
  await poll(
    async () => (await fixture.events()).some((row) => row.event === "read" && row.params.uri === "fixture://wait"),
    "held read",
  )
  child.terminal.write("x")
  await poll(
    async () =>
      (await fixture.events()).some((row) => row.event === "read-cleanup") &&
      !plain().includes("Loading") &&
      !plain().includes("Cancelling"),
    "cancel joined",
  )
  assert.equal(runtime.calls.length, 0)
  checks.push("actual-entry-explicit-cancel-no-provider-work")
  child.terminal.write("\x1b[27u")
  await poll(() => plain().includes("MCP connections"), "resource picker closed")
  child.terminal.write("\x1b[27u")
  await poll(() => !plain().includes("MCP connections"), "manager closed")
  assert.ok(plain().includes("@"), plain())
  child.terminal.write("\r")
  await poll(
    () =>
      fixture.delivered.some(
        (row) => !row.ancillary && JSON.stringify(row.input).includes("UNICODE:雪:fixture://notes/one"),
      ),
    "prepared bytes delivered",
    30000,
  )
  assert.ok(fixture.delivered.some((row) => !row.ancillary && JSON.stringify(row.input).includes("query=a%26b")))
  checks.push("actual-entry-draft-submit-delivers-prepared-bytes")
  console.log(
    JSON.stringify({
      mode: fullscreen ? "fullscreen-native" : "mini-native",
      passed: checks.length,
      checks,
      output: runtime.output,
    }),
  )
} finally {
  await writeFile(join(runtime.output, "mcp-entry-tui.txt"), plain())
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "MCP PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  terminal.dispose()
  await writeFile(join(runtime.output, "mcp-entry-tui.ansi"), screen.text)
  await writeFile(join(runtime.output, "mcp-entry-tui.json"), JSON.stringify({ checks }, null, 2))
  await fixture.close()
}

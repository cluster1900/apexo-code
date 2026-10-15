import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const runtime = await startShellFixture("cli", { next: () => ({ content: "UNEXPECTED_SANDBOX_MODEL_CALL" }) })
const fresh = process.argv.includes("--new")
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
  const session = fresh ? undefined : await runtime.api("/session", { title: "Sandbox terminal verification" })
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
      ...(session ? ["--session", session.id] : []),
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
  await poll(() => plain().includes(fullscreen && !fresh ? "0 running" : "Ask anything"), "terminal ready", 30_000)
  const before = (await runtime.api("/session")).length
  const empty = fresh && fullscreen
  child.terminal.write("\x1b[200~/sandbox\x1b[201~")
  await poll(() => plain().includes("/sandbox"), "sandbox command entered")
  child.terminal.write("\r")
  await poll(() => plain().includes(empty ? "No Session selected" : "Stored profile: off"), "passive command sandbox")
  assert.ok(plain().includes("compatibility flow"))
  assert.equal((await runtime.api("/session")).length, before)
  assert.equal(runtime.calls.length, 0)
  checks.push("slash-command-routes-to-passive-status", "opening-does-not-create-an-additional-session-or-model-work")
  child.terminal.write("r")
  await poll(() => plain().includes(empty ? "No Session selected" : "Backend: unchecked"), "passive refresh")
  assert.equal(runtime.calls.length, 0)
  child.terminal.write("\x1b[27u")
  await poll(() => !plain().includes("r refresh · esc back"), "panel closed")
  child.terminal.write("\x1b[200~/sandbox\x1b[201~")
  await poll(() => plain().includes("/sandbox"), "sandbox command reentered")
  child.terminal.write("\r")
  await poll(() => plain().includes(empty ? "No Session selected" : "Stored profile: off"), "passive reopen")
  assert.equal((await runtime.api("/session")).length, before)
  assert.equal(runtime.calls.length, 0)
  checks.push("refresh-close-reopen-retains-passive-behavior")
  console.log(
    JSON.stringify({ mode: fullscreen ? "fullscreen" : "mini", passed: checks.length, checks, output: runtime.output }),
  )
} finally {
  await writeFile(join(runtime.output, "sandbox-route.txt"), plain())
  child?.kill("SIGTERM")
  if (child)
    await deadline(child.exited, 10000, "sandbox route cleanup").catch(async () => {
      child.kill("SIGKILL")
      await child.exited
    })
  child?.terminal?.close()
  terminal.dispose()
  await writeFile(join(runtime.output, "sandbox-route.ansi"), screen.text)
  await writeFile(join(runtime.output, "sandbox-route.json"), JSON.stringify({ checks }, null, 2))
  await runtime.close()
}

import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"
const runtime = await startShellFixture(process.argv.includes("--desktop") ? "desktop" : "cli", {
  next: () => ({ content: "COMPAT_TERMINAL_DONE" }),
})
const fullscreen = process.argv.includes("--fullscreen")
const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
const output = { text: "" }
const plain = () =>
  Array.from({ length: terminal.buffer.active.length }, (_, row) =>
    terminal.buffer.active.getLine(row)?.translateToString(true),
  ).join("\n")
let child
try {
  const session = await runtime.api("/session", {
    title: "Compatibility regression",
    agent: "build",
    model: { providerID: "xai", id: "grok-4.7" },
  })
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      resolve("src/index.ts"),
      "attach",
      runtime.url,
      ...(!fullscreen ? ["--mini"] : []),
      ...(process.argv.includes("--explicit") ? ["--session-protocol", "compatibility"] : []),
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
          output.text += text
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes(fullscreen ? "0 running" : "ctrl+p cmd"), "compatibility terminal ready", 30000)
  assert.equal(runtime.calls.length, 0)
  child.terminal.write("COMPAT_TERMINAL_PROMPT\r")
  await poll(() => plain().includes("COMPAT_TERMINAL_DONE"), "actual compatibility terminal prompt", 30000)
  assert.equal(runtime.calls.length, 1)
  const messages = await runtime.api(`/session/${session.id}/message`)
  assert.equal(messages.filter((message) => message.info.role === "user").length, 1)
  console.log(
    JSON.stringify(
      {
        checks: ["compatibility attach is passive", "ordinary legacy prompt/render remains intact"],
        mode: fullscreen ? "fullscreen" : "mini",
        providerCalls: runtime.calls.length,
        output: runtime.output,
      },
      null,
      2,
    ),
  )
} finally {
  await Bun.write(join(runtime.output, "compat-terminal.txt"), plain())
  await Bun.write(join(runtime.output, "compat-terminal.ansi"), output.text)
  child?.kill("SIGTERM")
  if (child)
    await deadline(child.exited, 10000, "compatibility terminal cleanup").catch(async () => {
      child.kill("SIGKILL")
      await child.exited
    })
  child?.terminal?.close()
  terminal.dispose()
  await runtime.close()
  console.error(`Compatibility terminal evidence: ${runtime.output}`)
}

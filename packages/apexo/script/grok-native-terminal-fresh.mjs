import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { join, resolve } from "node:path"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startPlanUiFixture } from "./grok-plan-ui-fixture.mjs"
const fixture = await startPlanUiFixture({
  mode: "ordinary",
  mixed: process.argv.includes("--mixed"),
  runtime: process.argv.includes("--desktop") ? "desktop" : "cli",
})
const { runtime } = fixture
const fullscreen = process.argv.includes("--fullscreen")
const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
const output = { text: "" }
const plain = () =>
  Array.from({ length: terminal.buffer.active.length }, (_, row) =>
    terminal.buffer.active.getLine(row)?.translateToString(true),
  ).join("\n")
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
      ...(process.argv.includes("--mixed") || process.argv.includes("--explicit")
        ? ["--session-protocol", "native"]
        : []),
      "--dir",
      runtime.directory,
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
  await poll(() => plain().includes(fullscreen ? "Build" : "ctrl+p cmd"), "fresh native terminal ready", 30000)
  if (!fullscreen)
    await poll(
      async () =>
        (await Bun.file(fixture.records).text())
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .filter((request) => request.method === "GET" && request.path.endsWith("/question")).length >= 2,
      "native mini input bootstrap",
      30000,
    )
  assert.equal(runtime.calls.length, 0)
  child.terminal.write("NATIVE_FRESH_PROMPT\r")
  await poll(
    () => plain().includes("An ordinary question allows a custom answer"),
    "fresh native pending question",
    30000,
  )
  child.terminal.write("\r")
  await poll(() => plain().includes("ORDINARY_QUESTION_DONE"), "fresh native prompt completion", 30000)
  assert.equal(runtime.calls.length, 2)
  const sessions = (await fixture.api("/api/session")).data
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].location.directory, runtime.directory)
  const messages = (await fixture.api(`/api/session/${sessions[0].id}/message?order=asc`)).data
  assert.equal(messages.filter((message) => message.type === "user").length, 1)
  console.log(
    JSON.stringify(
      {
        checks: [
          "fresh native terminal creates exactly one real Session",
          "actual prompt and question approval complete through native API",
        ],
        mode: fullscreen ? "fullscreen" : "mini",
        backend: process.argv.includes("--mixed") && process.argv.includes("--desktop") ? "desktop" : "cli",
        providerCalls: runtime.calls.length,
        output: runtime.output,
      },
      null,
      2,
    ),
  )
} finally {
  await Bun.write(join(runtime.output, "fresh-terminal.txt"), plain())
  await Bun.write(join(runtime.output, "fresh-terminal.ansi"), output.text)
  child?.kill("SIGTERM")
  if (child)
    await deadline(child.exited, 10000, "fresh terminal cleanup").catch(async () => {
      child.kill("SIGKILL")
      await child.exited
    })
  child?.terminal?.close()
  terminal.dispose()
  await fixture.close()
  console.error(`Fresh native terminal evidence: ${runtime.output}`)
}

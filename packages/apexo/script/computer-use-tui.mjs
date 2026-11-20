import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { toolName } from "../../../plugins/computer-use/script/build.mjs"
import { startComputerUseFixture } from "./computer-use-fixture.mjs"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const fullscreen = process.argv.includes("--fullscreen")
const fixture = await startComputerUseFixture("cli")
const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
const decoder = new TextDecoder()
const screen = { raw: "" }
const plain = () =>
  Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const checks = []
let child
try {
  await fixture.install()
  const session = await fixture.session()
  fixture.state.steps.push(
    { tool: toolName("desktop_version"), args: {} },
    { content: "COMPUTER_USE_TUI_DONE version 1.3.1" },
  )
  child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      import.meta.resolve("@opentui/solid/preload"),
      resolve("src/index.ts"),
      "attach",
      fixture.runtime.url,
      "--dir",
      fixture.runtime.directory,
      "--session",
      session.id,
      "--session-protocol",
      "native",
      ...(fullscreen ? [] : ["--mini"]),
    ],
    {
      cwd: fixture.runtime.directory,
      env: { ...fixture.runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols: 120,
        rows: 40,
        data(_, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          screen.raw += text
          terminal.write(text)
          if (text.includes("\x1b[6n")) child.terminal.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(
    () => !/Error:|Cannot find/.test(plain()) && /Ask|New session|build|grok/i.test(plain()),
    "full native terminal ready",
    30_000,
  )
  checks.push("native-terminal-startup-and-session-attachment")
  const prompt = "Report the installed Computer Use native version."
  child.terminal.write(`\x1b[200~${prompt}\x1b[201~`)
  await poll(() => plain().includes(prompt), "terminal editor shows the complete prompt")
  child.terminal.write("\r")
  await poll(() => fixture.state.requests.length >= 2, "terminal prompt executes real plugin", 45_000)
  await poll(() => plain().includes("COMPUTER_USE_TUI_DONE"), "terminal renders provider completion", 30_000)
  const history = (await fixture.client.messages.list({ sessionID: session.id, order: "asc" })).data
  const tools = history.flatMap((item) =>
    item.type === "assistant" ? item.content.filter((part) => part.type === "tool") : [],
  )
  assert.ok(
    tools.some(
      (part) =>
        part.name === toolName("desktop_version") &&
        part.state.status === "completed" &&
        JSON.stringify(part.state.content).includes("1.3.1"),
    ),
  )
  checks.push("terminal-submission-real-tool-and-durable-history", "terminal-renders-tool-task-completion")
  console.log(
    JSON.stringify({
      kind: fullscreen ? "fullscreen" : "mini",
      checks,
      passed: checks.length,
      output: fixture.runtime.output,
    }),
  )
} finally {
  await writeFile(join(fixture.runtime.output, "computer-use-tui.txt"), plain())
  await writeFile(join(fixture.runtime.output, "computer-use-tui.ansi"), screen.raw)
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10_000, "owned terminal exit").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  terminal.dispose()
  await fixture.runtime.close()
}

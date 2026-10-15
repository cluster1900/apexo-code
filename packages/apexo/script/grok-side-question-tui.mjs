import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const gate = Promise.withResolvers()
const captured = []
const runtime = await startShellFixture("cli", {
  models: {
    "grok-4.7": {
      name: "Side question fixture",
      tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      limit: { context: 100000, output: 10000 },
    },
  },
  async next({ body, text }) {
    captured.push(body)
    if (text.includes("SIDE_HOLD")) await gate.promise
    return { content: "SIDE_TUI_ANSWER" }
  },
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
  const session = await runtime.api("/session", { title: "Side question terminal verification" })
  const endpoint = `/session/${session.id}/side-question`
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
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "terminal ready", 30_000)
  child.terminal.write("\x1b[200~/btw SIDE_TUI_QUESTION\x1b[201~")
  await poll(() => plain().includes("SIDE_TUI_QUESTION"), "question entered")
  child.terminal.write("\r")
  await poll(() => plain().includes("Side questions") && plain().includes("SIDE_TUI_ANSWER"), "side answer rendered")
  checks.push("typed-local-command", "real-model-answer")
  assert.equal((await runtime.api(endpoint))[0].status, "completed")
  child.terminal.write("n")
  await poll(() => plain().includes("ctrl+s ask separately"), "new question editor")
  child.terminal.write("\x1b[200~SIDE_HOLD\x1b[201~")
  await poll(() => plain().includes("SIDE_HOLD"), "held question entered")
  child.terminal.write("\x13")
  await poll(() => plain().includes("running") && plain().includes("SIDE_HOLD"), "separate running answer")
  child.terminal.write("c")
  await poll(() => plain().includes("cancelled"), "targeted cancellation")
  assert.equal((await runtime.api(endpoint))[0].status, "completed")
  checks.push("new-question-editor", "targeted-cancel", "previous-answer-preserved")
  child.terminal.write("i")
  await poll(() => plain().includes("Image file path"), "image picker")
  const image = join(runtime.directory, "pixel.png")
  await writeFile(
    image,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==",
      "base64",
    ),
  )
  child.terminal.write(`\x1b[200~${image}\x1b[201~`)
  await poll(() => plain().includes("pixel.png"), "image path entered")
  child.terminal.write("\x13")
  await poll(() => plain().includes("Images attached: 1"), "image attached")
  child.terminal.write("n")
  await poll(() => plain().includes("ctrl+s ask separately"), "image question editor")
  child.terminal.write("\x1b[200~SIDE_IMAGE\x1b[201~")
  await poll(() => plain().includes("SIDE_IMAGE"), "image question entered")
  child.terminal.write("\x13")
  await poll(
    async () => (await runtime.api(endpoint)).some((entry) => entry.imageCount === 1 && entry.status === "completed"),
    "image answer",
  )
  assert.ok(JSON.stringify(captured).includes("image/png"))
  checks.push("explicit-image-file", "image-provider-input")
  if (fullscreen) {
    child.terminal.write("\x1b[27u")
    await poll(() => plain().includes("0 running") && !plain().includes("Side questions ·"), "back to main composer")
    child.terminal.write("\x1b[200~/btw SIDE_TRANSFER \x1b[201~")
    await poll(() => plain().includes("SIDE_TRANSFER"), "transfer question entered")
    child.terminal.write(`\x1b[200~${image}\x1b[201~`)
    await poll(() => plain().includes("[Image"), "main composer image attached")
    child.terminal.write("\r")
    await poll(async () => (await runtime.api(endpoint)).some((entry) => entry.question.includes("SIDE_TRANSFER") && entry.imageCount === 1 && entry.status === "completed"), "composer image transferred")
    checks.push("existing-composer-image-transferred")
  }
  assert.deepEqual(await runtime.api(`/session/${session.id}/message`), [])
  checks.push("main-transcript-untouched")
  console.log(
    JSON.stringify({ mode: fullscreen ? "fullscreen" : "mini", passed: checks.length, checks, output: runtime.output }),
  )
} finally {
  gate.resolve()
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "side-question PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await writeFile(join(runtime.output, "side-question-tui.txt"), plain())
  terminal.dispose()
  await writeFile(join(runtime.output, "side-question-tui.ansi"), screen.text)
  await writeFile(join(runtime.output, "side-question-tui.json"), JSON.stringify({ checks }, null, 2))
  await runtime.close()
}

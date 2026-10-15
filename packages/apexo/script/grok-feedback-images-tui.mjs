import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const runtime = await startShellFixture("cli")
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
  const session = await runtime.api("/session", { title: "Feedback terminal verification" })
  const endpoint = `/session/${session.id}/feedback`
  const draft = await runtime.api(endpoint, {
    title: "FEEDBACK_SEEDED",
    details: "FEEDBACK_DETAILS",
    type: "bug",
    product_area: "Terminal",
    task_category: "debug",
    failure_mode: "stopped_early",
  })
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
  child.terminal.write("\x1b[200~/feedback\x1b[201~")
  await poll(() => plain().includes("/feedback"), "feedback entered")
  child.terminal.write("\r")
  await poll(() => plain().includes("Feedback drafts") && plain().includes("FEEDBACK_SEEDED"), "feedback list")
  child.terminal.write("\r")
  await poll(() => plain().includes("FEEDBACK_DETAILS"), "draft loaded")
  const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"
  const selected = join(runtime.directory, "terminal-image.png")
  await writeFile(selected, Buffer.from(data, "base64"))
  child.terminal.write("i")
  await poll(() => plain().includes("Local PNG/JPEG/GIF file"), "image path editor")
  child.terminal.write(`\x1b[200~${selected}\x1b[201~`)
  await poll(() => plain().includes("terminal-image.png"), "selected image path entered")
  child.terminal.write("\r")
  await poll(
    () => plain().includes("Image selected.") && !plain().includes("Working"),
    "image selected and action idle",
  )
  child.terminal.write("1")
  await poll(() => plain().includes("Image removed from selection"), "image explicitly removed")
  child.terminal.write("i")
  await poll(() => plain().includes("Local PNG/JPEG/GIF file"), "image path editor again")
  child.terminal.write(`\x1b[200~${selected}\x1b[201~`)
  await poll(() => plain().includes("terminal-image.png"), "image path entered again")
  child.terminal.write("\r")
  await poll(() => plain().includes("Image selected.") && !plain().includes("Working"), "attachment ready")
  child.terminal.write("v")
  await poll(() => plain().includes("o open GitHub form") && !plain().includes("Working"), "reviewed image draft idle")
  const saved = (await runtime.api(endpoint))[0]
  assert.equal(saved.images.length, 1)
  await writeFile(selected, "source changed")
  child.terminal.write("d")
  await poll(() => plain().includes("Save to a new local file"), "export path editor")
  const output = join(runtime.directory, "feedback.html")
  child.terminal.write(`\x1b[200~${output}\x1b[201~`)
  await poll(() => plain().includes("feedback.html"), "HTML path entered")
  child.terminal.write("\r")
  await poll(
    async () =>
      (await Bun.file(output).exists()) &&
      !plain().includes("Save to a new local file") &&
      !plain().includes("Working"),
    "HTML exported and idle",
  )
  const html = await readFile(output, "utf8")
  assert.match(html, /FEEDBACK_SEEDED[\s\S]*FEEDBACK_DETAILS/)
  const embedded = html.match(/href="data:image\/png;base64,([^"]+)"/)[1]
  assert.equal(embedded, data)
  assert.equal(Buffer.from(embedded, "base64").toString("base64"), data)
  checks.push(
    "explicit-local-file",
    "remove-and-reselect",
    "image-metadata-review",
    "portable-html-exact-bytes",
    "source-change-does-not-change-snapshot",
  )
  child.terminal.write("d")
  await poll(() => plain().includes("Save to a new local file"), "second export editor")
  child.terminal.write(`\x1b[200~${output}\x1b[201~`)
  await poll(() => plain().includes("feedback.html"), "existing output entered")
  child.terminal.write("\r")
  await poll(() => plain().includes("Operation failed"), "existing file protected")
  assert.equal(await readFile(output, "utf8"), html)
  checks.push("existing-export-never-overwritten")
  assert.equal(runtime.calls.length, 0)
  checks.push("no-provider-turn-or-external-submission")
  console.log(
    JSON.stringify({ mode: fullscreen ? "fullscreen" : "mini", passed: checks.length, checks, output: runtime.output }),
  )
} finally {
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "feedback PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await writeFile(join(runtime.output, "feedback-tui.txt"), plain())
  terminal.dispose()
  await writeFile(join(runtime.output, "feedback-tui.ansi"), screen.text)
  await writeFile(join(runtime.output, "feedback-tui.json"), JSON.stringify({ checks }, null, 2))
  await runtime.close()
}

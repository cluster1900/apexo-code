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
  checks.push("local-command", "list-load")
  child.terminal.write("n")
  await poll(
    () =>
      plain().includes("Category: unspecified") &&
      plain().includes("Failure: unspecified") &&
      plain().includes("Area: unspecified"),
    "new draft clears metadata",
  )
  child.terminal.write("\r")
  await poll(() => plain().includes("FEEDBACK_DETAILS"), "existing draft reloaded")
  checks.push("new-clears-metadata")
  child.terminal.write("v")
  await poll(() => plain().includes("o open GitHub form"), "review exact draft")
  assert.equal((await runtime.api(endpoint))[0].revision, draft.revision + 1)
  child.terminal.write("d")
  await poll(() => plain().includes("Save to a new local file"), "export path editor")
  const output = join(runtime.directory, "feedback.md")
  child.terminal.write(`\x1b[200~${output}\x1b[201~`)
  await poll(() => plain().includes("feedback.md"), "export path entered")
  child.terminal.write("\r")
  await poll(() => Bun.file(output).exists(), "export saved")
  assert.match(await readFile(output, "utf8"), /FEEDBACK_SEEDED[\s\S]*FEEDBACK_DETAILS/)
  checks.push("review-before-external-form", "markdown-export")
  child.terminal.write("\x1b[27u")
  await poll(() => plain().includes("t title"), "back to editor")
  child.terminal.write("t")
  await poll(() => plain().includes("Editing title"), "title editor")
  child.terminal.write("\x01\x0b\x1b[200~FEEDBACK_EDITED\x1b[201~")
  await poll(() => plain().includes("FEEDBACK_EDITED"), "title edited")
  child.terminal.write("\x13")
  await poll(() => plain().includes("FEEDBACK_EDITED"), "title retained")
  child.terminal.write("s")
  await poll(async () => (await runtime.api(endpoint))[0].title === "FEEDBACK_EDITED", "draft saved")
  checks.push("edit-save-existing")
  const current = (await runtime.api(endpoint))[0]
  await runtime.api(endpoint, {
    title: "OTHER_EDITOR",
    details: current.details,
    type: current.type,
    draft_id: current.id,
    revision: current.revision,
  })
  child.terminal.write("s")
  await poll(() => plain().includes("Operation failed"), "stale revision rejected")
  assert.equal((await runtime.api(endpoint))[0].title, "OTHER_EDITOR")
  child.terminal.write("r")
  await poll(() => plain().includes("OTHER_EDITOR"), "refresh latest")
  child.terminal.write("\r")
  await poll(() => plain().includes("OTHER_EDITOR"), "load latest revision")
  checks.push("revision-conflict-keeps-newer-draft", "refresh-recovery")
  child.terminal.write("x")
  await poll(() => plain().includes("Delete this saved local draft?"), "delete confirmation")
  child.terminal.write("n")
  assert.equal((await runtime.api(endpoint)).length, 1)
  child.terminal.write("x")
  child.terminal.write("y")
  await poll(async () => (await runtime.api(endpoint)).length === 0, "confirmed delete")
  checks.push("delete-cancel", "confirmed-delete")
  assert.deepEqual(await runtime.api(`/session/${session.id}/message`), [])
  assert.equal(runtime.calls.length, 0)
  checks.push("no-main-turn-or-feedback-submission")
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

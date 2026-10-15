import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const runtime = await startShellFixture("cli", {
  ...(process.argv.includes("--v2") ? { config: { memory_v2: { enabled: true } } } : {}),
  next: async ({ input }) =>
    JSON.stringify(input).includes("You are a memory note formatter")
      ? { content: "## Preferences\nREVIEW_REWRITTEN" }
      : undefined,
})
const fullscreen = process.argv.includes("--fullscreen")
const screen = { text: "", offset: 0 }
const plain = () => screen.text.slice(screen.offset).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
const checks = []
let child
try {
  const session = await runtime.api("/session", { title: "Memory terminal verification" })
  const endpoint = `/experimental/session/${session.id}/memory`
  const notes = () => runtime.api(endpoint)
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
        data(terminal, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          screen.text += text
          if (text.includes("\x1b[6n")) terminal.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "terminal ready", 30_000)
  const open = async (content) => {
    screen.offset = screen.text.length
    child.terminal.write(`\x1b[200~/remember ${content}\x1b[201~`)
    await poll(() => plain().includes("/remember"), "remember entered")
    child.terminal.write("\r")
    await poll(() => plain().includes("Review memory note"), "review shown")
  }
  await open("REVIEW_CANCEL")
  await poll(() => runtime.calls.length > 0, "rewrite requested")
  assert.deepEqual(await notes(), [])
  child.terminal.write("\x1b[27u")
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "review cancelled")
  assert.deepEqual(await notes(), [])
  assert.deepEqual(await runtime.api(`/session/${session.id}/message`), [])
  checks.push("inline-review", "cancel-without-save", "rewrite-without-main-turn")
  await open("REVIEW_RAW_SAVE")
  child.terminal.write("y")
  await poll(() => plain().includes("Memory saved to"), "original saved")
  const global = (await notes()).find((note) => note.source === "global")
  const original = await readFile(global.path, "utf8")
  assert.match(original, /REVIEW_RAW_SAVE/)
  assert.doesNotMatch(original, /REVIEW_CANCEL|REVIEW_REWRITTEN/)
  checks.push("confirm-original", "default-global")
  child.terminal.write("\r")
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "saved closed")
  await open("")
  await poll(() => plain().includes("ctrl+s review"), "empty editor")
  child.terminal.write("\x1b[200~REVIEW_EDITED\x1b[201~")
  await poll(() => plain().includes("REVIEW_EDITED"), "editor input")
  child.terminal.write("\x13")
  await poll(() => plain().includes("enter/y save"), "edited review")
  await poll(() => runtime.calls.length >= 3, "edited rewrite requested")
  await poll(() => plain().includes("tab switches the preview"), "rewrite ready")
  child.terminal.write("\t")
  await poll(() => plain().includes("REVIEW_REWRITTEN"), "rewrite selected")
  child.terminal.write("w")
  await poll(() => plain().includes("workspace"), "workspace selected")
  child.terminal.write("y")
  await poll(() => plain().includes("Memory saved to"), "rewritten saved")
  const workspace = (await notes()).find((note) => note.source === "workspace")
  assert.match(await readFile(workspace.path, "utf8"), /REVIEW_REWRITTEN/)
  assert.doesNotMatch(await readFile(global.path, "utf8"), /REVIEW_REWRITTEN|REVIEW_EDITED/)
  assert.deepEqual(await runtime.api(`/session/${session.id}/message`), [])
  checks.push("empty-editor", "edit-and-review", "choose-rewrite", "choose-workspace", "no-main-turn")
  console.log(
    JSON.stringify(
      { mode: fullscreen ? "fullscreen" : "mini", passed: checks.length, checks, output: runtime.output },
      null,
      2,
    ),
  )
} finally {
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "memory PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await writeFile(join(runtime.output, "memory-review-tui.ansi"), screen.text)
  await writeFile(join(runtime.output, "memory-review-tui.json"), JSON.stringify({ checks }, null, 2))
  await runtime.close()
  console.error(`Memory review TUI evidence: ${runtime.output}`)
}

import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const runtime = await startShellFixture("cli", {
  config: {
    memory: { session: { save_on_end: false }, dream: { enabled: false } },
    compaction: { memory_flush: { enabled: false } },
  },
  next: () => ({ content: "MEMORY_TUI_ACK" }),
})
const fullscreen = process.argv.includes("--fullscreen")
let child
let transcript = ""
let offset = 0
const plain = () => transcript.slice(offset).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
const checks = []
try {
  const session = await runtime.api("/session", { title: "Memory browser terminal" })
  const base = join(runtime.env.APEXO_TEST_HOME, ".grok", "memory")
  const root = join(
    base,
    `${basename(runtime.directory)}-${createHash("sha256").update(runtime.directory).digest("hex").slice(0, 8)}`,
  )
  await mkdir(join(root, "topics"), { recursive: true })
  await writeFile(join(base, "MEMORY.md"), "GLOBAL_KEEP")
  const file = join(root, "topics", "database.md")
  await writeFile(file, "# Database\nDATABASE_TUI_ORIGINAL_中文\n")
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
          transcript += text
          if (text.includes("\x1b[6n")) terminal.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "terminal session ready", 30_000)
  child.terminal.write("/memory")
  await poll(() => /Browse (saved )?memory/.test(plain()), "memory command autocomplete")
  child.terminal.write("\r")
  await poll(() => plain().includes("Memory disabled; saved notes are kept"), "memory browser initially off")
  assert.equal((await runtime.api(`/experimental/session/${session.id}/memory/status`)).enabled, false)
  const calls = runtime.calls.length
  offset = transcript.length
  child.terminal.write("t")
  await poll(() => plain().includes("GLOBAL_KEEP"), "enabled memory browser open")
  assert.equal((await runtime.api(`/experimental/session/${session.id}/memory/status`)).enabled, true)
  child.terminal.write("t")
  await poll(async () => !(await runtime.api(`/experimental/session/${session.id}/memory/status`)).enabled, "disabled state after t")
  child.terminal.resize(121, 40)
  await poll(() => plain().includes("Memory disabled; saved notes are kept"), "disable with t")
  assert.equal((await runtime.api(`/experimental/session/${session.id}/memory/status`)).enabled, false)
  assert.match(await readFile(file, "utf8"), /DATABASE_TUI_ORIGINAL/)
  offset = transcript.length
  child.terminal.write("t")
  await poll(() => plain().includes("GLOBAL_KEEP"), "reenabled memory browser")
  assert.equal(runtime.calls.length, calls)
  checks.push("default-off", "t-enable", "t-disable-preserves-files", "t-reenable-without-model-call")
  checks.push("slash-opens-browser", "global-preview")
  child.terminal.write("j")
  await poll(() => plain().includes("DATABASE_TUI_ORIGINAL_中文"), "workspace preview")
  checks.push("keyboard-select-preview")
  child.terminal.write("\r")
  child.terminal.write("\x1b[27u")
  child.terminal.write("/")
  child.terminal.write("database")
  child.terminal.write("\r")
  child.terminal.resize(122, 40)
  await poll(() => plain().includes("Filter: database"), "memory filter")
  checks.push("name-content-filter")
  child.terminal.write("x")
  await poll(() => plain().includes("again to confirm"), "delete confirmation")
  child.terminal.write("\x1b[27u")
  assert.match(await readFile(file, "utf8"), /DATABASE_TUI_ORIGINAL/)
  child.terminal.write("x")
  checks.push("cancel-delete-and-leave-preview")
  await writeFile(file, "# Database\nDATABASE_TUI_CHANGED_中文\n")
  child.terminal.write("x")
  await poll(() => plain().includes("note changed"), "reject stale preview")
  assert.match(await readFile(file, "utf8"), /DATABASE_TUI_CHANGED/)
  checks.push("reject-changed-preview")
  child.terminal.write("r")
  await poll(() => plain().includes("DATABASE_TUI_CHANGED_中文"), "refresh preview")
  child.terminal.write("x")
  child.terminal.write("x")
  await poll(async () => (await readFile(file, "utf8").catch(() => undefined)) === undefined, "confirmed delete")
  assert.equal(await readFile(join(base, "MEMORY.md"), "utf8"), "GLOBAL_KEEP")
  checks.push("confirmed-single-delete", "preserve-global")
  console.log(
    JSON.stringify({ result: "pass", mode: fullscreen ? "fullscreen" : "mini", output: runtime.output, checks }),
  )
} finally {
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10_000, "memory PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await writeFile(join(runtime.output, "memory-tui.ansi"), transcript)
  await writeFile(join(runtime.output, "memory-tui.json"), JSON.stringify({ checks }, null, 2))
  await runtime.close()
  console.error(`Memory TUI evidence: ${runtime.output}`)
}

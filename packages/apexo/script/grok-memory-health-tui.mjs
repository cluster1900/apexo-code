import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const runtime = await startShellFixture("cli", {
  config: {
    memory_v2: { enabled: true, capture_enabled: false, automatic_dream_enabled: false },
    memory: { session: { save_on_end: false }, dream: { enabled: false } },
    compaction: { memory_flush: { enabled: false } },
  },
  next: () => ({ content: "MEMORY_TUI_ACK" }),
})
const fullscreen = process.argv.includes("--fullscreen")
let child
let transcript = ""
const screen = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
const plain = () =>
  Array.from({ length: screen.rows }, (_, row) =>
    screen.buffer.active.getLine(screen.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const checks = []
try {
  const session = await runtime.api("/session", { title: "Memory browser terminal" })
  await runtime.api(`/experimental/session/${session.id}/memory/remember`, {
    content: "PRIVATE_HEALTH_TUI",
    scope: "workspace",
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
        data(terminal, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          transcript += text
          screen.write(text)
          if (text.includes("\x1b[6n")) terminal.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "terminal session ready", 30_000)
  child.terminal.write("/memory")
  await poll(() => /Browse (saved )?memory/.test(plain()), "memory command autocomplete")
  child.terminal.write("\r")
  await poll(() => /Memory enabled\s*for this session/.test(plain()), "memory browser open")
  await poll(() => plain().includes("PRIVATE_HEALTH_TUI"), "memory browser preview ready")
  child.terminal.write("h")
  await poll(() => plain().includes("Memory diagnostics") && plain().includes("1 visible"), "health panel counts")
  assert.ok(!plain().includes("PRIVATE_HEALTH_TUI"))
  checks.push("health-key-opens-panel", "health-counts", "health-content-free")
  await runtime.api(
    `/session/${session.id}`,
    { permission: [{ permission: "read", pattern: "*", action: "deny" }] },
    "PATCH",
  )
  child.terminal.write("r")
  await poll(() => plain().includes("workspace: denied"), "health refresh denied")
  checks.push("health-refresh-latest-permissions")
  child.terminal.write("\x1b[27u")
  await poll(() => /Memory enabled\s*for this session/.test(plain()), "health escape returns to browser")
  checks.push("health-escape-returns-to-browser")
  assert.equal(runtime.calls.length, 0)
  checks.push("no-model-calls")
  console.log(
    JSON.stringify({ result: "pass", mode: fullscreen ? "fullscreen" : "mini", output: runtime.output, checks }),
  )
} finally {
  await writeFile(join(runtime.output, "memory-health-screen.txt"), plain())
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10_000, "memory PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await writeFile(join(runtime.output, "memory-health-tui.ansi"), transcript)
  await writeFile(join(runtime.output, "memory-health-tui.json"), JSON.stringify({ checks }, null, 2))
  screen.dispose()
  await runtime.close()
  console.error(`Memory health TUI evidence: ${runtime.output}`)
}

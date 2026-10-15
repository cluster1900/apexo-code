// Actual mini/fullscreen native attach, backed by real native Memory management.
import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startMemoryUiFixture } from "./grok-memory-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"

const desktop = process.argv.includes("--desktop")
const mixed = desktop || process.argv.includes("--mixed")
const fixture = await startMemoryUiFixture({ mixed, runtime: desktop ? "desktop" : "cli" })
const { runtime, repo } = fixture
const fullscreen = process.argv.includes("--fullscreen")
const cols = process.argv.includes("--narrow") ? 80 : 120
const rows = process.argv.includes("--narrow") ? 24 : 40
const terminal = new Terminal({ cols, rows, allowProposedApi: true })
const output = { text: "" }
const plain = () =>
  Array.from({ length: rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const memoryView = () => {
  const lines = plain().split("\n")
  const top = lines.findIndex((line) => line.includes("Memory ·"))
  if (top < 0) return ""
  const left = lines[top].indexOf("Memory ·")
  return lines
    .slice(top)
    .map((line) => line.slice(left, fullscreen ? left + 88 : undefined))
    .join("\n")
}
const checks = []
let child
try {
  const before = runtime.calls.length
  const initialPatches = (await fixture.records()).filter(
    (item) => item.method === "PATCH" && item.path === `/api/session/${fixture.session.id}/memory`,
  ).length
  const toggled = async (count, enabled) => {
    const records = (await fixture.records()).filter(
      (item) =>
        item.method === "PATCH" && item.path === `/api/session/${fixture.session.id}/memory` && item.status === 200,
    )
    return (
      records.length === initialPatches + count &&
      (enabled
        ? memoryView().includes("Memory enabled")
        : memoryView().includes("Memory disabled; saved notes are kept"))
    )
  }
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      join(repo, "packages/apexo/src/index.ts"),
      "attach",
      runtime.url,
      ...(mixed ? ["--session-protocol", "native"] : []),
      ...(!fullscreen ? ["--mini", "--no-replay"] : []),
      "--dir",
      runtime.directory,
      "--session",
      fixture.session.id,
    ],
    {
      cwd: join(repo, "packages/apexo"),
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols,
        rows,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          output.text += text
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(
    () => (fullscreen ? /0 running|MEMORY_UI_DONE/.test(plain()) : plain().includes("ctrl+p cmd")),
    "native terminal ready",
    30000,
  )
  await poll(
    async () =>
      (await fixture.records()).some(
        (item) => item.path === `/api/session/${fixture.session.id}/question` && item.status === 200,
      ),
    "native passive input bootstrap",
  )
  child.terminal.write("/memory")
  await poll(() => /\/memory\s+Browse (saved )?memory/.test(plain()), "Memory autocomplete ready")
  child.terminal.write("\r")
  if (fullscreen) {
    await poll(() => !/\/memory\s+Browse memory/.test(plain()), "Memory autocomplete selection")
    if (plain().includes("> /memory")) child.terminal.write("\r")
  }
  await poll(() => memoryView().includes("Memory disabled; saved notes are kept"), "native Memory initially off", 20000)
  assert.ok(!memoryView().includes("o operations") && !memoryView().includes("h health"))
  await writeFile(join(runtime.output, "memory-disabled.txt"), plain())
  checks.push("native-passive-mode-and-truthful-capabilities")
  child.terminal.write("t")
  await poll(async () => (await toggled(1, true)) && memoryView().includes("MEMORY_UI_ORIGINAL"), "native note preview")
  await writeFile(join(runtime.output, "memory-preview.txt"), plain())
  checks.push("enable-and-native-preview")
  child.terminal.write("t")
  await poll(
    async () => (await toggled(2, false)) && !memoryView().includes("MEMORY_UI_ORIGINAL"),
    "disable hides note content",
  )
  assert.match(await readFile(fixture.file, "utf8"), /MEMORY_UI_ORIGINAL/)
  checks.push("disable-preserves-file-and-clears-content")
  child.terminal.write("t")
  await poll(async () => (await toggled(3, true)) && memoryView().includes("MEMORY_UI_ORIGINAL"), "re-enable preview")
  child.terminal.write("x")
  await poll(() => memoryView().includes("again to confirm"), "reviewed delete confirmation")
  await writeFile(fixture.file, "# Memory UI\nMEMORY_UI_CHANGED_中文\n")
  child.terminal.write("x")
  await poll(() => memoryView().includes("note changed"), "native hash conflict")
  assert.match(await readFile(fixture.file, "utf8"), /MEMORY_UI_CHANGED/)
  await writeFile(join(runtime.output, "memory-conflict.txt"), plain())
  checks.push("changed-hash-rejected-without-silent-retry")
  child.terminal.write("r")
  await poll(() => memoryView().includes("MEMORY_UI_CHANGED"), "fresh preview")
  child.terminal.write("x")
  await poll(() => memoryView().includes("again to confirm"), "fresh confirmation")
  child.terminal.write("x")
  await poll(
    async () => (await readFile(fixture.file, "utf8").catch(() => undefined)) === undefined,
    "native hash deletion",
  )
  checks.push("fresh-confirmed-single-note-deletion")
  child.terminal.write("\x1b[27u")
  await poll(() => !plain().includes("↑↓ select"), "close Memory browser")
  child.terminal.write("/flush")
  await poll(
    () => /\/flush\s+(?:Memory: flush|Unavailable in native Memory)/.test(plain()),
    "unsupported command menu ready",
  )
  child.terminal.write("\r")
  await poll(
    () =>
      fullscreen
        ? plain().includes("This Memory operation is not available")
        : memoryView().includes("Browse, preview, delete and toggle only."),
    "native unsupported operation guidance",
  )
  assert.equal(runtime.calls.length, before)
  assert.ok(
    !(await fixture.records()).some((item) => item.path.includes("/experimental/") && item.path.includes("memory")),
  )
  checks.push("unsupported-command-no-provider-or-compatibility-call")
  await writeFile(join(runtime.output, "memory-final.txt"), plain())
  console.log(
    JSON.stringify(
      {
        mode: fullscreen ? "fullscreen" : "mini",
        backend: desktop ? "desktop" : "cli",
        mixed,
        cols,
        rows,
        checks,
        providerCalls: before,
        output: runtime.output,
      },
      null,
      2,
    ),
  )
} finally {
  await writeFile(join(runtime.output, "memory-active.txt"), plain())
  if (child) {
    child.kill("SIGTERM")
    await deadline(child.exited, 10000, "Memory terminal cleanup").catch(async () => {
      child.kill("SIGKILL")
      await child.exited
    })
    child.terminal?.close()
  }
  terminal.dispose()
  await writeFile(join(runtime.output, "memory.ansi"), output.text)
  await writeFile(join(runtime.output, "memory-tui.json"), JSON.stringify({ checks }, null, 2))
  await fixture.close()
  console.error(`Memory TUI evidence: ${runtime.output}`)
}

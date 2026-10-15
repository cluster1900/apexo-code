import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const home = await mkdtemp(join(tmpdir(), "apexo-hooks-ui-"))
await mkdir(join(home, "hooks"))
const source = join(home, "hooks/ui.json")
const configure = (event) =>
  writeFile(
    source,
    JSON.stringify({ hooks: { [event]: [{ hooks: [{ type: "command", command: "printf HOOK_SECRET_BODY" }] }] } }),
  )
await configure("UserPromptSubmit")
const runtime = await startShellFixture("cli", { env: { GROK_HOME: home }, next: () => ({ content: "HOOK_UI_DONE" }) })
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
  const session = await runtime.api("/session", { title: "Hooks terminal verification" })
  const endpoint = `/session/${session.id}/hooks`
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
  child.terminal.write("\x1b[200~/hooks\x1b[201~")
  await poll(() => plain().includes("/hooks"), "hooks entered")
  child.terminal.write("\r")
  await poll(() => plain().includes("Hook configuration has not been captured yet"), "passive uncaptured snapshot")
  assert.equal((await runtime.api(endpoint)).captured, false)
  assert.equal((await runtime.api(endpoint)).generation, 0)
  assert.equal(runtime.calls.length, 0)
  child.terminal.write("l")
  assert.equal((await runtime.api(endpoint)).captured, false)
  assert.equal((await runtime.api(endpoint)).generation, 0)
  checks.push("passive-open", "uncaptured-reload-disabled")
  await runtime.api(`/session/${session.id}/prompt_async`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Capture hook snapshot" }],
  })
  await poll(
    async () =>
      (await runtime.api(`/session/${session.id}/message`)).some(
        (item) => item.info.role === "assistant" && item.info.time.completed,
      ),
    "capture completed",
  )
  child.terminal.write("r")
  await poll(
    () =>
      plain().includes("Snapshot generation: 1") &&
      plain().includes("UserPromptSubmit") &&
      !plain().includes("Loading snapshot"),
    "captured metadata",
  )
  assert.ok(!plain().includes("HOOK_SECRET_BODY"))
  checks.push("refresh-metadata", "sanitized-command")
  const callsBeforeChoice = runtime.calls.length
  assert.ok(plain().includes("This session: enabled"))
  child.terminal.write(" ")
  await poll(
    () => plain().includes("This session: disabled") && plain().includes("Saved choice: disabled"),
    "disable hook",
  )
  assert.equal((await runtime.api(endpoint)).inspection.hooks[0].savedDisabled, true)
  assert.equal((await runtime.api(endpoint)).generation, 1)
  child.terminal.write(" ")
  await poll(
    () => plain().includes("This session: enabled") && plain().includes("Saved choice: use configuration"),
    "enable hook",
  )
  assert.equal((await runtime.api(endpoint)).inspection.hooks[0].savedDisabled, false)
  assert.equal(runtime.calls.length, callsBeforeChoice)
  checks.push("saved-effective-toggle", "toggle-no-model-or-registry-work")
  await configure("PreToolUse")
  assert.equal((await runtime.api(endpoint)).inspection.hooks[0].event, "UserPromptSubmit")
  const before = runtime.calls.length
  child.terminal.write("l")
  await poll(() => plain().includes("Snapshot generation: 2") && plain().includes("PreToolUse"), "explicit reload")
  assert.equal(runtime.calls.length, before)
  assert.equal((await runtime.api(endpoint)).generation, 2)
  checks.push("explicit-reload", "no-model-work")
  child.terminal.write("\x1b[27u")
  await poll(() => !plain().includes("r refresh snapshot"), "panel closed")
  child.terminal.write("\x1b[200~/hooks\x1b[201~")
  await poll(() => plain().includes("/hooks"), "hooks reopened command")
  child.terminal.write("\r")
  await poll(() => plain().includes("Snapshot generation: 2"), "reopened snapshot")
  assert.equal((await runtime.api(endpoint)).generation, 2)
  assert.equal(runtime.calls.length, before)
  checks.push("reopen-is-passive")
  console.log(
    JSON.stringify({ mode: fullscreen ? "fullscreen" : "mini", passed: checks.length, checks, output: runtime.output }),
  )
} finally {
  await writeFile(join(runtime.output, "hooks-tui.txt"), plain())
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "hooks PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  terminal.dispose()
  await writeFile(join(runtime.output, "hooks-tui.ansi"), screen.text)
  await writeFile(join(runtime.output, "hooks-tui.json"), JSON.stringify({ checks }, null, 2))
  await runtime.close()
}

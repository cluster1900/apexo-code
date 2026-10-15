import { Terminal } from "@xterm/headless"
import assert from "node:assert/strict"
import { readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startMcpUiFixture } from "./grok-mcp-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"

const fixture = await startMcpUiFixture()
const { runtime, repo } = fixture
const fullscreen = process.argv.includes("--fullscreen")
const cols = fullscreen ? 120 : 80
const rows = fullscreen ? 40 : 24
const terminal = new Terminal({ cols, rows, allowProposedApi: true })
const screen = { text: "" }
const plain = () =>
  Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const checks = []
let child
try {
  const starts = await fixture.starts()
  const before = (await fixture.records()).filter((item) => item.method === "POST").length
  await symlink(join(repo, "packages/apexo/node_modules"), join(runtime.output, "node_modules"))
  const harness = join(runtime.output, "mcp-terminal.tsx")
  await writeFile(
    harness,
    `/** @jsxImportSource @opentui/solid */
import { createCliRenderer } from ${JSON.stringify(import.meta.resolve("@opentui/core"))};
import { render } from ${JSON.stringify(import.meta.resolve("@opentui/solid"))};
import { createDefaultOpenTuiKeymap } from ${JSON.stringify(import.meta.resolve("@opentui/keymap/opentui"))};
import { KeymapProvider } from ${JSON.stringify(import.meta.resolve("@opentui/keymap/solid"))};
import { createApexoClient } from ${JSON.stringify(import.meta.resolve("@apexo/sdk/v2"))};
import { McpBrowser, mcpActions } from ${JSON.stringify(join(repo, "packages/tui/src/component/mcp-browser.tsx"))};
const renderer = await createCliRenderer({exitOnCtrlC:true, useKittyKeyboard:{}, useMouse:false});
const keymap = createDefaultOpenTuiKeymap(renderer);
const client = createApexoClient({baseUrl:${JSON.stringify(runtime.url)}});
await render(() => <KeymapProvider keymap={keymap}><McpBrowser height={${fullscreen ? 32 : 21}} actions={mcpActions(client, ${JSON.stringify(runtime.directory)})} theme={() => ({text:"#ffffff",muted:"#aaaaaa",error:"#ff5555",highlight:"#55ffff"})} onClose={() => {renderer.destroy();process.exit(0)}} /></KeymapProvider>, renderer);
`,
  )
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [process.execPath, "--no-install", "--preload", import.meta.resolve("@opentui/solid/preload"), harness],
    {
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols,
        rows,
        data(_, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          screen.text += text
          terminal.write(text)
          if (text.includes("\x1b[6n")) child.terminal.write("\x1b[1;1R")
        },
      },
    },
  )
  const row = (name, state) => plain().includes(`${name} · ${state}`)
  await poll(() => row("a-local", "connected") && row("b-disabled", "disabled"), "native MCP panel", 30000)
  assert.equal(await fixture.starts(), starts)
  assert.equal((await fixture.records()).filter((item) => item.method === "POST").length, before)
  assert.ok(plain().includes("tools: 1"))
  checks.push("passive-native-open")
  child.terminal.write("\r")
  await poll(() => row("a-local", "disabled"), "disconnect")
  assert.equal((await runtime.api("/api/mcp"))["a-local"].status, "disabled")
  assert.ok(plain().includes("Saved choice: disabled"))
  child.terminal.write("c")
  await poll(() => row("a-local", "connected") && !plain().includes("Loading"), "reset preference")
  assert.equal((await runtime.api("/api/mcp"))["a-local"].preference, undefined)
  child.terminal.write("\r")
  await poll(() => row("a-local", "disabled"), "disconnect after reset")
  checks.push("saved-choice-visible-and-reset-applies-configuration")
  child.terminal.write("\r")
  await poll(() => row("a-local", "connected"), "connect")
  const connected = await fixture.starts()
  child.terminal.write("r")
  await poll(
    async () => (await fixture.starts()) > connected && row("a-local", "connected") && !plain().includes("Loading"),
    "retry",
  )
  checks.push("disconnect-connect-retry")
  await writeFile(fixture.mode, "fail")
  child.terminal.write("r")
  await poll(() => plain().includes("MCP operation failed"), "failed retry")
  assert.equal((await runtime.api("/api/mcp"))["a-local"].status, "connected")
  assert.ok(row("a-local", "connected"))
  checks.push("failed-retry-preserves-healthy-connection")
  child.terminal.write("\r")
  await poll(() => row("a-local", "disabled"), "disconnect before failed connect")
  child.terminal.write("\r")
  await poll(() => row("a-local", "failed"), "failed connection published")
  const failureText = (await runtime.api("/api/mcp"))["a-local"].error
  assert.ok(failureText)
  await writeFile(fixture.mode, "ready")
  child.terminal.write("\r")
  await poll(() => row("a-local", "connected") && !plain().includes("MCP operation failed"), "retry recovery")
  assert.ok(!plain().includes(failureText))
  checks.push("failed-connection-recovery")
  await writeFile(fixture.outage, "503")
  child.terminal.write("u")
  await poll(() => plain().includes("Could not load MCP connections"), "refresh outage")
  await rm(fixture.outage)
  child.terminal.write("u")
  await poll(() => row("a-local", "connected") && !plain().includes("Could not load"), "refresh recovery")
  checks.push("manual-refresh-error-recovery")
  const preferenceDirectory = join(runtime.env.XDG_DATA_HOME, runtime.env.APEXO_APP_DIR_NAME, "mcp-preferences")
  const preferenceNames = (await readdir(preferenceDirectory)).filter((name) => name.endsWith(".json"))
  assert.equal(preferenceNames.length, 1)
  const preferenceFile = join(preferenceDirectory, preferenceNames[0])
  const savedPreference = await readFile(preferenceFile)
  const storageMessage = "Saved connection choices could not be read or updated."
  try {
    await writeFile(preferenceFile, "{")
    child.terminal.write("r")
    await poll(() => plain().includes(storageMessage), "safe storage error")
    const status = (await runtime.api("/api/mcp"))["a-local"]
    assert.equal(status.preferenceError, true)
    assert.equal(status.status, "connected")
    assert.equal(status.tools, 1)
    assert.equal(runtime.calls.length, 0)
    assert.ok(!plain().includes(preferenceFile))
    await writeFile(join(runtime.output, "mcp-preference-storage-error.txt"), plain())
  } finally {
    await writeFile(preferenceFile, savedPreference)
  }
  child.terminal.write("r")
  await poll(
    () => row("a-local", "connected") && !plain().includes(storageMessage) && !plain().includes("Loading"),
    "storage preference recovery",
  )
  assert.equal((await runtime.api("/api/mcp"))["a-local"].preferenceError, undefined)
  checks.push("storage-error-retains-tools-and-clears-after-repair")
  child.terminal.write("\x1b[B\x1b[B")
  await poll(() => plain().includes("Authentication setup is not available yet"), "native authentication boundary")
  const authBefore = (await fixture.records()).filter((item) => item.method === "POST").length
  const readsBefore = (await fixture.records()).filter((item) => item.path === "/api/mcp").length
  child.terminal.write("a")
  // Refresh is a completed round trip proving the preceding ignored key cannot open OAuth.
  child.terminal.write("u")
  await poll(
    async () =>
      (await fixture.records()).filter((item) => item.path === "/api/mcp").length > readsBefore &&
      !plain().includes("Loading"),
    "auth passive refresh",
  )
  assert.equal((await fixture.records()).filter((item) => item.method === "POST").length, authBefore)
  assert.ok(!plain().includes("a authenticate"))
  checks.push("native-auth-unavailable")
  assert.equal(await readFile(join(runtime.directory, "apexo.json"), "utf8"), fixture.config)
  assert.equal(runtime.calls.length, 0)
  const controls = (await fixture.records()).filter((item) => item.method === "POST" && /^\/api\/mcp\//.test(item.path))
  assert.ok(controls.length >= 7)
  assert.ok(controls.every((item) => item.contentLength === null || item.contentLength === "0"))
  checks.push("saved-choices-no-shared-config-write-no-model-work-no-control-body")
  console.log(
    JSON.stringify({
      mode: fullscreen ? "expanded-native-actions" : "narrow-native-actions",
      passed: checks.length,
      checks,
      output: runtime.output,
    }),
  )
} finally {
  await writeFile(join(runtime.output, "mcp-tui.txt"), plain())
  await writeFile(join(runtime.output, "mcp-tui.ansi"), screen.text)
  child?.kill("SIGTERM")
  if (child)
    await deadline(child.exited, 10000, "owned MCP PTY cleanup").catch(async () => {
      child.kill("SIGKILL")
      await child.exited
    })
  child?.terminal?.close()
  terminal.dispose()
  await fixture.close()
}

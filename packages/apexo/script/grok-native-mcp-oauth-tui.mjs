import { Terminal } from "@xterm/headless"
import assert from "node:assert/strict"
import { chmod, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startOAuthUiFixture } from "./grok-mcp-oauth-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"

const fixture = await startOAuthUiFixture()
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
  const opener = join(runtime.output, "bin")
  await mkdir(opener)
  await writeFile(join(opener, "open"), '#!/bin/sh\nexec /usr/bin/curl --silent --output /dev/null "$1"\n')
  await chmod(join(opener, "open"), 0o700)
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
      env: { ...runtime.env, PATH: `${opener}:${runtime.env.PATH}`, TERM: "xterm-256color", COLORTERM: "truecolor" },
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
  const row = (state) => plain().includes(`reference · ${state}`)
  const geometry = () => {
    const lines = plain().split("\n")
    const header = lines.findIndex((x) => x.includes("MCP connections"))
    const footer = lines.findIndex((x) => x.includes("Enter connect/disconnect"))
    const auth = lines.findIndex((x) => x.includes("a authenticate"))
    assert.ok(
      header >= 0 && footer > header && auth > footer,
      "non-overlapping header, controls and authentication row",
    )
  }
  await poll(() => row("disabled") && plain().includes("a authenticate"), "passive OAuth terminal", 30000)
  geometry()
  assert.equal(fixture.issuer.state.authorize, 0)
  assert.equal(fixture.issuer.state.initializes, 0)
  checks.push("passive-long-panel-and-visible-fixed-controls")
  child.terminal.write("a")
  await poll(() => fixture.issuer.state.authorize === 1, "explicit terminal opener")
  await poll(() => plain().includes("Authentication: waiting"), "visible waiting feedback")
  geometry()
  await writeFile(join(runtime.output, "oauth-waiting.txt"), plain())
  child.terminal.write("x")
  await poll(() => plain().includes("Authentication: cancelled"), "exact terminal cancel")
  assert.equal(fixture.issuer.state.grants, 0)
  checks.push("explicit-start-and-exact-cancel-with-visible-feedback")
  child.terminal.write("a")
  await poll(() => fixture.issuer.state.authorize === 2, "second explicit terminal opener")
  await fixture.consent()
  await poll(() => plain().includes("Authentication: credentials_ready"), "disabled authorization ready")
  assert.equal(fixture.issuer.state.initializes, 0)
  child.terminal.write("\r")
  await poll(() => row("connected") && !plain().includes("Loading"), "explicit terminal connect")
  assert.equal((await runtime.api("/api/mcp")).reference.tools, 1)
  checks.push("consent-preserves-disabled-until-explicit-connect")
  fixture.issuer.state.denied = true
  child.terminal.write("a")
  await poll(() => fixture.issuer.state.authorize === 3, "declined terminal consent")
  await fixture.consent()
  await poll(() => plain().includes("Authentication: failed"), "declined feedback")
  assert.equal((await runtime.api("/api/mcp")).reference.status, "connected")
  assert.equal((await runtime.api("/api/mcp")).reference.tools, 1)
  geometry()
  checks.push("declined-consent-preserves-tools-and-fixed-chrome")
  assert.equal(runtime.calls.length, 0)
  assert.equal(await readFile(join(runtime.directory, "apexo.json"), "utf8"), fixture.config)
  checks.push("no-model-work-or-config-mutation")
  console.log(
    JSON.stringify({
      mode: fullscreen ? "expanded-native-actions" : "narrow-native-actions",
      passed: checks.length,
      checks,
      output: runtime.output,
    }),
  )
} finally {
  await writeFile(join(runtime.output, "mcp-oauth-tui.txt"), plain())
  await writeFile(join(runtime.output, "mcp-oauth-tui.ansi"), screen.text)
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

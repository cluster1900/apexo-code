import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startSandboxUiFixture } from "./grok-sandbox-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"

const fixture = await startSandboxUiFixture()
const { runtime, repo } = fixture
const fullscreen = process.argv.includes("--fullscreen")
const cols = process.argv.includes("--narrow") ? 80 : 120
const rows = process.argv.includes("--narrow") ? 24 : 40
const terminal = new Terminal({ cols, rows, allowProposedApi: true })
const screen = { text: "" }
const plain = () =>
  Array.from({ length: rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const checks = []
let child
try {
  const before = fixture.calls.length
  await symlink(join(repo, "packages/apexo/node_modules"), join(runtime.output, "node_modules"))
  const harness = join(runtime.output, "sandbox-terminal.tsx")
  const source = (path) => JSON.stringify(join(repo, path))
  await writeFile(
    harness,
    `/** @jsxImportSource @opentui/solid */
import {createCliRenderer} from ${JSON.stringify(import.meta.resolve("@opentui/core"))};
import {render} from ${JSON.stringify(import.meta.resolve("@opentui/solid"))};
import {createDefaultOpenTuiKeymap} from ${JSON.stringify(import.meta.resolve("@opentui/keymap/opentui"))};
import {onMount} from ${JSON.stringify(import.meta.resolve("solid-js"))};
import {createApexoClient} from ${JSON.stringify(import.meta.resolve("@apexo/sdk/v2"))};
import {CommandSandboxBrowser} from ${source("packages/tui/src/component/command-sandbox-browser.tsx")};
import {DialogCommandSandbox} from ${source("packages/tui/src/component/dialog-command-sandbox.tsx")};
import {SDKProvider} from ${source("packages/tui/src/context/sdk.tsx")};
import {ThemeProvider} from ${source("packages/tui/src/context/theme.tsx")};
import {KVProvider} from ${source("packages/tui/src/context/kv.tsx")};
import {TuiPathsProvider} from ${source("packages/tui/src/context/runtime.tsx")};
import {TuiConfig,TuiConfigProvider} from ${source("packages/tui/src/config/index.tsx")};
import {DialogProvider,useDialog} from ${source("packages/tui/src/ui/dialog.tsx")};
import {ToastProvider} from ${source("packages/tui/src/ui/toast.tsx")};
import {ApexoKeymapProvider,registerApexoKeymap} from ${source("packages/tui/src/keymap.tsx")};
const renderer=await createCliRenderer({exitOnCtrlC:true,useMouse:false});
const keymap=createDefaultOpenTuiKeymap(renderer);const config=TuiConfig.resolve({},{terminalSuspend:false});registerApexoKeymap(keymap,renderer,config);
setInterval(()=>{const walk=node=>[{id:node.id,x:node.x,y:node.y,width:node.width,height:node.height,text:typeof node.plainText==="string"?node.plainText:undefined},...node.getChildren().flatMap(walk)];void Bun.write(${JSON.stringify(join(runtime.output, "layout.json"))},JSON.stringify(walk(renderer.root)))},100);
const client=createApexoClient({baseUrl:${JSON.stringify(runtime.url)}});
const actions={get:async signal=>(await client.v2.session.sandbox({sessionID:${JSON.stringify(fixture.session.id)}},{signal,throwOnError:true})).data};
function Mini(){return <CommandSandboxBrowser actions={actions} theme={()=>({text:"#ffffff",muted:"#aaaaaa",error:"#ff5555",highlight:"#55ffff"})} onClose={()=>{renderer.destroy();process.exit(0)}}/>}
function Open(){const dialog=useDialog();onMount(()=>dialog.replace(()=><DialogCommandSandbox sessionID=${JSON.stringify(fixture.session.id)}/>));return <box/>}
await render(()=><ApexoKeymapProvider keymap={keymap}><TuiPathsProvider value={{cwd:${JSON.stringify(runtime.directory)},home:${JSON.stringify(runtime.env.HOME)},state:${JSON.stringify(runtime.output)},worktree:${JSON.stringify(runtime.directory)}}}><TuiConfigProvider config={config}><KVProvider><ThemeProvider mode="dark"><ToastProvider><SDKProvider url=${JSON.stringify(runtime.url)} events={{subscribe:async()=>()=>{}}}><DialogProvider>${fullscreen ? "<Open/>" : "<Mini/>"}</DialogProvider></SDKProvider></ToastProvider></ThemeProvider></KVProvider></TuiConfigProvider></TuiPathsProvider></ApexoKeymapProvider>,renderer);
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
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          screen.text += text
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes("Stored profile: off"), "native sandbox status", 30000)
  assert.ok(plain().includes("native commands on macOS"))
  assert.ok(plain().includes("compatibility flow"))
  assert.equal(fixture.calls.length, before)
  checks.push("passive-status-with-honest-terminal-limit")
  await writeFile(fixture.outage, "503")
  child.terminal.write("r")
  await poll(() => plain().includes("Could not read command sandbox status"), "visible status failure")
  assert.ok(!plain().includes("private fixture conflict cause"))
  await writeFile(join(runtime.output, "sandbox-error.txt"), plain())
  checks.push("refresh-failure-is-visible")
  await rm(fixture.outage)
  child.terminal.write("r")
  await poll(() => !plain().includes("Could not read command sandbox status"), "refresh recovers")
  assert.equal(fixture.calls.length, before)
  const records = await fixture.records()
  assert.ok(records.filter((r) => r.path.endsWith("/sandbox")).length >= 3)
  assert.equal(records.filter((r) => r.method === "POST").length, 1)
  checks.push("refresh-and-recovery-do-not-create-or-execute")
  console.log(
    JSON.stringify(
      {
        checks,
        output: runtime.output,
        mode: fullscreen ? "fullscreen" : "mini",
        cols,
        rows,
        providerCalls: fixture.calls.length,
      },
      null,
      2,
    ),
  )
} finally {
  await writeFile(join(runtime.output, "sandbox-final.txt"), plain())
  child?.kill("SIGTERM")
  if (child)
    await deadline(child.exited, 10000, "Task PTY cleanup").catch(async () => {
      child.kill("SIGKILL")
      await child.exited
    })
  child?.terminal?.close()
  await writeFile(join(runtime.output, "sandbox.ansi"), screen.text)
  await fixture.close()
  console.error(`Sandbox TUI evidence: ${runtime.output}`)
}

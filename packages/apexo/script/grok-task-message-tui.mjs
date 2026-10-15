import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startTaskMessageUiFixture } from "./grok-task-message-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"

const fixture = await startTaskMessageUiFixture()
const delivery = process.argv.find((arg) => ["steer", "queue", "interject"].includes(arg)) ?? "steer"
const run = await fixture.launch(delivery)
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
  const harness = join(runtime.output, "task-terminal.tsx")
  const source = (path) => JSON.stringify(join(repo, path))
  await writeFile(
    harness,
    `/** @jsxImportSource @opentui/solid */
import {createCliRenderer} from ${JSON.stringify(import.meta.resolve("@opentui/core"))};
import {render} from ${JSON.stringify(import.meta.resolve("@opentui/solid"))};
import {createDefaultOpenTuiKeymap} from ${JSON.stringify(import.meta.resolve("@opentui/keymap/opentui"))};
import {createStore,reconcile} from ${JSON.stringify(import.meta.resolve("solid-js/store"))};
import {onMount,onCleanup} from ${JSON.stringify(import.meta.resolve("solid-js"))};
import {createApexoClient} from ${JSON.stringify(import.meta.resolve("@apexo/sdk/v2"))};
import {taskActions} from ${source("packages/tui/src/util/session-tasks.ts")};
import {RunTasksBody} from ${source("packages/apexo/src/cli/cmd/run/footer.tasks.tsx")};
import {DialogTasks} from ${source("packages/tui/src/component/dialog-tasks.tsx")};
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
const baseActions=taskActions(client,()=>${JSON.stringify(run.session.id)});
const {taskMessageDraft}=await import("@apexo/sdk/v2/task-message");
const actions={...baseActions,messageDraft:target=>taskMessageDraft(client,${JSON.stringify(run.session.id)},target.id,target.started_at)};
function Mini(){const [state,setState]=createStore({items:[],native:false,error:""});const abort=new AbortController();let timer;const refresh=async()=>{try{const next=await actions.list(abort.signal);if(!abort.signal.aborted){setState("items",reconcile(next.items));setState({native:next.native,error:""})}}catch(error){if(!abort.signal.aborted)setState("error",String(error))}finally{if(!abort.signal.aborted)timer=setTimeout(refresh,1000)}};onMount(refresh);onCleanup(()=>{abort.abort();clearTimeout(timer)});return <RunTasksBody tasks={()=>state.items} native={()=>state.native} error={()=>state.error} actions={actions} theme={()=>({text:"#ffffff",muted:"#aaaaaa",error:"#ff5555",highlight:"#55ffff"})} onClose={()=>{renderer.destroy();process.exit(0)}}/>}
function Open(){const dialog=useDialog();onMount(()=>dialog.replace(()=><DialogTasks sessionID=${JSON.stringify(run.session.id)}/>));return <box/>}
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
  const snapshot = async (name) => {
    const file = join(runtime.output, "layout.json")
    await rm(file, { force: true })
    await poll(() => Bun.file(file).exists(), "rendered Task geometry")
    const nodes = JSON.parse(await readFile(file, "utf8"))
    const root = nodes.find((node) => node.id === (fullscreen ? "session-task-dialog" : "session-task-mini"))
    assert.ok(
      root && root.width > 0 && root.height > 0 && root.y >= 0 && root.y + root.height <= rows,
      "Task root fits terminal height",
    )
    const output = nodes.find((node) => node.id === "session-task-output")
    assert.ok(output, "Task output viewport is identifiable")
    assert.ok(
      output.height > 0 && output.y >= root.y && output.y + output.height <= root.y + root.height,
      "Task output viewport fits its root",
    )
    const title = nodes.find((node) => node.text?.startsWith("Tasks ·"))
    assert.ok(
      title && title.height > 0 && title.y >= 0 && title.y + title.height <= rows,
      "Task controls remain visible",
    )
    await writeFile(join(runtime.output, `tasks-${name}-layout.json`), JSON.stringify(nodes, null, 2))
    await writeFile(join(runtime.output, `tasks-${name}.txt`), plain())
  }
  await poll(() => plain().includes(`Message UI ${delivery}`) && plain().includes("recent"), "native Task panel", 30000)
  child.terminal.write(fullscreen ? "\x05" : "m")
  await poll(() => plain().includes("Message this Task") && plain().includes("Ctrl+S send message"), "enabled editor")
  child.terminal.write("CORRECTION_UI_中文")
  for (let index = 0; index < ["steer", "queue", "interject"].indexOf(delivery); index++) child.terminal.write("\t")
  await poll(
    () => plain().includes(`Delivery: ${delivery}`) && plain().includes("CORRECTION_UI_中文"),
    "message composition",
  )
  child.terminal.write("\x13")
  await poll(
    () => plain().includes("Accepted; waiting") && plain().includes("Ctrl+N new message"),
    "admitted and idle action",
  )
  assert.equal(run.childCalls(), 1)
  await writeFile(join(runtime.output, "message-admitted.txt"), plain())
  const nodes = JSON.parse(await readFile(join(runtime.output, "layout.json"), "utf8"))
  const editor = nodes.find((node) => node.id === "task-message-editor")
  const actions = nodes.find((node) => node.id === "task-message-actions")
  assert.ok(
    editor && actions && actions.y >= editor.y && actions.y + actions.height <= rows,
    "message actions fit viewport",
  )
  await writeFile(join(runtime.output, "message-admitted-layout.json"), JSON.stringify(nodes, null, 2))
  child.terminal.write("\x1b")
  await poll(() => plain().includes("Tasks ·") && !plain().includes("Message this Task"), "back to task panel")
  child.terminal.write(fullscreen ? "\x05" : "m")
  await poll(() => plain().includes("Accepted; waiting"), "reopened retained receipt")
  if (process.argv.includes("--cancel")) {
    await runtime.api(`/api/session/${run.session.id}/task/${run.task.id}/cancel`, undefined, "POST")
    await poll(() => plain().includes("Cancelled before delivery"), "terminal cancelled receipt")
    run.release()
    assert.equal(run.childCalls(), 1)
  } else {
    await run.settle()
    await poll(
      () => plain().includes("Delivered to child") && plain().includes("does not mean"),
      "passive promoted receipt",
    )
  }
  await writeFile(join(runtime.output, "message-final.txt"), plain())
  console.log(
    JSON.stringify({
      fullscreen,
      cols,
      rows,
      delivery,
      childCalls: run.childCalls(),
      cancelled: process.argv.includes("--cancel"),
      output: runtime.output,
    }),
  )
} catch (error) {
  await writeFile(join(runtime.output, "failure.txt"), plain())
  throw error
} finally {
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "terminal cleanup").catch(() => child.kill("SIGKILL"))
  await fixture.close()
  await writeFile(join(runtime.output, "terminal.raw"), screen.text)
  terminal.dispose()
  console.error(`Task message terminal evidence: ${runtime.output}`)
}

import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startTaskUiFixture } from "./grok-task-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"

const background = process.argv.includes("--background")
const fixture = await startTaskUiFixture({ background })
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
const actions=taskActions(client,()=>${JSON.stringify(fixture.session.id)});
function Mini(){const [state,setState]=createStore({items:[],native:false,error:""});const abort=new AbortController();let timer;const refresh=async()=>{try{const next=await actions.list(abort.signal);if(!abort.signal.aborted){setState("items",reconcile(next.items));setState({native:next.native,error:""})}}catch(error){if(!abort.signal.aborted)setState("error",String(error))}finally{if(!abort.signal.aborted)timer=setTimeout(refresh,1000)}};onMount(refresh);onCleanup(()=>{abort.abort();clearTimeout(timer)});return <RunTasksBody tasks={()=>state.items} native={()=>state.native} error={()=>state.error} actions={actions} theme={()=>({text:"#ffffff",muted:"#aaaaaa",error:"#ff5555",highlight:"#55ffff"})} onClose={()=>{renderer.destroy();process.exit(0)}}/>}
function Open(){const dialog=useDialog();onMount(()=>dialog.replace(()=><DialogTasks sessionID=${JSON.stringify(fixture.session.id)}/>));return <box/>}
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
  await poll(() => plain().includes("Running UI task") && plain().includes("recent"), "native Task panel", 30000)
  assert.equal(fixture.calls.length, before)
  await writeFile(join(runtime.output, "tasks-running.txt"), plain())
  assert.ok((plain().includes("Tasks") && plain().includes("Stop task")) || (!fullscreen && plain().includes("c stop")))
  if (background) {
    assert.ok(plain().includes("Background"), "real background flag is visible")
    assert.ok(plain().includes("recent tasks") && !plain().includes("foreground tasks"), "current manager copy")
    await snapshot("background-running")
  }
  checks.push(background ? "passive-background-label-and-current-copy" : "passive-native-list-and-scoped-count")
  await writeFile(fixture.outage, "409")
  child.terminal.write(fullscreen ? "\x18" : "c")
  await poll(() => plain().includes("worker is still starting"), "safe cancellation conflict")
  assert.ok(!plain().includes("private fixture conflict cause"))
  await poll(
    async () =>
      (await fixture.records()).filter((row) => row.method === "GET" && row.path.endsWith("/task")).length > 3,
    "poll after conflict",
  )
  assert.ok(plain().includes("worker is still starting"), "passive polling retains cancellation feedback")
  assert.equal((await fixture.list())[0].status, "running")
  assert.equal(fixture.calls.length, before)
  await snapshot("conflict")
  checks.push("retryable-conflict-retains-running-and-no-provider")
  await rm(fixture.outage)
  child.terminal.write(fullscreen ? "\x18" : "c")
  await poll(async () => (await fixture.list())[0].status === "cancelled", "joined Task cancellation")
  fixture.hold.resolve()
  await poll(() => plain().includes("cancelled"), "cancelled row")
  child.terminal.write("\x1b[B")
  await poll(() => plain().includes("Interrupted by a server restart"), "restart guidance")
  await snapshot("interrupted")
  assert.ok(
    plain().includes("Tasks") && plain().includes("interrupted") && plain().includes("Review output"),
    "restart guidance and controls fit together",
  )
  child.terminal.write("\x1b[B")
  await poll(() => plain().includes("TASK_OUTPUT_START"), "completed multiline output")
  await snapshot("long-output")
  assert.ok(plain().includes("Tasks") && plain().includes("TASK_OUTPUT_START"), "long output does not displace header")
  checks.push("cancelled-interrupted-and-long-completed-output-visible")
  if (background) {
    assert.equal(fixture.calls.length, before)
    assert.equal(fixture.background.scenario("HOLD").notices, 0)
    checks.push("background-cancel-has-no-parent-wake")
    const selection = { id: fixture.tasks.find((task) => task.status === "completed").id }
    for (const mode of ["IDLE", "ACTIVE", "WAIT"]) {
      const task = await fixture.background.launch(mode)
      await poll(() => plain().includes(`Background UI ${mode}`), `background ${mode} row`)
      const ordered = await fixture.list()
      const distance = fullscreen ? ordered.findIndex((item) => item.id === selection.id) : ordered.length
      assert.ok(distance >= 0, "Previously selected Task is still listed")
      for (let row = 0; row < distance; row++) child.terminal.write("\x1b[A")
      selection.id = task.id
      const count = fixture.calls.length
      const reads = (await fixture.records()).filter(
        (row) => row.method === "GET" && row.path.endsWith(`/task/${task.id}`),
      ).length
      await poll(
        async () =>
          (await fixture.records()).filter((row) => row.method === "GET" && row.path.endsWith(`/task/${task.id}`))
            .length > reads,
        `passive ${mode} detail read`,
      )
      assert.equal(fixture.calls.length, count)
      assert.ok(plain().includes("Background"))
      await snapshot(`background-${mode.toLowerCase()}-running`)
      fixture.background.scenario(mode).child.resolve()
      if (mode === "ACTIVE") {
        await poll(() => plain().includes("UI_RESULT_ACTIVE"), "active-parent terminal receipt")
        assert.equal(fixture.background.scenario(mode).parentCalls, 2)
        assert.equal(fixture.background.scenario(mode).notices, 0)
      }
      await fixture.background.settle(mode)
      await poll(() => plain().includes(`UI_RESULT_${mode}`), `completed ${mode} output`)
      await snapshot(`background-${mode.toLowerCase()}-completed`)
      checks.push(`background-${mode.toLowerCase()}-passive-read-and-final-receipt`)
    }
  }
  const records = await fixture.records()
  assert.ok(
    records
      .filter((row) => row.path.endsWith("/cancel"))
      .every((row) => row.contentLength === null || row.contentLength === "0"),
  )
  assert.ok(!records.some((row) => row.path.includes("/experimental/")))
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
  await writeFile(join(runtime.output, "tasks-final.txt"), plain())
  child?.kill("SIGTERM")
  if (child)
    await deadline(child.exited, 10000, "Task PTY cleanup").catch(async () => {
      child.kill("SIGKILL")
      await child.exited
    })
  child?.terminal?.close()
  await writeFile(join(runtime.output, "tasks.ansi"), screen.text)
  await fixture.close()
  console.error(`Task native TUI evidence: ${runtime.output}`)
}

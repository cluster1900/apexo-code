// Isolated installed-runtime reference only; native product code never invokes Grok.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const scenario = process.argv[2] ?? "omitted"
assert.ok(["omitted", "false", "true"].includes(scenario))
const output = await mkdtemp(join(tmpdir(), "apexo-scheduler-audit-"))
const home = join(output, "home")
const cwd = join(output, "workspace")
await mkdir(home, { recursive: true })
await mkdir(cwd)
const calls = [],
  events = [],
  logs = []
const planned = { aliases: [], args: {}, sent: true }
const runtime = { current: undefined }
const childCalls = []
const provider = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (request.method !== "POST") return response.end(JSON.stringify({ data: [{ id: "fixture" }] }))
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push(body)
  const tool =
    !planned.sent &&
    (body.tools ?? []).map((tool) => tool.function ?? tool).find((tool) => planned.aliases.includes(tool.name))
  if (tool) planned.sent = true
  const user = body.messages?.findLast((message) => message.role === "user")
  if (body.tools?.length && String(user?.content).includes("SCHEDULER_RESTART_FIRE")) childCalls.push(body)
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `monitor_call_${calls.length}`,
            type: "function",
            function: {
              name: tool.name,
              arguments: JSON.stringify(planned.args),
            },
          },
        ],
      }
    : { role: "assistant", content: "MONITOR_ACK" }
  const chunk = (delta, finish_reason = null) => ({
    id: "shell-reference",
    object: "chat.completion.chunk",
    created: 1,
    model: "fixture",
    choices: [{ index: 0, delta, finish_reason }],
  })
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.write(`data: ${JSON.stringify(chunk(delta))}\n\n`)
  response.write(
    `data: ${JSON.stringify({ ...chunk({}, tool ? "tool_calls" : "stop"), usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\n`,
  )
  response.end("data: [DONE]\n\n")
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
await writeFile(
  join(home, "config.toml"),
  `[models]\ndefault = "fixture"\n[model.fixture]\nmodel = "fixture"\nname = "Scheduler comparison"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = false\n[cli]\nuse_leader = false\n`,
)
async function start() {
  const child = spawn(
    process.env.GROK_BIN ?? "grok",
    ["agent", "stdio", "--leader-socket", join(output, "leader.sock")],
    {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: home,
        GROK_HOME: home,
        GROK_CONFIG: "",
        GROK_CONFIG_PATH: "",
        GROK_MEMORY: "0",
        GROK_MANAGED_MCPS_ENABLED: "0",
        XAI_API_KEY: "fixture",
        ...Object.fromEntries(
          ["CONFIG", "DATA", "STATE", "CACHE", "RUNTIME"].map((kind) => [
            kind === "RUNTIME" ? "XDG_RUNTIME_DIR" : `XDG_${kind}_HOME`,
            join(home, `xdg-${kind.toLowerCase()}`),
          ]),
        ),
        ...Object.fromEntries(
          ["CURSOR", "CLAUDE", "CODEX"].flatMap((vendor) =>
            ["MCPS", "RULES", "SKILLS", "AGENTS", "HOOKS"].map((surface) => [`GROK_${vendor}_${surface}_ENABLED`, "0"]),
          ),
        ),
      },
    },
  )
  const exited = new Promise((resolve) => child.once("exit", resolve))
  child.stderr.on("data", (chunk) => logs.push(chunk))
  const connection = new ClientSideConnection(
    () => ({
      async requestPermission(input) {
        return {
          outcome: {
            outcome: "selected",
            optionId: input.options.find((option) => option.kind === "allow_once").optionId,
          },
        }
      },
      async sessionUpdate(params) {
        events.push(params)
      },
      async extNotification(method, params) {
        events.push({ method, params })
      },
    }),
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  )
  const initialized = await deadline(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    30000,
    "initialize",
  )
  assert.ok(initialized.agentCapabilities?.loadSession)
  return { child, exited, connection }
}
async function stop(signal) {
  if (!runtime.current) return
  const current = runtime.current
  runtime.current = undefined
  current.child.kill(signal)
  await deadline(current.exited, 10000, "reference cleanup").catch(async () => {
    current.child.kill("SIGKILL")
    await current.exited
  })
  console.error(JSON.stringify({ cleanup: "reaped", pid: current.child.pid, signal }))
}
const updates = () =>
  events.flatMap((event) => (event.update ? [event.update] : event.params?.update ? [event.params.update] : []))
async function prompt(sessionId, text) {
  return deadline(runtime.current.connection.prompt({ sessionId, prompt: [{ type: "text", text }] }), 25000, text)
}
async function invoke(sessionId, aliases, args) {
  const from = updates().length
  Object.assign(planned, { aliases, args, sent: false })
  await prompt(sessionId, "MONITOR_PARENT controlled tool request")
  assert.ok(planned.sent, `Missing tool ${aliases.join(",")}`)
  const turn = updates().slice(from)
  const call = turn.find((update) => update.sessionUpdate === "tool_call")
  assert.ok(call)
  const result = turn.findLast(
    (update) => update.toolCallId === call.toolCallId && ["completed", "failed"].includes(update.status),
  )
  assert.ok(result)
  return result
}
const results = []
let sessionID = "",
  taskID = ""
try {
  runtime.current = await start()
  sessionID = (await runtime.current.connection.newSession({ cwd, mcpServers: [] })).sessionId
  const created = await invoke(sessionID, ["scheduler_create"], {
    interval: "1m",
    prompt: "SCHEDULER_RESTART_FIRE",
    fire_immediately: false,
    ...(scenario === "omitted" ? {} : { durable: scenario === "true" }),
  })
  assert.equal(created.status, "completed")
  taskID = created.rawOutput?.id
  assert.ok(taskID)
  const persisted = await poll(
    async () => {
      for await (const file of new Bun.Glob("sessions/**/resources_state.json").scan({ cwd: home, absolute: true })) {
        const data = JSON.parse(await readFile(file, "utf8"))
        const task = data.state?.["grok_build.Scheduler"]?.tasks?.find((task) => task.id === taskID)
        if (task) return task
      }
    },
    "schedule persisted before crash",
    10000,
  )
  assert.equal(persisted.durable, scenario === "true")
  results.push({ step: "persisted-before-crash", task: persisted })
  assert.equal(childCalls.length, 0)
  await stop("SIGKILL")
  runtime.current = await start()
  await deadline(
    runtime.current.connection.loadSession({ sessionId: sessionID, cwd, mcpServers: [] }),
    30000,
    "load original Session",
  )
  const listed = await invoke(sessionID, ["scheduler_list"], {})
  assert.equal(listed.status, "completed")
  assert.ok(listed.rawOutput?.tasks?.some((task) => task.id === taskID))
  results.push({ step: "same-session-restored", result: listed.rawOutput })
  await poll(() => childCalls.length > 0, "restored schedule fires at actual 60-second cadence", 75000)
  results.push({ step: "automatic-fire-after-crash", childCalls: childCalls.length })
  const deleted = await invoke(sessionID, ["scheduler_delete"], { id: taskID })
  assert.equal(deleted.rawOutput?.success, true)
  taskID = ""
  const final = await invoke(sessionID, ["scheduler_list"], {})
  assert.deepEqual(final.rawOutput?.tasks, [])
  results.push({ step: "deleted-and-empty" })
  console.log(JSON.stringify({ scenario, output, providerCalls: calls.length, checks: results }))
} finally {
  if (taskID && runtime.current) await invoke(sessionID, ["scheduler_delete"], { id: taskID }).catch(() => {})
  await stop("SIGTERM")
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(output, "observations.json"), JSON.stringify({ scenario, results, calls, events }, null, 2))
  await writeFile(join(output, "stderr.log"), Buffer.concat(logs))
  console.error(JSON.stringify({ evidence: output }))
}

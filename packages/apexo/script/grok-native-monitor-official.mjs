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

const scenario = process.argv[2] ?? "schema"
assert.ok(["schema", "idle", "active", "complete", "cancel", "overload", "stop", "rearm"].includes(scenario))
const output = await mkdtemp(join(tmpdir(), "apexo-monitor-official-"))
const home = join(output, "home")
const cwd = join(output, "workspace")
await mkdir(home, { recursive: true })
await mkdir(cwd)
const calls = [],
  events = [],
  logs = []
const planned = { aliases: [], args: {}, sent: true }
const parentHeld = Promise.withResolvers()
const phase = { active: false, released: false }
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
  if (body.tools?.length && /(?:^|<user_query>\s*)MONITOR_PARENT_ACTIVE/.test(String(user?.content)) && !phase.active) {
    phase.active = true
    await parentHeld.promise
  }
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `monitor_call_${calls.length}`,
            type: "function",
            function: { name: tool.name, arguments: JSON.stringify(planned.args) },
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
  `[models]\ndefault = "fixture"\n[model.fixture]\nmodel = "fixture"\nname = "Monitor comparison"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = false\n[cli]\nuse_leader = false\n`,
)
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
const updates = () =>
  events.flatMap((event) => (event.update ? [event.update] : event.params?.update ? [event.params.update] : []))
async function prompt(sessionId, text) {
  return deadline(connection.prompt({ sessionId, prompt: [{ type: "text", text }] }), 25000, text)
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
try {
  await deadline(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    30000,
    "initialize",
  )
  const session = await connection.newSession({ cwd, mcpServers: [] })
  await prompt(session.sessionId, "MONITOR_CATALOG inspect available tools only")
  const catalog = calls.find((c) => c.tools?.length).tools.map((t) => t.function ?? t)
  const selected = catalog.filter((t) => /monitor|command.*output|kill.*command/i.test(t.name))
  await writeFile(join(output, "catalog.json"), JSON.stringify(selected, null, 2))
  console.log(JSON.stringify({ scenario, catalog: selected, output }))
  if (scenario !== "schema") {
    const command = ["stop", "rearm"].includes(scenario)
      ? "echo $$ > monitor.pid; while [ ! -f event.release ]; do sleep 0.02; done; printf 'AFTER_STOP_EVENT\\n'; while [ ! -f second.release ]; do sleep 0.02; done; printf 'AFTER_USER_EVENT\\n'; while [ ! -f finish.release ]; do sleep 0.02; done"
      : scenario === "overload"
        ? "echo $$ > monitor.pid; while [ ! -f finish.release ]; do printf 'OVERLOAD_EVENT\\n'; sleep 0.005; done"
        : "echo $$ > monitor.pid; while [ ! -f event.release ]; do sleep 0.02; done; printf 'MONITOR_STDOUT 😀\\n'; printf 'MONITOR_STDERR 中文\\n' >&2; while [ ! -f finish.release ]; do sleep 0.02; done; printf 'FINAL_PARTIAL' >&2"
    const started = await invoke(session.sessionId, ["monitor"], {
      command,
      description: "Native Monitor reference",
      persistent: true,
      timeout_ms: 60000,
    })
    await writeFile(join(output, "started.json"), JSON.stringify(started, null, 2))
    const id = started.rawOutput?.taskId ?? started.rawOutput?.task_id
    assert.ok(id, JSON.stringify(started))
    await poll(
      async () => !!(await readFile(join(cwd, "monitor.pid"), "utf8").catch(() => "")),
      "monitor spawned",
      10000,
    )
    const pid = Number((await readFile(join(cwd, "monitor.pid"), "utf8")).trim())
    const active = ["active", "stop", "rearm"].includes(scenario)
      ? prompt(session.sessionId, "MONITOR_PARENT_ACTIVE hold parent")
      : undefined
    if (active) await poll(() => phase.active, "active provider held", 10000)
    if (["stop", "rearm"].includes(scenario)) {
      await connection.cancel({ sessionId: session.sessionId })
      const stopped = await active
      assert.equal(stopped.stopReason, "cancelled")
      parentHeld.resolve()
    }
    const baseline = calls.length
    if (scenario === "cancel") await invoke(session.sessionId, ["kill_command_or_subagent"], { task_id: id })
    await writeFile(join(cwd, "event.release"), "event")
    if (scenario === "complete") await writeFile(join(cwd, "finish.release"), "finish")
    if (scenario === "overload")
      await poll(() => JSON.stringify(events).includes("Monitor stopped"), "overload warning", 45000)
    else await new Promise((r) => setTimeout(r, 1200))
    const whileHeld = calls.slice(baseline).filter((c) => c.tools?.length).length
    parentHeld.resolve()
    if (active) await active
    await new Promise((r) => setTimeout(r, 1200))
    let alive = true
    try {
      process.kill(pid, 0)
    } catch {
      alive = false
    }
    const stoppedTurns = calls.slice(baseline).filter((c) => c.tools?.length).length
    if (scenario === "rearm") {
      await prompt(session.sessionId, "MONITOR_REAL_USER continue watching")
      await writeFile(join(cwd, "second.release"), "second")
      await new Promise((r) => setTimeout(r, 1200))
    }
    const after = calls.slice(baseline)
    const observed = {
      scenario,
      id,
      stoppedTurns,
      pidAlive: alive,
      whileHeld,
      modelTurns: after.filter((c) => c.tools?.length).length,
      providerCalls: calls.length,
      eventUpdates: events.filter((e) => e.method?.includes("monitor") || e.update?.sessionUpdate === "monitor_event"),
      after,
    }
    await writeFile(join(output, "observations.json"), JSON.stringify(observed, null, 2))
    console.log(JSON.stringify({ ...observed, after: undefined, eventUpdates: observed.eventUpdates.length, output }))
  }
} finally {
  parentHeld.resolve()
  await writeFile(join(cwd, "event.release"), "cleanup")
  await writeFile(join(cwd, "finish.release"), "cleanup")
  await writeFile(join(cwd, "second.release"), "cleanup")
  child.kill("SIGTERM")
  await deadline(exited, 10000, "shutdown").catch(async () => {
    child.kill("SIGKILL")
    await exited
  })
  provider.closeAllConnections()
  await new Promise((r) => provider.close(r))
  await writeFile(join(output, "comparison.json"), JSON.stringify({ calls, events }, null, 2))
  await writeFile(join(output, "stderr.log"), Buffer.concat(logs))
  console.log(JSON.stringify({ output, cleanup: "installed child reaped; provider closed" }))
}

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

const scenario = process.argv[2] ?? "contract"
assert.ok(["contract", "delete", "stop"].includes(scenario))
const output = await mkdtemp(join(tmpdir(), "apexo-scheduler-audit-"))
const home = join(output, "home")
const cwd = join(output, "workspace")
await mkdir(home, { recursive: true })
await mkdir(cwd)
const calls = [],
  events = [],
  logs = []
const planned = { aliases: [], args: {}, sent: true }
const parentHeld = Promise.withResolvers()
const phase = {
  active: false,
  released: false,
  child: false,
  childClosed: false,
}
const childHeld = Promise.withResolvers()
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
  if (
    body.tools?.length &&
    /(?:^|<user_query>\s*)SCHEDULER_PARENT_ACTIVE/.test(String(user?.content)) &&
    !phase.active
  ) {
    phase.active = true
    await parentHeld.promise
  }
  if (body.tools?.length && String(user?.content).includes("SCHEDULER_FIRE_MARKER")) {
    phase.child = true
    response.on("close", () => {
      phase.childClosed = true
    })
    await childHeld.promise
  }
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
const results = []
let sessionID = "",
  taskID = ""
try {
  await deadline(
    connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    }),
    30000,
    "initialize",
  )
  sessionID = (await connection.newSession({ cwd, mcpServers: [] })).sessionId
  await prompt(sessionID, "SCHEDULER_CATALOG inspect only")
  const catalog = calls
    .find((c) => c.tools?.length)
    .tools.map((t) => t.function ?? t)
    .filter((t) => /scheduler/.test(t.name))
  await writeFile(join(output, "catalog.json"), JSON.stringify(catalog, null, 2))
  const create = await invoke(sessionID, ["scheduler_create"], {
    interval: scenario === "contract" ? "1s" : "1h",
    prompt: scenario === "contract" ? "CONTRACT_ONLY" : "SCHEDULER_FIRE_MARKER",
    fire_immediately: scenario !== "contract",
    durable: true,
  })
  results.push({ step: "create", result: create })
  taskID = create.rawOutput?.id
  assert.ok(taskID, JSON.stringify(create))
  if (scenario === "contract") {
    results.push({
      step: "list",
      result: await invoke(sessionID, ["scheduler_list"], {}),
    })
    results.push({
      step: "update",
      result: await invoke(sessionID, ["scheduler_create"], {
        task_id: taskID,
        prompt: "UPDATED",
        fire_immediately: true,
      }),
    })
    results.push({
      step: "updated-list",
      result: await invoke(sessionID, ["scheduler_list"], {}),
    })
  } else {
    await poll(() => phase.child, "scheduled child reached local provider", 10000)
    if (scenario === "stop") {
      const active = prompt(sessionID, "SCHEDULER_PARENT_ACTIVE hold parent")
      await poll(() => phase.active, "parent held", 10000)
      await connection.cancel({ sessionId: sessionID })
      results.push({ step: "stop", result: await active })
      parentHeld.resolve()
    } else {
      results.push({
        step: "delete-held",
        result: await invoke(sessionID, ["scheduler_delete"], { id: taskID }),
      })
      results.push({ step: "child-before-release", closed: phase.childClosed })
      taskID = ""
    }
    const before = calls.length
    childHeld.resolve()
    await new Promise((r) => setTimeout(r, 1800))
    results.push({
      step: "after-release",
      calls: calls.slice(before).map((c) => ({ tools: c.tools?.length ?? 0, messages: c.messages })),
      childClosed: phase.childClosed,
    })
  }
  if (taskID) {
    results.push({
      step: "delete",
      result: await invoke(sessionID, ["scheduler_delete"], { id: taskID }),
    })
    taskID = ""
  }
  results.push({
    step: "final-list",
    result: await invoke(sessionID, ["scheduler_list"], {}),
  })
  if (scenario === "contract")
    results.push({
      step: "one-shot",
      result: await invoke(sessionID, ["scheduler_create"], {
        interval: "1h",
        prompt: "ONE_SHOT",
        recurring: false,
      }),
    })
  console.log(JSON.stringify({ scenario, output, providerCalls: calls.length, results }))
} finally {
  childHeld.resolve()
  parentHeld.resolve()
  if (taskID) await invoke(sessionID, ["scheduler_delete"], { id: taskID }).catch(() => {})
  await writeFile(join(output, "observations.json"), JSON.stringify({ scenario, results, calls, events }, null, 2))
  child.kill("SIGTERM")
  await deadline(exited, 10000, "reference cleanup").catch(async () => {
    child.kill("SIGKILL")
    await exited
  })
  provider.closeAllConnections()
  await new Promise((r) => provider.close(r))
  await writeFile(join(output, "stderr.log"), Buffer.concat(logs))
  console.error(JSON.stringify({ cleanup: "reaped", pid: child.pid, output }))
}

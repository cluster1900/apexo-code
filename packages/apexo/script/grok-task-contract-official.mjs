// Installed Grok ACP comparison. Record only task tool inputs/results, never setup/config events.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const directory = await mkdtemp(join(tmpdir(), "apexo-task-contract-official-"))
const planned = { tool: "", args: {}, sent: false }
const providerCalls = []
const provider = createServer(async (request, response) => {
  if (request.method !== "POST") {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify({ object: "list", data: [{ id: "fixture", object: "model", created: 1, owned_by: "fixture" }] }),
    )
    return
  }
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  const tools = body.tools?.map((tool) => tool.function ?? tool) ?? []
  const aliases =
    planned.tool === "run_terminal_cmd"
      ? ["run_terminal_cmd", "run_terminal_command"]
      : planned.tool === "get_task_output"
        ? ["get_task_output", "get_command_or_subagent_output"]
        : [planned.tool, "wait_commands_or_subagents"]
  const tool = !planned.sent && tools.find((item) => aliases.includes(item.name))
  providerCalls.push({ tool: tool?.name, names: tools.map((item) => item.name) })
  if (tool) planned.sent = true
  const id = `contract_${providerCalls.length}`
  response.writeHead(200, { "content-type": "text/event-stream" })
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          { index: 0, id, type: "function", function: { name: tool.name, arguments: JSON.stringify(planned.args) } },
        ],
      }
    : { role: "assistant", content: "CONTRACT_ACK" }
  const events = [
    { id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: null }] },
    {
      id,
      object: "chat.completion.chunk",
      model: body.model,
      choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    },
  ]
  response.end(
    events.map((event) => `data: ${JSON.stringify({ created: 1, ...event })}\n\n`).join("") + "data: [DONE]\n\n",
  )
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
await mkdir(join(directory, "grok-home"))
await writeFile(
  join(directory, "grok-home/config.toml"),
  `[models]\ndefault = "task-contract"\n[model.task-contract]\nmodel = "fixture"\nname = "Task contract fixture"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "local-fixture-key"\napi_backend = "chat_completions"\ncontext_window = 100000\n`,
)
const child = spawn("bun", ["run", "src/index.ts", "acp", "--backend", "grok-build", "--cwd", directory], {
  cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  env: {
    ...process.env,
    GROK_MAX_WAIT_BLOCK_MS: "80",
    GROK_HOME: join(directory, "grok-home"),
    GROK_CONFIG: "",
    GROK_CONFIG_PATH: "",
    XAI_API_KEY: "local-fixture-key",
  },
  stdio: ["pipe", "pipe", "pipe"],
})
const exited = new Promise((resolve) => child.once("exit", resolve))
const stderr = []
const events = []
const results = []
const state = { sessionID: "", taskID: "", pid: 0 }
child.stderr.on("data", (data) => stderr.push(data))
function record(update) {
  if (!["tool_call", "tool_call_update"].includes(update.sessionUpdate)) return
  events.push({
    type: update.sessionUpdate,
    id: update.toolCallId,
    title: update.title,
    status: update.status,
    input: update.rawInput,
    output: update.rawOutput,
    content: Array.isArray(update.content)
      ? update.content
          .filter((item) => item.type === "content" && item.content?.type === "text")
          .map((item) => item.content.text)
      : undefined,
    time: Date.now(),
  })
}
const connection = new ClientSideConnection(
  () => ({
    async requestPermission(params) {
      const option = params.options.find((option) => option.kind === "allow_once")
      assert.ok(option)
      return { outcome: { outcome: "selected", optionId: option.optionId } }
    },
    async sessionUpdate(params) {
      record(params.update)
    },
    async extNotification(method, params) {
      if (method === "_x.ai/session_notification" && params.update) record(params.update)
    },
  }),
  ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
)
async function prompt(text) {
  const before = events.length
  const result = await deadline(
    connection.prompt({ sessionId: state.sessionID, prompt: [{ type: "text", text }] }),
    60_000,
    "official task contract turn",
  )
  assert.equal(result.stopReason, "end_turn")
  return events.slice(before)
}
async function query(label, args, check, name = "get_task_output") {
  Object.assign(planned, { tool: name, args, sent: false })
  const turn = await prompt(
    `This is an explicit compatibility test of the installed runtime. Call get_task_output (or its older name get_command_or_subagent_output) EXACTLY ONCE with precisely this raw JSON: ${JSON.stringify(args)}. Preserve the key names, scalar/array types, whitespace, duplicates and empty strings; these are the subject of the test. Even if validation fails, do not repair, retry, call another tool, or cancel the running task. End your turn after the one result.`,
  )
  const call = turn.find((event) => event.type === "tool_call")
  assert.ok(call, `No official tool call for ${label}`)
  assert.deepEqual(call.input, args, `Model changed the test input for ${label}`)
  assert.equal(new Set(turn.filter((event) => event.type === "tool_call").map((event) => event.id)).size, 1)
  const result = turn.findLast((event) => event.id === call.id && ["completed", "failed"].includes(event.status))
  assert.ok(result, `Missing final result for ${label}`)
  check(result, call)
  results.push({ label, input: call.input, result, elapsed: result.time - call.time })
}
try {
  await connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
  state.sessionID = (await connection.newSession({ cwd: directory, mcpServers: [] })).sessionId
  Object.assign(planned, {
    tool: "run_terminal_cmd",
    sent: false,
    args: {
      command: "printf OFFICIAL_TASK_CONTRACT; echo $$ > task.pid; while [ ! -f task.release ]; do sleep 0.1; done",
      description: "Start background task contract process",
      block_until_ms: 0,
    },
  })
  await prompt(
    "Run exactly one background terminal command: printf OFFICIAL_TASK_CONTRACT; echo $$ > task.pid; while [ ! -f task.release ]; do sleep 0.1; done. Use background=true or block_until_ms=0, whichever your tool supports. End this turn immediately after it starts. Do not poll, read files, spawn agents, or run another command. The test client will manage cleanup.",
  )
  state.pid = await poll(
    async () => Number(await readFile(join(directory, "task.pid"), "utf8").catch(() => "")),
    "official background PID",
  )
  const listed = await connection.extMethod("_x.ai/task/list", { sessionId: state.sessionID })
  const task = listed.result?.tasks?.find((item) => item.is_backgrounded && !item.completed)
  assert.ok(task, "Missing background task snapshot")
  state.taskID = task.task_id
  const running = (result) => {
    const output = JSON.stringify(result.output ?? result.content)
    assert.equal(result.status, "completed")
    assert.ok(output.includes("OFFICIAL_TASK_CONTRACT"), output)
    assert.ok(output.includes("running"), output)
    assert.equal(result.output.Result.task_id, state.taskID)
    process.kill(state.pid, 0)
  }
  await query(
    "trim-and-deduplicate",
    { task_ids: [` ${state.taskID} `, state.taskID, "", " "], timeout_ms: 0 },
    running,
  )
  await query("scalar-alias", { task_id: ` ${state.taskID} `, timeout_ms: 0 }, running)
  await query("scalar-canonical", { task_ids: ` ${state.taskID} `, timeout_ms: null }, running)
  await query("deduplicate-before-limit", { task_ids: Array(21).fill(` ${state.taskID} `), timeout_ms: 0 }, running)
  await query("numeric-id", { task_id: 228, timeout_ms: 0 }, (result) => {
    const text = JSON.stringify(result.output ?? result.content)
    assert.ok(/not found|not_found/i.test(text), text)
    assert.ok(text.includes("228"))
  })
  await query(
    "twenty-one-unique",
    { task_ids: Array.from({ length: 21 }, (_, index) => `missing-${index}`), timeout_ms: 0 },
    (result) => {
      assert.match(JSON.stringify(result.output ?? result.content), /maximum of 20|exceeds.*20/i)
    },
  )
  await query(
    "twenty-unique",
    { task_ids: Array.from({ length: 20 }, (_, index) => `missing-${index}`), timeout_ms: 0 },
    (result) => {
      // 1.0.52 aggregates all-missing IDs into TaskNotFound; newer source returns MultiResult.
      const output = JSON.stringify(result.output)
      assert.match(output, /not found|not_found/i)
      assert.ok(Array.from({ length: 20 }, (_, index) => `missing-${index}`).every((id) => output.includes(id)))
      assert.ok(!output.includes("exceeds maximum"))
    },
  )
  for (const [label, args] of [
    ["empty-list", { task_ids: [] }],
    ["null-list", { task_ids: null }],
    ["blank-ids", { task_ids: ["", " "] }],
    ["duplicate-fields", { task_ids: [state.taskID], task_id: state.taskID }],
    ["invalid-shape", { task_ids: true }],
  ]) {
    await query(label, args, (result) => {
      assert.equal(result.status, "failed")
      assert.ok(!JSON.stringify(result.output ?? result.content ?? "").includes("OFFICIAL_TASK_CONTRACT"))
    })
  }
  await query("host-wait-cap", { task_ids: [state.taskID], timeout_ms: 10_000 }, (result, call) => {
    running(result)
    assert.ok(
      result.time - call.time >= 60 && result.time - call.time < 3000,
      `Official host cap took ${result.time - call.time}ms`,
    )
  })
  console.log(JSON.stringify({ result: "pass", directory, cases: results.length, hostWaitMs: 80 }))
} finally {
  if (state.taskID)
    await connection.extMethod("_x.ai/task/kill", { sessionId: state.sessionID, taskId: state.taskID }).catch(() => {})
  await writeFile(join(directory, "task.release"), "cleanup")
  if (state.sessionID) await connection.cancel({ sessionId: state.sessionID }).catch(() => {})
  child.kill("SIGTERM")
  await deadline(exited, 10_000, "official cleanup").catch(() => child.kill("SIGKILL"))
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(directory, "task-contract.json"), JSON.stringify({ results, events, providerCalls }, null, 2))
  await writeFile(join(directory, "stderr.log"), Buffer.concat(stderr))
  console.error(`Official task contract evidence: ${directory}`)
}

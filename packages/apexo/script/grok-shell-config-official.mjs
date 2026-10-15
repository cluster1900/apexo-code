// Installed Grok ACP Shell host configuration comparison; exclude setup/config events.
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

const directory = await mkdtemp(join(tmpdir(), "apexo-shell-config-official-"))
const planned = { tool: "", args: {}, sent: false }
const providerCalls = []
const schemas = []
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
  schemas.push(...tools.filter((item) => ["run_terminal_cmd", "run_terminal_command"].includes(item.name)))
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
  `[toolset.bash]\ndefault_block_until_ms = 40\nmax_timeout_secs = 0.08\n[models]\ndefault = "task-contract"\n[model.task-contract]\nmodel = "fixture"\nname = "Task contract fixture"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "local-fixture-key"\napi_backend = "chat_completions"\ncontext_window = 100000\n`,
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

try {
  await connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
  state.sessionID = (await connection.newSession({ cwd: directory, mcpServers: [] })).sessionId
  for (const [index, input] of [undefined, 10000, 0].entries()) {
    Object.assign(planned, {
      tool: "run_terminal_cmd",
      sent: false,
      args: {
        command: `echo $$ > host-${index}.pid; printf OFFICIAL_HOST_STARTED; while [ ! -f host-${index}.release ]; do sleep 0.05; done; printf OFFICIAL_HOST_FINISHED`,
        description: "Verify host Shell foreground limits without killing background commands",
        ...(input === undefined ? {} : { block_until_ms: input }),
      },
    })
    const turn = await prompt(
      "Execute the configured Shell compatibility scenario exactly once, then end the turn. Do not poll or cancel; the test client controls the background command.",
    )
    const call = turn.find((event) => event.type === "tool_call")
    assert.ok(call)
    assert.deepEqual(call.input, planned.args)
    const result = turn.findLast((event) => event.id === call.id && ["completed", "failed"].includes(event.status))
    assert.equal(result?.status, "completed", JSON.stringify(result))
    const elapsed = result.time - call.time
    const expected = input === undefined ? 40 : input === 0 ? 0 : 80
    assert.ok(
      elapsed >= expected - 10 && elapsed < 3000,
      `Official configured wait: ${elapsed}ms, expected ${expected}ms`,
    )
    state.pid = await poll(
      async () => Number(await readFile(join(directory, `host-${index}.pid`), "utf8").catch(() => "")),
      "official host shell PID",
    )
    await new Promise((resolve) => setTimeout(resolve, 400))
    process.kill(state.pid, 0)
    const listed = await connection.extMethod("_x.ai/task/list", { sessionId: state.sessionID })
    const task = listed.result?.tasks?.find((item) => item.is_backgrounded && !item.completed)
    assert.ok(task, JSON.stringify(listed))
    const schema = schemas.at(-1)?.parameters?.properties?.block_until_ms
    assert.ok(schema, "Installed runtime must expose the current wait contract")
    assert.match(schema.description, /default(?:s to| is) 40(?:ms| \(0\.04 seconds\))/i)
    assert.equal(schema.maximum, 80)
    results.push({ input, expected, elapsed, schema, survived: true })
    await writeFile(join(directory, `host-${index}.release`), "release")
    await poll(async () => {
      const latest = await connection.extMethod("_x.ai/task/list", { sessionId: state.sessionID })
      return !latest.result?.tasks?.some((item) => item.task_id === task.task_id && !item.completed)
    }, "official completion")
  }
  console.log(JSON.stringify({ result: "pass", cases: results.length, results, directory }))
} finally {
  await Promise.all([0, 1, 2].map((index) => writeFile(join(directory, `host-${index}.release`), "cleanup")))
  if (state.sessionID) await connection.cancel({ sessionId: state.sessionID }).catch(() => {})
  child.kill("SIGTERM")
  await deadline(exited, 10000, "official cleanup").catch(() => child.kill("SIGKILL"))
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(directory, "results.json"), JSON.stringify({ results, schemas, events }, null, 2))
  await writeFile(join(directory, "stderr.log"), Buffer.concat(stderr))
  console.error(`Official Shell host evidence: ${directory}`)
}

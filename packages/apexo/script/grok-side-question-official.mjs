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

const directory = await mkdtemp(join(tmpdir(), "apexo-btw-official-"))
const planned = { tool: "", args: {}, sent: false }
const providerCalls = []
const captured = []
const updates = []
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
  captured.push(body)
  const tools = body.tools?.map((tool) => tool.function ?? tool) ?? []
  const aliases =
    planned.tool === "run_terminal_cmd"
      ? ["run_terminal_cmd", "run_terminal_command"]
      : planned.tool === "get_task_output"
        ? ["get_task_output", "get_command_or_subagent_output"]
        : [planned.tool]
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
await mkdir(join(directory, "host-home"))
await writeFile(
  join(directory, "grok-home/config.toml"),
  `[models]\ndefault = "task-contract"\n[model.task-contract]\nmodel = "fixture"\nname = "Side question fixture"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "local-fixture-key"\napi_backend = "chat_completions"\ncontext_window = 100000\n`,
)
const child = spawn("grok", ["--cwd", directory, "agent", "--xai-api-base-url", `http://127.0.0.1:${provider.address().port}/v1`, "--no-leader", "stdio"], {
  cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  env: {
    ...process.env,
    HOME: join(directory, "host-home"),
    APEXO_TEST_HOME: join(directory, "host-home"),
    XDG_CONFIG_HOME: join(directory, "host-home", "config"),
    XDG_DATA_HOME: join(directory, "host-home", "data"),
    XDG_CACHE_HOME: join(directory, "host-home", "cache"),
    XDG_STATE_HOME: join(directory, "host-home", "state"),
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
const commands = []
const results = []
const state = { sessionID: "", taskID: "", pid: 0 }
child.stderr.on("data", (data) => stderr.push(data))
function record(update) {
  updates.push(update.sessionUpdate)
  if (update.sessionUpdate === "available_commands_update")
    commands.push(...update.availableCommands.map((command) => command.name))
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
  await prompt("OFFICIAL_MAIN_CONTEXT fruit is apricot")
  const before = updates.length
  const answer = await deadline(
    connection.extMethod("_x.ai/btw", { sessionId: state.sessionID, question: "OFFICIAL_SIDE_QUESTION what fruit?" }),
    30000,
    "official side question",
  )
  assert.equal((answer.result ?? answer).answer, "CONTRACT_ACK")
  const request = captured.find((body) => JSON.stringify(body.messages?.at(-1)).includes("OFFICIAL_SIDE_QUESTION"))
  assert.ok(JSON.stringify(request).includes("apricot"))
  results.push("side answer inherits main context")
  assert.ok(!updates.slice(before).includes("agent_message_chunk"))
  results.push("side answer returned separately from main ACP output")
  const image = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg=="
  const imageAnswer = await deadline(
    connection.extMethod("_x.ai/btw", {
      sessionId: state.sessionID,
      question: "OFFICIAL_SIDE_IMAGE",
      content: [{ type: "image", mimeType: "image/png", data: image }],
    }),
    30000,
    "official side image",
  )
  assert.equal((imageAnswer.result ?? imageAnswer).answer, "CONTRACT_ACK")
  const imageRequest = captured.findLast((body) => JSON.stringify(body.messages?.at(-1)).includes("OFFICIAL_SIDE_IMAGE"))
  assert.ok(imageRequest, "side image request was not observed")
  assert.ok(JSON.stringify(imageRequest).includes("image_url"), "normalized image content missing from correlated request")
  results.push("inline side image reaches provider")
  console.log(
    JSON.stringify(
      {
        result: "pass",
        installed: "Grok",
        scenarios: results,
        providerCalls: providerCalls.length,
        advertisedSideTools: request.tools?.length ?? 0,
      },
      null,
      2,
    ),
  )
} finally {
  if (state.sessionID) await connection.cancel({ sessionId: state.sessionID }).catch(() => {})
  child.kill("SIGTERM")
  await deadline(exited, 10000, "official cleanup").catch(() => child.kill("SIGKILL"))
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(directory, "side-question.json"), JSON.stringify({ results, updates, providerCalls }, null, 2))
  await writeFile(join(directory, "provider-requests.json"), JSON.stringify(captured, null, 2))
  await writeFile(join(directory, "stderr.log"), Buffer.concat(stderr))
  console.error(`Official side question evidence: ${directory}`)
}

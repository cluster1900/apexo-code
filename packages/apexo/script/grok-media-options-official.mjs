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

const directory = await mkdtemp(join(tmpdir(), "apexo-media-official-"))
const planned = { tool: "", args: {}, sent: false }
const providerCalls = []
const mediaCalls = []
let failDownload = false
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"
const provider = createServer(async (request, response) => {
  if (request.url.startsWith("/fixture/")) {
    mediaCalls.push({ path: request.url, authorization: request.headers.authorization })
    response.statusCode = failDownload ? 403 : 200
    response.end(failDownload ? "storage unavailable" : "fixture-mp4")
    return
  }
  if (request.url.includes("/videos/")) {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    mediaCalls.push({
      path: request.url,
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined,
    })
    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify(
        request.method === "POST"
          ? { request_id: "fixture-video" }
          : { status: "done", video: { url: "https://unused.invalid/video.mp4" } },
      ),
    )
    return
  }
  if (request.url.includes("/images/")) {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    mediaCalls.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString()) })
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ data: [{ b64_json: png }] }))
    return
  }
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
await writeFile(
  join(directory, "grok-home/config.toml"),
  `[features]\nimage_gen_model_override = "configured-generation"\nimage_edit_model_override = "configured-edit"\n[tools]\ndisable_zdr_incompatible_tools = true\n[tools.zdr_video_output_s3]\nbucket = "fixture"\nendpoint = "http://127.0.0.1:${provider.address().port}"\nregion = "us-east-1"\n[tools.zdr_video_output_s3.read_write]\naccess_key_id = "writer"\nsecret_access_key = "fixture-secret"\n[tools.zdr_video_output_s3.read_only]\naccess_key_id = "reader"\nsecret_access_key = "reader-secret"\n[endpoints]\nxai_api_base_url = "http://127.0.0.1:${provider.address().port}/v1"\n[models]\ndefault = "task-contract"\n[model.task-contract]\nmodel = "fixture"\nname = "Task contract fixture"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "local-fixture-key"\napi_backend = "chat_completions"\ncontext_window = 100000\n`,
)
const child = spawn(process.env.APEXO_GROK_BUILD_BIN ?? "grok", ["agent", "stdio"], {
  cwd: directory,
  env: {
    ...process.env,
    HOME: directory,
    XDG_CONFIG_HOME: join(directory, "xdg-config"),
    XDG_DATA_HOME: join(directory, "xdg-data"),
    XDG_STATE_HOME: join(directory, "xdg-state"),
    XDG_CACHE_HOME: join(directory, "xdg-cache"),
    XDG_RUNTIME_DIR: join(directory, "xdg-runtime"),
    GROK_MEMORY: "0",
    GROK_IMAGE_GEN_MODEL_OVERRIDE: "environment-generation",
    GROK_IMAGE_EDIT_MODEL_OVERRIDE: "",
    GROK_MANAGED_MCPS_ENABLED: "0",
    ...Object.fromEntries(
      ["CURSOR", "CLAUDE", "CODEX"].flatMap((vendor) =>
        ["MCPS", "RULES", "SKILLS", "AGENTS", "HOOKS"].map((surface) => [`GROK_${vendor}_${surface}_ENABLED`, "0"]),
      ),
    ),
    APEXO_TEST_HOME: directory,
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
  for (const [tool, args] of [
    ["image_gen", { prompt: "blue square" }],
    ["image_edit", { prompt: "make blue", image: [`data:image/png;base64,${png}`] }],
  ]) {
    Object.assign(planned, { tool, args, sent: false })
    const turn = await prompt(`Execute ${tool} for this deterministic media protocol test`)
    assert.ok(planned.sent, `${tool} not advertised: ${JSON.stringify(providerCalls.at(-1)?.names)}`)
    assert.ok(
      turn.some((event) => event.status === "completed"),
      JSON.stringify(turn),
    )
    results.push({ tool, turn })
  }
  Object.assign(planned, {
    tool: "image_to_video",
    args: { image: `data:image/png;base64,${png}`, prompt: "rotate", duration: 6 },
    sent: false,
  })
  const video = await prompt("Execute image_to_video for deterministic S3 protocol test")
  assert.ok(planned.sent, "image_to_video not advertised")
  assert.ok(
    video.some((event) => event.status === "completed"),
    JSON.stringify(video),
  )
  results.push({ tool: "image_to_video S3", turn: video })
  Object.assign(planned, {
    tool: "reference_to_video",
    args: {
      prompt: "rotate reference",
      aspect_ratio: "16:9",
      images: [`data:image/png;base64,${png}`],
      first_frame: `data:image/png;base64,${png}`,
      keyframes: [{ image: `data:image/png;base64,${png}`, timestamp_s: 3 }],
      duration: 6,
    },
    sent: false,
  })
  const reference = await prompt("Execute reference_to_video for deterministic S3 protocol test")
  assert.ok(planned.sent, "reference_to_video not advertised")
  assert.ok(
    reference.some((event) => event.status === "completed"),
    JSON.stringify(reference),
  )
  results.push({ tool: "reference_to_video S3", turn: reference })
  assert.ok(
    mediaCalls.some((call) => call.body?.output?.upload_url),
    JSON.stringify(mediaCalls),
  )
  assert.ok(
    mediaCalls.some((call) => call.path.startsWith("/fixture/") && !call.authorization),
    JSON.stringify(mediaCalls),
  )
  assert.equal(
    mediaCalls.find((call) => call.path.endsWith("/images/generations"))?.body.model,
    "environment-generation",
  )
  assert.equal(mediaCalls.find((call) => call.path.endsWith("/images/edits"))?.body.model, "configured-edit")
  assert.ok(
    mediaCalls
      .filter((call) => call.path.startsWith("/fixture/"))
      .every((call) =>
        new URL(call.path, "http://fixture").searchParams.get("X-Amz-Credential")?.startsWith("reader/"),
      ),
  )
  failDownload = true
  Object.assign(planned, { tool: "image_to_video", args: { image: `data:image/png;base64,${png}` }, sent: false })
  const failed = await prompt("Execute image_to_video and report the storage download failure")
  assert.ok(planned.sent)
  assert.ok(
    failed.some((event) => event.status === "failed"),
    JSON.stringify(failed),
  )
  results.push({ tool: "S3 minted GET failure remains failure", turn: failed })
  assert.ok(mediaCalls[1].body.image)
  assert.equal(mediaCalls[1].body.resolution, "1k")
  console.log(
    JSON.stringify({
      result: "pass",
      installed: "Grok",
      commandAdvertisement: {
        imagine: commands.includes("imagine"),
        "imagine-video": commands.includes("imagine-video"),
      },
      scenarios: results.map((result) => result.tool),
      mediaCalls,
    }),
  )
} finally {
  if (state.sessionID) await connection.cancel({ sessionId: state.sessionID }).catch(() => {})
  child.kill("SIGTERM")
  await deadline(exited, 10000, "official cleanup").catch(() => child.kill("SIGKILL"))
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(
    join(directory, "media.json"),
    JSON.stringify({ results, events, providerCalls, mediaCalls }, null, 2),
  )
  await writeFile(join(directory, "stderr.log"), Buffer.concat(stderr))
  console.error(`Official media evidence: ${directory}`)
}

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
import { prepareReferenceIsolation } from "./grok-reference-isolation.mjs"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const directory = await mkdtemp(join(tmpdir(), "apexo-feedback-official-"))
const planned = { tool: "", args: {}, sent: false }
const providerCalls = []
const submissions = []
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
  if (request.url.endsWith("/feedback")) {
    submissions.push(body)
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ feedbackId: "local-fixture", createdAt: "2026-10-15T00:00:00Z" }))
    return
  }
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
  `[models]\ndefault = "task-contract"\n[model.task-contract]\nmodel = "fixture"\nname = "Feedback fixture"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "local-fixture-key"\napi_backend = "chat_completions"\ncontext_window = 100000\n[features]\nfeedback=true\n[memory]\nenabled=false\n[cli]\nuse_leader=false\n[endpoints]\nfeedback_base_url="http://127.0.0.1:${provider.address().port}/v1"\ndeployment_key="local-fixture"\n`,
)
const isolation = await prepareReferenceIsolation({
  output: directory,
  home: join(directory, "grok-home"),
  cwd: directory,
  port: provider.address().port,
  extraEnv: {
    GROK_FEEDBACK_ENABLED: "true",
    GROK_FEEDBACK_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
    GROK_MEMORY: "0",
    GROK_TITLE_REFRESH: "0",
    GROK_TURN_SUMMARY: "0",
  },
})
const child = isolation.start(["agent", "stdio", "--leader-socket", join(directory, "leader.sock")])
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
  const draftFiles = async () =>
    Array.fromAsync(new Bun.Glob("**/feedback_drafts.json").scan({ cwd: directory, absolute: true, dot: true }))
  Object.assign(planned, {
    tool: "send_feedback",
    args: {
      title: "Local fixture",
      details: "What happened:\nFixture response\n\nRepro:\nRun fixture",
      type: "bug",
      task_category: "debug",
    },
    sent: false,
  })
  const create = await prompt("Save feedback locally using send_feedback")
  assert.ok(planned.sent, "send_feedback not advertised")
  assert.ok(
    create.some((event) => event.status === "completed"),
    JSON.stringify(create),
  )
  const files = await draftFiles()
  assert.equal(files.length, 1, JSON.stringify(files))
  const read = async () => JSON.parse(await readFile(files[0], "utf8")).drafts
  const first = await read()
  assert.equal(first.length, 1)
  assert.equal(first[0].revision, 1)
  results.push("local draft persisted")
  const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"
  const image = { data, mimeType: "image/png", fileName: "local.png" }
  const method = "_x.ai/feedback"
  const attempt = async (name, edited_body, extra = {}) => {
    const before = submissions.length
    const result = await deadline(
      connection.extMethod(method, { session_id: state.sessionID, draft_id: first[0].id, edited_body, ...extra }).then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, code: error.code, message: error.message, data: error.data }),
      ),
      30000,
      name,
    )
    results.push({ name, result, submissions: submissions.length - before })
    return result
  }
  const body = { title: "Image-only reviewed draft", details: "", type: "bug", images: [image] }
  const top = await attempt("top-level images rejected", body, { images: [image] })
  assert.equal(top.ok, false)
  const count = await attempt("five images rejected", { ...body, images: Array(5).fill(image) })
  assert.equal(count.ok, false)
  const webp = await attempt("WebP rejected", { ...body, images: [{ ...image, mimeType: "image/webp" }] })
  assert.equal(webp.ok, false)
  const accepted = await attempt("reviewed image-only body", body)
  assert.equal(accepted.ok, true, JSON.stringify(accepted))
  assert.equal(submissions.length, 1, JSON.stringify(results))
  assert.deepEqual(submissions[0].images, [image])
  assert.deepEqual(await read(), [])
  results.push("exact image bytes reach only isolated local feedback endpoint; submitted draft cleaned up")

  console.log(
    JSON.stringify({ result: "pass", installed: "Grok", scenarios: results, providerCalls: providerCalls.length }),
  )
} finally {
  if (state.sessionID) await connection.cancel({ sessionId: state.sessionID }).catch(() => {})
  process.kill(-child.pid, "SIGTERM")
  await deadline(exited, 10000, "official cleanup").catch(() => process.kill(-child.pid, "SIGKILL"))
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(
    join(directory, "feedback.json"),
    JSON.stringify({ results, events, providerCalls, submissions }, null, 2),
  )
  await writeFile(join(directory, "stderr.log"), Buffer.concat(stderr))
  console.error(`Official feedback evidence: ${directory}`)
}

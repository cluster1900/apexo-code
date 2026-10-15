// Isolated installed-runtime comparison; no reference executable is used by migrated product code.
import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"
import { prepareReferenceIsolation } from "./grok-reference-isolation.mjs"
const output = await mkdtemp(join(tmpdir(), "apexo-task-operator-reference-"))
const home = join(output, "home"),
  cwd = join(output, "workspace")
await mkdir(join(home, "workflows"), { recursive: true })
await mkdir(cwd)
let rootCalls = 0
const calls = [],
  events = [],
  logs = [],
  results = []
const models = [{ id: "fixture", object: "model" }]
const provider = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("content-type", "application/json")
    return res.end(JSON.stringify({ data: models }))
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push(body)
  const title = (body.tools ?? []).some((tool) => (tool.function ?? tool).name === "session_title")
  if (req.url === "/v1/responses" && title) {
    const item = {
      type: "function_call",
      id: "fc_title",
      call_id: "call_title",
      name: "session_title",
      arguments: JSON.stringify({ session_title: "Workflow agent comparison" }),
      status: "completed",
    }
    const result = {
      id: "resp_title",
      object: "response",
      created_at: 1,
      model: body.model,
      status: "completed",
      output: [item],
      error: null,
      incomplete_details: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }
    res.writeHead(200, { "content-type": "text/event-stream" })
    return res.end(
      [
        { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, arguments: "", status: "in_progress" },
        },
        { type: "response.function_call_arguments.delta", output_index: 0, item_id: item.id, delta: item.arguments },
        { type: "response.function_call_arguments.done", output_index: 0, item_id: item.id, arguments: item.arguments },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: result },
      ]
        .map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
        .join(""),
    )
  }
  const delta = (content, finish_reason = null) => ({
    id: "workflow-agent",
    object: "chat.completion.chunk",
    created: 1,
    model: body.model,
    choices: [{ index: 0, delta: content, finish_reason }],
  })
  res.writeHead(200, { "content-type": "text/event-stream" })
  const users = (body.messages ?? [])
    .filter((message) => message.role === "user")
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
  const isChild = users.some((text) => text.includes("OPERATOR_REFERENCE_CHILD"))
  const spawn = !title && !isChild && rootCalls++ === 0
  const tool = spawn && body.tools?.map((tool) => tool.function ?? tool).find((tool) => tool.name === "spawn_subagent")
  if (spawn) assert.ok(tool)
  const content = title
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "call_title",
            type: "function",
            function: {
              name: "session_title",
              arguments: JSON.stringify({ session_title: "Workflow agent comparison" }),
            },
          },
        ],
      }
    : spawn
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "operator_spawn",
              type: "function",
              function: {
                name: tool.name,
                arguments: JSON.stringify({
                  prompt: "OPERATOR_REFERENCE_CHILD",
                  description: "Operator child",
                  background: false,
                }),
              },
            },
          ],
        }
      : {
          role: "assistant",
          content: isChild
            ? users.some((text) => text.includes("OPERATOR_REFERENCE_NEXT"))
              ? "OPERATOR_REFERENCE_WOKEN"
              : "OPERATOR_REFERENCE_DONE"
            : "OPERATOR_REFERENCE_PARENT_IDLE",
        }
  res.end(
    `data: ${JSON.stringify(delta(content))}\n\ndata: ${JSON.stringify({ ...delta({}, title || spawn ? "tool_calls" : "stop"), usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
  )
})
let child, exited
try {
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${provider.address().port}/v1`
  await writeFile(
    join(home, "config.toml"),
    `[models]\ndefault="fixture"\n[model.fixture]\nmodel="fixture"\nname="Agent selection fixture"\nbase_url="${base}"\napi_key="fixture"\napi_backend="chat_completions"\ncontext_window=100000\n[features]\nactive_agent_messages=true\n[workflows]\nenabled=true\n[memory]\nenabled=false\n[cli]\nuse_leader=false\n`,
  )
  const isolation = await prepareReferenceIsolation({
    output,
    home,
    cwd,
    port: provider.address().port,
    extraEnv: {
      GROK_WORKFLOWS: "1",
      GROK_ACTIVE_AGENT_MESSAGES: "1",
      GROK_MEMORY: "0",
      GROK_TITLE_REFRESH: "0",
      GROK_TURN_SUMMARY: "0",
    },
  })
  child = isolation.start(["agent", "stdio", "--leader-socket", join(output, "leader.sock")])
  exited = new Promise((resolve) => child.once("close", resolve))
  child.stderr.on("data", (chunk) => logs.push(chunk))
  const connection = new ClientSideConnection(
    () => ({
      async requestPermission(params) {
        const option = params.options.find((option) => option.kind === "allow_once")
        assert.ok(option, "Fixture requires an allow-once permission option")
        return { outcome: { outcome: "selected", optionId: option.optionId } }
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
  await deadline(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    30000,
    "initialize",
  )
  const session = await connection.newSession({ cwd, mcpServers: [] })
  await writeFile(join(output, "catalog.json"), JSON.stringify(session.models, null, 2))
  await deadline(
    connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "OPERATOR_REFERENCE_ROOT" }] }),
    30000,
    "source child",
  )
  const address = events
    .flatMap((event) => [event.update, event.params?.update, event.params])
    .find((update) => update?.agentAddress)?.agentAddress
  assert.ok(address, `No advertised human address: ${JSON.stringify(events)}`)
  const before = calls.filter(
    (call) =>
      !(call.tools ?? []).some((tool) => (tool.function ?? tool).name === "session_title") &&
      call.messages?.some(
        (message) => message.role === "user" && JSON.stringify(message.content).includes("OPERATOR_REFERENCE_CHILD"),
      ),
  ).length
  assert.equal(before, 1)
  const admission = await deadline(
    connection.extMethod("_x.ai/subagent/message", {
      sessionId: session.sessionId,
      agentAddress: address,
      queue: false,
      content: [{ type: "text", text: "OPERATOR_REFERENCE_NEXT" }],
    }),
    20000,
    "operator message",
  )
  results.push({ address, admission })
  assert.equal(admission.result?.kind, "accepted")
  const resumed = await poll(
    () =>
      calls.find(
        (call) =>
          !(call.tools ?? []).some((tool) => (tool.function ?? tool).name === "session_title") &&
          call.messages?.some(
            (message) => message.role === "user" && JSON.stringify(message.content).includes("OPERATOR_REFERENCE_NEXT"),
          ),
      ),
    "operator child request",
    25000,
  )
  assert.ok(
    resumed.messages.some(
      (message) => message.role === "assistant" && JSON.stringify(message.content).includes("OPERATOR_REFERENCE_DONE"),
    ),
  )
  assert.ok(
    resumed.messages.some(
      (message) => message.role === "user" && JSON.stringify(message.content).includes("OPERATOR_REFERENCE_CHILD"),
    ),
  )
  assert.ok(!Buffer.concat(logs).toString().includes("Failed to deserialize ResponseStreamEvent"))
  console.log(
    JSON.stringify(
      {
        output,
        isolation: "actual home denied; exact local provider port allowed; unrelated port denied",
        checks: 3,
        results,
        childCalls: calls.filter(
          (call) =>
            !(call.tools ?? []).some((tool) => (tool.function ?? tool).name === "session_title") &&
            call.messages?.some(
              (message) =>
                message.role === "user" && JSON.stringify(message.content).includes("OPERATOR_REFERENCE_CHILD"),
            ),
        ).length,
        providerCalls: calls.length,
      },
      null,
      2,
    ),
  )
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    process.kill(-child.pid, "SIGTERM")
    await deadline(exited, 10000, "reference shutdown").catch(async () => {
      process.kill(-child.pid, "SIGKILL")
      await exited
    })
  }
  provider.closeAllConnections()
  if (provider.listening) await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(output, "observations.json"), JSON.stringify({ results, calls, events }, null, 2))
  await writeFile(join(output, "stderr.log"), Buffer.concat(logs))
  console.error(`Evidence: ${output}`)
}

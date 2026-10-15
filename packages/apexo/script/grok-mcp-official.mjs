// Isolated installed Grok evidence; no Apexo runtime depends on this process.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const directory = await mkdtemp(join(tmpdir(), "apexo-mcp-official-"))
const home = join(directory, "home")
const workspace = join(directory, "workspace")
const trace = join(directory, "mcp.jsonl")
await mkdir(home)
await mkdir(workspace)
const calls = []
const events = []
const logs = []
const checks = []
const provider = createServer(async (request, response) => {
  if (request.method !== "POST") return response.end(JSON.stringify({ data: [{ id: "fixture", object: "model" }] }))
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push(body)
  if (request.url.endsWith("/responses")) {
    const item = {
      type: "function_call",
      id: "fc_reference_title",
      call_id: "call_reference_title",
      name: "session_title",
      arguments: JSON.stringify({ session_title: "Preserve the apricot decision" }),
      status: "completed",
    }
    const result = {
      id: "resp_reference_title",
      object: "response",
      created_at: 1,
      model: body.model,
      status: "completed",
      output: [item],
      error: null,
      incomplete_details: null,
      instructions: null,
      max_output_tokens: null,
      parallel_tool_calls: true,
      previous_response_id: null,
      reasoning: { effort: null, summary: null },
      store: false,
      temperature: 1,
      text: { format: { type: "text" } },
      tool_choice: "auto",
      tools: body.tools ?? [],
      top_p: 1,
      truncation: "disabled",
      user: null,
      metadata: {},
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }
    response.writeHead(200, { "content-type": "text/event-stream" })
    return response.end(
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
  const names = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
  const results = (body.messages ?? []).filter((message) => message.role === "tool")
  const searched = results.find((message) => JSON.stringify(message).includes("echo"))
  const finished = results.some((message) => JSON.stringify(message).includes("OFFICIAL_MCP_RESULT"))
  const discover = (value) => {
    if (!value || typeof value !== "object") return undefined
    if (typeof value.name === "string" && value.name.includes("echo")) return value.name
    if (typeof value.tool_name === "string" && value.tool_name.includes("echo")) return value.tool_name
    return Object.values(value).map(discover).find(Boolean)
  }
  const content = searched?.content
  const result = typeof content === "string" ? JSON.parse(content) : content
  const leaf = discover(result)
  const name = finished ? undefined : leaf ? "use_tool" : names.includes("search_tool") ? "search_tool" : undefined
  const args = leaf ? { tool_name: leaf, tool_input: { text: "OFFICIAL_MCP_RESULT" } } : { query: "reference echo" }
  const delta = name
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `call_reference_mcp_${results.length}`,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      }
    : { role: "assistant", content: "MCP reference completed" }
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(
    [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      {
        choices: [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      },
    ]
      .map(
        (event) =>
          `data: ${JSON.stringify({ id: "mcp-reference", object: "chat.completion.chunk", created: 1, model: body.model, ...event })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
  )
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
const url = `http://127.0.0.1:${provider.address().port}/v1`
await writeFile(
  join(home, "config.toml"),
  `[models]\ndefault = "fixture"\n[model.fixture]\nmodel = "fixture"\nname = "MCP fixture"\nbase_url = "${url}"\napi_key = "fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = false\n[memory_v2]\nenabled = false\n`,
)
const child = spawn("grok", ["agent", "stdio", "--leader-socket", join(directory, "leader.sock")], {
  cwd: workspace,
  env: {
    ...process.env,
    HOME: home,
    GROK_HOME: home,
    GROK_CONFIG: "",
    GROK_CONFIG_PATH: "",
    XAI_API_KEY: "fixture",
    GROK_MANAGED_MCPS_ENABLED: "0",
    GROK_TITLE_REFRESH: "0",
    GROK_TURN_SUMMARY: "0",
    GROK_MODELS_BASE_URL: url,
    GROK_MODELS_LIST_URL: `${url}/models`,
    ...Object.fromEntries(
      ["CURSOR", "CLAUDE", "CODEX"].flatMap((vendor) =>
        ["MCPS", "RULES", "SKILLS", "AGENTS", "HOOKS"].map((surface) => [`GROK_${vendor}_${surface}_ENABLED`, "0"]),
      ),
    ),
  },
  stdio: ["pipe", "pipe", "pipe"],
})
const exited = new Promise((resolve) => child.once("exit", resolve))
child.stderr.on("data", (chunk) => logs.push(chunk.toString()))
const connection = new ClientSideConnection(
  () => ({
    async requestPermission(params) {
      const option = params.options.find((item) => item.kind === "allow_once")
      return { outcome: option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" } }
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
try {
  await deadline(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    30_000,
    "reference initialize",
  )
  const session = await deadline(
    connection.newSession({
      cwd: workspace,
      mcpServers: [
        {
          name: "reference",
          command: process.execPath,
          args: [resolve("test/fixture/mcp-native-stdio.ts")],
          env: [{ name: "MCP_NATIVE_TRACE", value: trace }],
        },
      ],
    }),
    30_000,
    "reference MCP session",
  )
  await poll(
    () =>
      events.some((event) => event.method === "_x.ai/mcp_initialized" && event.params?.sessionId === session.sessionId),
    "reference MCP ready",
    30_000,
  )
  assert.equal(calls.length, 0)
  checks.push("mcp-setup-without-provider-work")
  await deadline(
    connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "Call the reference echo MCP tool with OFFICIAL_MCP_RESULT." }],
    }),
    60_000,
    "reference MCP execution",
  )
  assert.ok(
    calls.some((body) => (body.tools ?? []).some((tool) => (tool.function?.name ?? tool.name) === "search_tool")),
  )
  checks.push("mcp-discovery-tool-advertised")
  assert.ok((await readFile(trace, "utf8")).includes("OFFICIAL_MCP_RESULT"))
  assert.ok(
    calls.some((body) =>
      (body.messages ?? []).some(
        (message) => message.role === "tool" && JSON.stringify(message).includes("OFFICIAL_MCP_RESULT"),
      ),
    ),
  )
  checks.push("real-stdio-call-result-returned-to-provider")
  console.log(
    JSON.stringify({ kind: "official-installed", passed: checks.length, checks, providerCalls: calls.length }),
  )
} finally {
  child.kill("SIGTERM")
  await deadline(exited, 10_000, "reference exit").catch(() => child.kill("SIGKILL"))
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(directory, "stderr.log"), logs.join(""))
  await writeFile(join(directory, "requests.json"), JSON.stringify(calls))
  await writeFile(join(directory, "events.json"), JSON.stringify(events))
  console.error(`MCP reference evidence: ${directory}`)
}

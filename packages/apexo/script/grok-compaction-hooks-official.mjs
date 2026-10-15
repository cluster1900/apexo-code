// Isolated installed-runtime evidence only; Apexo never depends on this process.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline } from "./grok-shell-fixture.mjs"

const directory = await mkdtemp(join(tmpdir(), "apexo-compact-official-"))
const grokHome = join(directory, "grok-home")
const workspace = join(directory, "workspace")
await mkdir(grokHome)
await mkdir(workspace)
const trace = join(directory, "hooks.jsonl")
const hookRows = async () => (await readFile(trace, "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse)
await mkdir(join(grokHome, "hooks"))
await writeFile(
  join(directory, "observe.py"),
  `import json,sys
value=json.load(sys.stdin)
with open(sys.argv[1], 'a') as out: out.write(json.dumps({'event':value['hook_event_name'],'source':value['source'],'session':value['session_id']})+'\\n')
print(json.dumps({'decision':'block','continue':False,'reason':'observer cannot veto'}))
sys.exit(2)
`,
)
await writeFile(
  join(grokHome, "hooks/compact.json"),
  JSON.stringify({
    hooks: Object.fromEntries(
      ["PreCompact", "PostCompact"].map((event) => [
        event,
        [
          {
            matcher: "manual",
            hooks: [{ type: "command", command: `python3 '${join(directory, "observe.py")}' '${trace}'`, timeout: 2 }],
          },
        ],
      ]),
    ),
  }),
)
const calls = []
const events = []
const logs = []
const checks = []
const planned = { fail: false, phase: "empty" }
const provider = createServer(async (request, response) => {
  if (request.method !== "POST") return response.end(JSON.stringify({ data: [{ id: "fixture", object: "model" }] }))
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push({ phase: planned.phase, body, hooks: await hookRows() })
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
  if (planned.fail) {
    response.writeHead(400, { "content-type": "application/json" })
    return response.end(JSON.stringify({ error: { message: "Summary unavailable", type: "invalid_request_error" } }))
  }
  const content =
    planned.phase === "seed"
      ? "The apricot decision is recorded."
      : "## Objective\nPreserve the apricot decision for the user's next request.\n## Important Details\nThe user requested retention of the apricot decision. No repository files have been inspected or modified, no tools have been invoked, and no independent verification was requested.\n## Work State\nThe original request and acknowledgement are recorded. There are no active implementation tasks, blockers, pending external actions, or claims of completed code changes.\n## Next Move\nWait for the user's next instruction and carry forward the apricot decision accurately."
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(
    [
      { choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] },
      {
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      },
    ]
      .map(
        (event) =>
          `data: ${JSON.stringify({ id: "compact-reference", object: "chat.completion.chunk", created: 1, model: body.model, ...event })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
  )
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
await writeFile(
  join(grokHome, "config.toml"),
  `[models]\ndefault = "fixture"\n[model.fixture]\nmodel = "fixture"\nname = "Compaction fixture"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "local-fixture-key"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = false\n[memory_v2]\nenabled = false\n`,
)
const child = spawn("grok", ["agent", "stdio", "--leader-socket", join(directory, "leader.sock")], {
  cwd: workspace,
  env: {
    ...process.env,
    HOME: grokHome,
    GROK_HOME: grokHome,
    GROK_CONFIG: "",
    GROK_CONFIG_PATH: "",
    XAI_API_KEY: "local-fixture-key",
    GROK_MANAGED_MCPS_ENABLED: "0",
    GROK_TITLE_REFRESH: "0",
    GROK_TURN_SUMMARY: "0",
    GROK_MODELS_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
    GROK_MODELS_LIST_URL: `http://127.0.0.1:${provider.address().port}/v1/models`,
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
    async requestPermission() {
      return { outcome: { outcome: "cancelled" } }
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
    30000,
    "official initialize",
  )
  const sessionId = (await connection.newSession({ cwd: workspace, mcpServers: [] })).sessionId
  const prompt = (text) =>
    deadline(
      connection.prompt({ sessionId, prompt: [{ type: "text", text }] }),
      30000,
      text === "/compact" ? "official compact" : "official seed",
    )
  const empty = await prompt("/compact").then(
    (result) => ({ result }),
    (error) => ({ error: { code: error.code, message: error.message, data: error.data } }),
  )
  const emptyCalls = calls.length
  checks.push("empty-compaction-reference-outcome-recorded")
  planned.phase = "seed"
  await prompt("Remember the apricot decision and preserve this context for a later turn.")
  assert.ok(calls.length >= emptyCalls + 1)
  const seededCalls = calls.length
  const seededHooks = (await hookRows()).length
  planned.phase = "manual"
  const first = await prompt("/compact")
  assert.ok(calls.length > seededCalls)
  assert.ok(JSON.stringify(calls.slice(seededCalls)).includes("apricot"))
  checks.push("manual-command-summarizes-existing-conversation")
  const manualHooks = (await hookRows()).slice(seededHooks)
  assert.deepEqual(
    manualHooks.map((row) => [row.event, row.source]),
    [
      ["PreCompact", "manual"],
      ["PostCompact", "manual"],
    ],
  )
  assert.ok(manualHooks.every((row) => row.session === sessionId))
  assert.ok(
    calls.slice(seededCalls).some(
      (call) =>
        call.hooks
          .slice(seededHooks)
          .map((row) => row.event)
          .join(",") === "PreCompact",
    ),
  )
  checks.push("manual-observers-bracket-summary-and-exit-two-does-not-veto")
  const beforeFailure = (await hookRows()).length
  planned.fail = true
  planned.phase = "failed"
  const failed = await prompt("/compact").then(
    (result) => ({ result }),
    (error) => ({ error: { code: error.code, message: error.message, data: error.data } }),
  )
  assert.ok(failed.error)
  checks.push("failed-summary-surfaces-an-error")
  assert.deepEqual(
    (await hookRows()).slice(beforeFailure).map((row) => row.event),
    ["PreCompact"],
  )
  checks.push("failed-summary-has-pre-but-no-post-observer")
  console.log(
    JSON.stringify(
      {
        kind: "official-installed",
        checks,
        passed: checks.length,
        providerCalls: calls.length,
        hooks: await hookRows(),
        requests: calls.map((call) => ({
          phase: call.phase,
          tools: call.body.tools?.length ?? 0,
          compaction: JSON.stringify(call.body.messages ?? []).includes("faithful, concise summary"),
        })),
        empty,
        first,
        failed,
        events: events.filter((event) => JSON.stringify(event).toLowerCase().includes("compact")),
      },
      null,
      2,
    ),
  )
} finally {
  child.kill("SIGTERM")
  await deadline(exited, 10000, "official exit").catch(() => child.kill("SIGKILL"))
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(directory, "stderr.log"), logs.join(""))
  await writeFile(join(directory, "requests.json"), JSON.stringify(calls, null, 2))
}

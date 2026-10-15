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
const output = await mkdtemp(join(tmpdir(), "apexo-workflow-agent-reference-"))
const home = join(output, "home"),
  cwd = join(output, "workspace")
await mkdir(join(home, "workflows"), { recursive: true })
await mkdir(cwd)
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
    : { role: "assistant", content: "AGENT_REFERENCE_CHILD" }
  res.end(
    `data: ${JSON.stringify(delta(content))}\n\ndata: ${JSON.stringify({ ...delta({}, title ? "tool_calls" : "stop"), usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
  )
})
let child, exited
try {
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${provider.address().port}/v1`
  await writeFile(
    join(home, "config.toml"),
    `[models]\ndefault="fixture"\n[model.fixture]\nmodel="fixture"\nname="Agent selection fixture"\nbase_url="${base}"\napi_key="fixture"\napi_backend="chat_completions"\ncontext_window=100000\n[workflows]\nenabled=true\n[memory]\nenabled=false\n[cli]\nuse_leader=false\n`,
  )
  const cases = [
    ["selected", "explore"],
    ["omitted", undefined],
    ["missing", "missing-workflow-agent"],
  ]
  for (const [name, agent] of cases)
    await writeFile(
      join(home, "workflows", `${name}.rhai`),
      `let meta=#{name:"${name}",description:"Local selected-agent comparison"}; let r=agent("AGENT_PROBE_${name}",#{model:"fixture",capability_mode:"read-only"${agent === undefined ? "" : `,agent_type:"${agent}"`}}); complete(r.output);`,
    )
  const isolation = await prepareReferenceIsolation({
    output,
    home,
    cwd,
    port: provider.address().port,
    extraEnv: { GROK_WORKFLOWS: "1", GROK_MEMORY: "0", GROK_TITLE_REFRESH: "0", GROK_TURN_SUMMARY: "0" },
  })
  child = isolation.start(["agent", "stdio", "--leader-socket", join(output, "leader.sock")])
  exited = new Promise((resolve) => child.once("close", resolve))
  child.stderr.on("data", (chunk) => logs.push(chunk))
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
  await deadline(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    30000,
    "initialize",
  )
  const session = await connection.newSession({ cwd, mcpServers: [] })
  await writeFile(join(output, "catalog.json"), JSON.stringify(session.models, null, 2))
  for (const [name, agent] of cases) {
    const start = events.length,
      before = calls.length
    await deadline(
      connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: `/workflow ${name} --agent-budget 1` }],
      }),
      20000,
      "workflow launch",
    )
    const terminal = await poll(
      () =>
        events
          .slice(start)
          .findLast(
            (e) =>
              e.params?.update?.sessionUpdate === "workflow_updated" &&
              ["complete", "failed", "cancelled"].includes(e.params.update.status),
          )?.params.update,
      `workflow ${name}`,
      25000,
    )
    const observed = calls
      .slice(before)
      .filter((x) =>
        x.messages?.some((message) => message.role === "user" && message.content === `AGENT_PROBE_${name}`),
      )
    results.push({
      name,
      agent,
      status: terminal.status,
      summary: terminal.result_summary,
      error: terminal.error ?? terminal.message,
      calls: observed.map((x) => ({ model: x.model })),
    })
  }
  assert.deepEqual(
    results.map((result) => result.status),
    ["complete", "complete", "complete"],
  )
  assert.deepEqual(
    results.map((result) => result.calls.length),
    [1, 1, 0],
  )
  assert.ok(results.slice(0, 2).every((result) => result.summary.includes("AGENT_REFERENCE_CHILD")))
  // agent() returns the unavailable-type error as output; this script then explicitly calls complete().
  assert.equal(results[2].summary, "Unknown subagent type: missing-workflow-agent")
  assert.ok(!Buffer.concat(logs).toString().includes("Failed to deserialize ResponseStreamEvent"))
  console.log(
    JSON.stringify(
      {
        output,
        isolation: "actual home denied; exact local provider port allowed; unrelated port denied",
        checks: 3,
        results,
        childCalls: results.flatMap((result) => result.calls).length,
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

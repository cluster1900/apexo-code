// Isolated installed-runtime comparison; no reference executable is used by migrated product code.
import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile, readFile, realpath } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"
import { prepareReferenceIsolation } from "./grok-reference-isolation.mjs"
const output = await mkdtemp(join(tmpdir(), "apexo-workflow-resume-reference-"))
const home = join(output, "home"),
  cwd = join(output, "workspace")
await mkdir(join(home, "workflows"), { recursive: true })
await mkdir(cwd)
await writeFile(join(cwd, "tracked.txt"), "COMMITTED_PARENT\n")
await promisify(execFile)("/usr/bin/git", ["init"], { cwd })
await promisify(execFile)("/usr/bin/git", ["add", "tracked.txt"], { cwd })
await promisify(execFile)(
  "/usr/bin/git",
  [
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  ],
  { cwd },
)
await writeFile(join(cwd, "tracked.txt"), "DIRTY_PARENT\n")
await writeFile(join(cwd, "untracked.txt"), "UNTRACKED_PARENT\n")
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
  const messages = body.messages ?? []
  const userIndex = messages.findLastIndex((message) => message.role === "user")
  const userText = JSON.stringify(messages[userIndex]?.content ?? "")
  const isChild = /RESUME_REFERENCE_SOURCE|RESUME_REFERENCE_NEXT/.test(userText)
  const childTool = !title && isChild && !messages.slice(userIndex + 1).some((message) => message.role === "tool")
  const command = userText.includes("RESUME_REFERENCE_NEXT")
    ? "pwd; cat child.txt; cat tracked.txt; cat untracked.txt"
    : "pwd; cat tracked.txt; cat untracked.txt; printf 'CHILD_EDIT\\n' > child.txt"
  if (childTool) assert.ok(body.tools.some((tool) => (tool.function ?? tool).name === "run_terminal_command"))
  const content = childTool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: userText.includes("RESUME_REFERENCE_NEXT") ? "placement_next" : "placement_first",
            type: "function",
            function: {
              name: "run_terminal_command",
              arguments: JSON.stringify({
                command,
                description: "Verify Workflow isolated placement",
                block_until_ms: 30000,
              }),
            },
          },
        ],
      }
    : title
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
    `data: ${JSON.stringify(delta(content))}\n\ndata: ${JSON.stringify({ ...delta({}, title || childTool ? "tool_calls" : "stop"), usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
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
  const cases = [["resumed", "general-purpose"]]
  await writeFile(
    join(home, "workflows", "resumed.rhai"),
    'let meta=#{name:"resumed",description:"Durable resume comparison"}; let first=agent("RESUME_REFERENCE_SOURCE",#{agent_type:"general-purpose",model:"fixture",isolation_worktree:true,capability_mode:"all"}); let second=agent("RESUME_REFERENCE_NEXT",#{resume_from:first.agent_id,agent_type:"missing-ignored",model:"fixture",capability_mode:"all"}); complete(#{first:first.agent_id,second:second.agent_id,result:second.output});',
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
      async requestPermission(params) {
        const option = params.options.find((option) => option.kind === "allow_once")
        assert.ok(option)
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
  for (const [name, agent] of cases) {
    const start = events.length,
      before = calls.length
    await deadline(
      connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: `/workflow ${name} --agent-budget 2` }],
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
        x.messages?.some(
          (message) =>
            message.role === "user" && ["RESUME_REFERENCE_SOURCE", "RESUME_REFERENCE_NEXT"].includes(message.content),
        ),
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
  assert.equal(results[0].status, "complete")
  assert.equal(results[0].calls.length, 4)
  const execution = calls
    .flatMap((call) => (call.messages ?? []).filter((message) => message.role === "tool"))
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
    .filter((text) => text.includes("DIRTY_PARENT"))
  assert.ok(execution.length >= 2, "actual Workflow children read dirty parent state")
  assert.ok(execution.some((text) => text.includes("UNTRACKED_PARENT")))
  assert.ok(
    execution.some((text) => text.includes("CHILD_EDIT")),
    "resumed worktree retains previous child edit",
  )
  assert.equal(await readFile(join(cwd, "tracked.txt"), "utf8"), "DIRTY_PARENT\n")
  assert.equal(await Bun.file(join(cwd, "child.txt")).exists(), false)
  const currentOutput = (marker) =>
    calls
      .flatMap((call) => {
        const messages = call.messages ?? []
        const index = messages.findLastIndex((message) => message.role === "user")
        if (messages[index]?.content !== marker) return []
        return messages
          .slice(index + 1)
          .filter((message) => message.role === "tool")
          .map((message) => message.content)
      })
      .findLast((text) => typeof text === "string" && text.includes("DIRTY_PARENT"))
  const firstOutput = currentOutput("RESUME_REFERENCE_SOURCE")
  const nextOutput = currentOutput("RESUME_REFERENCE_NEXT")
  assert.ok(firstOutput && nextOutput)
  const firstCwd = firstOutput.split("\n").find((line) => line.startsWith("/"))
  const nextCwd = nextOutput.split("\n").find((line) => line.startsWith("/"))
  assert.ok(firstCwd && nextCwd)
  assert.equal(await realpath(firstCwd), await realpath(nextCwd))
  assert.notEqual(await realpath(firstCwd), await realpath(cwd))
  assert.equal(await readFile(join(firstCwd, "child.txt"), "utf8"), "CHILD_EDIT\n")
  results.push({ execution, cwd, firstCwd, nextCwd })
  const resumed = calls.find((call) =>
    call.messages?.some((message) => message.role === "user" && message.content === "RESUME_REFERENCE_NEXT"),
  )
  assert.ok(resumed)
  assert.ok(
    resumed.messages.some((message) => message.role === "user" && message.content === "RESUME_REFERENCE_SOURCE"),
  )
  assert.ok(
    resumed.messages.some((message) => message.role === "assistant" && message.content === "AGENT_REFERENCE_CHILD"),
  )
  assert.match(results[0].summary, /AGENT_REFERENCE_CHILD/)
  assert.ok(!Buffer.concat(logs).toString().includes("Failed to deserialize ResponseStreamEvent"))
  console.log(
    JSON.stringify(
      {
        output,
        isolation: "actual home denied; exact local provider port allowed; unrelated port denied",
        checks: 7,
        results,
        childCalls: results[0].calls.length,
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

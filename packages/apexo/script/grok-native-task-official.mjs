// Isolated installed-runtime comparison only; Apexo product code never invokes Grok.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const output = await mkdtemp(join(tmpdir(), "apexo-task-official-"))
const home = join(output, "home"),
  cwd = join(output, "workspace")
await mkdir(home, { recursive: true })
await mkdir(cwd)
const planned = { aliases: [], args: {}, sent: false }
const held = Promise.withResolvers(),
  cancelled = Promise.withResolvers()
const calls = [],
  events = [],
  logs = [],
  childCalls = []
const provider = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (request.method !== "POST") return response.end(JSON.stringify({ data: [{ id: "fixture" }] }))
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push(body)
  const user = body.messages?.findLast((message) => message.role === "user")
  const text = typeof user?.content === "string" ? user.content : JSON.stringify(user?.content)
  const first = text?.startsWith("TASK_CHILD_HOLD")
  const cancel = text?.startsWith("TASK_CHILD_CANCEL")
  const follow = text?.startsWith("TASK_FOLLOWUP")
  if (first || follow || cancel) childCalls.push(body)
  const tool =
    !first &&
    !follow &&
    !cancel &&
    !planned.sent &&
    (body.tools ?? []).map((tool) => tool.function ?? tool).find((tool) => planned.aliases.includes(tool.name))
  if (tool) planned.sent = true
  if (first) await held.promise
  if (cancel) await cancelled.promise
  const content = first ? "TASK_CHILD_DONE" : follow ? "TASK_FOLLOWUP_DONE" : "ACK"
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `task_call_${calls.length}`,
            type: "function",
            function: { name: tool.name, arguments: JSON.stringify(planned.args) },
          },
        ],
      }
    : { role: "assistant", content }

  const chunk = (delta, finish_reason = null) => ({
    id: "official-workflow",
    object: "chat.completion.chunk",
    created: 1,
    model: "fixture",
    choices: [{ index: 0, delta, finish_reason }],
  })
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.write(`data: ${JSON.stringify(chunk(delta))}\n\n`)
  response.write(
    `data: ${JSON.stringify({ ...chunk({}, tool ? "tool_calls" : "stop"), usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\n`,
  )
  response.end("data: [DONE]\n\n")
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
await writeFile(
  join(home, "config.toml"),
  `[models]\ndefault = "fixture"\n[model.fixture]\nmodel = "fixture"\nname = "Workflow comparison"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[workflows]\nenabled = true\n[memory]\nenabled = false\n[cli]\nuse_leader = false\n`,
)
const child = spawn(
  process.env.GROK_BIN ?? "grok",
  ["agent", "stdio", "--leader-socket", join(output, "leader.sock")],
  {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, "xdg-config"),
      XDG_DATA_HOME: join(home, "xdg-data"),
      XDG_STATE_HOME: join(home, "xdg-state"),
      XDG_CACHE_HOME: join(home, "xdg-cache"),
      XDG_RUNTIME_DIR: join(home, "xdg-runtime"),

      GROK_HOME: home,
      GROK_CONFIG: "",
      GROK_CONFIG_PATH: "",
      GROK_WORKFLOWS: "1",
      GROK_MEMORY: "0",
      GROK_MANAGED_MCPS_ENABLED: "0",
      XAI_API_KEY: "fixture",
      ...Object.fromEntries(
        ["CURSOR", "CLAUDE", "CODEX"].flatMap((vendor) =>
          ["MCPS", "RULES", "SKILLS", "AGENTS", "HOOKS"].map((surface) => [`GROK_${vendor}_${surface}_ENABLED`, "0"]),
        ),
      ),
    },
  },
)
const exited = new Promise((resolve) => child.once("exit", resolve))
child.stderr.on("data", (chunk) => logs.push(chunk))
const connection = new ClientSideConnection(
  () => ({
    async requestPermission(input) {
      return {
        outcome: {
          outcome: "selected",
          optionId: input.options.find((option) => option.kind === "allow_once").optionId,
        },
      }
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
const updates = () =>
  events.flatMap((event) => (event.update ? [event.update] : event.params?.update ? [event.params.update] : []))
async function invoke(sessionId, aliases, args) {
  const from = updates().length
  Object.assign(planned, { aliases, args, sent: false })
  await deadline(
    connection.prompt({ sessionId, prompt: [{ type: "text", text: "TASK_PARENT controlled tool request" }] }),
    20000,
    "tool request",
  )
  assert.equal(planned.sent, true, `Missing tool ${aliases.join(",")}`)
  const turn = updates().slice(from)
  const call = turn.find((update) => update.sessionUpdate === "tool_call")
  assert.ok(call)
  const result = turn.findLast(
    (update) => update.toolCallId === call.toolCallId && ["completed", "failed"].includes(update.status),
  )
  assert.ok(result)
  console.log(JSON.stringify({ aliases, args, result }))
  return result
}
try {
  await deadline(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    30000,
    "initialize",
  )
  const session = await connection.newSession({ cwd, mcpServers: [] })
  const started = await invoke(session.sessionId, ["task", "spawn_subagent"], {
    description: "Inspect isolated child",
    prompt: "TASK_CHILD_HOLD return TASK_CHILD_DONE",
    background: true,
  })
  await poll(() => childCalls.length === 1, "held child request", 20000)
  const id = started.rawOutput.text.match(/subagent_id: ([^\n]+)/)?.[1]
  assert.ok(id)
  const snapshot = await invoke(session.sessionId, ["get_task_output", "get_command_or_subagent_output"], {
    task_ids: [id],
    timeout_ms: 0,
  })
  assert.ok(JSON.stringify(snapshot.rawOutput).includes("running"))
  assert.ok(
    !calls
      .flatMap((call) => (call.tools ?? []).map((tool) => (tool.function ?? tool).name))
      .includes("send_subagent_message"),
  )
  held.resolve()
  const completed = await invoke(session.sessionId, ["get_task_output", "get_command_or_subagent_output"], {
    task_ids: [id],
    timeout_ms: 10000,
  })
  assert.ok(JSON.stringify(completed.rawOutput).includes("TASK_CHILD_DONE"))
  const resumed = await invoke(session.sessionId, ["task", "spawn_subagent"], {
    description: "Resume isolated child",
    prompt: "TASK_FOLLOWUP return TASK_FOLLOWUP_DONE",
    resume_from: id,
    background: false,
  })
  assert.ok(JSON.stringify(resumed.rawOutput).includes("TASK_FOLLOWUP_DONE"))
  assert.equal(childCalls.length, 2)
  assert.notEqual(resumed.rawOutput.subagent_id, id)
  assert.ok(
    updates().some(
      (update) =>
        update.sessionUpdate === "subagent_spawned" &&
        update.subagent_id === resumed.rawOutput.subagent_id &&
        update.resumed_from === id,
    ),
  )
  console.log(JSON.stringify({ stage: "resume_from", source: id, result: resumed.rawOutput }))
  const second = await invoke(session.sessionId, ["task", "spawn_subagent"], {
    description: "Cancel isolated child",
    prompt: "TASK_CHILD_CANCEL return CANCEL_LATE",
    background: true,
  })
  const secondID = second.rawOutput.text.match(/subagent_id: ([^\n]+)/)?.[1]
  assert.ok(secondID)
  await poll(() => childCalls.length >= 3, "second child held", 20000)
  const killed = await invoke(session.sessionId, ["kill_task", "kill_command_or_subagent"], { task_id: secondID })
  assert.ok(/killed|cancelled/i.test(JSON.stringify(killed.rawOutput)))
  const after = await invoke(session.sessionId, ["get_task_output", "get_command_or_subagent_output"], {
    task_ids: [secondID],
    timeout_ms: 0,
  })
  assert.ok(/cancelled|killed/i.test(JSON.stringify(after.rawOutput)))
  console.log(
    JSON.stringify({
      checks: [
        "background-registration-before-held-provider",
        "snapshot-running",
        "active-message-tool-not-advertised",
        "completed-transcript-resume-output",
        "cancel-terminal-status-without-socket-close-assumption",
      ],
      childRequests: childCalls.length,
      providerCalls: calls.length,
      output,
    }),
  )
} finally {
  held.resolve()
  cancelled.resolve()
  child.kill("SIGTERM")
  await deadline(exited, 10000, "shutdown").catch(async () => {
    child.kill("SIGKILL")
    await exited
  })
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(output, "comparison.json"), JSON.stringify({ calls, events }, null, 2))
  await writeFile(join(output, "stderr.log"), Buffer.concat(logs))
  console.log(JSON.stringify({ output }))
}

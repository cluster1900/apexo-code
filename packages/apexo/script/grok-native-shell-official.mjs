// Isolated installed-runtime reference only; native product code never invokes Grok.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const scenario = process.argv[2] ?? "schema"
assert.ok(["schema", "idle", "active", "wait", "cancel", "stop", "stop-active", "timed"].includes(scenario))
const output = await mkdtemp(join(tmpdir(), "apexo-shell-official-"))
const home = join(output, "home")
const cwd = join(output, "workspace")
await mkdir(home, { recursive: true })
await mkdir(cwd)
const calls = [],
  events = [],
  logs = []
const planned = { aliases: [], args: {}, sent: true }
const parentHeld = Promise.withResolvers()
const phase = { active: false, released: false }
const provider = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (request.method !== "POST") return response.end(JSON.stringify({ data: [{ id: "fixture" }] }))
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push(body)
  const tool =
    !planned.sent &&
    (body.tools ?? []).map((tool) => tool.function ?? tool).find((tool) => planned.aliases.includes(tool.name))
  if (tool) planned.sent = true
  const user = body.messages?.findLast((message) => message.role === "user")
  if (body.tools?.length && /(?:^|<user_query>\s*)SHELL_PARENT_ACTIVE/.test(String(user?.content)) && !phase.active) {
    phase.active = true
    await parentHeld.promise
  }
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `shell_call_${calls.length}`,
            type: "function",
            function: { name: tool.name, arguments: JSON.stringify(planned.args) },
          },
        ],
      }
    : { role: "assistant", content: "SHELL_ACK" }
  const chunk = (delta, finish_reason = null) => ({
    id: "shell-reference",
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
  `[models]\ndefault = "fixture"\n[model.fixture]\nmodel = "fixture"\nname = "Shell comparison"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = false\n[cli]\nuse_leader = false\n`,
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
      GROK_HOME: home,
      GROK_CONFIG: "",
      GROK_CONFIG_PATH: "",
      GROK_MEMORY: "0",
      GROK_MANAGED_MCPS_ENABLED: "0",
      XAI_API_KEY: "fixture",
      ...Object.fromEntries(
        ["CONFIG", "DATA", "STATE", "CACHE", "RUNTIME"].map((kind) => [
          kind === "RUNTIME" ? "XDG_RUNTIME_DIR" : `XDG_${kind}_HOME`,
          join(home, `xdg-${kind.toLowerCase()}`),
        ]),
      ),
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
async function prompt(sessionId, text) {
  return deadline(connection.prompt({ sessionId, prompt: [{ type: "text", text }] }), 25000, text)
}
async function invoke(sessionId, aliases, args) {
  const from = updates().length
  Object.assign(planned, { aliases, args, sent: false })
  await prompt(sessionId, "SHELL_PARENT controlled tool request")
  assert.ok(planned.sent, `Missing tool ${aliases.join(",")}`)
  const turn = updates().slice(from)
  const call = turn.find((update) => update.sessionUpdate === "tool_call")
  assert.ok(call)
  const result = turn.findLast(
    (update) => update.toolCallId === call.toolCallId && ["completed", "failed"].includes(update.status),
  )
  assert.ok(result)
  return result
}
try {
  await deadline(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    30000,
    "initialize",
  )
  const session = await connection.newSession({ cwd, mcpServers: [] })
  await prompt(session.sessionId, "SHELL_CATALOG inspect available tools only")
  const catalog = calls.find((call) => call.tools?.length).tools.map((tool) => tool.function ?? tool)
  const selected = catalog.filter((tool) =>
    /shell|terminal|bash|monitor|task.*output|kill.*task|command.*output|kill.*command/i.test(tool.name),
  )
  await writeFile(join(output, "catalog.json"), JSON.stringify(selected, null, 2))
  console.log(JSON.stringify({ scenario, catalog: selected, output }))
  if (scenario !== "schema") {
    const command =
      "printf 'SHELL_STARTED 😀\\n'; printf 'SHELL_STDERR 中文\\n' >&2; echo $$ > shell.pid; while [ ! -f shell.release ]; do sleep 0.05; done; printf 'SHELL_FINISHED\\n'"
    const started = await invoke(
      session.sessionId,
      ["run_terminal_command", "run_terminal_cmd", "Shell", "shell", "bash"],
      { command, description: "Native Shell reference", block_until_ms: scenario === "timed" ? 150 : 0 },
    )
    await writeFile(join(output, "started.json"), JSON.stringify(started, null, 2))
    console.log(JSON.stringify({ started }))
    const id = started.rawOutput?.task_id
    assert.ok(id, "No task ID in shell result")
    await poll(async () => !!(await readFile(join(cwd, "shell.pid"), "utf8").catch(() => "")), "shell spawned", 10000)
    const pid = Number((await readFile(join(cwd, "shell.pid"), "utf8")).trim())
    const snapshot = await invoke(session.sessionId, ["get_task_output", "get_command_or_subagent_output"], {
      task_ids: [id],
      timeout_ms: 0,
    })
    await writeFile(join(output, "snapshot.json"), JSON.stringify(snapshot, null, 2))
    assert.equal(snapshot.rawOutput?.Result?.status, "running")
    assert.ok(snapshot.rawOutput.Result.output.includes("SHELL_STARTED 😀"))
    assert.ok(snapshot.rawOutput.Result.output.includes("SHELL_STDERR 中文"))
    assert.equal(Number((await readFile(join(cwd, "shell.pid"), "utf8")).trim()), pid)
    process.kill(pid, 0)
    const waiting =
      scenario === "wait"
        ? invoke(session.sessionId, ["get_task_output", "get_command_or_subagent_output"], {
            task_ids: [id],
            timeout_ms: 10000,
          })
        : undefined
    if (waiting) await poll(() => planned.sent, "blocking wait admitted", 10000)
    if (scenario === "cancel")
      await invoke(session.sessionId, ["kill_task", "kill_command_or_subagent"], { task_id: id })
    if (scenario === "stop") await connection.cancel({ sessionId: session.sessionId })
    const active = ["active", "stop-active"].includes(scenario)
      ? prompt(session.sessionId, "SHELL_PARENT_ACTIVE hold independent parent")
      : undefined
    if (active) await poll(() => phase.active, "active provider held", 10000)
    if (scenario === "stop-active") {
      await connection.cancel({ sessionId: session.sessionId })
      const receipt = await active
      await writeFile(join(output, "cancelled-turn.json"), JSON.stringify(receipt))
      assert.equal(receipt.stopReason, "cancelled", "Accepted active Stop must settle as cancelled")
      parentHeld.resolve()
    }
    const baseline = calls.length
    await writeFile(join(cwd, "shell.release"), "release")
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const whileHeld = calls.slice(baseline)
    parentHeld.resolve()
    if (active) await active
    if (waiting) await waiting
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const after = calls.slice(baseline)
    const modelTurns = after.filter((call) => call.tools?.length)
    const reminderTurns = modelTurns.filter((call) =>
      /^<system-reminder>\s*Background task /.test(
        String(call.messages?.findLast((message) => message.role === "user")?.content),
      ),
    )
    const expected = ["wait", "cancel", "stop-active"].includes(scenario) ? 0 : 1
    if (scenario !== "stop-active")
      assert.equal(reminderTurns.length, expected, "Unexpected automatic completion provider turns")
    if (scenario === "active")
      assert.equal(
        whileHeld.filter((call) => call.tools?.length).length,
        0,
        "Concurrent parent request during held turn",
      )
    await writeFile(
      join(output, "observations.json"),
      JSON.stringify(
        {
          scenario,
          id,
          baseline,
          whileHeld,
          after,
          modelTurns: modelTurns.length,
          reminderTurns: reminderTurns.length,
          events,
        },
        null,
        2,
      ),
    )
    console.log(
      JSON.stringify({
        scenario,
        modelTurnsAfterRelease: modelTurns.length,
        reminderTurns: reminderTurns.length,
        providerCalls: calls.length,
        output,
      }),
    )
  }
} finally {
  phase.released = true
  parentHeld.resolve()
  await writeFile(join(cwd, "shell.release"), "cleanup")
  child.kill("SIGTERM")
  await deadline(exited, 10000, "shutdown").catch(async () => {
    child.kill("SIGKILL")
    await exited
  })
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(output, "comparison.json"), JSON.stringify({ calls, events }, null, 2))
  await writeFile(join(output, "stderr.log"), Buffer.concat(logs))
  console.log(JSON.stringify({ output, cleanup: "installed child reaped; provider closed" }))
}

// Isolated installed-runtime reference only; native product code never invokes Grok.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline } from "./grok-shell-fixture.mjs"

const scenario = "loop"

const output = await mkdtemp(join(tmpdir(), "apexo-scheduler-audit-"))
const home = join(output, "home")
const cwd = join(output, "workspace")
await mkdir(home, { recursive: true })
await mkdir(cwd)
const calls = [],
  events = [],
  logs = []
const provider = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (request.method !== "POST") return response.end(JSON.stringify({ data: [{ id: "fixture" }] }))
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push(body)
  const delta = { role: "assistant", content: "LOOP_REFERENCE_ACK" }
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
    `data: ${JSON.stringify({ ...chunk({}, "stop"), usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\n`,
  )
  response.end("data: [DONE]\n\n")
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
await writeFile(
  join(home, "config.toml"),
  `[models]\ndefault = "fixture"\n[model.fixture]\nmodel = "fixture"\nname = "Scheduler comparison"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = false\n[cli]\nuse_leader = false\n`,
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
const results = []
let sessionID = ""
try {
  await deadline(
    connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    }),
    30000,
    "initialize",
  )
  sessionID = (await connection.newSession({ cwd, mcpServers: [] })).sessionId
  for (const command of ["/loop", "/loop 30m SCHEDULER_LOOP_UI_PROBE"]) {
    const before = calls.length
    await prompt(sessionID, command)
    const observed = calls.slice(before).filter((call) => call.tools?.length)
    assert.ok(observed.length > 0, "Loop uses ordinary provider prompt")
    const text = JSON.stringify(observed[0].messages?.findLast((message) => message.role === "user"))
    assert.ok(text.includes(command === "/loop" ? "Usage: /loop" : "SCHEDULER_LOOP_UI_PROBE"))
    if (command !== "/loop") {
      assert.ok(text.includes("scheduler_create"))
      assert.ok(text.includes("fire_immediately"))
      assert.ok(text.includes("never invent one"))
    }
    results.push({ step: command, providerCalls: observed.length, expandedUserText: text })
  }
  assert.ok(
    !updates().some((update) => update.sessionUpdate === "tool_call"),
    "Host did not create a schedule without a model tool call",
  )
  console.log(JSON.stringify({ scenario, output, providerCalls: calls.length, results }))
} finally {
  await writeFile(join(output, "observations.json"), JSON.stringify({ scenario, results, calls, events }, null, 2))
  child.kill("SIGTERM")
  await deadline(exited, 10000, "reference cleanup").catch(async () => {
    child.kill("SIGKILL")
    await exited
  })
  provider.closeAllConnections()
  await new Promise((r) => provider.close(r))
  await writeFile(join(output, "stderr.log"), Buffer.concat(logs))
  console.error(JSON.stringify({ cleanup: "reaped", pid: child.pid, output }))
}

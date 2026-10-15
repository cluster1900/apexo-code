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

const alwaysInvalid = process.argv.includes("--always-invalid")
const output = await mkdtemp(join(tmpdir(), "apexo-workflow-official-"))
const home = join(output, "home"),
  cwd = join(output, "workspace")
await mkdir(join(home, "workflows"), { recursive: true })
await mkdir(cwd)
await writeFile(
  join(home, "workflows", "native-reference.rhai"),
  'let meta = #{name: "native-reference", description: "Isolated saved workflow comparison"}; ' +
    'let r = agent("Return OFFICIAL_WORKFLOW_CHILD", #{capability_mode: "read-only", output_schema: #{type: "object", required: ["ok"], properties: #{ok: #{type: "boolean"}}, additionalProperties: false}}); complete(r.output);',
)
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
  const correction =
    typeof user?.content === "string" &&
    user.content.startsWith("Your final message did not satisfy the output contract")
  const first = typeof user?.content === "string" && user.content.startsWith("Return OFFICIAL_WORKFLOW_CHILD")
  if (first || correction) childCalls.push(body)
  const content = correction ? (alwaysInvalid ? '{"wrong":true}' : '{"ok":true}') : first ? '{"wrong":true}' : "ACK"

  const chunk = (delta, finish_reason = null) => ({
    id: "official-workflow",
    object: "chat.completion.chunk",
    created: 1,
    model: "fixture",
    choices: [{ index: 0, delta, finish_reason }],
  })
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.write(`data: ${JSON.stringify(chunk({ role: "assistant", content }))}\n\n`)
  response.write(
    `data: ${JSON.stringify({ ...chunk({}, "stop"), usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\n`,
  )
  response.end("data: [DONE]\n\n")
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
await writeFile(
  join(home, "config.toml"),
  `[models]\ndefault = "fixture"\n[model.fixture]\nmodel = "fixture"\nname = "Workflow comparison"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[workflows]\nenabled = true\n[memory]\nenabled = false\n[cli]\nuse_leader = false\n`,
)
const child = spawn("grok", ["agent", "stdio", "--leader-socket", join(output, "leader.sock")], {
  cwd,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    HOME: home,
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
})
const exited = new Promise((resolve) => child.once("exit", resolve))
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
try {
  await deadline(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    30000,
    "official initialize",
  )
  const session = await connection.newSession({ cwd, mcpServers: [] })
  await deadline(
    connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "/workflow native-reference --agent-budget 1" }],
    }),
    20000,
    "official saved workflow launch",
  )
  await poll(
    () => calls.some((call) => JSON.stringify(call).includes("Return OFFICIAL_WORKFLOW_CHILD")),
    "official independent child",
    20000,
  )
  await poll(
    () =>
      events.some(
        (event) =>
          event.params?.update?.sessionUpdate === "workflow_updated" &&
          event.params.update.status === "complete" &&
          JSON.stringify(event.params.update).includes(alwaysInvalid ? "structured output validation failed" : "ok"),
      ),
    "official workflow outcome",
    20000,
  )
  const children = childCalls
  assert.equal(children.length, 2)
  assert.ok(JSON.stringify(children[1].messages.at(-1)).includes("output contract"))
  const completed = events.findLast((event) => event.params?.update?.status === "complete").params.update
  assert.equal(completed.agents_used, 1)
  assert.equal(completed.agents[0].tokens_used, 10)
  assert.ok(children.every((call) => !(call.tools ?? []).some((tool) => tool.function?.name === "workflow")))
  console.log(
    JSON.stringify(
      {
        checks: [
          alwaysInvalid
            ? "installed-schema-correction-stops-after-one-invalid-retry"
            : "installed-output-schema-invalid-first-reply-corrects-once-with-agent-budget-one",
          "workflow-child-cannot-launch-nested-workflow",
        ],
        providerCalls: calls.length,
        workflowChildCalls: children.length,
        workflowUpdates: events
          .filter((event) => event.params?.update?.sessionUpdate === "workflow_updated")
          .map((event) => event.params.update),
        output,
      },
      null,
      2,
    ),
  )
} finally {
  child.kill("SIGTERM")
  await deadline(exited, 10000, "official shutdown").catch(() => child.kill("SIGKILL"))
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(output, "comparison.json"), JSON.stringify({ calls, events }, null, 2))
  await writeFile(join(output, "stderr.log"), Buffer.concat(logs))
}

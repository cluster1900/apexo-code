// Isolated installed-runtime comparison; no reference executable is used by migrated product code.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"
const output = await mkdtemp(join(tmpdir(), "apexo-workflow-effort-reference-"))
const home = join(output, "home"),
  cwd = join(output, "workspace")
await mkdir(join(home, "workflows"), { recursive: true })
await mkdir(cwd)
const calls = [],
  events = [],
  logs = [],
  results = []
const models = [
  {
    id: "fixture",
    object: "model",
    supportsReasoningEffort: true,
    reasoningEffort: "medium",
    reasoningEfforts: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
  },
  { id: "plain", object: "model", supportsReasoningEffort: false },
]
const provider = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("content-type", "application/json")
    return res.end(JSON.stringify({ data: models }))
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push(body)
  const delta = (content, finish_reason = null) => ({
    id: "workflow-effort",
    object: "chat.completion.chunk",
    created: 1,
    model: body.model,
    choices: [{ index: 0, delta: content, finish_reason }],
  })
  res.writeHead(200, { "content-type": "text/event-stream" })
  res.end(
    `data: ${JSON.stringify(delta({ role: "assistant", content: "EFFORT_REFERENCE_CHILD" }))}\n\ndata: ${JSON.stringify({ ...delta({}, "stop"), usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
  )
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
const base = `http://127.0.0.1:${provider.address().port}/v1`
await writeFile(
  join(home, "config.toml"),
  `[models]\ndefault="fixture"\n[model.fixture]\nmodel="fixture"\nname="Effort fixture"\nbase_url="${base}"\napi_key="fixture"\napi_backend="chat_completions"\ncontext_window=100000\nsupports_reasoning_effort=true\nreasoning_effort="medium"\nreasoning_efforts=[{value="low",label="Low"},{value="medium",label="Medium"},{value="high",label="High"}]\n[model.plain]\nmodel="plain"\nname="No effort fixture"\nbase_url="${base}"\napi_key="fixture"\napi_backend="chat_completions"\ncontext_window=100000\nsupports_reasoning_effort=false\n[workflows]\nenabled=true\n[memory]\nenabled=false\n[cli]\nuse_leader=false\n`,
)
const cases = [
  ["high", "fixture", "high"],
  ["case", "fixture", "LOW"],
  ["omitted", "fixture", undefined],
  ["outside", "fixture", "max"],
  ["unknown", "fixture", "ultra"],
  ["plain", "plain", "high"],
]
for (const [name, model, effort] of cases)
  await writeFile(
    join(home, "workflows", `${name}.rhai`),
    `let meta=#{name:"${name}",description:"Local effort comparison"}; let r=agent("EFFORT_PROBE_${name}",#{model:"${model}",capability_mode:"read-only"${effort === undefined ? "" : `,effort:"${effort}"`}}); complete(r.output);`,
  )
const child = spawn(process.env.GROK_BIN ?? "grok", ["agent", "stdio", "--leader-socket", join(output, "leader.sock")], {
  cwd,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    HOME: home,
    GROK_HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    GROK_CONFIG: "",
    GROK_CONFIG_PATH: "",
    GROK_WORKFLOWS: "1",
    GROK_MEMORY: "0",
    GROK_MANAGED_MCPS_ENABLED: "0",
    GROK_TITLE_REFRESH: "0",
    GROK_TURN_SUMMARY: "0",
    GROK_MODELS_BASE_URL: base,
    GROK_MODELS_LIST_URL: `${base}/models`,
    XAI_API_KEY: "fixture",
    ...Object.fromEntries(
      ["CURSOR", "CLAUDE", "CODEX"].flatMap((v) =>
        ["MCPS", "RULES", "SKILLS", "AGENTS", "HOOKS"].map((s) => [`GROK_${v}_${s}_ENABLED`, "0"]),
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
    "initialize",
  )
  const session = await connection.newSession({ cwd, mcpServers: [] })
  await writeFile(join(output, "catalog.json"), JSON.stringify(session.models, null, 2))
  for (const [name, model, effort] of cases) {
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
        x.messages?.some((message) => message.role === "user" && message.content === `EFFORT_PROBE_${name}`),
      )
    results.push({
      name,
      model,
      effort,
      status: terminal.status,
      summary: terminal.result_summary,
      error: terminal.error ?? terminal.message,
      calls: observed.map((x) => ({ model: x.model, reasoning_effort: x.reasoning_effort, reasoning: x.reasoning })),
    })
  }
  assert.deepEqual(
    results.map((result) => result.status),
    ["complete", "complete", "complete", "complete", "failed", "complete"],
  )
  assert.deepEqual(
    results.map((result) => result.calls.map((call) => call.reasoning_effort)),
    [["high"], ["low"], ["medium"], ["max"], [], [undefined]],
  )
  const advertised = session.models.availableModels.find((model) => model.modelId === "fixture")._meta
  assert.deepEqual(
    advertised.reasoningEfforts.map((item) => item.value),
    ["low", "medium", "high"],
  )
  assert.equal(advertised.supportsReasoningEffort, true)
  console.log(
    JSON.stringify(
      {
        output,
        checks: 6,
        results,
        childCalls: results.flatMap((result) => result.calls).length,
        providerCalls: calls.length,
      },
      null,
      2,
    ),
  )
} finally {
  child.kill("SIGTERM")
  await deadline(exited, 10000, "reference shutdown").catch(async () => {
    child.kill("SIGKILL")
    await exited
  })
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(output, "observations.json"), JSON.stringify({ results, calls, events }, null, 2))
  await writeFile(join(output, "stderr.log"), Buffer.concat(logs))
  console.error(`Evidence: ${output}`)
}

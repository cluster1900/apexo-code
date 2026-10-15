// Isolated installed-runtime evidence only; Apexo never depends on this process.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, writeFile, readFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const scenario = process.argv[2] ?? "unknown-agent"
assert.ok(["valid", "unknown-agent", "unknown-model"].includes(scenario))
const pair =
  scenario === "valid"
    ? { model: "role-fixture", agent_type: "grok-build" }
    : scenario === "unknown-agent"
      ? { model: "role-fixture", agent_type: "apexo-reference-missing-agent" }
      : { model: "apexo-reference-missing-model", agent_type: "grok-build" }
const directory = await mkdtemp(join(tmpdir(), "apexo-role-selection-official-"))
const grokHome = join(directory, "grok-home")
const workspace = join(directory, "workspace")
await mkdir(grokHome)
await mkdir(workspace)
const calls = []
const events = []
const logs = []
const checks = []
const planned = {
  mode: "advised",
  phase: "initial",
  verifications: 0,
  strategies: 0,
  plan: undefined,
  planText: undefined,
  workers: [],
}
const files = new Map()
const allowedWrites = new Set()
const provider = createServer(async (request, response) => {
  if (request.method !== "POST")
    return response.end(
      JSON.stringify({
        data: [
          { id: "fixture", object: "model" },
          { id: "role-fixture", object: "model" },
        ],
      }),
    )
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push({ phase: planned.phase, body })
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
  const messages = body.messages ?? []
  const text = JSON.stringify(messages)
  const flattened = messages
    .map((item) =>
      typeof item.content === "string" ? item.content : (item.content ?? []).map((part) => part.text ?? "").join("\n"),
    )
    .join("\n")
  const phase = body.tools?.some((tool) => tool.function?.name === "session_title")
    ? "title"
    : text.includes("Goal Plan Writer")
      ? "planning"
      : text.includes("Goal Strategist")
        ? "strategizing"
        : text.includes("adversarial verifier")
          ? "verifying"
          : text.includes("hidden completion evaluator")
            ? "evaluating"
            : "executing"
  calls.at(-1).phase = phase
  calls.at(-1).mode = planned.mode
  const output = { content: "Concrete evidence is available", tool: undefined, args: undefined }
  if (["planning", "verifying", "strategizing"].includes(phase)) {
    const paths =
      phase === "planning"
        ? [flattened.match(/your only write is `([^`]+)`/)?.[1]]
        : phase === "strategizing"
          ? [flattened.match(/Write a short Markdown note to `([^`]+)`/)?.[1]]
          : [flattened.match(/JSON verdict[^`\n]*`([^`\n]+)`/)?.[1], flattened.match(/Details[^`\n]*`([^`\n]+)`/)?.[1]]
    assert.ok(paths.every(Boolean), `reference ${phase} artifact paths`)
    const step = files.get(paths[0]) ?? 0
    files.set(paths[0], step + 1)
    if (!step && phase === "verifying") planned.verifications++
    if (!step && phase === "strategizing") planned.strategies++
    if (phase === "strategizing") planned.plan = flattened.match(/Do NOT edit `([^`]+)`/)?.[1]
    if (step < paths.length && !(phase === "strategizing" && planned.mode === "empty")) {
      const achieved = planned.verifications > 1
      output.tool = "write"
      const content =
        phase === "planning"
          ? "# Goal plan\n## Objective\nPreserve every original requirement and independently verify its evidence.\n## Acceptance criteria\nProduce and verify the requested evidence.\n## Verification plan\nInspect the deliverable independently.\n"
          : phase === "strategizing"
            ? "# Strategy\nSTRATEGY_REFERENCE: isolate the boundary and independently reproduce the missing evidence."
            : step === 0
              ? JSON.stringify({
                  refuted: !achieved,
                  findings: achieved ? [] : ["Independent reproduction is missing"],
                  evidence: "Independent evidence reviewed",
                  confidence: "high",
                  blocking: "none",
                  details_md: "Independent evidence reviewed",
                })
              : "# Findings\nIndependent evidence reviewed."
      output.args = { file_path: paths[step], content }
      if (phase === "planning") planned.planText = content
      allowedWrites.add(paths[step])
    } else output.content = phase === "verifying" ? (planned.verifications > 1 ? "Not Refuted" : "Refuted") : "Done"
  } else if (phase === "title") {
    output.tool = "session_title"
    output.args = { session_title: "Goal strategy comparison" }
  } else if (phase === "evaluating")
    output.content = JSON.stringify({
      decision: "candidate_complete",
      evidence: "Worker produced concrete evidence",
      next_step: "Independently verify",
      blocker_key: "",
    })
  else planned.workers.push(flattened)
  const content = output.content
  const delta = output.tool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `strategy_${calls.length}`,
            type: "function",
            function: { name: output.tool, arguments: JSON.stringify(output.args) },
          },
        ],
      }
    : { role: "assistant", content }
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(
    [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      {
        choices: [{ index: 0, delta: {}, finish_reason: output.tool ? "tool_calls" : "stop" }],
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
  `[models]\ndefault = "fixture"\n[model.fixture]\nmodel = "fixture"\nname = "Strategy fixture"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "local-fixture-key"\napi_backend = "chat_completions"\ncontext_window = 100000\n[model.role-fixture]\nmodel = "role-fixture"\nname = "Role fixture"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "local-fixture-key"\napi_backend = "chat_completions"\ncontext_window = 100000\n[goal]\nuse_current_model_only = false\nplanner_model = { model = "${pair.model}", agent_type = "${pair.agent_type}" }\nstrategist_model = { model = "${pair.model}", agent_type = "${pair.agent_type}" }\nskeptic_models = [{ model = "${pair.model}", agent_type = "${pair.agent_type}" }]\n[memory]\nenabled = false\n[memory_v2]\nenabled = false\n`,
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
    GROK_GOAL: "1",
    GROK_GOAL_PLANNER: "1",
    GROK_GOAL_CLASSIFIER: "1",
    GROK_GOAL_VERIFIER_N: "1",
    GROK_GOAL_STRATEGIST_EVERY: "1",
    GROK_GOAL_USE_CURRENT_MODEL_ONLY: "0",
    GROK_GOAL_SUMMARY: "0",
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
    async requestPermission(params) {
      if (allowedWrites.has(params.toolCall.rawInput?.file_path)) {
        const option = params.options.find((item) => item.kind === "allow_once")
        if (option) return { outcome: { outcome: "selected", optionId: option.optionId } }
      }
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
  for (const mode of ["advised"]) {
    planned.mode = mode
    planned.verifications = 0
    planned.strategies = 0
    planned.workers = []
    const sessionId = (await connection.newSession({ cwd: workspace, mcpServers: [] })).sessionId
    await deadline(
      connection.prompt({
        sessionId,
        prompt: [
          {
            type: "text",
            text: "/goal Produce concrete evidence and independently verify every original requirement --budget 100000",
          },
        ],
      }),
      60000,
      `official strategy ${mode}`,
    )
    const info = await poll(
      async () => {
        const response = await connection.extMethod("_x.ai/session/state", { sessionId, cwd: workspace })
        const goal = (response.result ?? response).goal
        return goal && goal.status !== "active" && goal
      },
      "official strategy terminal state",
      30000,
    )
    assert.equal(info.status, "complete")
    assert.equal(planned.strategies, 1)
    assert.equal(await readFile(planned.plan, "utf8"), planned.planText)
    if (mode === "advised") assert.ok(planned.workers.some((text) => text.includes("STRATEGY_REFERENCE")))
    const goalCalls = calls.filter((call) => call.phase !== "initial")
    assert.ok(goalCalls.length > 0)
    for (const call of goalCalls.filter((call) => call.phase !== "title")) {
      // The pinned implementation forces its mirror-fork planner to the parent
      // model for prefix-cache reuse; explicit pairs apply to the other roles.
      const override = ["verifying", "strategizing"].includes(call.phase)
      assert.equal(
        call.body.model,
        scenario === "valid" && override ? "role-fixture" : "fixture",
        "installed role model policy matches the pinned implementation",
      )
    }
    const sessionRoot = join(grokHome, "sessions")
    const persisted = (
      await Promise.all(
        (await readdir(sessionRoot, { recursive: true }))
          .filter((name) => name.endsWith("events.jsonl"))
          .map(async (name) =>
            (await readFile(join(sessionRoot, name), "utf8"))
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line)),
          ),
      )
    ).flat()
    const decisions = persisted.filter(
      (event) => event.type === (scenario === "valid" ? "goal_role_model_resolved" : "goal_role_model_fail_open"),
    )
    assert.ok(decisions.some((event) => event.role === "skeptic"))
    assert.ok(decisions.some((event) => event.role === "strategist"))
    assert.ok(!decisions.some((event) => event.role === "planner"))
    for (const event of decisions) {
      if (scenario === "valid") assert.equal(event.model_id, "role-fixture")
      else assert.equal(event.reason, scenario === "unknown-agent" ? "toolset_unknown" : "model_unknown")
    }
    await writeFile(join(directory, "role-decisions.json"), JSON.stringify(decisions, null, 2))
    checks.push(`${scenario}-completes-with-expected-models-and-unchanged-plan`)
  }
  console.log(
    JSON.stringify(
      {
        kind: "official-installed",
        scenario,
        requested: pair,
        checks,
        passed: checks.length,
        providerCalls: calls.length,
        phases: calls.map((call) => ({ mode: call.mode, phase: call.phase })),
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
  await writeFile(join(directory, "events.json"), JSON.stringify(events, null, 2))
  console.error(`Role-selection evidence: ${directory}`)
}

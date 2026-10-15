// Real native Rhai effort selection through ordinary Session execution, with isolated CLI/Desktop profiles.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const calls = [],
  checks = [],
  customHeaders = []
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  http: async (request, response) => {
    if (request.headers["x-workflow-custom"]) customHeaders.push(request.headers["x-workflow-custom"])
    if (!request.url.endsWith("/messages")) return false
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    calls.push({ model: body.model, effort: body.output_config?.effort, custom: body.workflow_custom })
    assert.ok(!body.tools.some((tool) => ["workflow", "write"].includes(tool.name)))
    const events = [
      {
        type: "message_start",
        message: {
          id: "effort",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 0 },
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "EFFORT_CHILD_OK" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ]
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""))
    return true
  },
  next: ({ body }) => {
    const tools = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
    assert.ok(!tools.includes("workflow") && !tools.includes("write"))
    calls.push({
      model: body.model,
      effort: body.reasoning?.effort ?? body.reasoning_effort,
      custom: body.workflow_custom,
    })
    return { content: "EFFORT_CHILD_OK" }
  },
})
const idle = () =>
  poll(async () => Object.keys((await fixture.api("/api/session/active")).data).length === 0, "Workflow drain idle")
const settled = (url) =>
  poll(
    async () => {
      const info = await fixture.api(url)
      return ["pending", "running"].includes(info.status) ? undefined : info
    },
    "Workflow effort",
    25000,
  )
const variant = (id, body, headers = {}) => ({ id, body, headers })
const info = (variants = [], request = {}) => ({
  name: "Effort fixture",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  limit: { context: 100000, output: 10000 },
  variants,
  request,
})
try {
  const base = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT).provider.xai.options.baseURL
  const responses = (effort) => ({ reasoning: { effort } })
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      providers: {
        xai: {
          api: { type: "aisdk", package: "@ai-sdk/xai", url: base, settings: { apiKey: "fixture" } },
          models: {
            "grok-4.7": info(
              [
                variant("calm", responses("low")),
                variant("careful", responses("high")),
                variant("custom", { ...responses("low"), workflow_custom: "keep" }, { "x-workflow-custom": "keep" }),
                variant(
                  "custom-high",
                  { ...responses("high"), workflow_custom: "keep" },
                  { "x-workflow-custom": "keep" },
                ),
              ],
              { variant: "calm" },
            ),
            plain: info(),
            ambiguous: info([variant("one", responses("high")), variant("two", responses("high"))]),
            conflict: info([
              variant("custom", { ...responses("low"), workflow_custom: "keep" }, { "x-workflow-custom": "keep" }),
              variant("high", responses("high")),
            ]),
          },
        },
        chat: {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: base, settings: { apiKey: "fixture" } },
          models: { chat: info([variant("light", { reasoning_effort: "low" })]) },
        },
        anthropic: {
          api: { type: "aisdk", package: "@ai-sdk/anthropic", url: base, settings: { apiKey: "fixture" } },
          models: { anthropic: info([variant("thorough", { output_config: { effort: "high" } })]) },
        },
      },
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    }),
  )
  const parent = async (model = { providerID: "xai", id: "grok-4.7" }) =>
    (await fixture.api("/api/session", { location: { directory: fixture.directory }, model, agent: "build" })).data
  const first = await parent()
  const run = async (session, script, budget = 1) => {
    const root = `/api/session/${session.id}/workflow`
    const pending = await fixture.api(root, { source: { type: "script", name: "effort", script }, agentBudget: budget })
    const target = `${root}/${pending.id}`
    const result = await settled(target)
    await idle()
    return { info: result, target }
  }
  const mixed = await run(
    first,
    'complete(parallel([#{prompt:"RESPONSE",effort:"HIGH",capability_mode:"read-only"},#{prompt:"CHAT",model:"chat/chat",effort:"low",capability_mode:"read-only"},#{prompt:"ANTHROPIC",model:"anthropic/anthropic",effort:"high",capability_mode:"read-only"}]));',
    3,
  )
  assert.equal(mixed.info.status, "completed", mixed.info.message)
  assert.deepEqual(
    calls.map((call) => [call.model, call.effort]).toSorted(),
    [
      ["grok-4.7", "high"],
      ["chat", "low"],
      ["anthropic", "high"],
    ].toSorted(),
  )
  for (const childID of mixed.info.children) {
    const child = (await fixture.api(`/api/session/${childID}`)).data
    assert.ok(["careful", "light", "thorough"].includes(child.model.variant))
    assert.equal(child.parentID, first.id)
  }
  checks.push("parallel-independent-native-apis-wire-efforts-and-durable-child-variants")
  const omitted = await run(first, 'complete(agent("OMITTED",#{capability_mode:"read-only"}).output);')
  assert.equal(omitted.info.status, "completed", omitted.info.message)
  assert.equal(calls.at(-1).effort, "low")
  checks.push("omitted-effort-preserves-native-default-variant")
  const custom = await parent({ providerID: "xai", id: "grok-4.7", variant: "custom" })
  const preserved = await run(custom, 'complete(agent("CUSTOM",#{effort:"high",capability_mode:"read-only"}).output);')
  assert.equal(preserved.info.status, "completed", preserved.info.message)
  assert.equal(calls.at(-1).custom, "keep")
  assert.equal(calls.at(-1).effort, "high")
  assert.deepEqual(customHeaders, ["keep"])
  checks.push("custom-body-and-headers-preserved-when-selecting-effort")
  for (const [session, options] of [
    [first, 'effort:"ultra"'],
    [first, 'effort:"max"'],
    [first, 'model:"xai/plain",effort:"high"'],
    [first, 'model:"xai/ambiguous",effort:"high"'],
    [await parent({ providerID: "xai", id: "conflict", variant: "custom" }), 'effort:"high"'],
  ]) {
    const before = calls.length
    const invalid = await run(session, `complete(agent("REJECT",#{${options},capability_mode:"read-only"}).output);`)
    assert.equal(invalid.info.status, "failed")
    assert.deepEqual(invalid.info.children, [])
    assert.equal(calls.length, before)
  }
  checks.push("unknown-unavailable-ambiguous-and-custom-conflicts-reject-before-child-provider")
  const budget = await run(
    first,
    'complete(parallel([#{prompt:"BUDGET_HIGH",effort:"high",capability_mode:"read-only"},#{prompt:"BUDGET_LOW",effort:"low",capability_mode:"read-only"}]));',
    1,
  )
  assert.equal(budget.info.status, "budget_limited")
  assert.deepEqual(budget.info.children, [])
  await fixture.api(`${budget.target}/resume`, { agentBudget: 2 })
  const resumed = await settled(budget.target)
  await idle()
  assert.equal(resumed.status, "completed", resumed.message)
  assert.deepEqual(
    calls
      .slice(-2)
      .map((call) => call.effort)
      .toSorted(),
    ["high", "low"],
  )
  checks.push("budget-resume-retains-per-task-effort")
  await fixture.crash()
  await fixture.reopen()
  assert.equal((await fixture.api(budget.target)).status, "completed")
  assert.equal(calls.length, 7)
  checks.push("completed-receipts-survive-process-restart-without-model-work")
  console.log(JSON.stringify({ checks, providerCalls: calls.length, output: fixture.output }, null, 2))
} finally {
  await fixture.close()
  await writeFile(
    join(fixture.output, "workflow-effort.json"),
    JSON.stringify({ checks, calls, customHeaders }, null, 2),
  )
}

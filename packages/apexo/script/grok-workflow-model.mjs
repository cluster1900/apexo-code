// Actual native Workflow child model selection; CLI or packaged Desktop backend.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const calls = [],
  checks = []
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next: ({ body, text }) => {
    const tools = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
    assert.ok(!tools.includes("workflow") && !tools.includes("write"))
    calls.push({ model: body.model, variant: body.workflow_variant, text })
    return { content: "MODEL_CHILD_OK" }
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
    "Workflow model selection",
    25_000,
  )
try {
  const config = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT)
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      providers: {
        xai: {
          api: {
            type: "aisdk",
            package: "@ai-sdk/xai",
            url: config.provider.xai.options.baseURL,
            settings: { apiKey: "fixture" },
          },
          models: Object.fromEntries(
            ["grok-4.7", "workflow-alternate"].map((id) => [
              id,
              {
                name: id,
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 100000, output: 10000 },
                variants: [{ id: "precise", body: { workflow_variant: "precise" } }],
              },
            ]),
          ),
        },
      },
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    }),
  )
  const parent = (
    await fixture.api("/api/session", {
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
      agent: "build",
    })
  ).data
  const root = `/api/session/${parent.id}/workflow`
  const run = async (input) => {
    const info = await fixture.api(root, input)
    const target = `${root}/${info.id}`
    return { info: await settled(target), target }
  }
  const mixed = await run({
    source: {
      type: "script",
      name: "models",
      script:
        'complete(parallel([#{prompt:"INHERITED",capability_mode:"read-only"},#{prompt:"EXPLICIT",model:"xai/workflow-alternate",capability_mode:"read-only"}]));',
    },
    agentBudget: 2,
  })
  assert.equal(mixed.info.status, "completed", mixed.info.message)
  assert.equal(mixed.info.agentsSpent, 2)
  assert.equal(mixed.info.tokens, 240)
  assert.deepEqual(calls.map((call) => call.model).toSorted(), ["grok-4.7", "workflow-alternate"])
  for (const childID of mixed.info.children) {
    const child = (await fixture.api(`/api/session/${childID}`)).data
    assert.equal(child.parentID, parent.id)
    assert.ok(["grok-4.7", "workflow-alternate"].includes(child.model.id))
  }
  await idle()
  checks.push("mixed-parallel-models-inheritance-permissions-and-real-token-usage")
  const variant = await run({
    source: {
      type: "definition",
      definition: {
        name: "variant",
        description: "Model variant",
        stages: [
          {
            name: "child",
            prompt: "VARIANT",
            readOnly: true,
            model: { providerID: "xai", id: "workflow-alternate", variant: "precise" },
          },
        ],
      },
    },
    agentBudget: 1,
  })
  assert.equal(variant.info.status, "completed", variant.info.message)
  assert.equal(calls.at(-1).model, "workflow-alternate")
  assert.equal(calls.at(-1).variant, "precise")
  await idle()
  checks.push("canonical-stage-model-and-native-variant-reach-provider")
  for (const model of [
    { providerID: "xai", id: "missing" },
    { providerID: "xai", id: "workflow-alternate", variant: "missing" },
  ]) {
    const before = calls.length
    const invalid = await run({
      source: {
        type: "definition",
        definition: {
          name: "invalid",
          description: "Invalid explicit model",
          stages: [{ name: "child", prompt: "INVALID", readOnly: true, model }],
        },
      },
      agentBudget: 1,
    })
    assert.equal(invalid.info.status, "failed")
    assert.match(invalid.info.message, /unavailable/i)
    assert.deepEqual(invalid.info.children, [])
    assert.equal(calls.length, before)
    await idle()
  }
  checks.push("unavailable-model-and-variant-fail-before-child-or-provider")
  const limited = await run({
    source: {
      type: "script",
      name: "budget-models",
      script:
        'complete(parallel([#{prompt:"BUDGET_A",model:"xai/workflow-alternate",capability_mode:"read-only"},#{prompt:"BUDGET_B",capability_mode:"read-only"}]));',
    },
    agentBudget: 1,
  })
  assert.equal(limited.info.status, "budget_limited")
  assert.deepEqual(limited.info.children, [])
  assert.equal(calls.length, 3)
  await idle()
  await fixture.api(`${limited.target}/resume`, { agentBudget: 2 })
  const resumed = await settled(limited.target)
  assert.equal(resumed.status, "completed", resumed.message)
  assert.equal(resumed.agentsSpent, 2)
  assert.equal(resumed.tokens, 240)
  assert.deepEqual(
    calls
      .slice(3)
      .map((call) => call.model)
      .toSorted(),
    ["grok-4.7", "workflow-alternate"],
  )
  await idle()
  checks.push("budget-resume-preserves-immutable-explicit-model-options")
  await fixture.crash()
  await fixture.reopen()
  const persisted = await fixture.api(limited.target)
  assert.equal(persisted.status, "completed")
  assert.equal(persisted.tokens, 240)
  assert.equal(calls.length, 5)
  checks.push("completed-model-receipts-persist-without-provider-replay")
  console.log(JSON.stringify({ checks, providerCalls: calls.length, output: fixture.output }, null, 2))
} finally {
  await fixture.close()
  await writeFile(join(fixture.output, "workflow-model.json"), JSON.stringify({ checks, calls }, null, 2))
}

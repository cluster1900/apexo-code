// Actual native selected-agent Workflow execution in isolated CLI/Desktop profiles.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const calls = [],
  checks = []
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next: ({ body, input, text }) => {
    const system = input.filter((message) => message.role === "system" || message.role === "developer")
    calls.push({ model: body.model, text, system })
    return { content: "SELECTED_AGENT_RESULT" }
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
    "Workflow selected agent",
    25000,
  )
try {
  const base = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT).provider.xai.options.baseURL
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      agents: {
        parent: {
          system: "PARENT_AGENT_MARKER",
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "task", resource: "blocked", effect: "deny" },
          ],
        },
        helper: { mode: "subagent", model: "selection/selected", system: "SELECTED_AGENT_MARKER" },
        blocked: { mode: "subagent" },
        hidden: { mode: "subagent", hidden: true },
        primary: { mode: "primary" },
      },
      providers: {
        selection: {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: base, settings: { apiKey: "fixture" } },
          models: Object.fromEntries(
            ["parent", "selected", "override"].map((id) => [
              id,
              {
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 100000, output: 10000 },
              },
            ]),
          ),
        },
      },
    }),
  )
  const parent = (
    await fixture.api("/api/session", {
      location: { directory: fixture.directory },
      agent: "parent",
      model: { providerID: "selection", id: "parent" },
    })
  ).data
  const root = `/api/session/${parent.id}/workflow`
  const pending = await fixture.api(root, {
    source: {
      type: "script",
      name: "agent-selection",
      script:
        'let first=agent("SELECTED_FIRST",#{agent_type:"helper",capability_mode:"read-only"}); await_user("verification","Inspect selection"); let second=agent("SELECTED_SECOND",#{agent_type:"helper",model:"selection/override",capability_mode:"read-only"}); complete(#{first:first.output,second:second.output});',
    },
    agentBudget: 2,
  })
  const target = `${root}/${pending.id}`
  const paused = await settled(target)
  assert.equal(paused.status, "paused", paused.message)
  assert.equal(paused.children.length, 1)
  assert.deepEqual(
    calls.map((call) => call.model),
    ["selected"],
  )
  await idle()
  await fixture.api(`${target}/resume`, {})
  const completed = await settled(target)
  assert.equal(completed.status, "completed", completed.message)
  assert.deepEqual(completed.result, { first: "SELECTED_AGENT_RESULT", second: "SELECTED_AGENT_RESULT" })
  assert.deepEqual(
    calls.map((call) => call.model),
    ["selected", "override"],
  )
  for (const call of calls) {
    assert.match(JSON.stringify(call.system), /SELECTED_AGENT_MARKER/)
    assert.doesNotMatch(JSON.stringify(call.system), /PARENT_AGENT_MARKER/)
  }
  for (const id of completed.children) {
    const child = (await fixture.api(`/api/session/${id}`)).data
    assert.equal(child.agent, "helper")
    assert.equal(child.parentID, parent.id)
  }
  checks.push(
    "native-selected-agent-system-model-and-managed-child-identity",
    "pause-resume-replays-receipt-without-new-provider-turn",
  )
  await idle()
  for (const agent of ["missing", "hidden", "primary", "blocked"]) {
    const rejected = await fixture.api(root, {
      source: {
        type: "script",
        name: "reject-agent",
        script: `complete(agent("NEVER_EXECUTE",#{agent_type:"${agent}"}));`,
      },
    })
    const failed = await settled(`${root}/${rejected.id}`)
    assert.equal(failed.status, "failed")
    assert.deepEqual(failed.children, [])
    assert.equal(calls.length, 2)
    await idle()
  }
  checks.push("invalid-and-denied-agents-create-no-child-and-call-no-provider")
  await fixture.crash()
  await fixture.reopen()
  const persisted = await fixture.api(target)
  assert.equal(persisted.status, "completed")
  assert.deepEqual(persisted.children, completed.children)
  assert.equal(calls.length, 2)
  checks.push("completed-selected-agent-receipts-persist-across-process-restart")
  console.log(JSON.stringify({ checks, providerCalls: calls.length, output: fixture.output }, null, 2))
} finally {
  await fixture.close()
  await writeFile(join(fixture.output, "workflow-agent.json"), JSON.stringify({ checks, calls }, null, 2))
}

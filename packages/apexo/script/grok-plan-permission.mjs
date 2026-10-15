// Real compatibility CLI/Desktop permission acceptance; native Plan is a separate capability.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, deadline, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const checks = []
const evidence = []
for (const scenario of ["allow", "ask-approve", "ask-reject", "deny"]) {
  const state = { sent: false }
  const requests = []
  const runtime = await startShellFixture(kind, {
    config: {
      snapshot: false,
      permission: { "*": "allow", plan_enter: scenario.startsWith("ask") ? "ask" : scenario },
    },
    next: ({ body }) => {
      const tools = (body.tools ?? []).map((tool) => tool.function ?? tool)
      const enter = tools.find((tool) => ["enter_plan_mode", "plan_enter"].includes(tool.name))
      requests.push({ tools: tools.map((tool) => tool.name), input: body.messages ?? body.input })
      if (enter && !state.sent) {
        state.sent = true
        return { tool: enter.name, args: {} }
      }
      return { content: "PLAN_PERMISSION_DONE" }
    },
  })
  try {
    const session = await runtime.api("/session", {})
    const prompt = runtime.api(`/session/${session.id}/message`, {
      agent: "build",
      model: { providerID: "xai", modelID: "grok-4.7" },
      parts: [{ type: "text", text: "Inspect the project in Plan mode." }],
    })
    // Attach a rejection handler immediately while the real permission request is inspected.
    const settled = prompt.then(
      (value) => ({ value }),
      (error) => ({ error: String(error) }),
    )
    const messages = () => runtime.api(`/session/${session.id}/message`)
    const planInputs = (items) => items.filter((item) => item.info.role === "user" && item.info.agent === "plan")
    if (scenario.startsWith("ask")) {
      const permission = await poll(
        async () => (await runtime.api("/permission")).find((item) => item.sessionID === session.id),
        "Plan entry permission",
      )
      assert.equal(permission.permission, "plan_enter")
      assert.deepEqual(permission.patterns, ["*"])
      assert.equal(planInputs(await messages()).length, 0, "Agent must not switch before the user's answer")
      await runtime.api(`/permission/${permission.id}/reply`, { reply: scenario === "ask-approve" ? "once" : "reject" })
      checks.push(`${scenario}: real permission precedes agent transition`)
    }
    const outcome = await deadline(settled, 20000, `${scenario} prompt settlement`)
    assert.equal(outcome.error, undefined)
    const final = await messages()
    const entered = scenario === "allow" || scenario === "ask-approve"
    assert.equal(planInputs(final).length, entered ? 1 : 0)
    if (entered) {
      assert.ok(planInputs(final)[0].parts.some((part) => part.type === "text" && part.synthetic === true))
      assert.ok(final.some((item) => item.info.role === "assistant" && item.info.agent === "plan"))
    }
    assert.equal(state.sent, scenario !== "deny")
    assert.equal((await runtime.api("/permission")).length, 0)
    checks.push(`${scenario}: ${entered ? "existing compatibility transition preserved" : "no Plan transition"}`)
    evidence.push({
      scenario,
      providerCalls: runtime.calls.length,
      planInputs: planInputs(final).length,
      output: runtime.output,
    })
    await writeFile(join(runtime.output, "plan-permission-requests.json"), JSON.stringify(requests, null, 2))
  } finally {
    await runtime.close()
  }
}
console.log(
  JSON.stringify(
    {
      kind,
      passed: checks.length,
      checks,
      evidence,
      providerCalls: evidence.reduce((sum, item) => sum + item.providerCalls, 0),
    },
    null,
    2,
  ),
)

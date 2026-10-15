// Native role-pair acceptance; run only after applying the corresponding source patch.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const cases = [
  { name: "valid", agent: "reviewer", model: "grok-role", selected: true },
  { name: "unknown-agent", agent: "missing", model: "grok-role", fallback: "agent_unavailable" },
  { name: "text-only-model", agent: "reviewer", model: "grok-no-tools", fallback: "model_unavailable" },
  { name: "unknown-model", agent: "reviewer", model: "missing-model", fallback: "model_unavailable" },
  { name: "read-denied", agent: "no-read", model: "grok-role", fallback: "agent_incapable" },
  { name: "grep-denied", agent: "no-grep", model: "grok-role", fallback: "agent_incapable" },
]
const strings = (value) =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : []
const checks = []
for (const scenario of cases) {
  const calls = []
  const files = new Map()
  const state = { verifications: 0 }
  const pair = { model: `xai/${scenario.model}`, agent_type: scenario.agent }
  const fixture = await startShellFixture(kind, {
    models: {
      "grok-role": { name: "Independent role", tool_call: true, limit: { context: 100000, output: 10000 } },
      "grok-no-tools": { name: "Text only", tool_call: false, limit: { context: 100000, output: 10000 } },
    },
    config: {
      goal: {
        verifier_count: 1,
        summary_enabled: false,
        strategist_every: 1,
        planner_model: pair,
        strategist_model: pair,
        skeptic_models: [pair],
      },
      agent: {
        reviewer: { mode: "subagent", permission: { edit: { "**/workspace/**": "deny" } } },
        "no-read": { mode: "subagent", permission: { read: "deny" } },
        "no-grep": { mode: "subagent", permission: { grep: "deny" } },
      },
      snapshot: false,
      compaction: { auto: false },
    },
    next: async ({ body }) => {
      const text = strings(body).join("\n")
      const phase = text.includes("independent goal planner")
        ? "planning"
        : text.includes("independent Goal strategy adviser")
          ? "strategizing"
          : text.includes("hidden completion evaluator")
            ? "evaluating"
            : text.includes("independent skeptical goal verifier")
              ? "verifying"
              : "executing"
      calls.push({ phase, model: body.model, body })
      const report = (key) => JSON.parse(new RegExp(`${key}=("[^"\\n]+")`).exec(text)?.[1] ?? "null")
      if (["planning", "strategizing", "verifying"].includes(phase)) {
        assert.equal(
          body.model,
          scenario.selected ? "grok-role" : "grok-4.7",
          "role pair is selected atomically before the first request",
        )
        const names = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
        assert.ok(names.includes("read") && names.includes("grep"), "selected role can inspect evidence")
        if (phase === "strategizing") assert.ok(!names.includes("bash"), "adviser remains tool-restricted")
        const file = report(
          phase === "planning" ? "PLAN_FILE" : phase === "strategizing" ? "STRATEGY_FILE" : "VERDICT_FILE",
        )
        assert.ok(file)
        const step = files.get(file) ?? 0
        files.set(file, step + 1)
        if (!step) {
          if (phase === "verifying") state.verifications++
          return {
            tool: "goal_report_write",
            args: {
              path: file,
              content:
                phase === "planning"
                  ? "Preserve original requirements and inspect evidence."
                  : phase === "strategizing"
                    ? "Inspect the remaining gap independently."
                    : JSON.stringify({
                        achieved: state.verifications > 1,
                        confidence: "high",
                        blocking: "none",
                        evidence: "Independent inspection",
                        unmet: state.verifications > 1 ? [] : ["Repeat independent verification"],
                      }),
            },
          }
        }
        if (phase === "verifying" && step === 1)
          return {
            tool: "goal_report_write",
            args: { path: report("DETAILS_FILE"), content: "Independent verification details." },
          }
        return { content: "Done" }
      }
      assert.equal(body.model, "grok-4.7", "worker and evaluator keep the current model")
      if (phase === "evaluating")
        return {
          content: JSON.stringify({
            decision: "candidate_complete",
            evidence: "Worker evidence exists",
            next_step: "Independently verify",
            blocker_key: "",
          }),
        }
      return { content: "Concrete worker evidence." }
    },
  })
  try {
    await writeFile(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
    const session = (
      await fixture.api("/api/session", {
        location: { directory: fixture.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    const root = `/api/session/${session.id}/goal`
    const id = `goal_roles${scenario.name.replaceAll("-", "")}`
    await fixture.api(root, {
      id,
      objective: "Produce evidence, preserve the original task and independently verify it.",
    })
    assert.equal(calls.length, 0)
    await fixture.api(`${root}/${id}/start`, { agent: "build", model: { providerID: "xai", id: "grok-4.7" } })
    const info = await poll(
      async () => {
        const goal = await fixture.api(root)
        return goal.status !== "active" && goal
      },
      "role-selection Goal settled",
      30000,
    )
    await poll(
      async () => Object.keys((await fixture.api("/api/session/active")).data).length === 0,
      "role children idle",
      15000,
    )
    assert.equal(info.status, "complete", JSON.stringify({ scenario: scenario.name, info, output: fixture.output }))
    assert.equal(info.tokensUsed, calls.length * 120, "preflight introduces no model request or unbilled fallback")
    assert.equal(calls.length, 14)
    assert.equal(info.strategy.status, "advised")
    const executions = [
      info.plannerExecution,
      info.strategy.execution,
      ...info.verification.results.map((result) => result.execution),
    ]
    for (const execution of executions) {
      assert.deepEqual(execution.requested, pair)
      assert.equal(execution.agent, scenario.selected ? "reviewer" : "build")
      assert.equal(execution.model.id, scenario.selected ? "grok-role" : "grok-4.7")
      assert.equal(execution.fallback, scenario.fallback)
    }
    checks.push({ name: scenario.name, providerCalls: calls.length, tokensUsed: info.tokensUsed })
  } finally {
    await fixture.close()
    console.error(`Role-selection ${scenario.name} evidence: ${fixture.output}`)
  }
}
console.log(JSON.stringify({ kind, passed: checks.length, checks }, null, 2))

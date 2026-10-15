// Real CLI/Electron provider requests: panel quorum, per-review evidence, concurrency and configuration.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const checks = [],
  evidence = []
for (const setting of [
  { name: "default", count: 3 },
  { name: "config-five", count: 5, config: { goal: { verifier_count: 5 } } },
  {
    name: "environment-over-config",
    count: 2,
    config: { goal: { verifier_count: 5 } },
    env: { GROK_GOAL_VERIFIER_N: "2" },
  },
  {
    name: "invalid-environment-falls-through",
    count: 4,
    config: { goal: { verifier_count: 4 } },
    env: { GROK_GOAL_VERIFIER_N: "invalid" },
  },
  { name: "zero-clamps-to-one", count: 1, config: { goal: { verifier_count: 0 } } },
]) {
  const calls = [],
    states = [],
    control = { scenario: "complete", round: 0, hold: undefined, cold: 0 }
  const runtime = await startShellFixture(kind, {
    goalReports: true,
    ...setting,
    next: async ({ body }) => {
      const text = JSON.stringify(body)
      if (text.includes("independent goal planner"))
        return { content: JSON.stringify({ plan: "Verify each original requirement" }) }
      if (text.includes("hidden completion evaluator"))
        return {
          content: JSON.stringify({
            decision: "candidate_complete",
            evidence: "Changed artifact and tests",
            next_step: "Verify all requirements",
            blocker_key: "",
          }),
        }
      if (!text.includes("independent skeptical goal verifier")) return { content: "PANEL_WORK_EVIDENCE" }
      const input = JSON.parse(body.messages.at(-1).content)
      calls.push({ scenario: control.scenario, input })
      if (input.verifierIndex === 0) control.round++
      if (input.verifierIndex > 0 && control.hold) {
        control.cold++
        await control.hold.promise
      }
      const rejected =
        control.round === 1 &&
        ((control.scenario === "gatekeeper" && input.verifierIndex === 0) ||
          (control.scenario === "cold-tie" && input.verifierIndex === 2) ||
          (control.scenario === "low-outlier" && input.verifierIndex === 0) ||
          (control.scenario === "external-blocker" && input.verifierIndex === 0))
      return {
        content: JSON.stringify({
          achieved: !rejected,
          evidence: `Evidence from independent verifier ${input.verifierIndex + 1}`,
          unmet: rejected ? ["Required artifact lacks checked evidence"] : [],
          confidence: control.scenario === "low-outlier" ? "low" : "high",
          blocking: rejected && control.scenario === "external-blocker" ? "unverifiable" : "none",
        }),
      }
    },
  })
  try {
    for (const scenario of setting.name === "default"
      ? ["complete", "gatekeeper", "cold-tie", "low-outlier", "external-blocker", "cancel", "restart"]
      : ["complete"]) {
      control.scenario = scenario
      control.round = 0
      control.cold = 0
      if (["cancel", "restart"].includes(scenario)) control.hold = Promise.withResolvers()
      const session = await runtime.api("/session", { title: "Goal panel contract" })
      const root = `/session/${session.id}/goal`
      const goal = await runtime.api(root, {
        id: `goal_${crypto.randomUUID().replaceAll("-", "")}`,
        objective: `Complete every requirement: ${scenario}`,
      })
      const target = `${root}/${goal.id}`
      await runtime.api(`${target}/start`, { agent: "build", model: { providerID: "xai", id: "grok-4.7" } })
      if (["cancel", "restart"].includes(scenario)) {
        await poll(() => control.cold === 2, "both cold verifiers started concurrently")
        assert.equal((await runtime.api(root)).verification.results.length, 1)
        if (scenario === "restart") {
          await runtime.crash()
          await runtime.reopen()
          const before = calls.length
          const restored = await runtime.api(root)
          assert.equal(restored.phase, "verifying")
          assert.equal(restored.verification.results.length, 1)
          assert.equal(calls.length, before)
          await assert.rejects(runtime.api(`${target}/run`, undefined, "POST"))
          assert.equal(calls.length, before)
        } else await runtime.api(`${target}/pause`, undefined, "POST")
        const paused = await poll(async () => {
          const value = await runtime.api(root)
          return value.status === "user_paused" && value.usageIncomplete && value
        }, "cancelled reviewers settled")
        states.push(paused)
        control.hold.resolve()
        control.hold = undefined
        await runtime.api(`${target}/resume`, undefined, "POST")
      }
      const result = await poll(
        async () => {
          const value = await runtime.api(root)
          return ["complete", "blocked", "infra_paused", "no_progress_paused"].includes(value.status) && value
        },
        "Goal panel settled",
        20000,
      )
      states.push(result)
      assert.equal(result.status, scenario === "external-blocker" ? "blocked" : "complete")
      assert.equal(result.verification.count, setting.count)
      assert.equal(result.verification.results.length, setting.count)
      assert.deepEqual(
        result.verification.results.map((item) => item.index),
        Array.from({ length: setting.count }, (_, i) => i),
      )
      assert.ok(
        result.verification.results.every(
          (item) => item.tokensUsed === 120 && item.evidence.includes("independent verifier"),
        ),
      )
      if (["gatekeeper", "cold-tie"].includes(scenario)) assert.equal(result.workerRounds, 2)
      if (scenario === "low-outlier") {
        assert.equal(result.workerRounds, 1)
        assert.equal(result.verification.results[0].achieved, false)
      }
      if (scenario === "gatekeeper") assert.equal(calls.filter((call) => call.scenario === scenario).length, 4)
      checks.push(`${setting.name}:${scenario}`)
    }
    evidence.push({ setting, output: runtime.output, modelRequests: runtime.calls.length, calls, states })
    await writeFile(join(runtime.output, "goal-panel.json"), JSON.stringify({ setting, calls, states }, null, 2))
  } finally {
    control.hold?.resolve()
    await runtime.close()
  }
}
console.log(
  JSON.stringify({ kind, checks, evidence: evidence.map(({ setting, output }) => ({ setting, output })) }, null, 2),
)

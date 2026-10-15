// Native progress acceptance; run only after the source patch and coordinated build are applied.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const plan =
  "# Original plan\n## Acceptance criteria\nProduce and independently verify the requested evidence.\n## Task checklist\n- [ ] Capture concrete evidence\n- [ ] Independently inspect evidence\n## Non-goals\n- [ ] Unrequested scope\n"
const strings = (value) =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : []
const checks = []
for (const scenario of ["valid", "invalid", "denied"]) {
  const calls = []
  const files = new Map()
  const state = { workers: 0, evaluations: 0, workerContexts: [], reviews: [] }
  const fixture = await startShellFixture(kind, {
    config: {
      goal: {
        verifier_count: 1,
        summary_enabled: false,
        strategist_every: 100,
      },
      permission: {
        "*": "allow",
        update_goal: scenario === "denied" ? "deny" : "allow",
      },
      snapshot: false,
      compaction: { auto: false },
    },
    next: async ({ body }) => {
      const text = strings(body).join("\n")
      const phase = text.includes("independent goal planner")
        ? "planning"
        : text.includes("hidden completion evaluator")
          ? "evaluating"
          : text.includes("independent skeptical goal verifier")
            ? "verifying"
            : "executing"
      calls.push({ phase, body })
      const report = (key) => JSON.parse(new RegExp(`${key}=("[^"\\n]+")`).exec(text)?.[1] ?? "null")
      if (phase === "planning" || phase === "verifying") {
        assert.ok(
          !(body.tools ?? []).some((tool) => (tool.function?.name ?? tool.name) === "update_goal"),
          "role child cannot update worker progress",
        )
        const file = report(phase === "planning" ? "PLAN_FILE" : "VERDICT_FILE")
        assert.ok(file)
        const step = files.get(file) ?? 0
        files.set(file, step + 1)
        if (phase === "verifying") state.reviews.push(text)
        if (!step)
          return {
            tool: "goal_report_write",
            args: {
              path: file,
              content:
                phase === "planning"
                  ? plan
                  : JSON.stringify({
                      achieved: true,
                      evidence: "Independent evidence inspected",
                      unmet: [],
                      confidence: "high",
                      blocking: "none",
                    }),
            },
          }
        if (phase === "verifying" && step === 1)
          return {
            tool: "goal_report_write",
            args: {
              path: report("DETAILS_FILE"),
              content: "# Findings\nOriginal scope independently verified; progress annotations were advisory.",
            },
          }
        return { content: "Done" }
      }
      if (phase === "evaluating") {
        state.evaluations++
        return {
          content: JSON.stringify({
            decision: state.evaluations === 1 ? "continue" : "candidate_complete",
            evidence: "Original deliverable inspected",
            next_step: "Inspect the remaining evidence independently",
            blocker_key: "",
          }),
        }
      }
      state.workers++
      const context = JSON.parse(/Advisory plan progress: ([^\n]+)/.exec(text)?.[1] ?? "null")
      assert.ok(context?.advisory)
      state.workerContexts.push(context)
      if (state.workers === 1)
        return {
          tool: "update_goal",
          args: {
            plan_progress: {
              complete: [scenario === "invalid" ? 2 : 0],
              deviation:
                scenario === "invalid"
                  ? "MUST_NOT_PERSIST"
                  : "Used captured local evidence because the remote service was unavailable.",
            },
          },
        }
      if (state.workers === 3)
        return {
          tool: "update_goal",
          args: { plan_progress: { complete: [0, 1] } },
        }
      return { content: "Concrete original-scope evidence has been captured." }
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
    const id = `goal_progress${scenario}`
    await fixture.api(root, {
      id,
      objective: "Produce concrete evidence and independently verify the original requested outcome.",
    })
    await fixture.api(`${root}/${id}/start`, {
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
    const info = await poll(
      async () => {
        const value = await fixture.api(root)
        return value.status !== "active" && value
      },
      "progress Goal complete",
      30000,
    )
    await poll(
      async () => Object.keys((await fixture.api("/api/session/active")).data).length === 0,
      "progress children idle",
      15000,
    )
    assert.equal(info.status, "complete", JSON.stringify(info))
    assert.equal(info.plan, plan)
    assert.equal(calls.length, 11)
    assert.equal(info.tokensUsed, 1320)
    assert.equal(state.workers, 4)
    assert.equal(state.evaluations, 2)
    if (scenario === "denied") assert.equal(info.planProgress, undefined)
    else {
      assert.deepEqual(info.planProgress.completed, [0, 1])
      assert.equal(info.planProgress.deviations.length, scenario === "valid" ? 1 : 0)
      assert.ok(state.reviews.some((text) => text.includes("advisoryPlanProgress")))
      assert.ok(state.workerContexts.at(-1).tasks.every((task) => task.completed))
    }
    assert.equal(state.workerContexts[1].tasks[0].completed, scenario === "valid")
    assert.ok(!JSON.stringify(info).includes("MUST_NOT_PERSIST"))
    const reports = await fixture.api(`${root}/${id}/reports`)
    for (const report of reports) {
      const content = await fixture.api(`${root}/${id}/reports/${report.id}/plan`)
      assert.equal(content.text, plan)
      assert.equal(content.sha256, createHash("sha256").update(plan).digest("hex"))
    }
    assert.deepEqual((await fixture.api(root)).planProgress, info.planProgress, "reopening status preserves progress")
    checks.push({
      scenario,
      providerCalls: calls.length,
      tokensUsed: info.tokensUsed,
    })
  } finally {
    await fixture.close()
    console.error(`Goal progress ${scenario} evidence: ${fixture.output}`)
  }
}
console.log(JSON.stringify({ kind, passed: checks.length, checks }, null, 2))

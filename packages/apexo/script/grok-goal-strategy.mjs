// Native Goal strategy acceptance against the actual CLI or packaged Electron backend.
import assert from "node:assert/strict"
import { writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const state = { mode: "advised", calls: [], files: new Map(), verifications: 0, workers: [], hold: undefined }
const strings = (value) =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : []
const fixture = await startShellFixture(kind, {
  config: {
    goal: {
      verifier_count: 1,
      summary_enabled: false,
      strategist_every: 1,
      strategist_model: { model: "xai/missing-model", agent_type: "missing-agent" },
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
    state.calls.push({ phase, mode: state.mode, body })
    const path = (key) => JSON.parse(new RegExp(`${key}=("[^"\\n]+")`).exec(text)?.[1] ?? "null")
    if (phase === "strategizing") {
      assert.ok(
        !body.tools?.some((tool) =>
          ["bash", "run_terminal_cmd", "write", "edit"].includes(tool.function?.name ?? tool.name),
        ),
        "adviser cannot mutate workspace or run shell",
      )
      if (state.mode === "cancel") {
        state.hold.entered.resolve()
        await state.hold.release.promise
      }
      if (state.mode === "missing") return { error: { status: 400, message: "Strategy transport unavailable" } }
      if (state.mode === "empty") return { content: "No file was written" }
    }
    if (["planning", "verifying", "strategizing"].includes(phase)) {
      const file = path(
        phase === "planning" ? "PLAN_FILE" : phase === "strategizing" ? "STRATEGY_FILE" : "VERDICT_FILE",
      )
      assert.ok(file, "native role receives assigned file")
      const step = state.files.get(file) ?? 0
      state.files.set(file, step + 1)
      if (!step) {
        if (phase === "verifying") state.verifications++
        const achieved = state.verifications > 1 && state.mode !== "stalled"
        return {
          tool: "goal_report_write",
          args: {
            path: file,
            content:
              phase === "planning"
                ? "Preserve the original contract and independently verify every requirement."
                : phase === "strategizing"
                  ? "STRATEGY_DIAGNOSIS: inspect the boundary with an independent reproduction."
                  : JSON.stringify({
                      achieved,
                      confidence: "high",
                      blocking: "none",
                      evidence: achieved ? "All evidence verified" : "Independent reproduction is missing",
                      unmet: achieved ? [] : ["Independent reproduction"],
                    }),
          },
        }
      }
      if (phase === "verifying" && step === 1)
        return {
          tool: "goal_report_write",
          args: { path: path("DETAILS_FILE"), content: "# Findings\nIndependent evidence determines completion." },
        }
      return { content: "Done" }
    }
    if (phase === "evaluating")
      return {
        content: JSON.stringify({
          decision: "candidate_complete",
          evidence: "Worker produced concrete evidence",
          next_step: "Verify original criteria",
          blocker_key: "",
        }),
      }
    state.workers.push(text)
    return { content: "Worker produced concrete evidence." }
  },
})
const checks = []
try {
  await writeFile(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
  const create = async (mode, budget) => {
    state.mode = mode
    state.verifications = 0
    state.workers = []
    const session = (
      await fixture.api("/api/session", {
        location: { directory: fixture.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    const root = `/api/session/${session.id}/goal`
    const id = `goal_strategy${mode}`
    await fixture.api(root, {
      id,
      objective: "Complete the original task and independently reproduce its result",
      ...(budget ? { tokenBudget: budget } : {}),
    })
    await fixture.api(`${root}/${id}/start`, { agent: "build", model: { providerID: "xai", id: "grok-4.7" } })
    return { root, id, session, target: `${root}/${id}` }
  }
  const stopped = (goal) =>
    poll(
      async () => {
        const info = await fixture.api(goal.root)
        return info.status !== "active" && info
      },
      "strategy Goal stop",
      30_000,
    )
  const idle = () =>
    poll(
      async () => Object.keys((await fixture.api("/api/session/active")).data).length === 0,
      "strategy drains idle",
      15_000,
    )
  for (const mode of ["advised", "empty", "budget", "stalled", "missing"]) {
    const before = state.calls.length
    const goal = await create(mode, mode === "budget" ? 1000 : undefined)
    const info = await stopped(goal)
    await idle()
    assert.equal(
      info.status,
      mode === "budget"
        ? "budget_limited"
        : mode === "stalled"
          ? "no_progress_paused"
          : mode === "missing"
            ? "infra_paused"
            : "complete",
    )
    assert.equal(info.plan, "Preserve the original contract and independently verify every requirement.")
    assert.equal(await readFile(info.plannerFiles.plan.path, "utf8"), info.plan)
    if (mode === "missing") assert.equal(info.usageIncomplete, true)
    else assert.equal(info.tokensUsed, (state.calls.length - before) * 120)
    if (mode === "advised") {
      assert.equal(info.strategy.status, "advised")
      assert.ok(info.strategy.execution.fallback)
      assert.equal(info.strategy.execution.model.id, "grok-4.7")
      assert.ok(state.workers[1].includes("STRATEGY_DIAGNOSIS"))
      assert.ok(!state.workers[0].includes("STRATEGY_DIAGNOSIS"))
      const reports = await fixture.api(`${goal.target}/reports`)
      const report = reports.find((item) => item.kind === "strategizing")
      assert.ok(report?.files.some((file) => file.key === "strategy" && file.name === "strategy.md"))
      assert.ok((await fixture.api(`${goal.target}/reports/${report.id}/strategy`)).text.includes("STRATEGY_DIAGNOSIS"))
    }
    if (mode === "empty") assert.equal(info.strategy.status, "failed")
    if (mode === "budget") {
      assert.equal(info.tokensUsed, 1080)
      assert.equal(state.workers.length, 1)
    }
    if (mode === "stalled") assert.equal(info.verificationRounds, 2)
    checks.push(mode)
  }
  state.hold = { entered: Promise.withResolvers(), release: Promise.withResolvers() }
  const cancelled = await create("cancel")
  await deadline(state.hold.entered.promise, 20_000, "strategy child entered")
  await fixture.api(`${cancelled.target}/pause`, undefined, "POST")
  state.hold.release.resolve()
  await idle()
  const paused = await fixture.api(cancelled.root)
  assert.equal(paused.status, "user_paused")
  assert.equal(paused.strategy.status, "running")
  assert.equal(state.workers.length, 1)
  state.mode = "advised"
  const beforeResume = state.calls.filter((call) => call.phase === "strategizing").length
  await fixture.api(`${cancelled.target}/resume`, undefined, "POST")
  const resumed = await stopped(cancelled)
  await idle()
  assert.equal(resumed.status, "complete")
  assert.equal(state.calls.filter((call) => call.phase === "strategizing").length, beforeResume)
  checks.push("cancel-resume-does-not-repeat-claimed-advice")
  console.log(JSON.stringify({ kind, checks, passed: checks.length, providerCalls: state.calls.length }, null, 2))
} finally {
  state.hold?.release.resolve()
  await fixture.close()
}

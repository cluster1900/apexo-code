// Real native /api/session Goal execution under the CLI or production Electron backend.
import assert from "node:assert/strict"
import { writeFile, access } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const state = { mode: "complete", calls: [], files: new Map(), evaluations: 0, hold: undefined }
const strings = (value) =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : []
const fixture = await startShellFixture(kind, {
  config: { goal: { verifier_count: 1, summary_enabled: false }, snapshot: false },
  next: async ({ body, finished }) => {
    const text = strings(body).join("\n")
    const phase = text.includes("independent goal planner")
      ? "planning"
      : text.includes("hidden completion evaluator")
        ? "evaluating"
        : text.includes("independent skeptical goal verifier")
          ? "verifying"
          : "executing"
    state.calls.push({ phase, mode: state.mode, body })
    const path = (key) => JSON.parse(new RegExp(`${key}=("[^"\\n]+")`).exec(text)?.[1] ?? "null")
    if (phase === "planning" || phase === "verifying") {
      const file = path(phase === "planning" ? "PLAN_FILE" : "VERDICT_FILE")
      assert.ok(file, "Native role received its assigned private report")
      const step = state.files.get(file) ?? 0
      state.files.set(file, step + 1)
      if (!step)
        return {
          tool: "goal_report_write",
          args: {
            path: file,
            content:
              phase === "planning"
                ? "Preserve the whole objective and verify the native result."
                : JSON.stringify({
                    achieved: true,
                    confidence: "high",
                    blocking: "none",
                    evidence: "Native worker transcript and scoped evidence verified",
                    unmet: [],
                  }),
          },
        }
      if (phase === "verifying" && step === 1)
        return {
          tool: "goal_report_write",
          args: {
            path: path("DETAILS_FILE"),
            content: "# Findings\nEvery original requirement is supported by native transcript evidence.",
          },
        }
      return { content: "Done" }
    }
    if (phase === "evaluating") {
      state.evaluations++
      return {
        content: JSON.stringify({
          decision: state.mode === "continue" && state.evaluations === 1 ? "continue" : "candidate_complete",
          evidence: "Worker performed concrete native work",
          next_step: "Verify all original requirements",
          blocker_key: "",
        }),
      }
    }
    if (state.hold) await state.hold.promise
    if (state.mode === "error") return { error: { status: 400, message: "Native fixture provider failed" } }
    if (!finished && body.tools?.some((tool) => (tool.function?.name ?? tool.name) === "update_goal"))
      return { tool: "update_goal", args: { message: "Native worker made concrete progress" } }
    return { content: "NATIVE_GOAL_WORK_COMPLETE" }
  },
})
const checks = []
try {
  await writeFile(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
  const create = async (name, budget) => {
    const session = (
      await fixture.api("/api/session", {
        location: { directory: fixture.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    const root = `/api/session/${session.id}/goal`
    const id = `goal_v2${name}`
    await fixture.api(root, {
      id,
      objective: `NATIVE_GOAL_${name}: perform the entire native task and independent verification`,
      ...(budget ? { tokenBudget: budget } : {}),
    })
    return { session, root, id, target: `${root}/${id}` }
  }
  const start = (goal) =>
    fixture.api(`${goal.target}/start`, { agent: "build", model: { providerID: "xai", id: "grok-4.7" } })
  const stopped = (goal) =>
    poll(
      async () => {
        const info = await fixture.api(goal.root)
        return info.status !== "active" && info
      },
      "native Goal stop",
      30_000,
    )
  const idle = () =>
    poll(
      async () => Object.keys((await fixture.api("/api/session/active")).data).length === 0,
      "native drains idle",
      15_000,
    )
  const first = await create("complete")
  assert.equal(state.calls.length, 0)
  await start(first)
  const complete = await stopped(first)
  assert.equal(complete.status, "complete")
  await idle()
  assert.equal(complete.tokensUsed, state.calls.length * 120)
  assert.equal(complete.verification.results.length, 1)
  assert.ok(complete.plannerSessionID)
  assert.notEqual(complete.plannerSessionID, complete.verification.results[0].sessionID)
  assert.equal((await fixture.api(`${first.target}/reports`)).length, 2)
  const messages = (await fixture.api(`/api/session/${first.session.id}/message`)).data
  assert.equal(messages.filter((message) => message.type === "user").length, 1)
  assert.ok(
    messages
      .filter((message) => message.type === "assistant")
      .some((message) =>
        message.content.some(
          (part) =>
            (part.type === "tool" && part.name === "update_goal") ||
            (part.type === "tool" && part.tool === "update_goal"),
        ),
      ),
  )
  await assert.rejects(access(complete.plannerFiles.workerScratch))
  checks.push("native-independent-planner-worker-update-tool-evaluator-verifier-ledger-reports-terminal-cleanup")

  const count = state.calls.length
  const budget = await create("budget", 120)
  await start(budget)
  assert.equal((await stopped(budget)).status, "budget_limited")
  await idle()
  assert.equal(state.calls.length, count + 1)
  checks.push("actual-provider-budget-stops-before-another-native-turn")

  state.mode = "continue"
  state.evaluations = 0
  const continuation = await create("continue")
  await start(continuation)
  const continued = await stopped(continuation)
  assert.equal(continued.status, "complete")
  assert.equal(continued.workerRounds, 2)
  await idle()
  checks.push("independent-evaluator-durably-continues-native-worker-rounds")

  state.mode = "held"
  state.hold = Promise.withResolvers()
  const paused = await create("pause")
  await start(paused)
  await poll(
    () => state.calls.some((call) => call.mode === "held" && call.phase === "executing"),
    "held native worker",
    15_000,
  )
  await fixture.api(`${paused.target}/pause`, undefined, "POST")
  await idle()
  state.hold.resolve()
  state.hold = undefined
  assert.equal((await fixture.api(paused.root)).status, "user_paused")
  state.mode = "complete"
  await fixture.api(`${paused.target}/resume`, undefined, "POST")
  assert.equal((await stopped(paused)).status, "complete")
  await idle()
  checks.push("pause-cancels-owned-drain-and-explicit-resume-reuses-durable-plan")

  state.mode = "crash"
  state.hold = Promise.withResolvers()
  const crashed = await create("crash")
  await start(crashed)
  await poll(
    () => state.calls.some((call) => call.mode === "crash" && call.phase === "executing"),
    "native crash worker",
    15_000,
  )
  await fixture.crash()
  state.hold.resolve()
  state.hold = undefined
  const before = state.calls.length
  await fixture.reopen()
  const recovered = await fixture.api(crashed.root)
  assert.equal(recovered.phase, "executing")
  assert.equal(recovered.status, "active")
  assert.equal(state.calls.length, before)
  assert.deepEqual((await fixture.api("/api/session/active")).data, {})
  state.mode = "complete"
  await fixture.api(`${crashed.target}/resume`, undefined, "POST")
  const resumed = await stopped(crashed)
  assert.equal(resumed.status, "complete")
  assert.equal(resumed.plannerSessionID, recovered.plannerSessionID)
  await idle()
  checks.push("sigkill-reopen-does-not-retry-provider-until-explicit-resume")

  console.log(JSON.stringify({ kind, checks, passed: checks.length, providerCalls: state.calls.length }, null, 2))
  await writeFile(
    join(fixture.output, "native-goal-results.json"),
    JSON.stringify({ kind, checks, calls: state.calls }, null, 2),
  )
} finally {
  await writeFile(
    join(fixture.output, "native-goal-results.json"),
    JSON.stringify({ kind, checks, calls: state.calls }, null, 2),
  )
  state.hold?.resolve()
  await fixture.close()
}

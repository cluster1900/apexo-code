// Exercise the real CLI / production Electron Goal HTTP lifecycle with an isolated provider.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const checks = [],
  calls = [],
  states = []
const control = { mode: "complete", verifications: 0, evaluations: 0, hold: undefined }
const fixture = await startShellFixture(kind, {
  goalReports: true,
  next: async ({ body, ancillary, finished, text: latest }) => {
    const text = JSON.stringify(body)
    const phase = text.includes("independent goal planner")
      ? "planning"
      : text.includes("hidden completion evaluator")
        ? "evaluating"
        : text.includes("independent skeptical goal verifier")
          ? "verifying"
          : ancillary
            ? "ancillary"
            : "executing"
    calls.push({ phase, mode: control.mode, body })
    if (phase === "planning")
      return { content: JSON.stringify({ plan: "Implement A and B, then independently verify both" }) }
    if (phase === "evaluating") {
      control.evaluations++
      assert.equal(body.tools?.length ?? 0, 0)
      assert.ok(JSON.stringify(body.response_format).includes("blocker_key"))
      if (["held-evaluation", "restart-evaluation"].includes(control.mode) && control.hold) await control.hold.promise
      if (control.mode === "invalid" || (control.mode === "retry-evaluation" && control.evaluations === 1))
        return {
          content: JSON.stringify({
            decision: "candidate_complete",
            evidence: "claimed",
            next_step: "verify",
            blocker_key: "",
            extra: true,
          }),
        }
      return {
        content: JSON.stringify({
          decision:
            control.mode === "blocked"
              ? "blocked"
              : control.mode === "continue" && control.evaluations < 4
                ? "continue"
                : "candidate_complete",
          evidence: "The transcript contains actual work and test evidence",
          next_step:
            control.mode === "continue"
              ? "EVALUATOR_NEXT_STEP: complete the next requirement"
              : "Independently verify all requirements",
          blocker_key: control.mode === "blocked" ? "required_service" : "",
        }),
      }
    }
    if (phase === "verifying") {
      control.verifications++
      const rejected = control.mode === "reject" && control.verifications === 1
      return {
        content: JSON.stringify({
          achieved: !rejected,
          confidence: "high",
          blocking: "none",
          evidence: rejected ? "B has no evidence yet" : "A and B are verified",
          unmet: rejected ? ["Implement and test B"] : [],
        }),
      }
    }
    if (phase === "executing" && control.mode === "notification") {
      if (latest.includes("Background command completed:")) return { content: "GOAL_NOTIFICATION_OBSERVED" }
      if (!finished)
        return {
          tool: "run_terminal_cmd",
          args: {
            command: "while [ ! -f goal-notification.release ]; do sleep 0.01; done; printf GOAL_LATE_OUTPUT",
            description: "Notify after launch goal ends",
            block_until_ms: 0,
          },
        }
    }
    if (phase === "executing" && control.hold && !["held-evaluation", "restart-evaluation"].includes(control.mode))
      await control.hold.promise
    return { content: "GOAL_WORK_EVIDENCE A and B implemented and tested" }
  },
})
const api = fixture.api
const request = async (path, method, body) => {
  const response = await fetch(`${fixture.url}${path}?directory=${encodeURIComponent(fixture.directory)}`, {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  })
  return { status: response.status, body: await response.json() }
}
const create = async (objective, tokenBudget) => {
  const session = await api("/session", { title: "Goal API verification" })
  const root = `/session/${session.id}/goal`
  assert.equal(await api(root), null)
  await api(`/session/${session.id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    noReply: true,
    parts: [{ type: "text", text: objective }],
  })
  const input = { id: `goal_${randomUUID().replaceAll("-", "")}`, objective, ...(tokenBudget ? { tokenBudget } : {}) }
  const info = await api(root, input)
  return { session, root, input, info, target: `${root}/${input.id}` }
}
const settled = async (item, status) => {
  const info = await poll(
    async () => {
      const value = await api(item.root)
      return value?.status === status && value
    },
    `goal ${status}`,
    20_000,
  )
  states.push(info)
  return info
}

try {
  const plain = await create("Preserve original A and B objective", 10000)
  assert.equal(calls.length, 0)
  assert.deepEqual(await api(plain.root, plain.input), plain.info)
  assert.equal((await request(plain.root, "POST", { ...plain.input, objective: "Changed scope" })).status, 409)
  checks.push("durable-idempotent-admission-without-inference")
  await api(`${plain.target}/run`, undefined, "POST")
  const completed = await settled(plain, "complete")
  assert.equal(completed.tokensUsed, 720)
  assert.equal(completed.workerRounds, 1)
  assert.equal(completed.verificationRounds, 1)
  assert.equal(calls.filter((call) => call.phase !== "ancillary").length, 6)
  assert.equal((await request(`${plain.target}/resume`, "POST")).status, 409)
  checks.push("exclusive-admission-planner-worker-verifier-and-actual-usage")

  control.mode = "reject"
  control.verifications = 0
  const retry = await create("Preserve A and B after rejection")
  await api(`${retry.target}/run`, undefined, "POST")
  const retried = await settled(retry, "complete")
  assert.equal(retried.workerRounds, 2)
  assert.equal(retried.verificationRounds, 2)
  assert.equal(retried.tokensUsed, 1080)
  assert.ok(
    calls
      .filter((call) => call.mode === "reject" && call.phase === "executing")
      .some((call) => JSON.stringify(call.body).includes("Implement and test B")),
  )
  checks.push("rejected-verification-continues-with-original-scope-and-unmet-requirements")

  control.mode = "budget"
  const budget = await create("Stop at the actual budget", 200)
  await api(`${budget.target}/run`, undefined, "POST")
  assert.equal((await settled(budget, "budget_limited")).tokensUsed, 240)
  assert.equal(calls.filter((call) => call.mode === "budget" && call.phase === "verifying").length, 0)
  assert.equal((await request(`${budget.target}/resume`, "POST")).status, 409)
  checks.push("budget-stops-at-safe-boundary-and-resume-cannot-bypass-it")

  for (const [mode, status, evaluations, workers] of [
    ["continue", "complete", 4, 4],
    ["blocked", "blocked", 3, 3],
    ["retry-evaluation", "complete", 2, 1],
    ["invalid", "infra_paused", 2, 1],
    ["evaluation-budget", "budget_limited", 1, 1],
  ]) {
    control.mode = mode
    control.evaluations = 0
    const item = await create(`Evaluate all requirements: ${mode}`, mode === "evaluation-budget" ? 350 : undefined)
    await api(`${item.target}/run`, undefined, "POST")
    const result = await settled(item, status)
    const requests = calls.filter((call) => call.mode === mode && call.phase !== "ancillary")
    assert.equal(requests.filter((call) => call.phase === "evaluating").length, evaluations)
    assert.equal(result.workerRounds, workers)
    assert.equal(result.verificationRounds, status === "complete" ? 1 : 0)
    assert.equal(result.tokensUsed, requests.length * 120)
    if (mode === "continue")
      assert.ok(
        requests
          .filter((call) => call.phase === "executing")
          .slice(1)
          .every((call) => JSON.stringify(call.body).includes("EVALUATOR_NEXT_STEP")),
      )
    if (mode === "blocked") assert.equal(result.evaluation.blocker_key, "required_service")
    checks.push(`independent-evaluator-${mode}`)
  }

  control.mode = "held-evaluation"
  control.hold = Promise.withResolvers()
  const evaluating = await create("Pause an in-flight evaluator without accepting its late result")
  await api(`${evaluating.target}/run`, undefined, "POST")
  await poll(
    () => calls.some((call) => call.mode === "held-evaluation" && call.phase === "evaluating"),
    "evaluator entered",
  )
  assert.equal((await api(evaluating.root)).phase, "evaluating")
  await api(`${evaluating.target}/pause`, undefined, "POST")
  assert.equal((await api(evaluating.root)).status, "user_paused")
  control.hold.resolve()
  control.hold = undefined
  control.mode = "evaluation-resumed"
  await api(`${evaluating.target}/resume`, undefined, "POST")
  const resumedEvaluation = await settled(evaluating, "complete")
  assert.equal(resumedEvaluation.workerRounds, 2)
  assert.equal(resumedEvaluation.tokensUsed, 840)
  assert.equal(resumedEvaluation.usageIncomplete, true)
  checks.push("cancelled-evaluator-is-fenced-and-resume-runs-new-work")

  control.mode = "notification"
  const notification = await create("Only launch a background operation; handle its eventual completion independently")
  await api(`${notification.target}/run`, undefined, "POST")
  const launched = await settled(notification, "complete")
  await writeFile(join(fixture.directory, "goal-notification.release"), "release")
  await poll(
    async () =>
      (await api(`/session/${notification.session.id}/message`)).some((message) =>
        message.parts.some((part) => part.type === "text" && part.text === "GOAL_NOTIFICATION_OBSERVED"),
      ),
    "post-goal background notification",
    20_000,
  )
  assert.deepEqual(await api(notification.root), launched)
  checks.push("late-background-notification-runs-without-expired-goal-accounting")

  control.mode = "held"
  control.hold = Promise.withResolvers()
  const held = await create("Pause and explicitly resume this goal")
  await api(`${held.target}/run`, undefined, "POST")
  await poll(() => calls.some((call) => call.mode === "held" && call.phase === "executing"), "held worker request")
  assert.equal((await request(`${held.target}/run`, "POST")).status, 409)
  assert.equal((await request(`${held.root}/goal_stale/pause`, "POST")).status, 409)
  assert.equal((await api(held.root)).status, "active")
  const paused = await api(`${held.target}/pause`, undefined, "POST")
  assert.equal(paused.status, "user_paused")
  assert.equal(paused.tokensUsed, 120)
  const count = calls.length
  for (const _ of [1, 2, 3]) assert.equal((await api(held.root)).status, "user_paused")
  assert.equal((await request(`${held.target}/run`, "POST")).status, 409)
  assert.equal(calls.length, count)
  control.hold.resolve()
  control.hold = undefined
  control.mode = "resumed"
  await api(`${held.target}/resume`, undefined, "POST")
  assert.equal((await settled(held, "complete")).tokensUsed, 720)
  checks.push("busy-and-stale-controls-rejected-pause-is-durable-and-resume-explicit")

  control.mode = "ordinary"
  control.hold = Promise.withResolvers()
  const ordinary = api(`/session/${held.session.id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Ordinary follow-up unrelated to completed Goal" }],
  }).then(
    (value) => ({ value }),
    (error) => ({ error: String(error) }),
  )
  await poll(
    () => calls.some((call) => call.mode === "ordinary" && call.phase === "executing"),
    "ordinary prompt started",
  )
  assert.equal(await api(held.target, undefined, "DELETE"), true)
  assert.equal(await api(held.root), null)
  assert.equal((await api("/session/status"))[held.session.id]?.type, "busy")
  control.hold.resolve()
  control.hold = undefined
  const ordinaryResult = await deadline(ordinary, 20_000, "ordinary prompt completes after old goal clear")
  assert.ok(!ordinaryResult.error, ordinaryResult.error)
  assert.ok(ordinaryResult.value.parts.some((part) => part.type === "text" && part.text.includes("GOAL_WORK_EVIDENCE")))
  checks.push("clearing-old-goal-does-not-cancel-new-ordinary-prompt")

  for (const phase of ["executing", "evaluating"]) {
    control.mode = phase === "executing" ? "restart" : "restart-evaluation"
    control.hold = Promise.withResolvers()
    const crashed = await create("Recover only through explicit control")
    await api(`${crashed.target}/run`, undefined, "POST")
    await poll(() => calls.some((call) => call.mode === control.mode && call.phase === phase), "restart worker started")
    await fixture.crash()
    await fixture.reopen()
    const before = calls.length
    assert.equal((await api(crashed.root)).phase, phase)
    assert.equal(calls.length, before)
    assert.equal((await request(`${crashed.target}/run`, "POST")).status, 409)
    assert.equal((await api(crashed.root)).status, "user_paused")
    assert.equal((await api(crashed.root)).usageIncomplete, true)
    assert.equal(calls.length, before)
    control.hold.resolve()
    control.hold = undefined
    control.mode = "recovered"
    await api(`${crashed.target}/resume`, undefined, "POST")
    await settled(crashed, "complete")
    await api(crashed.target, undefined, "DELETE")
    await fixture.crash()
    await fixture.reopen()
    assert.equal(await api(crashed.root), null)
    checks.push(`sigkill-${phase}-read-does-not-run-explicit-recovery-and-clear-does-not-reappear`)
  }
  control.mode = "complete"
  const empty = await api("/session", { title: "Start a goal in an empty session" })
  const root = `/session/${empty.id}/goal`
  const input = {
    id: `goal_${randomUUID().replaceAll("-", "")}`,
    objective: "EMPTY_SESSION_GOAL implement all requirements",
  }
  await api(root, input)
  const target = `${root}/${input.id}`
  const selection = { agent: "build", model: { providerID: "xai", id: "grok-4.7" } }
  const beforeStart = calls.length
  assert.equal((await request(`${target}/start`, "POST", { ...selection, agent: "missing-goal-agent" })).status, 400)
  assert.equal((await api(root)).launch, undefined)
  assert.equal((await api(`/session/${empty.id}/message`)).length, 0)
  await api(`${target}/start`, selection)
  const complete = await settled({ root }, "complete")
  assert.equal(complete.tokensUsed, 720)
  assert.ok(
    calls
      .slice(beforeStart)
      .some((call) => call.phase === "executing" && JSON.stringify(call.body).includes(input.objective)),
  )
  const user = (await api(`/session/${empty.id}/message`)).filter((message) => message.info.role === "user")
  assert.equal(user.length, 1)
  assert.equal(user[0].info.id, complete.launch.messageID)
  assert.equal(user[0].parts.filter((part) => part.type === "text")[0].text, input.objective)
  const beforeRetry = calls.length
  assert.deepEqual(await api(`${target}/start`, selection), complete)
  assert.equal(calls.length, beforeRetry)
  assert.equal((await request(`${target}/start`, "POST", { ...selection, agent: "plan" })).status, 409)
  checks.push("empty-session-start-admits-objective-and-model-once-and-rejects-conflicting-retry")
  const unstarted = await api("/session", { title: "Paused before first start" })
  const pausedRoot = `/session/${unstarted.id}/goal`
  const pausedInput = { ...input, id: `goal_${randomUUID().replaceAll("-", "")}` }
  await api(pausedRoot, pausedInput)
  await api(`${pausedRoot}/${pausedInput.id}/pause`, undefined, "POST")
  assert.equal((await request(`${pausedRoot}/${pausedInput.id}/start`, "POST", selection)).status, 409)
  assert.equal((await api(`/session/${unstarted.id}/message`)).length, 0)
  assert.equal(calls.length, beforeRetry)
  checks.push("start-does-not-resume-a-paused-unstarted-goal")
  const edited = await api("/session", { title: "Preserve admitted objective presentation" })
  const editedRoot = `/session/${edited.id}/goal`
  const editedInput = { ...input, id: `goal_${randomUUID().replaceAll("-", "")}` }
  await api(editedRoot, editedInput)
  control.hold = Promise.withResolvers()
  const beforeEdited = calls.length
  const editedTarget = `${editedRoot}/${editedInput.id}`
  await api(`${editedTarget}/start`, selection)
  await poll(async () => (await api(editedRoot)).phase === "executing", "edited objective worker running")
  await poll(
    () => calls.slice(beforeEdited).some((call) => call.phase === "executing"),
    "edited objective provider request held",
  )
  await api(`${editedTarget}/pause`, undefined, "POST")
  assert.equal((await api(editedRoot)).usageIncomplete, true)
  const admitted = (await api(`/session/${edited.id}/message`)).find((message) => message.info.role === "user")
  const part = admitted.parts.find((part) => part.type === "text")
  const changed = { ...part, text: `${part.text}\nUSER_ADDED_CONTEXT` }
  assert.equal(
    (await request(`/session/${edited.id}/message/${admitted.info.id}/part/${part.id}`, "PATCH", changed)).status,
    200,
  )
  control.hold.resolve()
  control.hold = undefined
  await api(`${editedTarget}/resume`, undefined, "POST")
  assert.equal((await settled({ root: editedRoot }, "complete")).objective, editedInput.objective)
  const preserved = (await api(`/session/${edited.id}/message`)).filter((message) => message.info.role === "user")
  assert.equal(preserved.length, 1)
  assert.equal(preserved[0].parts.find((item) => item.id === part.id).text, changed.text)
  checks.push("resume-keeps-authorized-message-edits-and-immutable-goal-objective")
  console.log(
    JSON.stringify(
      { kind, output: fixture.output, checks, modelDecisions: calls.length, modelRequests: fixture.calls.length },
      null,
      2,
    ),
  )
} finally {
  control.hold?.resolve()
  await writeFile(join(fixture.output, "goal-api-evidence.json"), JSON.stringify({ checks, states, calls }, null, 2))
  await fixture.close()
  console.error(`Goal API evidence: ${fixture.output}`)
}

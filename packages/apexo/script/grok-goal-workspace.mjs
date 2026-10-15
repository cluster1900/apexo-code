// Real model/tool/session flow against CLI or the production Electron backend.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const calls = [],
  checks = [],
  states = []
const control = { mode: "reject", workers: 0, hold: undefined, held: false }
const runtime = await startShellFixture(kind, {
  goalReports: true,
  next: async ({ body, input }) => {
    const system = JSON.stringify(input.filter((message) => message.role === "system"))
    const phase = system.includes("independent goal planner")
      ? "planning"
      : system.includes("independent skeptical goal verifier")
        ? "verifying"
        : system.includes("hidden completion evaluator")
          ? "evaluating"
          : "executing"
    calls.push({ phase, mode: control.mode, body })
    if (phase === "planning" || phase === "verifying") {
      const names = body.tools.map((tool) => tool.function?.name ?? tool.name)
      assert.ok(names.includes("read_file"))
      assert.ok(names.includes("write") && !names.includes("task") && !names.includes("update_goal"))
      const current = input.findLastIndex((message) => message.role === "user")
      const results = input.slice(current + 1).filter((message) => message.role === "tool")
      if (control.mode === "deny") {
        if (!results.length)
          return { tool: "read_file", args: { target_file: join(runtime.directory, "restricted.txt") } }
        assert.ok(JSON.stringify(results).includes("prevents you"))
        return { content: JSON.stringify({ plan: "" }) }
      }
      if (results.length === 0) return { tool: "list_dir", args: { target_directory: runtime.directory } }
      if (results.length === 1)
        return { tool: "grep", args: { pattern: "GOAL_WORKSPACE", path: runtime.directory, include: "evidence.txt" } }
      if (results.length === 2)
        return { tool: "read_file", args: { target_file: join(runtime.directory, "evidence.txt") } }
      if (phase === "verifying" && control.mode === "cancel" && control.hold) {
        control.held = true
        await control.hold.promise
      }
      if (results.length === 3)
        return {
          tool: "run_terminal_cmd",
          args: { command: "printf GOAL_CHEAP_CHECK", description: "Check the test environment", block_until_ms: 1000 },
        }
      assert.ok(JSON.stringify(results[3]).includes("GOAL_CHEAP_CHECK"))
      if (phase === "planning")
        return {
          content: JSON.stringify({
            plan: "Read evidence.txt, implement the requirement, and check its actual contents",
          }),
        }
      const achieved = JSON.stringify(results[2]).includes("GOAL_WORKSPACE_FIXED")
      return {
        content: JSON.stringify({
          achieved,
          evidence: achieved
            ? "Read current evidence.txt: GOAL_WORKSPACE_FIXED"
            : "Read current evidence.txt: GOAL_WORKSPACE_PENDING",
          unmet: achieved ? [] : ["Fix evidence.txt"],
          confidence: "high",
          blocking: "none",
        }),
      }
    }
    if (phase === "evaluating")
      return {
        content: JSON.stringify({
          decision: "candidate_complete",
          evidence: "Worker claims completion",
          next_step: "Read the actual file",
          blocker_key: "",
        }),
      }
    if (input.at(-1)?.role !== "tool") {
      control.workers++
      return {
        tool: "write",
        args: {
          file_path: join(runtime.directory, "evidence.txt"),
          content:
            control.mode === "reject" && control.workers === 1 ? "GOAL_WORKSPACE_PENDING" : "GOAL_WORKSPACE_FIXED",
        },
      }
    }
    return { content: "Work is ready for independent verification" }
  },
})
const create = async (permission) => {
  const session = await runtime.api("/session", { title: "Goal workspace", ...(permission ? { permission } : {}) })
  await runtime.api(`/session/${session.id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    agent: "build",
    noReply: true,
    parts: [{ type: "text", text: "Inspect and fix evidence.txt" }],
  })
  const root = `/session/${session.id}/goal`
  const info = await runtime.api(root, {
    id: `goal_${randomUUID().replaceAll("-", "")}`,
    objective: "Make evidence.txt contain GOAL_WORKSPACE_FIXED and verify the actual file",
  })
  return { session, root, target: `${root}/${info.id}` }
}
const settle = (item, status) =>
  poll(
    async () => {
      const info = await runtime.api(item.root)
      return info.status === status && info
    },
    `goal ${status}`,
    45000,
  )

try {
  await writeFile(join(runtime.directory, "evidence.txt"), "GOAL_WORKSPACE_INITIAL")
  const item = await create()
  await runtime.api(`${item.target}/run`, undefined, "POST")
  const complete = await settle(item, "complete")
  states.push(complete)
  assert.equal(complete.workerRounds, 2)
  assert.equal(complete.verificationRounds, 2)
  assert.equal(complete.tokensUsed, calls.length * 120)
  assert.deepEqual(
    complete.verification.results.map((report) => report.tokensUsed),
    [600, 600, 600],
  )
  checks.push("planner-and-all-verifiers-read-search-list-and-run-cheap-checks")
  checks.push("actual-file-refutes-worker-claim-and-restarts-work")
  checks.push("every-provider-turn-billed-once-with-per-review-totals")
  const children = await runtime.api(`/session/${item.session.id}/children`)
  assert.equal(children.length, 4)
  const first = await runtime.api(`/session/${complete.verification.results[0].sessionID}/message`)
  assert.equal(first.filter((message) => message.info.role === "user").length, 2)
  for (const report of complete.verification.results.slice(1)) {
    const messages = await runtime.api(`/session/${report.sessionID}/message`)
    assert.equal(messages.filter((message) => message.info.role === "user").length, 1)
    const reads = messages
      .flatMap((message) => message.parts)
      .filter((part) => part.type === "tool" && part.tool === "read_file")
    assert.equal(reads.length, 1)
    assert.ok(JSON.stringify(reads).includes("GOAL_WORKSPACE_FIXED"))
  }
  assert.ok(children.some((child) => child.id === complete.plannerSessionID))
  checks.push("only-gatekeeper-resumes-own-persistent-child-session")
  await runtime.crash()
  await runtime.reopen()
  assert.deepEqual(await runtime.api(item.root), complete)
  assert.deepEqual(await runtime.api(`/session/${complete.verification.results[0].sessionID}/message`), first)
  checks.push("completed-review-references-and-tool-transcripts-survive-process-reopen")

  control.mode = "cancel"
  control.hold = Promise.withResolvers()
  const cancel = await create()
  await runtime.api(`${cancel.target}/run`, undefined, "POST")
  await poll(() => control.held, "held verifier read actual file", 45000)
  await runtime.api(`${cancel.target}/pause`, undefined, "POST")
  control.hold.resolve()
  control.hold = undefined
  const paused = await settle(cancel, "user_paused")
  states.push(paused)
  assert.equal(paused.usageIncomplete, true)
  assert.equal(paused.verification.results.length, 0)
  const statuses = await runtime.api("/session/status")
  for (const child of await runtime.api(`/session/${cancel.session.id}/children`))
    assert.ok(!statuses[child.id] || statuses[child.id].type === "idle")
  checks.push("pause-cancels-owned-review-session-and-preserves-missing-usage")

  control.mode = "deny"
  await writeFile(join(runtime.directory, "restricted.txt"), "ROLE_SECRET_MUST_NOT_ESCAPE")
  const denied = await create([
    { permission: "*", pattern: "*", action: "allow" },
    { permission: "read", pattern: "*restricted.txt", action: "deny" },
  ])
  await runtime.api(`${denied.target}/run`, undefined, "POST")
  states.push(await settle(denied, "infra_paused"))
  assert.ok(!JSON.stringify(calls).includes("ROLE_SECRET_MUST_NOT_ESCAPE"))
  checks.push("inherited-read-denial-cannot-be-overridden-by-session-wide-allow")
  console.log(
    JSON.stringify(
      { kind, checks, modelDecisions: calls.length, modelRequests: runtime.calls.length, output: runtime.output },
      null,
      2,
    ),
  )
} finally {
  control.hold?.resolve()
  await writeFile(join(runtime.output, "goal-workspace.json"), JSON.stringify({ checks, states, calls }, null, 2))
  await runtime.close()
  console.error(`Goal workspace evidence: ${runtime.output}`)
}

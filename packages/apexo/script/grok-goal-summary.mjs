// Real native Goal lifecycle; the optional closing summary owns one tool-free child turn.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const state = { mode: "success", calls: [], files: new Map(), hold: undefined }
const strings = (value) =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : []
const fixture = await startShellFixture(kind, {
  config: { goal: { verifier_count: 1 }, snapshot: false, compaction: { auto: false } },
  next: async ({ body }) => {
    const text = strings(body).join("\n")
    const phase = text.includes("optional closing summary")
      ? "summarizing"
      : text.includes("independent goal planner")
        ? "planning"
        : text.includes("hidden completion evaluator")
          ? "evaluating"
          : text.includes("independent skeptical goal verifier")
            ? "verifying"
            : "executing"
    state.calls.push({ mode: state.mode, phase, body })
    const path = (key) => JSON.parse(new RegExp(`${key}=("[^"\\n]+")`).exec(text)?.[1] ?? "null")
    if (phase === "summarizing") {
      assert.deepEqual(body.tools ?? [], [], "summary exposes no tools")
      assert.equal(body.tool_choice, "none")
      assert.ok(text.includes("Independent evidence reviewed"), "summary receives verified evidence")
      if (["held", "cancel", "clear", "crash"].includes(state.mode)) {
        state.hold.entered.resolve()
        await state.hold.release.promise
      }
      if (state.mode === "provider") return { error: { status: 400, message: "Summary unavailable" } }
      if (state.mode === "missing") return { content: "Unfinished summary", finishReason: "missing" }
      if (state.mode === "length") return { content: "Incomplete summary", finishReason: "length" }
      if (state.mode === "tool") return { tool: "bash", args: { command: "touch SUMMARY_MUST_NOT_EXIST" } }
      return { content: "SUMMARY_NATIVE: The original requirement was independently verified with concrete evidence." }
    }
    if (["planning", "verifying"].includes(phase)) {
      const file = path(phase === "planning" ? "PLAN_FILE" : "VERDICT_FILE")
      const step = state.files.get(file) ?? 0
      state.files.set(file, step + 1)
      if (!step)
        return {
          tool: "goal_report_write",
          args: {
            path: file,
            content:
              phase === "planning"
                ? "Preserve and independently verify every original requirement."
                : JSON.stringify({
                    achieved: true,
                    confidence: "high",
                    blocking: "none",
                    evidence: "Independent evidence reviewed",
                    unmet: [],
                  }),
          },
        }
      if (phase === "verifying" && step === 1)
        return {
          tool: "goal_report_write",
          args: { path: path("DETAILS_FILE"), content: "# Findings\nIndependent evidence reviewed." },
        }
      return { content: "Done" }
    }
    if (phase === "evaluating")
      return {
        content: JSON.stringify({
          decision: "candidate_complete",
          evidence: "Concrete evidence exists",
          next_step: "Verify original criteria",
          blocker_key: "",
        }),
      }
    return { content: "Concrete evidence satisfies the requested result." }
  },
})
const rejectChild = async (sessionID, id) => {
  await fixture.api(`/session/${sessionID}`, { metadata: {} }, "PATCH")
  const before = await fixture.api(`/api/session/${sessionID}/message`)
  for (const [path, payload, status] of [
    [`/api/session/${sessionID}/prompt`, { id, prompt: { text: "Repeat closing summary" }, resume: false }, 409],
    [`/session/${sessionID}/message`, { parts: [{ type: "text", text: "Repeat closing summary" }] }, 400],
  ]) {
    const response = await fetch(`${fixture.url}${path}?directory=${encodeURIComponent(fixture.directory)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    assert.equal(response.status, status, await response.text())
  }
  assert.deepEqual(await fixture.api(`/api/session/${sessionID}/message`), before)
}
const checks = []
try {
  await writeFile(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
  const idle = () =>
    poll(
      async () => Object.keys((await fixture.api("/api/session/active")).data).length === 0,
      "summary drain idle",
      15000,
    )
  const create = async (mode) => {
    state.mode = mode
    state.hold = { entered: Promise.withResolvers(), release: Promise.withResolvers() }
    const session = (
      await fixture.api("/api/session", {
        location: { directory: fixture.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    const root = `/api/session/${session.id}/goal`
    const id = `goal_summary${mode}`
    await fixture.api(root, {
      id,
      objective: "Produce concrete evidence and independently verify the original requirement",
      ...(mode === "budget" ? { tokenBudget: 850 } : {}),
    })
    await fixture.api(`${root}/${id}/start`, { agent: "build", model: { providerID: "xai", id: "grok-4.7" } })
    return { session, root, id, target: `${root}/${id}` }
  }
  for (const mode of [
    "success",
    "budget",
    "length",
    "missing",
    "provider",
    "tool",
    "held",
    "cancel",
    "clear",
    "crash",
  ]) {
    const before = state.calls.length
    const goal = await create(mode)
    if (["held", "cancel", "clear", "crash"].includes(mode)) {
      await deadline(state.hold.entered.promise, 30000, `${mode} summary entered`)
      const completed = await fixture.api(goal.root)
      assert.equal(completed.status, "complete", "completion is durable before summary finishes")
      assert.equal(completed.summary.status, "running")
      assert.equal(completed.tokensUsed, 840)
      if (mode === "held") {
        await rejectChild(completed.summary.sessionID, "msg_summaryreplay")
      }
      if (mode === "cancel") await fixture.api(`/api/session/${goal.session.id}/interrupt`, undefined, "POST")
      if (mode === "clear") {
        await fixture.api(goal.target, undefined, "DELETE")
        await fixture.api(goal.root, { id: "goal_summaryreplacement", objective: "A separate replacement" })
      }
      if (mode === "crash") await fixture.crash()
      state.hold.release.resolve()
      if (mode === "crash") await fixture.reopen()
    }
    await poll(
      async () => {
        const info = await fixture.api(goal.root)
        return info?.summary?.status !== "running" && info
      },
      "summary terminal receipt",
      30000,
    )
    await idle()
    const info = await fixture.api(goal.root)
    assert.equal(state.calls.slice(before).filter((call) => call.phase === "summarizing").length, 1)
    if (mode === "clear") {
      assert.equal(info.id, "goal_summaryreplacement")
      assert.equal(info.status, "active")
      assert.equal(info.summary, undefined)
      assert.equal(info.tokensUsed, 0)
      await fixture.api(`${goal.root}/${info.id}`, undefined, "DELETE")
    } else {
      assert.equal(info.status, "complete")
      if (["success", "budget", "held"].includes(mode)) {
        assert.equal(info.summary.status, "completed")
        assert.ok(info.summary.text.startsWith("SUMMARY_NATIVE:"))
        assert.equal(info.summary.tokensUsed, 120)
        assert.equal(info.tokensUsed, 960)
      } else {
        assert.equal(info.summary.status, "failed")
        assert.equal(
          info.summary.reason,
          ["cancel", "crash"].includes(mode)
            ? "interrupted"
            : ["provider", "missing"].includes(mode)
              ? "usage"
              : "output",
        )
        if (["cancel", "crash", "provider", "missing"].includes(mode)) assert.equal(info.usageIncomplete, true)
      }
      const messages = (await fixture.api(`/api/session/${goal.session.id}/message`)).data
      assert.equal(messages.filter((message) => message.type === "user").length, 1, "no visible parent summary prompt")
      const calls = state.calls.length
      await rejectChild(info.summary.sessionID, `msg_summarylater${mode}`)
      await fixture.api(`/api/session/${info.summary.sessionID}/wait`, undefined, "POST")
      assert.equal(state.calls.length, calls, "persisted summary child cannot replay")
    }
    checks.push(mode)
  }
  console.log(JSON.stringify({ kind, checks, passed: checks.length, providerCalls: state.calls.length }, null, 2))
} finally {
  state.hold?.release.resolve()
  await fixture.close()
  await writeFile(join(fixture.output, "summary-requests.json"), JSON.stringify(state.calls, null, 2))
  console.error(`Goal summary evidence: ${fixture.output}`)
}

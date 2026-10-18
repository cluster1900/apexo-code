import { startShellFixture } from "./grok-shell-fixture.mjs"

export async function startGoalFixture(kind, options = {}) {
  const plan = options.progress
    ? "# Goal plan\n## Acceptance criteria\nPreserve and verify the original objective.\n## Task checklist\n- [ ] Capture evidence\n- [ ] Independently inspect evidence\n"
    : "Implement the objective and verify the result"
  const progressNote = "PROGRESS_NOTE: Used captured local evidence."
  const control = { hold: undefined, calls: [], reject: options.reject ?? 0, plan, progressNote }
  const runtime = await startShellFixture(kind, {
    goalReports: true,
    config: options.config,
    models: options.models,
    next: async ({ body, ancillary }) => {
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
      control.calls.push({ phase, body })
      if (phase === "planning") return { content: JSON.stringify({ plan }) }
      if (phase === "evaluating")
        return {
          content: JSON.stringify({
            decision: "candidate_complete",
            evidence: "Work and checks completed",
            next_step: "Verify every requirement",
            blocker_key: "",
          }),
        }
      if (phase === "verifying" && control.reject > 0) {
        const gap = `Verification gap ${control.reject--}`
        return {
          content: JSON.stringify({
            confidence: "high",
            blocking: "none",
            achieved: false,
            evidence: gap,
            unmet: [gap],
          }),
        }
      }
      if (phase === "verifying")
        return {
          content: JSON.stringify({
            confidence: "high",
            blocking: "none",
            achieved: true,
            evidence: "Every requirement verified",
            unmet: [],
          }),
        }
      if (phase === "executing" && control.hold) await control.hold.promise
      if (phase === "executing" && options.progress) {
        const strings = (value) =>
          typeof value === "string"
            ? [value]
            : value && typeof value === "object"
              ? Object.values(value).flatMap(strings)
              : []
        const progress = JSON.parse(/Advisory plan progress: ([^\n]+)/.exec(strings(body).join("\n"))?.[1] ?? "null")
        if (!progress?.tasks?.[0]?.completed)
          return { tool: "update_goal", args: { plan_progress: { complete: [0, 1], deviation: progressNote } } }
      }
      return { content: "GOAL_UI_WORK_COMPLETED" }
    },
  })
  return { runtime, control }
}

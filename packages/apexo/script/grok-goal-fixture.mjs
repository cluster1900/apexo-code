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
    next: async (request) => {
      const custom = await options.next?.(request)
      if (custom) return custom
      const { body, ancillary } = request
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

// Shared by the CLI and Desktop /auto flows: bash asks, AUTO_SAFE runs `git status`, AUTO_RISKY runs `rm -rf`.
export const autoReviewFixture = {
  config: { permission: { "*": "allow", bash: "ask" } },
  next: ({ text, finished, ancillary }) => {
    if (ancillary) return
    const command = text.includes("AUTO_SAFE")
      ? "git status"
      : text.includes("AUTO_RISKY")
        ? "rm -rf auto-risky-dir"
        : ""
    if (!command) return
    if (finished) return { content: "AUTO_DONE" }
    return { tool: "run_terminal_cmd", args: { command, description: "auto review check" } }
  },
}

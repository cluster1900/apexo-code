export * as SessionGoalVerification from "./goal-verification"

import type { Goal } from "@apexo/schema/goal"
import { SessionGoalEvaluation } from "./goal-evaluation"

/** Skeptic zero is the reject gatekeeper; only the fresh panel can vote to approve. */
export function aggregate(panel: Goal.Panel) {
  const first = panel.results.find((result) => result.index === 0)
  const decisive = first && !first.achieved && first.confidence === "high"
  const short = panel.count > 1 && decisive && first.blocking === "none"
  if (!first || (!short && panel.results.length !== panel.count)) return
  const voters = panel.count === 1 ? panel.results : panel.results.filter((result) => result.index > 0)
  const achieved =
    !(panel.count > 1 && decisive) && voters.filter((result) => result.achieved).length > voters.length / 2
  const refuters = panel.results.filter((result) => !result.achieved)
  return {
    achieved,
    blocked: !achieved && refuters.length > 0 && refuters.every((result) => result.blocking !== "none"),
    unmet: achieved ? [] : [...new Set(refuters.flatMap((result) => result.unmet))],
    evidence: SessionGoalEvaluation.bounded(
      panel.results
        .map((result) => `Verifier ${result.index + 1} (${result.confidence}): ${result.evidence}`)
        .join("\n\n"),
      32_000,
    ),
  }
}

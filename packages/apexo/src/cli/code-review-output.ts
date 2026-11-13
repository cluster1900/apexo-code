import { CodeReview } from "@apexo/schema/code-review"

export function formatCodeReview(run: CodeReview.Run) {
  const result = run.result
  if (!result) return `Review ${run.id}: ${run.status}${run.error ? ` — ${run.error}` : ""}\n`
  return (
    [
      result.summary,
      ...result.findings.map(
        (finding) =>
          `[${finding.priority}] ${finding.path}${finding.anchor.type === "line" ? `:${finding.anchor.startLine}` : ""} — ${finding.title}\n${finding.explanation}`,
      ),
      `Assessment: ${result.assessment}`,
      ...(result.coverage.exclusions.length
        ? [`Excluded: ${result.coverage.exclusions.map((item) => `${item.path} (${item.reason})`).join(", ")}`]
        : []),
      ...(result.coverage.invalidLocations ? [`File-level locations: ${result.coverage.invalidLocations}`] : []),
      `Review: ${run.id}`,
    ].join("\n\n") + "\n"
  )
}
export function codeReviewExitCode(run: CodeReview.Run, failOn?: CodeReview.Priority) {
  if (run.status !== "completed" || !run.result) return 1
  return failOn && run.result.findings.some((finding) => Number(finding.priority.slice(1)) <= Number(failOn.slice(1)))
    ? 2
    : 0
}

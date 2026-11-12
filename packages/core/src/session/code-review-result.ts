export * as CodeReviewResult from "./code-review-result"

import { randomUUID } from "node:crypto"
import { CodeReview } from "@apexo/schema/code-review"
import { Effect, Option, Schema } from "effect"
import { CodeReviewCapture } from "./code-review-capture"

const json = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const output = Schema.decodeUnknownOption(CodeReview.Output)
export function decode(text: string) {
  const parsed = json(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1"))
  return Option.isSome(parsed) ? output(parsed.value) : Option.none<CodeReview.Output>()
}

export const validate = (captured: CodeReview.Captured, value: CodeReview.Output) =>
  Effect.gen(function* () {
    const capture = yield* CodeReviewCapture.Service
    const exclusions = [...captured.exclusions]
    const state = {
      invalidLocations: 0,
      bytes: captured.files.reduce((sum, file) => sum + Buffer.byteLength(file.patch), 0),
    }
    const seen = new Set<string>()
    const findings = yield* Effect.forEach(value.findings, (finding) =>
      Effect.gen(function* () {
        const filePath = CodeReviewCapture.reviewPath(captured.root, finding.path)
        if (!filePath) {
          state.invalidLocations++
          exclusions.push({ path: finding.path, reason: "invalid_finding_path" })
          return
        }
        const key = JSON.stringify({ ...finding, path: filePath })
        if (seen.has(key)) return
        seen.add(key)
        const text = yield* capture
          .read(captured, finding.side, filePath)
          .pipe(Effect.catch(() => Effect.succeed(undefined)))
        const lines = text === undefined ? [] : text === "" ? [] : text.replace(/\n$/, "").split("\n")
        const valid =
          text !== undefined &&
          Number.isSafeInteger(finding.startLine) &&
          Number.isSafeInteger(finding.endLine) &&
          finding.startLine >= 1 &&
          finding.endLine >= finding.startLine &&
          finding.endLine <= lines.length
        if (text === undefined) exclusions.push({ path: filePath, reason: "captured_content_unavailable" })
        if (!valid) state.invalidLocations++
        const file = captured.files.find(
          (file) => (finding.side === "old" ? (file.oldPath ?? file.path) : file.path) === filePath,
        )
        const inHunk =
          valid &&
          [...(file?.patch ?? "").matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].some((match) => {
            const start = Number(match[finding.side === "old" ? 1 : 3])
            const count = Number(match[finding.side === "old" ? 2 : 4] ?? 1)
            return count > 0 && finding.startLine >= start && finding.endLine < start + count
          })
        const startLine = Math.max(1, finding.startLine - 3)
        const snippet =
          valid && !inHunk
            ? {
                startLine,
                text: lines
                  .slice(startLine - 1, Math.min(finding.endLine + 3, startLine + 49))
                  .join("\n")
                  .slice(0, 16_384),
              }
            : undefined
        const included =
          snippet && state.bytes + Buffer.byteLength(snippet.text) <= CodeReviewCapture.maximumCapture
            ? snippet
            : undefined
        if (included) state.bytes += Buffer.byteLength(included.text)
        if (snippet && !included) {
          exclusions.push({ path: filePath, reason: "snippet_capture_limit" })
          state.invalidLocations++
        }
        return CodeReview.Finding.make({
          id: `finding_${randomUUID()}`,
          priority: finding.priority,
          title: finding.title,
          explanation: finding.explanation,
          confidence: finding.confidence,
          path: filePath,
          anchor:
            valid && (!snippet || included)
              ? {
                  type: "line",
                  side: finding.side,
                  startLine: finding.startLine,
                  endLine: finding.endLine,
                  inHunk,
                  ...(included ? { snippet: included } : {}),
                }
              : { type: "file" },
        })
      }),
    )
    const selected = findings.filter((finding) => finding !== undefined)
    return {
      summary: value.summary,
      findings: selected,
      assessment: selected.length
        ? ("issues_found" as const)
        : exclusions.length ||
            state.invalidLocations ||
            value.assessment === "inconclusive" ||
            value.assessment === "issues_found"
          ? ("inconclusive" as const)
          : ("no_findings" as const),
      coverage: { exclusions, invalidLocations: state.invalidLocations },
    }
  })

/**
 * Parses the text after `/goal`, matching Grok Build's
 * `/goal <objective> [--budget <tokens>]` and `status|pause|resume|clear`.
 * Shared by the TUI and Desktop so both accept the same syntax.
 */
export type GoalCommand =
  | { type: "open" }
  | { type: "operation"; operation: "status" | "pause" | "resume" | "clear" }
  | { type: "create"; objective: string; tokenBudget?: number }
  | { type: "invalid"; objective: string; reason: "budget" }

const operations = new Set(["status", "pause", "resume", "clear"])
const budgetFlag = /(?:^|\s)--budget(?:=|\s+)(\S*)/u

export function parseGoalCommand(input: string | undefined): GoalCommand {
  const text = (input ?? "")
    .trim()
    .replace(/^\/goal(?=\s|$)/u, "")
    .trim()
  if (!text) return { type: "open" }
  if (operations.has(text)) return { type: "operation", operation: text as "status" }
  const match = budgetFlag.exec(text)
  if (!match) return { type: "create", objective: text }
  const objective = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length))
    .replace(/\s+/gu, " ")
    .trim()
  const raw = match[1] ?? ""
  const value = Number(raw)
  if (!/^[1-9]\d*$/u.test(raw) || !Number.isSafeInteger(value)) return { type: "invalid", objective, reason: "budget" }
  if (!objective) return { type: "invalid", objective, reason: "budget" }
  return { type: "create", objective, tokenBudget: value }
}

/**
 * Grok Build's post-edit diagnostics summary (xai-grok-tools `lsp/manager.rs`): errors before
 * warnings, information and hints dropped, at most 10 per file and 30 per summary, with a note for
 * anything trimmed, wrapped in `<lsp-diagnostics>`. Edit tools append it to model output inside a
 * `<system-reminder>` the same way Grok Build's `LspDiagnosticsReminder` does.
 */
export * as LspDiagnostics from "./lsp-diagnostics"

import type { NativeLspClient } from "./lsp-client"

/** How long an edit waits for the language servers' verdict (Grok Build `DIAGNOSTICS_DRAIN_TIMEOUT`). */
export const DRAIN_TIMEOUT_MS = 500
export const MAX_PER_FILE = 10
export const MAX_PER_SUMMARY = 30

export interface FileReport {
  readonly uri: string
  readonly items: readonly NativeLspClient.Diagnostic[]
}

const escape = (message: string) =>
  message
    .replaceAll("</lsp-diagnostics>", "&lt;/lsp-diagnostics&gt;")
    .replaceAll("</system-reminder>", "&lt;/system-reminder&gt;")

/** The `<lsp-diagnostics>` block for these reports, or undefined when nothing is worth showing. */
export function summarize(reports: readonly FileReport[]): string | undefined {
  const lines: string[] = []
  const counts = { found: 0, shown: 0 }
  for (const report of reports) {
    const reportable = report.items
      .flatMap((item) =>
        item.severity === 1 ? [{ label: "error", item }] : item.severity === 2 ? [{ label: "warn", item }] : [],
      )
      .sort((a, b) => Number(a.label !== "error") - Number(b.label !== "error") || a.item.line - b.item.line)
    counts.found += reportable.length
    const showing = reportable.slice(0, Math.max(0, Math.min(MAX_PER_FILE, MAX_PER_SUMMARY - counts.shown)))
    if (!showing.length) continue
    lines.push(`${report.uri.startsWith("file://") ? report.uri.slice("file://".length) : report.uri}:`)
    counts.shown += showing.length
    for (const { label, item } of showing) lines.push(`  ${label}[L${item.line + 1}]: ${escape(item.message)}`)
  }
  if (!lines.length) return undefined
  if (counts.found > counts.shown) lines.push(`… and ${counts.found - counts.shown} more not shown`)
  return `<lsp-diagnostics>\n${lines.join("\n")}\n</lsp-diagnostics>`
}

/** Append a summary to model output the way Grok Build appends reminders to tool results. */
export function withReminder(text: string, summary: string | undefined) {
  if (!summary) return text
  const reminder = `<system-reminder>\n${summary}\n</system-reminder>`
  return text ? `${text}\n\n${reminder}` : reminder
}

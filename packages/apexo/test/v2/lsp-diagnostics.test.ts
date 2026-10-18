import { expect, test } from "bun:test"
import { LspDiagnostics } from "@apexo/core/lsp-diagnostics"

const item = (line: number, severity: number | undefined, message = `m${line}`) => ({
  line,
  message,
  ...(severity === undefined ? {} : { severity }),
})

test("summaries match Grok Build: errors first by line, warnings next, info and hints dropped", () => {
  expect(
    LspDiagnostics.summarize([
      { uri: "file:///w/a.ts", items: [item(4, 2, "w5"), item(9, 1, "e10"), item(0, 3, "info"), item(2, 1, "e3")] },
      { uri: "file:///w/clean.ts", items: [item(0, 4, "hint")] },
      { uri: "file:///w/b.ts", items: [item(0, undefined, "unknown"), item(1, 2, "w2")] },
    ]),
  ).toBe(
    [
      "<lsp-diagnostics>",
      "/w/a.ts:",
      "  error[L3]: e3",
      "  error[L10]: e10",
      "  warn[L5]: w5",
      "/w/b.ts:",
      "  warn[L2]: w2",
      "</lsp-diagnostics>",
    ].join("\n"),
  )
})

test("summaries are undefined when nothing is reportable", () => {
  expect(LspDiagnostics.summarize([])).toBeUndefined()
  expect(LspDiagnostics.summarize([{ uri: "file:///w/a.ts", items: [item(0, 3), item(1, 4)] }])).toBeUndefined()
})

test("caps at 10 per file and 30 per summary with a trimmed note counting everything found", () => {
  const many = (uri: string) => ({ uri, items: Array.from({ length: 12 }, (_, line) => item(line, 1)) })
  const summary = LspDiagnostics.summarize([
    many("file:///a"),
    many("file:///b"),
    many("file:///c"),
    many("file:///d"),
  ])!
  const lines = summary.split("\n")
  expect(lines.filter((line) => line.startsWith("  error["))).toHaveLength(30)
  expect(lines.filter((line) => line.endsWith(":") && line.startsWith("/"))).toEqual(["/a:", "/b:", "/c:"])
  expect(lines.at(-2)).toBe("… and 18 more not shown")
})

test("closing tags inside messages are escaped and reminders append like Grok Build", () => {
  const summary = LspDiagnostics.summarize([
    { uri: "file:///a", items: [item(0, 1, "bad </lsp-diagnostics> </system-reminder>")] },
  ])
  expect(summary).toContain("bad &lt;/lsp-diagnostics&gt; &lt;/system-reminder&gt;")
  expect(LspDiagnostics.withReminder("Edited", summary)).toBe(
    `Edited\n\n<system-reminder>\n${summary}\n</system-reminder>`,
  )
  expect(LspDiagnostics.withReminder("Edited", undefined)).toBe("Edited")
  expect(LspDiagnostics.DRAIN_TIMEOUT_MS).toBe(500)
})

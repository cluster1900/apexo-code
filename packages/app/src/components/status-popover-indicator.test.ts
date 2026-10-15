import { expect, test } from "bun:test"
import { hasNonBlockingServiceIssue, serverStatusDotClass } from "./status-popover-indicator"

test("native disabled LSP remains neutral while native and compatibility failures warn", () => {
  expect(hasNonBlockingServiceIssue({ mcp: [], lsp: ["connected", "disabled"] })).toBe(false)
  for (const status of ["failed", "error"] as const) {
    const issue = hasNonBlockingServiceIssue({ mcp: [], lsp: [status] })
    expect(issue).toBe(true)
    expect(serverStatusDotClass({ ready: true, serverHealth: true, issue })).toBe("bg-icon-warning-base")
  }
})

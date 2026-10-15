import { expect, test } from "bun:test"
import { memoryCaptureText } from "@apexo/tui/util/memory-capture"

test("capture diagnostics strip terminal controls while preserving multiline Unicode content", () => {
  const output = memoryCaptureText({
    sessionID: "ses_test",
    activity: "completed",
    fromTurn: 1,
    throughTurn: 2,
    attempt: 1,
    memories: [
      {
        statement: "\u001b[2J中文项目约定\u0007",
        body: "first line\nsecond\tline\u001b]52;c;Y2xpcGJvYXJk\u0007",
        path: "/tmp/memory.md\u000d",
      },
    ],
  })
  expect(output).toContain("中文项目约定\nfirst line\nsecond\tline\n/tmp/memory.md")
  expect(output).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/)
  expect(output).not.toContain("Y2xpcGJvYXJk")
})

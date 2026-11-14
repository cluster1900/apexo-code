import { expect, test } from "bun:test"
import type { ToolPart } from "@apexo/sdk/v2"
import { toolFrame, toolInlineInfo, toolScroll } from "@/cli/cmd/run/tool"

test("denied bash is rendered as failed even when it has no process exit code", () => {
  const output = toolScroll(
    "final",
    toolFrame(
      {
        kind: "tool",
        source: "tool",
        tool: "bash",
        phase: "final",
        text: "",
        toolState: "error",
        toolError: "Permission denied; tool execution stopped",
      },
      "",
    ),
  )
  expect(output).toContain("bash failed: Permission denied")
  expect(output).not.toContain("completed")
  expect(
    toolScroll(
      "final",
      toolFrame({ kind: "tool", source: "tool", tool: "bash", phase: "final", text: "", toolState: "completed" }, ""),
    ),
  ).toBe("bash completed")
})

test("a task without subagent_type is labelled as the general agent it runs", () => {
  const part = {
    id: "task-1",
    sessionID: "session-1",
    messageID: "message-1",
    type: "tool",
    callID: "call-task-1",
    tool: "task",
    state: {
      status: "running",
      input: { description: "Read calc.py and count lines", prompt: "Count the lines" },
      time: { start: 1 },
    },
  } as ToolPart
  expect(toolInlineInfo(part)).toMatchObject({
    title: "Read calc.py and count lines",
    description: "General Agent",
  })
})

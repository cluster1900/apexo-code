import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { GrokBuildTools } from "@/tool/grok-build"
import { ToolJsonSchema } from "@/tool/json-schema"
import type * as Tool from "@/tool/tool"
import { MessageID, SessionID } from "@/session/schema"

function fakeTool(id: string, capture: (value: unknown) => void): Tool.Def {
  return {
    id,
    description: id,
    parameters: Schema.Unknown,
    execute: (args) => {
      capture(args)
      return Effect.succeed({ title: id, metadata: {}, output: "ok" })
    },
  }
}

const context = {
  sessionID: SessionID.make("ses_grok_build_test"),
  messageID: MessageID.ascending("msg_grok_build_test"),
  agent: "build",
  abort: new AbortController().signal,
  metadata: () => Effect.void,
  ask: () => Effect.void,
  messages: [],
} satisfies Tool.Context

describe("grok-build tool profile", () => {
  test("exposes Grok Build names and preserves non-profile tools", () => {
    const tools = GrokBuildTools.adaptTools([
      fakeTool("bash", () => {}),
      fakeTool("read", () => {}),
      fakeTool("edit", () => {}),
      fakeTool("todowrite", () => {}),
      fakeTool("custom", () => {}),
    ])

    expect(tools.map((tool) => tool.id)).toEqual([
      "run_terminal_command",
      "read_file",
      "list_dir",
      "search_replace",
      "todo_write",
      "custom",
    ])
  })

  test("maps Grok Build argument names to Apexo tool arguments", async () => {
    const captured: Record<string, unknown> = {}
    const tools = GrokBuildTools.adaptTools([
      fakeTool("read", (value) => Object.assign(captured, { read: value })),
      fakeTool("edit", (value) => Object.assign(captured, { edit: value })),
      fakeTool("bash", (value) => Object.assign(captured, { shell: value })),
      fakeTool("write", (value) => Object.assign(captured, { write: value })),
    ])

    const read = tools.find((tool) => tool.id === "read_file")
    const edit = tools.find((tool) => tool.id === "search_replace")
    const shell = tools.find((tool) => tool.id === "run_terminal_command")
    const write = tools.find((tool) => tool.id === "write")
    if (!read || !edit || !shell || !write) throw new Error("expected profile tools")

    await Effect.runPromise(read.execute({ target_file: "src/a.ts", offset: 2 }, context))
    await Effect.runPromise(
      edit.execute({ file_path: "src/a.ts", old_string: "old", new_string: "new", replace_all: true }, context),
    )
    await Effect.runPromise(shell.execute({ command: "pwd", description: "cwd" }, context))
    await Effect.runPromise(write.execute({ file_path: "src/a.ts", content: "new" }, context))

    expect(captured).toEqual({
      read: { filePath: "src/a.ts", offset: 2, limit: undefined },
      edit: { filePath: "src/a.ts", oldString: "old", newString: "new", replaceAll: true },
      shell: { command: "pwd", timeout: undefined, workdir: undefined },
      write: { filePath: "src/a.ts", content: "new" },
    })
  })

  test("derives the Grok Build schemas instead of retaining Apexo camelCase schemas", () => {
    const tools = GrokBuildTools.adaptTools([fakeTool("bash", () => {})])
    const shell = tools.find((tool) => tool.id === "run_terminal_command")
    if (!shell) throw new Error("expected run_terminal_command")

    const schema = ToolJsonSchema.fromTool(shell)
    expect(schema.properties).toEqual(
      expect.objectContaining({
        command: expect.anything(),
        description: expect.anything(),
        block_until_ms: expect.anything(),
      }),
    )
    expect(schema.properties).not.toHaveProperty("filePath")
    expect(schema.required).toEqual(["command", "description"])
  })

  test("rejects an invalid Grok Build call before invoking the Apexo tool", async () => {
    let invoked = false
    const shell = GrokBuildTools.adaptTools([
      fakeTool("bash", () => {
        invoked = true
      }),
    ]).find((tool) => tool.id === "run_terminal_command")
    if (!shell) throw new Error("expected run_terminal_command")

    await expect(Effect.runPromise(shell.execute({ command: "pwd" }, context))).rejects.toThrow()
    expect(invoked).toBe(false)
  })
})

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
  test("recognizes canonical names and legacy aliases", () => {
    expect(GrokBuildTools.canonicalToolName("run_terminal_cmd")).toBe("run_terminal_cmd")
    expect(GrokBuildTools.canonicalToolName("run_terminal_command")).toBe("run_terminal_cmd")
    expect(GrokBuildTools.canonicalToolName("spawn_subagent")).toBe("task")
    expect(GrokBuildTools.isProfileTool("enter_plan_mode")).toBe(true)
    expect(GrokBuildTools.isProfileTool("exit_plan_mode")).toBe(true)
    expect(GrokBuildTools.isProfileTool("run_terminal_command")).toBe(true)
    expect(GrokBuildTools.isProfileTool("task")).toBe(true)
  })

  test("exposes Grok Build names and preserves non-profile tools", () => {
    const tools = GrokBuildTools.adaptTools([
      fakeTool("bash", () => {}),
      fakeTool("read", () => {}),
      fakeTool("edit", () => {}),
      fakeTool("todowrite", () => {}),
      fakeTool("custom", () => {}),
    ])

    expect(tools.map((tool) => tool.id)).toEqual([
      "run_terminal_cmd",
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
    const shell = tools.find((tool) => tool.id === "run_terminal_cmd")
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
    const shell = tools.find((tool) => tool.id === "run_terminal_cmd")
    if (!shell) throw new Error("expected run_terminal_cmd")

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
    ]).find((tool) => tool.id === "run_terminal_cmd")
    if (!shell) throw new Error("expected run_terminal_cmd")

    await expect(Effect.runPromise(shell.execute({ command: "pwd" }, context))).rejects.toThrow()
    expect(invoked).toBe(false)
  })

  test("exposes background task output and cancellation tools", async () => {
    const job = {
      id: "job_grok_build_test",
      type: "shell",
      status: "running" as const,
      started_at: Date.now(),
      metadata: { ownerSessionId: context.sessionID },
    }
    let cancelled = false
    const background = {
      get: () => Effect.succeed(job),
      wait: () => Effect.succeed({ info: job, timedOut: true }),
      cancel: () => {
        cancelled = true
        return Effect.succeed({ ...job, status: "cancelled" as const })
      },
    } as never
    const tools = GrokBuildTools.adaptTools([], { background })
    const output = tools.find((tool) => tool.id === "get_task_output")
    const kill = tools.find((tool) => tool.id === "kill_task")
    if (!output || !kill) throw new Error("expected background task tools")

    const snapshot = await Effect.runPromise(output.execute({ task_id: job.id }, context))
    expect(snapshot.metadata).toEqual({ task_id: job.id, status: "running", timed_out: true })
    expect(snapshot.output).toContain(`<task id="${job.id}" status="running">`)

    const result = await Effect.runPromise(kill.execute({ task_id: job.id }, context))
    expect(cancelled).toBe(true)
    expect(result.output).toContain(`Cancelled task ${job.id}.`)
  })

  test("waits for bounded shell commands without killing the background job", async () => {
    const captured: Record<string, unknown> = {}
    const job = {
      id: "job_bounded_shell",
      type: "shell",
      status: "running" as const,
      started_at: Date.now(),
      metadata: { ownerSessionId: context.sessionID },
    }
    const completed = { ...job, status: "completed" as const, output: "done" }
    const background = {
      start: (input: { run: Effect.Effect<string, unknown> }) => {
        void Effect.runPromise(input.run)
        return Effect.succeed(job)
      },
      wait: () => Effect.succeed({ info: completed, timedOut: false }),
    } as never
    const shell = GrokBuildTools.adaptTools(
      [
        {
          ...fakeTool("bash", (value) => Object.assign(captured, value as object)),
          execute: (args) => {
            Object.assign(captured, args as object)
            return Effect.succeed({ title: "shell", metadata: {}, output: "done" })
          },
        },
      ],
      { background },
    ).find((tool) => tool.id === "run_terminal_cmd")
    if (!shell) throw new Error("expected run_terminal_cmd")

    const result = await Effect.runPromise(
      shell.execute({ command: "sleep 1", description: "bounded", block_until_ms: 25 }, context),
    )
    expect(captured).toEqual({ command: "sleep 1", timeout: undefined })
    expect(result.metadata).toEqual({ task_id: job.id, status: "completed", command: "sleep 1" })
    expect(result.output).toContain(`<task id="${job.id}" status="completed">`)
  })

  test("maps follow-up messages to the canonical subagent tool", async () => {
    const captured: Record<string, unknown> = {}
    const tools = GrokBuildTools.adaptTools([fakeTool("task", (value) => Object.assign(captured, value as object))])
    const message = tools.find((tool) => tool.id === "send_subagent_message")
    if (!message) throw new Error("expected send_subagent_message")

    await Effect.runPromise(message.execute({ task_id: "ses_child", prompt: "continue" }, context))
    expect(captured).toEqual({
      description: "Follow-up message",
      prompt: "continue",
      subagent_type: "build",
      task_id: "ses_child",
      background: true,
    })
  })

  test("maps plan mode tools to the canonical names", () => {
    const tools = GrokBuildTools.adaptTools([fakeTool("plan_enter", () => {}), fakeTool("plan_exit", () => {})])

    expect(tools.map((tool) => tool.id)).toEqual(["enter_plan_mode", "exit_plan_mode"])
  })

  test("maps the Grok Build LSP schema to Apexo's LSP input", async () => {
    const captured: Record<string, unknown> = {}
    const lsp = GrokBuildTools.adaptTools([fakeTool("lsp", (value) => Object.assign(captured, value as object))]).find(
      (tool) => tool.id === "lsp",
    )
    if (!lsp) throw new Error("expected lsp")

    await Effect.runPromise(lsp.execute({ operation: "hover", file_path: "src/a.ts", line: 0, character: 3 }, context))
    expect(captured).toEqual({
      operation: "hover",
      filePath: "src/a.ts",
      line: 1,
      character: 4,
      query: undefined,
    })
  })
})

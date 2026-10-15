import { describe, expect, test } from "bun:test"
import { BackgroundJob } from "@apexo/core/background-job"
import { Effect, Schema } from "effect"
import { GrokBuildTools } from "@/tool/grok-build"
import { createExtensions } from "@/tool/grok-build-extensions"
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
    await Effect.runPromise(
      Effect.gen(function* () {
        const captured: Record<string, unknown> = {}
        const background = yield* BackgroundJob.make
        const shell = GrokBuildTools.adaptTools(
          [
            {
              ...fakeTool("bash", () => {}),
              execute: (args) => {
                Object.assign(captured, args as object)
                return Effect.succeed({ title: "shell", metadata: { exit: 0 }, output: "done" })
              },
            },
          ],
          { background },
        ).find((tool) => tool.id === "run_terminal_cmd")!
        const result = yield* shell.execute({ command: "sleep 1", description: "bounded", block_until_ms: 25 }, context)
        expect(captured).toEqual({ command: "sleep 1", timeout: 36_000_000 })
        expect(result.metadata).toMatchObject({ status: "completed", command: "sleep 1", background: false, exit: 0 })
        expect((yield* background.get(String(result.metadata.task_id)))?.status).toBe("completed")
        expect(result.output).toContain(`<task id="${result.metadata.task_id}" status="completed">`)
      }).pipe(Effect.scoped),
    )
  })

  test("reads multiple background tasks with the canonical task_ids input", async () => {
    const jobs = [
      {
        id: "job_one",
        type: "shell",
        status: "completed" as const,
        started_at: Date.now(),
        metadata: { ownerSessionId: context.sessionID },
        output: "one",
      },
      {
        id: "job_two",
        type: "shell",
        status: "completed" as const,
        started_at: Date.now(),
        metadata: { ownerSessionId: context.sessionID },
        output: "two",
      },
    ]
    const background = {
      get: (id: string) => Effect.succeed(jobs.find((job) => job.id === id)),
      wait: (input: { id: string }) =>
        Effect.succeed({ info: jobs.find((job) => job.id === input.id), timedOut: false }),
    } as never
    const output = GrokBuildTools.adaptTools([], { background }).find((tool) => tool.id === "get_task_output")
    if (!output) throw new Error("expected get_task_output")

    const result = await Effect.runPromise(output.execute({ task_ids: ["job_one", "job_two"] }, context))
    expect(result.metadata).toEqual({
      task_ids: ["job_one", "job_two"],
      statuses: [
        { task_id: "job_one", status: "completed" },
        { task_id: "job_two", status: "completed" },
      ],
    })
    expect(result.output).toContain('<task id="job_one" status="completed">')
    expect(result.output).toContain('<task id="job_two" status="completed">')
  })

  test("supports the wait_tasks compatibility alias", async () => {
    const job = {
      id: "job_wait",
      type: "shell",
      status: "completed" as const,
      started_at: Date.now(),
      metadata: { ownerSessionId: context.sessionID },
      output: "done",
    }
    const background = {
      get: () => Effect.succeed(job),
      wait: () => Effect.succeed({ info: job, timedOut: false }),
    } as never
    const wait = GrokBuildTools.adaptTools([], { background }).find((tool) => tool.id === "wait_tasks")
    if (!wait) throw new Error("expected wait_tasks")

    const result = await Effect.runPromise(wait.execute({ task_ids: [job.id], mode: "wait_any" }, context))
    expect(result.metadata).toEqual({
      task_ids: [job.id],
      mode: "wait_any",
      statuses: [{ task_id: job.id, status: "completed" }],
    })
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

  test("maps the canonical task background and resume fields", async () => {
    const captured: Record<string, unknown> = {}
    const task = GrokBuildTools.adaptTools([
      fakeTool("task", (value) => Object.assign(captured, value as object)),
    ]).find((tool) => tool.id === "task")
    if (!task) throw new Error("expected task")

    await Effect.runPromise(task.execute({ description: "inspect", prompt: "check it" }, context))
    expect(captured).toEqual({
      description: "inspect",
      prompt: "check it",
      subagent_type: "general",
      task_id: undefined,
      background: true,
    })

    await Effect.runPromise(
      task.execute(
        {
          description: "resume",
          prompt: "continue",
          subagent_type: "explore",
          run_in_background: false,
          resume_from: "ses_child",
        },
        context,
      ),
    )
    expect(captured).toEqual({
      description: "resume",
      prompt: "continue",
      subagent_type: "explore",
      task_id: "ses_child",
      background: false,
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

  test("allows workspaceSymbol without inventing a file path", async () => {
    const captured: Record<string, unknown> = {}
    const lsp = GrokBuildTools.adaptTools([fakeTool("lsp", (value) => Object.assign(captured, value as object))]).find(
      (tool) => tool.id === "lsp",
    )
    if (!lsp) throw new Error("expected lsp")

    await Effect.runPromise(lsp.execute({ operation: "workspaceSymbol", query: "Session" }, context))
    expect(captured).toEqual({
      operation: "workspaceSymbol",
      filePath: "",
      line: 1,
      character: 1,
      query: "Session",
    })
  })

  test("adds memory, monitor, scheduler, image, and video extensions to the profile", () => {
    const background = {} as never
    const extensions = createExtensions({
      background,
      shell: fakeTool("bash", () => {}),
      task: fakeTool("task", () => {}),
    })
    expect(extensions.map((tool) => tool.id)).toEqual([
      "memory",
      "memory_search",
      "memory_get",
      "image_gen",
      "image_to_video",
      "reference_to_video",
      "image_edit",
      "monitor",
      "scheduler_create",
      "scheduler_delete",
      "scheduler_list",
    ])
    expect(GrokBuildTools.advertisedToolNames()).toEqual(
      expect.arrayContaining([
        "memory",
        "monitor",
        "scheduler_create",
        "scheduler_delete",
        "scheduler_list",
        "image_gen",
        "image_to_video",
        "reference_to_video",
      ]),
    )
  })

  test("creates a scheduled task with the official interval and prompt fields", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const background = yield* BackgroundJob.make
          const create = createExtensions({ background, task: fakeTool("task", () => {}) }).find(
            (tool) => tool.id === "scheduler_create",
          )!
          const result = yield* create.execute(
            { interval: "5m", prompt: "check the deployment", fire_immediately: true },
            context,
          )
          expect(result.metadata).toMatchObject({ status: "running", interval: "300s", updated: false })
          expect(result.metadata.next_fire_at).toBeLessThanOrEqual(Date.now())
          expect((yield* background.get(String(result.metadata.task_id)))?.metadata?.prompt).toBe(
            "check the deployment",
          )
          expect(result.output).toContain("first run starts now")
        }),
      ),
    )
  })
})

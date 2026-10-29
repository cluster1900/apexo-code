import { Scheduler } from "@apexo/core/scheduler"
import { randomUUID } from "node:crypto"
import { GrokBuildMedia } from "./grok-build-media"
import { Effect, Schema } from "effect"
import { NonNegativeInt } from "@apexo/core/schema"
import { BackgroundJob } from "@/background/job"
import { Parameters as QuestionParameters } from "./question"
import { Parameters as TodoParameters } from "./todo"
import { Tool } from "./tool"
import { ToolJsonSchema } from "./json-schema"
import { createExtensions } from "./grok-build-extensions"
import { MemorySearch } from "@apexo/core/memory-search"
import { MemoryWork } from "@apexo/schema/memory-work"
import { Goal } from "@apexo/schema/goal"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionGoalUsage } from "@apexo/core/session/goal-usage"
import { ConfigToolset } from "@apexo/core/config/toolset"
import { SessionFeedback } from "@apexo/core/session/feedback"
import { feedbackTool } from "./feedback"

const DEFAULT_BLOCK_MS = 30_000
const BACKGROUND_TIMEOUT_MS = 10 * 60 * 60 * 1000
const MAX_WAIT_MS = 60 * 60 * 1000
const MAX_TASK_IDS = 20

/** The Grok Build names are a model-facing wire contract over Apexo tools. */
const ReadFileParameters = Schema.Struct({
  target_file: Schema.String.annotate({ description: "The path of the file to read" }),
  offset: Schema.optional(NonNegativeInt).annotate({ description: "The 1-indexed line to start reading from" }),
  limit: Schema.optional(NonNegativeInt).annotate({ description: "The number of lines to read" }),
})

const ListDirectoryParameters = Schema.Struct({
  target_directory: Schema.String.annotate({ description: "The directory path to list" }),
})

const SearchReplaceParameters = Schema.Struct({
  file_path: Schema.String.annotate({ description: "The path to the file to modify" }),
  old_string: Schema.String.annotate({ description: "The exact text to replace" }),
  new_string: Schema.String.annotate({ description: "The replacement text" }),
  replace_all: Schema.optional(Schema.Boolean).annotate({ description: "Replace every occurrence" }),
})

// Current Grok Build advertises command, description, and block_until_ms.
const RunTerminalParameters = shellParameters(DEFAULT_BLOCK_MS)

function shellParameters(defaultMs: number, maxMs?: number) {
  return Schema.Struct({
    command: Schema.String.annotate({ description: "The command to run" }),
    description: Schema.String.annotate({ description: "Why this command is needed" }),
    block_until_ms: Schema.optional(
      maxMs === undefined ? NonNegativeInt : NonNegativeInt.check(Schema.isLessThanOrEqualTo(maxMs)),
    ).annotate({
      description: `How long to wait in milliseconds before continuing in the background; defaults to ${defaultMs}ms, 0 returns immediately, maximum ${maxMs ?? BACKGROUND_TIMEOUT_MS}ms. Includes shell startup time. This does not terminate the command.`,
    }),
  })
}

const WriteParameters = Schema.Struct({
  file_path: Schema.String.annotate({ description: "The absolute path to the file to write" }),
  content: Schema.String.annotate({ description: "The content to write" }),
})

const SpawnSubagentParameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.optional(Schema.String).annotate({
    description: "The agent type, defaulting to general-purpose",
  }),
  run_in_background: Schema.optional(Schema.Boolean).annotate({
    description: "Return immediately with a subagent ID; defaults to true",
  }),
  resume_from: Schema.optional(Schema.String).annotate({
    description: "Resume a previous subagent session from its ID",
  }),
})

const SendSubagentMessageParameters = Schema.Struct({
  task_id: Schema.String.annotate({ description: "The running subagent ID" }),
  prompt: Schema.String.annotate({ description: "The message to send to the subagent" }),
})

const PlanModeParameters = Schema.Struct({})

const WebSearchBuildParameters = Schema.Struct({
  query: Schema.String.annotate({ description: "The web search query" }),
})

const LspParameters = Schema.Struct({
  operation: Schema.Literals([
    "goToDefinition",
    "findReferences",
    "hover",
    "goToImplementation",
    "documentSymbol",
    "workspaceSymbol",
  ]).annotate({ description: "The LSP operation to perform" }),
  file_path: Schema.optional(Schema.String).annotate({ description: "Absolute path to the file" }),
  line: Schema.optional(NonNegativeInt).annotate({ description: "0-indexed line number" }),
  character: Schema.optional(NonNegativeInt).annotate({ description: "0-indexed column number" }),
  query: Schema.optional(Schema.String).annotate({ description: "Symbol name or partial name" }),
})

type Adapter = {
  id: string
  description: string
  parameters: Schema.Decoder<unknown>
  map: (args: unknown) => unknown
}

function adapter(
  id: string,
  description: string,
  parameters: Schema.Decoder<unknown>,
  map: (args: unknown) => unknown,
): Adapter {
  return { id, description, parameters, map }
}

const adapters: Record<string, readonly Adapter[]> = {
  bash: [
    adapter("run_terminal_cmd", "Run a bash command and return its output.", RunTerminalParameters, (args) => {
      const value = args as Schema.Schema.Type<typeof RunTerminalParameters>
      return { command: value.command, timeout: value.block_until_ms === 0 ? undefined : value.block_until_ms }
    }),
  ],
  read: [
    adapter("read_file", "Read a file from the workspace.", ReadFileParameters, (args) => {
      const value = args as Schema.Schema.Type<typeof ReadFileParameters>
      return { filePath: value.target_file, offset: value.offset, limit: value.limit }
    }),
    adapter("list_dir", "List the entries in a directory.", ListDirectoryParameters, (args) => ({
      filePath: (args as Schema.Schema.Type<typeof ListDirectoryParameters>).target_directory,
    })),
  ],
  edit: [
    adapter("search_replace", "Replace an exact string in a file.", SearchReplaceParameters, (args) => {
      const value = args as Schema.Schema.Type<typeof SearchReplaceParameters>
      return {
        filePath: value.file_path,
        oldString: value.old_string,
        newString: value.new_string,
        replaceAll: value.replace_all,
      }
    }),
  ],
  write: [
    adapter("write", "Write content to a file.", WriteParameters, (args) => {
      const value = args as Schema.Schema.Type<typeof WriteParameters>
      return { filePath: value.file_path, content: value.content }
    }),
  ],
  task: [
    adapter("task", "Start a subagent to work on a task.", SpawnSubagentParameters, (args) => {
      const value = args as Schema.Schema.Type<typeof SpawnSubagentParameters>
      return {
        description: value.description,
        prompt: value.prompt,
        subagent_type: value.subagent_type ?? "general",
        task_id: value.resume_from,
        background: value.run_in_background ?? true,
      }
    }),
    adapter(
      "send_subagent_message",
      "Send a follow-up message to a running subagent.",
      SendSubagentMessageParameters,
      (args) => {
        const value = args as Schema.Schema.Type<typeof SendSubagentMessageParameters>
        return {
          description: "Follow-up message",
          prompt: value.prompt,
          subagent_type: "build",
          task_id: value.task_id,
          background: true,
        }
      },
    ),
  ],
  plan_enter: [
    adapter("enter_plan_mode", "Switch to plan mode before making changes.", PlanModeParameters, (args) => args),
  ],
  plan_exit: [
    adapter("exit_plan_mode", "Leave plan mode and switch to implementation.", PlanModeParameters, (args) => args),
  ],
  lsp: [
    adapter("lsp", "Use language servers for code intelligence.", LspParameters, (args) => {
      const value = args as Schema.Schema.Type<typeof LspParameters>
      return {
        operation: value.operation,
        filePath: value.file_path ?? "",
        line: (value.line ?? 0) + 1,
        character: (value.character ?? 0) + 1,
        query: value.query,
      }
    }),
  ],
  todowrite: [adapter("todo_write", "Update the task checklist.", TodoParameters, (args) => args)],
  question: [adapter("ask_user_question", "Ask the user one or more questions.", QuestionParameters, (args) => args)],
  webfetch: [
    adapter("web_fetch", "Fetch a URL and return its contents.", Schema.Struct({ url: Schema.String }), (args) => args),
  ],
  websearch: [
    adapter("web_search", "Search the web for relevant information.", WebSearchBuildParameters, (args) => args),
  ],
}

const unsupportedBuiltins = new Set(["invalid", "glob", "apply_patch", "execute", "skill"])

/** Canonical Grok Build names advertised to model-facing clients. */
export const canonicalToolNames = [
  "run_terminal_cmd",
  "get_task_output",
  "kill_task",
  "monitor",
  "scheduler_create",
  "scheduler_delete",
  "scheduler_list",
  "read_file",
  "list_dir",
  "grep",
  "search_replace",
  "write",
  "task",
  "send_subagent_message",
  "wait_tasks",
  "lsp",
  "enter_plan_mode",
  "exit_plan_mode",
  "todo_write",
  "update_goal",
  "send_feedback",
  "ask_user_question",
  "memory",
  "memory_search",
  "memory_get",
  "image_gen",
  "image_edit",
  "image_to_video",
  "reference_to_video",
  "web_search",
  "web_fetch",
] as const

/** Compatibility names accepted by older Apexo clients. */
export const legacyToolAliases = {
  run_terminal_command: "run_terminal_cmd",
  spawn_subagent: "task",
} as const

export const toolNames = canonicalToolNames

export function advertisedToolNames(options: { webSearch?: boolean } = {}) {
  return canonicalToolNames.filter((name) => name !== "web_search" || options.webSearch === true)
}

export function canonicalToolName(id: string) {
  return legacyToolAliases[id as keyof typeof legacyToolAliases] ?? id
}

type AdaptOptions = {
  goals?: SessionGoal.Interface
  feedback?: SessionFeedback.Interface
  directory?: string
  projectID?: string
  memory?: Effect.Effect<MemorySearch.Interface, MemorySearch.MemoryError>
  memoryAccess?: (ctx: Tool.Context, operation: Effect.Effect<string>) => Effect.Effect<string>
  dream?: (ctx: Tool.Context) => Effect.Effect<MemoryWork.Result>
  background?: BackgroundJob.Interface
  scheduler?: Scheduler.Interface
  profileExtensions?: boolean
  shell?: Tool.Def
  task?: Tool.Def
  media?: GrokBuildMedia.Options
  maxWaitMs?: number
  bash?: ConfigToolset.Bash
}

function adapt(
  tool: Tool.Def,
  item: Adapter,
  block: { default: number; maximum: number },
  background?: BackgroundJob.Interface,
): Tool.Def {
  return {
    ...tool,
    id: item.id,
    description: item.description,
    parameters: item.parameters,
    // The original jsonSchema describes Apexo's camelCase input. Clear it so
    // ToolJsonSchema derives the Grok snake_case contract above.
    // Advertise the ceiling, but decode oversized waits before clamping as Grok does.
    jsonSchema:
      item.id === "run_terminal_cmd"
        ? ToolJsonSchema.fromSchema(shellParameters(block.default, block.maximum))
        : undefined,
    execute: (args, ctx) =>
      Effect.flatMap(Schema.decodeUnknownEffect(item.parameters)(args), (decoded) => {
        if (item.id !== "run_terminal_cmd" || !background) {
          return tool.execute(item.map(decoded), ctx)
        }

        const input = decoded as Schema.Schema.Type<typeof RunTerminalParameters>
        const wait = Math.min(input.block_until_ms ?? block.default, block.maximum)
        const id = `job_${randomUUID()}`
        return Effect.gen(function* () {
          const job = yield* background.start({
            id,
            type: "shell",
            title: input.description,
            metadata: {
              ownerSessionId: ctx.sessionID,
              command: input.command,
              foreground: wait !== 0,
              background: wait === 0,
            },
            onPromote: Effect.gen(function* () {
              yield* ctx.metadata({
                title: input.description,
                metadata: {
                  task_id: id,
                  jobId: id,
                  background: true,
                  command: input.command,
                },
              })
              if (ctx.watchBackground) yield* ctx.watchBackground(id)
            }),
            run: tool
              .execute(
                // The foreground wait budget must never become the process kill deadline.
                { command: input.command, timeout: BACKGROUND_TIMEOUT_MS },
                {
                  ...ctx,
                  abort: new AbortController().signal,
                  metadata: (value) =>
                    Effect.gen(function* () {
                      yield* background.report({
                        id,
                        output: typeof value.metadata?.output === "string" ? value.metadata.output : undefined,
                        metadata: value.metadata,
                      })
                      const current = yield* background.get(id)
                      if (current?.metadata?.background === true) return
                      yield* ctx.metadata({
                        ...value,
                        metadata: { ...value.metadata, task_id: id, jobId: id, foreground: true, background: false },
                      })
                    }),
                },
              )
              .pipe(
                Effect.tap((result) => background.report({ id, metadata: result.metadata })),
                Effect.map((result) => result.output),
              ),
          })
          if (wait === 0) {
            if (ctx.watchBackground) yield* ctx.watchBackground(job.id)
            return backgroundStarted(input, job)
          }

          const aborted = Effect.callback<never>((resume) => {
            if (ctx.abort.aborted) return resume(Effect.interrupt)
            const onAbort = () => resume(Effect.interrupt)
            ctx.abort.addEventListener("abort", onAbort, { once: true })
            return Effect.sync(() => ctx.abort.removeEventListener("abort", onAbort))
          })
          return yield* Effect.gen(function* () {
            const result = yield* Effect.raceFirst(
              Effect.raceFirst(
                background.wait({
                  id: job.id,
                  timeout: wait,
                }),
                background.waitForPromotion(job.id).pipe(Effect.map((info) => ({ info, timedOut: false }))),
              ),
              aborted,
            )
            const info = result.timedOut ? yield* background.promote(job.id) : result.info
            if (!info) return yield* Effect.die(new Error(`Command ${job.id} disappeared`))
            if (info.status === "running") {
              const started = backgroundStarted(input, info)
              return {
                ...started,
                metadata: { ...started.metadata, timed_out: result.timedOut },
              }
            }
            return {
              title: input.description,
              metadata: { ...info.metadata, task_id: info.id, status: info.status, background: false },
              output: formatTaskOutput(info),
            }
          })
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              const current = yield* background.get(id)
              if (current?.metadata?.background !== true) yield* background.cancel(id)
            }),
          ),
        )
      }).pipe(Effect.orDie),
  }
}

function backgroundStarted(input: Schema.Schema.Type<typeof RunTerminalParameters>, job: BackgroundJob.Info) {
  return {
    title: input.description,
    metadata: { task_id: job.id, jobId: job.id, status: job.status, command: input.command, background: true },
    output: `<task id="${job.id}" status="running">\nBackground command started.\n</task>`,
  }
}

export function adaptTools(tools: readonly Tool.Def[], options: AdaptOptions = {}) {
  const maximum = Math.min(
    BACKGROUND_TIMEOUT_MS,
    options.bash?.max_block_until_ms || BACKGROUND_TIMEOUT_MS,
    (options.bash?.max_timeout_secs ?? 0) > 0
      ? Math.max(1, Math.round(options.bash!.max_timeout_secs! * 1000))
      : BACKGROUND_TIMEOUT_MS,
  )
  const block = {
    default: Math.min(options.bash?.default_block_until_ms ?? DEFAULT_BLOCK_MS, maximum),
    maximum,
  }
  const adapted = tools
    .filter((tool) => !unsupportedBuiltins.has(tool.id))
    .flatMap((tool) => {
      const items = adapters[tool.id]
      return items ? items.map((item) => adapt(tool, item, block, options.background)) : [tool]
    })
  const withBackground = options.background
    ? [
        ...adapted,
        taskOutput(options.background, options.maxWaitMs ?? MAX_WAIT_MS),
        waitTasks(options.background, options.maxWaitMs ?? MAX_WAIT_MS),
        killTask(options.background),
      ]
    : adapted
  if (!options.profileExtensions || !options.background) return withBackground
  return [
    ...withBackground,
    updateGoal(options.goals),
    feedbackTool(options.feedback),
    ...createExtensions({
      directory: options.directory,
      projectID: options.projectID,
      memory: options.memory,
      memoryAccess: options.memoryAccess,
      dream: options.dream,
      background: options.background,
      scheduler: options.scheduler,
      shell: options.shell,
      task: options.task,
      media: options.media,
    }),
  ]
}

function updateGoal(goals?: SessionGoal.Interface): Tool.Def {
  return {
    id: "update_goal",
    description:
      "Report progress or a blocker for the explicitly active goal. completed=true requests independent verification; it cannot directly complete the goal. Only the goal's main worker may update it. Do not create, pause, resume, or replace a goal with this tool. plan_progress.complete marks zero-based immutable Task checklist ordinals; plan_progress.deviation appends one concise advisory note. Never modify the plan or treat annotations as completion proof.",
    parameters: Goal.Update,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const attempt = yield* SessionGoalUsage.Current
        if (!goals || !attempt || attempt.sessionID !== ctx.sessionID)
          return yield* Effect.die(new Error("No active goal worker owns this session"))
        const input = yield* Schema.decodeUnknownEffect(Goal.Update)(args).pipe(Effect.orDie)
        yield* ctx.ask({
          permission: "update_goal",
          patterns: [attempt.goalID],
          always: ["*"],
          metadata: { goalID: attempt.goalID },
        })
        const info = yield* goals.update(attempt, input).pipe(Effect.orDie)
        return {
          title: "Goal progress",
          metadata: { goalID: info.id, status: info.status },
          output: JSON.stringify({
            status: info.status,
            message: info.message,
            verification_requested: input.completed === true,
            plan_progress: info.planProgress,
          }),
        }
      }),
  }
}

function taskOutput(background: BackgroundJob.Interface, maxWaitMs: number): Tool.Def {
  const ids = Schema.NullOr(
    Schema.Union([Schema.String, Schema.Finite, Schema.Array(Schema.Union([Schema.String, Schema.Finite]))]),
  )
  const parameters = Schema.Struct({
    task_ids: Schema.optional(ids),
    task_id: Schema.optional(ids),
    timeout_ms: Schema.optional(Schema.NullOr(NonNegativeInt)),
  })
  return {
    id: "get_task_output",
    description: `Get status and output for up to ${MAX_TASK_IDS} background tasks or subagents. Omit timeout_ms or pass 0 for a snapshot; a positive value waits for all tasks, capped at ${maxWaitMs}ms.`,
    parameters,
    // Compatibility decoding is deliberately broader than the model-facing contract.
    jsonSchema: taskWaitSchema(maxWaitMs, false),
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(parameters)(args)
        if (input.task_ids !== undefined && input.task_id !== undefined)
          return invalidTaskRequest("get_task_output", "Provide task_ids or its legacy task_id alias, not both.")
        const value = input.task_ids === undefined ? input.task_id : input.task_ids
        const ids = [
          ...new Set(
            (typeof value === "string" || typeof value === "number" ? [value] : (value ?? []))
              .map((id) => String(id).trim())
              .filter(Boolean),
          ),
        ]
        if (ids.length === 0) return invalidTaskRequest("get_task_output", "Provide a non-empty task_ids list.")
        if (ids.length > MAX_TASK_IDS)
          return invalidTaskRequest("get_task_output", `task_ids exceeds maximum of ${MAX_TASK_IDS} entries.`)
        const results = yield* Effect.all(
          ids.map((id) =>
            Effect.gen(function* () {
              const job = yield* background.get(id)
              if (!job || !owns(job, ctx.sessionID)) {
                return { id, status: "not_found" as const, output: `Task or subagent ${id} not found.` }
              }
              const result = yield* background.wait({ id, timeout: Math.min(input.timeout_ms ?? 0, maxWaitMs) })
              const info = result.info ?? job
              return {
                id,
                status: info.status,
                timedOut: result.timedOut,
                output: formatTaskOutput(info),
              }
            }),
          ),
          { concurrency: "unbounded" },
        )
        const metadata =
          results.length === 1
            ? {
                task_id: results[0].id,
                status: results[0].status,
                ...(results[0].timedOut ? { timed_out: true } : {}),
              }
            : {
                task_ids: results.map((result) => result.id),
                statuses: results.map((result) => ({ task_id: result.id, status: result.status })),
              }
        return {
          title: results.map((result) => result.id).join(", "),
          metadata,
          output: results.map((result) => result.output).join("\n\n"),
        }
      }).pipe(Effect.orDie),
  }
}

function killTask(background: BackgroundJob.Interface): Tool.Def {
  const parameters = Schema.Struct({
    task_id: Schema.String.annotate({ description: "The background task or subagent ID to terminate" }),
  })
  return {
    id: "kill_task",
    description: "Terminate a running background task or subagent.",
    parameters,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(parameters)(args)
        const job = yield* background.get(input.task_id)
        if (!job || !owns(job, ctx.sessionID)) {
          return {
            title: input.task_id,
            metadata: { task_id: input.task_id, status: "not_found" },
            output: `Task or subagent ${input.task_id} not found.`,
          }
        }
        const result = yield* background.cancel(input.task_id)
        return {
          title: input.task_id,
          metadata: { task_id: input.task_id, status: result?.status ?? "not_found" },
          output: result?.status === "cancelled" ? `Cancelled task ${input.task_id}.` : formatTaskOutput(result ?? job),
        }
      }).pipe(Effect.orDie),
  }
}

function waitTasks(background: BackgroundJob.Interface, maxWaitMs: number): Tool.Def {
  const parameters = Schema.Struct({
    task_ids: Schema.Array(Schema.String).annotate({ description: "One or more background task or subagent IDs" }),
    timeout_ms: Schema.optional(Schema.NullOr(NonNegativeInt)).annotate({
      description: `Maximum wait in milliseconds; defaults to 30 seconds, capped at ${maxWaitMs}`,
    }),
    mode: Schema.optional(Schema.Literals(["wait_all", "wait_any"])).annotate({
      description: "Wait for all tasks or return when any task completes",
    }),
  })
  return {
    id: "wait_tasks",
    description: `Wait for up to ${MAX_TASK_IDS} background tasks or subagents. Prefer get_task_output with a positive timeout_ms. Defaults to 30 seconds, capped at ${maxWaitMs}ms; wait_all also uses the default when timeout_ms is 0. Returns snapshots for every requested task.`,
    parameters,
    jsonSchema: taskWaitSchema(maxWaitMs, true),
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(parameters)(args)
        if (input.task_ids.length === 0) return invalidTaskRequest("wait_tasks", "task_ids must not be empty.")
        // Unlike get_task_output, the legacy contract counts and looks up raw IDs.
        if (input.task_ids.length > MAX_TASK_IDS)
          return invalidTaskRequest("wait_tasks", `task_ids exceeds maximum of ${MAX_TASK_IDS} entries.`)

        const timeout = Math.min(
          input.mode === "wait_any" ? (input.timeout_ms ?? DEFAULT_BLOCK_MS) : input.timeout_ms || DEFAULT_BLOCK_MS,
          maxWaitMs,
        )
        if (input.mode === "wait_any" && timeout > 0) {
          const jobs = yield* Effect.all(input.task_ids.map((id) => background.get(id)))
          const pending = [
            ...new Set(
              jobs.flatMap((job) =>
                job?.status === "running" &&
                job.metadata?.blockedReason !== "process_restart" &&
                owns(job, ctx.sessionID)
                  ? [job.id]
                  : [],
              ),
            ),
          ]
          if (pending.length) yield* Effect.raceAll(pending.map((id) => background.wait({ id, timeout })))
        }
        const wait = (id: string) =>
          Effect.gen(function* () {
            const job = yield* background.get(id)
            if (!job || !owns(job, ctx.sessionID)) {
              return { id, status: "not_found" as const, output: `Task or subagent ${id} not found.` }
            }
            const result = yield* background.wait({
              id,
              timeout: input.mode === "wait_any" ? 0 : timeout,
            })
            const info = result.info ?? job
            return {
              id,
              status: info.status,
              timedOut: result.timedOut,
              output: formatTaskOutput(info),
            }
          })
        const results = yield* Effect.all(input.task_ids.map(wait), { concurrency: "unbounded" })
        return {
          title: results.map((result) => result.id).join(", "),
          metadata: {
            task_ids: results.map((result) => result.id),
            mode: input.mode ?? "wait_all",
            statuses: results.map((result) => ({ task_id: result.id, status: result.status })),
          },
          output: results.map((result) => result.output).join("\n\n"),
        }
      }).pipe(Effect.orDie),
  }
}

function taskWaitSchema(maxWaitMs: number, legacy: boolean) {
  return ToolJsonSchema.fromSchema(
    Schema.Struct({
      task_ids: Schema.Array(Schema.String)
        .check(Schema.isMinLength(1), Schema.isMaxLength(MAX_TASK_IDS))
        .annotate({ description: "Background task or subagent IDs; use a one-element array for one task" }),
      timeout_ms: Schema.optional(NonNegativeInt.check(Schema.isLessThanOrEqualTo(maxWaitMs))).annotate({
        description: `Wait in milliseconds, at most ${maxWaitMs}`,
      }),
      ...(legacy ? { mode: Schema.Literals(["wait_all", "wait_any"]) } : {}),
    }),
  )
}

function invalidTaskRequest(title: string, output: string) {
  return { title, metadata: { status: "invalid_request" }, output }
}

function owns(job: BackgroundJob.Info, sessionID: string) {
  return (
    job.metadata?.parentSessionId === sessionID ||
    job.metadata?.sessionID === sessionID ||
    job.metadata?.ownerSessionId === sessionID
  )
}

function formatTaskOutput(job: BackgroundJob.Info) {
  const lines = [`<task id="${job.id}" status="${job.status}">`]
  if (job.output) lines.push(job.output)
  if (job.error) lines.push(`<error>${job.error}</error>`)
  lines.push("</task>")
  return lines.join("\n")
}

export function isProfileTool(id: string) {
  return canonicalToolNames.includes(canonicalToolName(id) as (typeof canonicalToolNames)[number])
}

export const GrokBuild = {
  adaptTools,
  canonicalToolName,
  canonicalToolNames,
  advertisedToolNames,
  isProfileTool,
  legacyToolAliases,
  toolNames,
}

export * as GrokBuildTools from "./grok-build"

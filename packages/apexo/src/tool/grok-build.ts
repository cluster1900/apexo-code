import { Effect, Schema } from "effect"
import { NonNegativeInt } from "@apexo/core/schema"
import { BackgroundJob } from "@/background/job"
import { Parameters as QuestionParameters } from "./question"
import { Parameters as TodoParameters } from "./todo"
import { Tool } from "./tool"

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
const RunTerminalParameters = Schema.Struct({
  command: Schema.String.annotate({ description: "The command to run" }),
  description: Schema.String.annotate({ description: "Why this command is needed" }),
  block_until_ms: Schema.optional(NonNegativeInt).annotate({
    description: "How long to wait in milliseconds; 0 requests background execution",
  }),
})

const WriteParameters = Schema.Struct({
  file_path: Schema.String.annotate({ description: "The absolute path to the file to write" }),
  content: Schema.String.annotate({ description: "The content to write" }),
})

const SpawnSubagentParameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.optional(Schema.String).annotate({ description: "The agent type, defaulting to build" }),
  task_id: Schema.optional(Schema.String),
  background: Schema.optional(Schema.Boolean),
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
        subagent_type: value.subagent_type ?? "build",
        task_id: value.task_id,
        background: value.background,
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
  "read_file",
  "list_dir",
  "grep",
  "search_replace",
  "write",
  "task",
  "send_subagent_message",
  "lsp",
  "enter_plan_mode",
  "exit_plan_mode",
  "todo_write",
  "ask_user_question",
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
  background?: BackgroundJob.Interface
}

function adapt(tool: Tool.Def, item: Adapter, background?: BackgroundJob.Interface): Tool.Def {
  return {
    ...tool,
    id: item.id,
    description: item.description,
    parameters: item.parameters,
    // The original jsonSchema describes Apexo's camelCase input. Clear it so
    // ToolJsonSchema derives the Grok snake_case contract above.
    jsonSchema: undefined,
    execute: (args, ctx) =>
      Effect.flatMap(Schema.decodeUnknownEffect(item.parameters)(args), (decoded) => {
        if (item.id !== "run_terminal_cmd" || !background || !hasBoundedWait(decoded)) {
          return tool.execute(item.map(decoded), ctx)
        }

        const input = decoded as Schema.Schema.Type<typeof RunTerminalParameters>
        return Effect.gen(function* () {
          const job = yield* background.start({
            type: "shell",
            title: input.description,
            metadata: {
              ownerSessionId: ctx.sessionID,
              command: input.command,
            },
            run: tool
              .execute(
                { command: input.command, timeout: undefined },
                {
                  ...ctx,
                  abort: new AbortController().signal,
                  metadata: () => Effect.void,
                },
              )
              .pipe(Effect.map((result) => result.output)),
          })
          if (input.block_until_ms === 0) return backgroundStarted(input, job)

          const result = yield* background.wait({ id: job.id, timeout: input.block_until_ms })
          if (result.timedOut || !result.info) {
            return {
              ...backgroundStarted(input, job),
              metadata: { task_id: job.id, status: "running", command: input.command, timed_out: true },
            }
          }
          return {
            title: input.description,
            metadata: { task_id: result.info.id, status: result.info.status, command: input.command },
            output: formatTaskOutput(result.info),
          }
        })
      }).pipe(Effect.orDie),
  }
}

function hasBoundedWait(value: unknown): value is Schema.Schema.Type<typeof RunTerminalParameters> {
  return (
    typeof value === "object" &&
    value !== null &&
    "block_until_ms" in value &&
    typeof (value as { block_until_ms?: number }).block_until_ms === "number"
  )
}

function backgroundStarted(input: Schema.Schema.Type<typeof RunTerminalParameters>, job: BackgroundJob.Info) {
  return {
    title: input.description,
    metadata: { task_id: job.id, status: job.status, command: input.command },
    output: `<task id="${job.id}" status="running">\nBackground command started.\n</task>`,
  }
}

export function adaptTools(tools: readonly Tool.Def[], options: AdaptOptions = {}) {
  const adapted = tools
    .filter((tool) => !unsupportedBuiltins.has(tool.id))
    .flatMap((tool) => {
      const items = adapters[tool.id]
      return items ? items.map((item) => adapt(tool, item, options.background)) : [tool]
    })
  if (!options.background) return adapted
  return [...adapted, taskOutput(options.background), killTask(options.background)]
}

function taskOutput(background: BackgroundJob.Interface): Tool.Def {
  const parameters = Schema.Struct({
    task_ids: Schema.optional(Schema.Array(Schema.String)).annotate({
      description: "One or more background task or subagent IDs; use a one-element array for one task",
    }),
    task_id: Schema.optional(Schema.String.annotate({ description: "Legacy single background task or subagent ID" })),
    timeout_ms: Schema.optional(NonNegativeInt).annotate({
      description: "How long to wait for all tasks in milliseconds; omitted or 0 returns snapshots",
    }),
  })
  return {
    id: "get_task_output",
    description: "Get the current status and output of a background task or subagent.",
    parameters,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(parameters)(args)
        const ids = input.task_ids ?? (input.task_id ? [input.task_id] : [])
        if (ids.length === 0) {
          return {
            title: "get_task_output",
            metadata: { status: "invalid_request" },
            output: "Provide at least one task ID in task_ids.",
          }
        }
        const results = yield* Effect.all(
          ids.map((id) =>
            Effect.gen(function* () {
              const job = yield* background.get(id)
              if (!job || !owns(job, ctx.sessionID)) {
                return { id, status: "not_found" as const, output: `Task or subagent ${id} not found.` }
              }
              const result = yield* background.wait({ id, timeout: input.timeout_ms ?? 0 })
              const info = result.info ?? job
              return {
                id,
                status: info.status,
                timedOut: result.timedOut,
                output: formatTaskOutput(info),
              }
            }),
          ),
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

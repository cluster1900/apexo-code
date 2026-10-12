import { Effect, Schema } from "effect"
import { NonNegativeInt } from "@apexo/core/schema"
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
// Apexo receives the wait value as its shell timeout until process management
// adds Grok's background-task handle semantics.
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

const WebSearchBuildParameters = Schema.Struct({
  query: Schema.String.annotate({ description: "The web search query" }),
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
    adapter("run_terminal_command", "Run a bash command and return its output.", RunTerminalParameters, (args) => {
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
    adapter("spawn_subagent", "Start a subagent to work on a task.", SpawnSubagentParameters, (args) => {
      const value = args as Schema.Schema.Type<typeof SpawnSubagentParameters>
      return {
        description: value.description,
        prompt: value.prompt,
        subagent_type: value.subagent_type ?? "build",
        task_id: value.task_id,
        background: value.background,
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

const unsupportedBuiltins = new Set(["invalid", "glob", "apply_patch", "lsp", "execute", "skill"])

/** Names advertised in the headless available_commands event. */
export const toolNames = [
  "run_terminal_command",
  "read_file",
  "list_dir",
  "grep",
  "search_replace",
  "write",
  "spawn_subagent",
  "todo_write",
  "ask_user_question",
  "web_search",
  "web_fetch",
] as const

function adapt(tool: Tool.Def, item: Adapter): Tool.Def {
  return {
    ...tool,
    id: item.id,
    description: item.description,
    parameters: item.parameters,
    // The original jsonSchema describes Apexo's camelCase input. Clear it so
    // ToolJsonSchema derives the Grok snake_case contract above.
    jsonSchema: undefined,
    execute: (args, ctx) =>
      Effect.flatMap(Schema.decodeUnknownEffect(item.parameters)(args), (decoded) =>
        tool.execute(item.map(decoded), ctx),
      ).pipe(Effect.orDie),
  }
}

export function adaptTools(tools: readonly Tool.Def[]) {
  return tools.filter((tool) => !unsupportedBuiltins.has(tool.id)).flatMap((tool) => {
    const items = adapters[tool.id]
    return items ? items.map((item) => adapt(tool, item)) : [tool]
  })
}

export function isProfileTool(id: string) {
  return toolNames.includes(id as (typeof toolNames)[number])
}

export const GrokBuild = { adaptTools, isProfileTool, toolNames }

export * as GrokBuildTools from "./grok-build"

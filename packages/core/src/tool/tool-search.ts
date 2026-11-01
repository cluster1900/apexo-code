export * as ToolSearchTools from "./tool-search"

import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Schema } from "effect"
import type { CommandSandbox } from "../command-sandbox"
import type { Location } from "../location"
import { McpToolIndex } from "../mcp-tool-index"
import { McpTools } from "../mcp-tools"
import type { PermissionV2 } from "../permission"
import type { ToolRegistry } from "./registry"
import { Failure, Tool } from "./tool"

const SearchInput = Schema.Struct({
  query: Schema.String.annotate({
    description:
      'Keywords to match against tool names, server names, and descriptions. Include the server name and action for best results (e.g. "linear create issue", "slack read thread history").',
  }),
  limit: Schema.Int.pipe(Schema.optional).annotate({
    description: "Maximum number of results to return (default 5).",
  }),
})

const UseInput = Schema.Struct({
  tool_name: Schema.String.pipe(Schema.optional).annotate({
    description: "Discovered MCP target name (server__tool).",
  }),
  tool_input: Schema.Union([Schema.Record(Schema.String, Schema.Unknown), Schema.String, Schema.Null])
    .pipe(Schema.optional)
    .annotate({ description: "Inline remote arguments matching the discovered input schema." }),
  tool_input_file: Schema.String.pipe(Schema.optional).annotate({
    description: "Path to a UTF-8 JSON arguments-only object.",
  }),
  file: Schema.String.pipe(Schema.optional).annotate({
    description: "Path to a UTF-8 JSON document with tool_name and object tool_input.",
  }),
})

const tryParse = <A>(fn: () => A) =>
  Effect.try({
    try: fn,
    catch: (error) => new Failure({ message: error instanceof Error ? error.message : String(error) }),
  })

export function makeTools(deps: {
  readonly toolCatalog: Effect.Effect<ReadonlyArray<McpTools.CatalogEntry>>
  readonly reconnecting: Effect.Effect<boolean>
  readonly permission: PermissionV2.Interface
  readonly sandbox: CommandSandbox.Interface
  readonly location: Location.Ref
  readonly registry: Pick<ToolRegistry.Interface, "materialize">
}): Record<string, Tool.AnyTool> {
  const visibleDeferred = (context: Tool.Context) =>
    Effect.gen(function* () {
      const decide = yield* deps.permission
        .inspect(context.sessionID, context.agent)
        .pipe(Effect.mapError((error) => new Failure({ message: error.message })))
      return (yield* deps.toolCatalog).filter(
        (entry) => entry.mode === "deferred" && decide(entry.key, ["*"]) !== "deny",
      )
    })

  const readJsonFile = (targetPath: string, context: Tool.Context) =>
    Effect.gen(function* () {
      const absolute = path.resolve(deps.location.directory, targetPath)
      yield* deps.sandbox
        .assertRead(context.sessionID, absolute)
        .pipe(Effect.mapError((error) => new Failure({ message: error.message })))
      yield* deps.permission
        .assert({
          action: "read",
          resources: [absolute],
          save: [deps.location.directory],
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
        })
        .pipe(Effect.mapError(() => new Failure({ message: `Read permission denied for ${absolute}` })))
      const stat = yield* Effect.tryPromise({
        try: () => fs.stat(absolute),
        catch: () => new Failure({ message: `MCP source file must be a regular file: ${absolute}` }),
      })
      if (!stat.isFile()) return yield* new Failure({ message: `MCP source file must be a regular file: ${absolute}` })
      if (stat.size > McpToolIndex.MAX_INPUT_FILE) return yield* new Failure({ message: "MCP source file exceeds 8 MiB" })
      return yield* Effect.tryPromise({
        try: () => Bun.file(absolute).text(),
        catch: () => new Failure({ message: `Could not read MCP source file: ${absolute}` }),
      })
    })

  const searchTool = Tool.make({
    description:
      'Search for MCP tools by keyword and retrieve their input schemas.\nIf status is "partial", some servers may still be connecting.',
    input: SearchInput,
    output: Schema.String,
    execute: (input, context) =>
      Effect.gen(function* () {
        const entries = yield* visibleDeferred(context)
        const ready = !(yield* deps.reconnecting)
        const limit = input.limit !== undefined && input.limit > 0 ? Math.min(input.limit, 255) : 5
        const rendered = McpToolIndex.render(entries, input.query, limit, ready)
        return JSON.stringify(
          {
            results: rendered.results,
            total_hidden_tools: rendered.total_hidden_tools,
            status: rendered.status,
            note: rendered.note,
          },
          null,
          2,
        )
      }),
  })

  const useTool = Tool.make({
    description:
      "Call a discovered MCP integration tool.\n\nSupply exactly one form: `tool_name` plus `tool_input` inline; `tool_name` plus `tool_input_file` for a UTF-8 JSON arguments-only object; or `file` for a UTF-8 JSON document with canonical `tool_name` and object `tool_input`. File forms require Read permission, then normal MCP approval. Files must be complete regular files, at most 8 MiB. Arguments must match the discovered schema from `search_tool`.",
    input: UseInput,
    output: Schema.Unknown,
    toModelOutput: (value) => value.output as ReadonlyArray<Tool.Content>,
    execute: (input, context) =>
      Effect.gen(function* () {
        const parsed = yield* tryParse(() => McpToolIndex.parseUseToolInput(input))
        const call =
          parsed.form === "inline"
            ? yield* tryParse(() => ({
                toolName: parsed.toolName,
                toolInput: McpToolIndex.normalizeArguments(parsed.toolInput),
              }))
            : parsed.form === "arguments-file"
              ? yield* readJsonFile(parsed.path, context).pipe(
                  Effect.flatMap((json) =>
                    tryParse(() => ({ toolName: parsed.toolName, toolInput: McpToolIndex.parseArgumentsFile(json) })),
                  ),
                )
              : yield* readJsonFile(parsed.path, context).pipe(
                  Effect.flatMap((json) => tryParse(() => McpToolIndex.parseInvocationFile(json))),
                )
        const entries = yield* visibleDeferred(context)
        const nativeNames = new Set((yield* deps.registry.materialize()).definitions.map((item) => item.name))
        const target = yield* tryParse(() => McpToolIndex.resolve(entries, call.toolName, nativeNames))
        return McpTools.toContent(yield* target.call(call.toolInput, context))
      }),
  })

  return {
    [McpToolIndex.SEARCH_TOOL]: searchTool,
    [McpToolIndex.USE_TOOL]: useTool,
  }
}

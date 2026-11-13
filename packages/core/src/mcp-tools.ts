export * as McpTools from "./mcp-tools"

import { createHash } from "node:crypto"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { Effect, Schema } from "effect"
import type { CommandSandbox } from "./command-sandbox"
import { Tool } from "./tool/tool"
import { PermissionV2 } from "./permission"
import { LocationRuntimeGuard } from "./location-runtime-guard"
import { Location } from "./location"
import type { McpCall } from "./mcp-call"

export type ExposureMode = "eager" | "deferred" | "codemode"

export interface CatalogEntry {
  readonly key: string
  readonly server: string
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
  readonly outputSchema?: unknown
  readonly mode: ExposureMode
  readonly tool: Tool.AnyTool
  readonly call: (args: Record<string, unknown>, context: Tool.Context) => Effect.Effect<CallToolResult, Tool.Failure>
}

export function name(server: string, tool: string) {
  const readable = `mcp_${server}_${tool}`.replace(/[^A-Za-z0-9_-]/g, "_")
  const hash = createHash("sha256")
    .update(JSON.stringify([server, tool]))
    .digest("hex")
    .slice(0, 10)
  return `${readable.slice(0, 53)}_${hash}`
}

export function toContent(result: CallToolResult): Tool.Content[] {
  const content = result.content.flatMap((part): Tool.Content[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }]
    if (part.type === "image" || part.type === "audio") return [{ type: "file", data: part.data, mime: part.mimeType }]
    if (part.type === "resource") {
      if ("text" in part.resource) return [{ type: "text", text: part.resource.text }]
      return [{ type: "file", data: part.resource.blob, mime: part.resource.mimeType ?? "application/octet-stream" }]
    }
    if (part.type === "resource_link") return [{ type: "text", text: `${part.name}: ${part.uri}` }]
    return []
  })
  if (content.length || result.structuredContent === undefined) return content
  return [{ type: "text", text: JSON.stringify(result.structuredContent) }]
}

export async function make(input: {
  server: string
  definition: Awaited<ReturnType<Client["listTools"]>>["tools"][number]
  client: Client
  calls?: McpCall.Interface
  timeout: number
  permission: PermissionV2.Interface
  guard: LocationRuntimeGuard.Interface
  location: Location.Ref
  sandbox?: CommandSandbox.Interface
  remote?: boolean
  mode?: ExposureMode
  active: () => boolean
}): Promise<CatalogEntry> {
  const { CallToolResultSchema } = await import("@modelcontextprotocol/sdk/types.js")
  const key = name(input.server, input.definition.name)
  const description = input.definition.description ?? `Call ${input.definition.name} on ${input.server}`
  const codec = await Tool.jsonSchema(input.definition.inputSchema)
  const execute = (args: unknown, context: Tool.Context) =>
    input.guard.use(
      input.location,
      Effect.gen(function* () {
        if (!input.active()) return yield* new Tool.Failure({ message: `Stale MCP tool call: ${key}` })
        if (input.remote && input.sandbox) {
          yield* input.sandbox
            .assertNetwork(context.sessionID)
            .pipe(Effect.mapError(() => new Tool.Failure({ message: `Sandbox network policy blocked ${key}` })))
        }
        yield* input.permission
          .assert({
            action: key,
            resources: ["*"],
            save: ["*"],
            sessionID: context.sessionID,
            agent: context.agent,
            source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
          })
          .pipe(Effect.mapError(() => new Tool.Failure({ message: `Permission denied for ${key}` })))
        const request = (signal: AbortSignal, timeout: number) =>
          input.client.callTool(
            { name: input.definition.name, arguments: args as Record<string, unknown> },
            CallToolResultSchema,
            {
              signal,
              timeout,
              maxTotalTimeout: timeout,
              resetTimeoutOnProgress: false,
            },
          )
        const result = yield* (
          input.calls
            ? input.calls.tool(context, request)
            : Effect.tryPromise({ try: (signal) => request(signal, input.timeout), catch: (error) => error })
        ).pipe(
          Effect.mapError(
            () =>
              new Tool.Failure({
                message: input.calls?.retired()
                  ? `MCP request stopped for ${key}; reconnecting may reset server state. The call was not replayed.`
                  : `MCP request failed for ${key}`,
              }),
          ),
        )
        if (result.isError)
          return yield* new Tool.Failure({
            message:
              result.content
                .flatMap((part) => (part.type === "text" ? [part.text] : []))
                .join("\n")
                .slice(0, 8_000) || `MCP tool ${key} failed`,
          })
        return result
      }),
    )

  return {
    key,
    server: input.server,
    name: input.definition.name,
    description,
    inputSchema: input.definition.inputSchema,
    ...(input.definition.outputSchema !== undefined ? { outputSchema: input.definition.outputSchema } : {}),
    mode: input.mode ?? "eager",
    tool: Tool.make({
      description,
      input: codec,
      output: Schema.Unknown,
      execute,
      toModelOutput: (value) => toContent(CallToolResultSchema.parse(value.output)),
    }),
    call: (args, context) =>
      Schema.decodeUnknownEffect(codec)(args).pipe(
        Effect.mapError((error) => new Tool.Failure({ message: `Invalid tool input for ${key}: ${error.message}` })),
        Effect.flatMap((validated) => execute(validated, context)),
      ),
  }
}

export * as McpTools from "./mcp-tools"

import { createHash } from "node:crypto"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { Effect, Schema } from "effect"
import type { CommandSandbox } from "./command-sandbox"
import { Tool } from "./tool/tool"
import { PermissionV2 } from "./permission"
import { LocationRuntimeGuard } from "./location-runtime-guard"
import { Location } from "./location"

export function name(server: string, tool: string) {
  const readable = `mcp_${server}_${tool}`.replace(/[^A-Za-z0-9_-]/g, "_")
  const hash = createHash("sha256")
    .update(JSON.stringify([server, tool]))
    .digest("hex")
    .slice(0, 10)
  return `${readable.slice(0, 53)}_${hash}`
}

export async function make(input: {
  server: string
  definition: Awaited<ReturnType<Client["listTools"]>>["tools"][number]
  client: Client
  timeout: number
  permission: PermissionV2.Interface
  guard: LocationRuntimeGuard.Interface
  location: Location.Ref
  sandbox?: CommandSandbox.Interface
  remote?: boolean
  active: () => boolean
}) {
  const { CallToolResultSchema } = await import("@modelcontextprotocol/sdk/types.js")
  const key = name(input.server, input.definition.name)
  const codec = await Tool.jsonSchema(input.definition.inputSchema)
  return [
    key,
    Tool.make({
      description: input.definition.description ?? `Call ${input.definition.name} on ${input.server}`,
      input: codec,
      output: Schema.Unknown,
      execute: (args, context) =>
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
            const result = yield* Effect.tryPromise({
              try: (signal) =>
                input.client.callTool(
                  { name: input.definition.name, arguments: args as Record<string, unknown> },
                  CallToolResultSchema,
                  {
                    signal,
                    timeout: input.timeout,
                    maxTotalTimeout: input.timeout,
                    resetTimeoutOnProgress: false,
                  },
                ),
              catch: () => new Tool.Failure({ message: `MCP request failed for ${key}` }),
            })
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
        ),
      toModelOutput: ({ output }) => {
        const result = CallToolResultSchema.parse(output)
        const content = result.content.flatMap((part): Tool.Content[] => {
          if (part.type === "text") return [{ type: "text", text: part.text }]
          if (part.type === "image" || part.type === "audio")
            return [{ type: "file", data: part.data, mime: part.mimeType }]
          if (part.type === "resource") {
            if ("text" in part.resource) return [{ type: "text", text: part.resource.text }]
            return [
              { type: "file", data: part.resource.blob, mime: part.resource.mimeType ?? "application/octet-stream" },
            ]
          }
          if (part.type === "resource_link") return [{ type: "text", text: `${part.name}: ${part.uri}` }]
          return []
        })
        return content.length || result.structuredContent === undefined
          ? content
          : [{ type: "text", text: JSON.stringify(result.structuredContent) }]
      },
    }),
  ] as const
}

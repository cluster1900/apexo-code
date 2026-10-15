export * as McpResourceTools from "./mcp-resources"

import { Effect, Layer, Schema } from "effect"
import { MCP } from "../mcp"
import { McpResources } from "../mcp-resources"
import { PermissionV2 } from "../permission"
import { Location } from "../location"
import { LocationRuntimeGuard } from "../location-runtime-guard"
import { makeLocationNode } from "../effect/app-node"
import { Tool } from "./tool"
import { ToolRegistry } from "./registry"
import { Tools } from "./tools"

const ListInput = Schema.Struct({ server: Schema.optional(Schema.String.check(Schema.isMinLength(1))) })
const ReadInput = Schema.Struct({
  server: Schema.String.check(Schema.isMinLength(1)),
  uri: Schema.String.check(Schema.isMinLength(1)),
})
const supported = new Set(["application/pdf", "image/gif", "image/jpeg", "image/png", "image/webp"])
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const permission = yield* PermissionV2.Service
    const location = yield* Location.Service
    const guard = yield* LocationRuntimeGuard.Service
    const tools = yield* Tools.Service
    const authorize = (server: string | undefined, uri: string | undefined, context: Tool.Context) =>
      Effect.gen(function* () {
        const servers = server === undefined ? yield* mcp.resourceServers : [server]
        if (!servers.length) return
        yield* permission.assert({
          action: "read",
          resources: servers.map((name) => McpResources.permissionResource(name, uri)),
          save: servers.map((name) => McpResources.permissionResource(name)),
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
        })
      })
    const list = (kind: "resources" | "templates") =>
      Tool.withPermission(
        Tool.make({
          description:
            kind === "resources"
              ? "List resources from connected MCP servers. Optional server selects one server. Catalog failures are reported explicitly; this never connects disconnected servers."
              : "List resource URI templates from connected MCP servers. Templates describe parameterized resource identifiers; this does not read their contents.",
          input: ListInput,
          output: Schema.Unknown,
          toModelOutput: ({ output }) => [{ type: "text", text: JSON.stringify(output) }],
          execute: (input, context) =>
            guard
              .use(
                location,
                Effect.gen(function* () {
                  yield* authorize(input.server, undefined, context)
                  return yield* kind === "resources" ? mcp.resources(input.server) : mcp.resourceTemplates(input.server)
                }),
              )
              .pipe(
                Effect.mapError(
                  (error) =>
                    new Tool.Failure({
                      message:
                        error instanceof MCP.Failure
                          ? error.message
                          : "Read permission denied for MCP resource catalog",
                    }),
                ),
              ),
        }),
        "read",
      )
    yield* tools
      .register({
        list_mcp_resources: list("resources"),
        list_mcp_resource_templates: list("templates"),
        read_mcp_resource: Tool.withPermission(
          Tool.make({
            description:
              "Read an MCP resource using an exact server name and resource URI. URIs are opaque MCP identifiers, including non-file schemes. Read permission is checked before requesting content.",
            input: ReadInput,
            output: Schema.Unknown,
            execute: (input, context) =>
              guard
                .use(
                  location,
                  Effect.gen(function* () {
                    yield* authorize(input.server, input.uri, context)
                    return yield* mcp.readResource(input.server, input.uri)
                  }),
                )
                .pipe(
                  Effect.mapError(
                    (error) =>
                      new Tool.Failure({
                        message:
                          error instanceof MCP.Failure ? error.message : "Read permission denied for MCP resource",
                      }),
                  ),
                ),
            toModelOutput: ({ output }) => {
              const result = output as McpResources.Read
              return result.contents.flatMap((part): Tool.Content[] => {
                const mime = part.mimeType ?? "application/octet-stream"
                if ("text" in part)
                  return [{ type: "text", text: `Resource: ${part.uri}\nMIME: ${mime}\n${part.text}` }]
                if (supported.has(mime)) return [{ type: "file", data: part.blob, mime, name: part.uri }]
                return [
                  {
                    type: "text",
                    text: `[Binary MCP resource omitted: ${part.uri} (${mime}) is not a supported attachment type]`,
                  },
                ]
              })
            },
          }),
          "read",
        ),
      })
      .pipe(Effect.orDie)
  }),
)
export const node = makeLocationNode({
  name: "tool/mcp-resources",
  layer,
  deps: [MCP.node, ToolRegistry.node, PermissionV2.node, Location.node, LocationRuntimeGuard.node],
})

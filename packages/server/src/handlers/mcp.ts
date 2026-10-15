import { MCP } from "@apexo/core/mcp"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "@apexo/protocol/errors"
import { McpServerNotFoundError } from "@apexo/protocol/groups/mcp"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const McpHandler = HttpApiBuilder.group(Api, "server.mcp", (handlers) =>
  handlers
    .handle("mcp.status", () =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        return yield* mcp.status
      }),
    )
    .handle("mcp.connect", ({ params }) => manage("connect", params.server))
    .handle("mcp.disconnect", ({ params }) => manage("disconnect", params.server))
    .handle("mcp.retry", ({ params }) => manage("retry", params.server))
    .handle("mcp.resetPreference", ({ params }) => manage("resetPreference", params.server))
    .handle("mcp.authStart", ({ params }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        return yield* mcp.authStart(params.server).pipe(Effect.mapError(mapError))
      }),
    )
    .handle("mcp.authCancel", ({ params }) =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        yield* mcp.authCancel(params.server, params.flowID).pipe(Effect.mapError(mapError))
        return true
      }),
    ),
)

function manage(action: "connect" | "disconnect" | "retry" | "resetPreference", server: string) {
  return Effect.gen(function* () {
    const mcp = yield* MCP.Service
    yield* mcp[action](server).pipe(Effect.mapError(mapError))
    return true
  })
}

function mapError(error: MCP.Failure) {
  if (error.code === "not_found")
    return new McpServerNotFoundError({
      server: error.server ?? "",
      message: error.message,
    })
  if (error.code === "busy")
    return new ConflictError({
      message: error.message,
      resource: error.server ?? "",
    })
  if (["invalid", "unsupported", "auth"].includes(error.code))
    return new InvalidRequestError({
      message: error.message,
      kind: error.code,
    })
  return new ServiceUnavailableError({
    message: error.message,
    service: "mcp",
  })
}

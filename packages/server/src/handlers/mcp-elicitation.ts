import { McpElicitation } from "@apexo/core/mcp-elicitation"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { SessionV2 } from "@apexo/core/session"
import {
  ConflictError,
  InvalidRequestError,
  McpElicitationNotFoundError,
  ServiceUnavailableError,
} from "@apexo/protocol/errors"
import { Effect, RcMap } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

export const McpElicitationHandler = HttpApiBuilder.group(Api, "server.mcpElicitation", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const sessions = yield* SessionV2.Service
    return handlers
      .handle(
        "mcpElicitation.list",
        Effect.fn(function* (ctx) {
          const forms = yield* McpElicitation.Service
          if (!ctx.query.includeDescendants) return yield* forms.list(ctx.params.sessionID)
          // Inspect live Location scopes only: polling must never boot historical worktrees or MCP peers.
          const active = yield* RcMap.keys(locations.rcMap)
          const pending = yield* Effect.forEach(active, (ref) =>
            Effect.gen(function* () {
              const forms = yield* McpElicitation.Service
              return yield* forms.list()
            }).pipe(
              Effect.provide(locations.get(ref)),
              Effect.mapError(
                () => new ServiceUnavailableError({ service: "mcp_elicitation", message: "MCP forms unavailable" }),
              ),
            ),
          )
          const requests = yield* Effect.filter(pending.flat(), (request) =>
            Effect.gen(function* () {
              const seen = new Set<string>()
              let id: typeof request.sessionID | undefined = request.sessionID
              while (id && !seen.has(id)) {
                if (id === ctx.params.sessionID) return true
                seen.add(id)
                const parentID: typeof request.sessionID | undefined = yield* sessions.get(id).pipe(
                  Effect.map((session) => session.parentID),
                  Effect.orElseSucceed(() => undefined),
                )
                id = parentID
              }
              return false
            }),
          )
          return requests.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        }),
      )
      .handle(
        "mcpElicitation.reply",
        Effect.fn(function* (ctx) {
          const forms = yield* McpElicitation.Service
          yield* forms.reply(ctx.params.sessionID, ctx.params.requestID, ctx.payload).pipe(
            Effect.mapError((error) =>
              error.code === "invalid"
                ? new InvalidRequestError({
                    kind: "mcp_elicitation",
                    message: error.message,
                    ...(error.field !== undefined ? { field: error.field } : {}),
                  })
                : error.code === "missing"
                  ? new McpElicitationNotFoundError({ requestID: ctx.params.requestID, message: error.message })
                  : error.code === "conflict"
                    ? new ConflictError({ message: error.message })
                    : new ServiceUnavailableError({ service: "mcp_elicitation", message: error.message }),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)

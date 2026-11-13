import { McpElicitation } from "@apexo/core/mcp-elicitation"
import {
  ConflictError,
  InvalidRequestError,
  McpElicitationNotFoundError,
  ServiceUnavailableError,
} from "@apexo/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

export const McpElicitationHandler = HttpApiBuilder.group(Api, "server.mcpElicitation", (handlers) =>
  handlers
    .handle(
      "mcpElicitation.list",
      Effect.fn(function* (ctx) {
        const forms = yield* McpElicitation.Service
        return yield* forms.list(ctx.params.sessionID)
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
    ),
)

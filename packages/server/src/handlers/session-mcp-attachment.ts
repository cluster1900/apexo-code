import { SessionMcpAttachment } from "@apexo/core/session/mcp-attachment"
import { SessionMcpAttachmentOperation } from "@apexo/core/session/mcp-attachment-operation"
import { McpAttachmentForbidden } from "@apexo/protocol/groups/session-mcp-attachment"
import {
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "@apexo/protocol/errors"
import { SessionSchema } from "@apexo/core/session/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const SessionMcpAttachmentHandler = HttpApiBuilder.group(Api, "server.sessionMcpAttachment", (handlers) =>
  Effect.gen(function* () {
    const operations = yield* SessionMcpAttachmentOperation.Service
    return handlers
      .handle("sessionMcpAttachment.reserve", ({ params, payload }) =>
        operations.reserve(params.sessionID, payload.request).pipe(Effect.mapError(failure(params.sessionID))),
      )
      .handle("sessionMcpAttachment.execute", ({ params, payload }) =>
        operations
          .execute(params.sessionID, params.operationID, payload.request)
          .pipe(Effect.mapError(failure(params.sessionID))),
      )
      .handle("sessionMcpAttachment.status", ({ params }) =>
        operations.status(params.sessionID, params.operationID).pipe(Effect.mapError(failure(params.sessionID))),
      )
      .handle("sessionMcpAttachment.cancel", ({ params }) =>
        operations.cancel(params.sessionID, params.operationID).pipe(Effect.mapError(failure(params.sessionID))),
      )
  }),
)
function failure(sessionID: SessionSchema.ID) {
  return (error: InstanceType<typeof SessionMcpAttachment.Failure>) => {
    if (error.code === "missing") return new SessionNotFoundError({ sessionID, message: error.message })
    if (error.code === "denied") return new McpAttachmentForbidden({ message: error.message })
    if (["changed", "expired", "conflict"].includes(error.code)) return new ConflictError({ message: error.message })
    if (error.code === "unavailable")
      return new ServiceUnavailableError({ message: error.message, service: "session.mcpAttachment" })
    return new InvalidRequestError({ message: error.message, kind: error.code })
  }
}

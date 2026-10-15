import { McpAttachmentOperation } from "@apexo/schema/mcp-attachment-operation"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError } from "../errors"

export class McpAttachmentForbidden extends Schema.TaggedErrorClass<McpAttachmentForbidden>()(
  "McpAttachmentForbidden",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}
const error = [
  McpAttachmentForbidden,
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
]
const root = "/api/session/:sessionID/mcp/operations"
const params = { sessionID: SessionID, operationID: McpAttachmentOperation.OperationID }
export const SessionMcpAttachmentGroup = HttpApiGroup.make("server.sessionMcpAttachment").add(
  HttpApiEndpoint.post("sessionMcpAttachment.reserve", root, {
    params: { sessionID: SessionID },
    payload: Schema.Struct({ request: McpAttachmentOperation.Request }),
    success: McpAttachmentOperation.Operation,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.sessionMcpAttachment.reserve",
      summary: "Reserve a Session-owned attachment operation without MCP or model work",
    }),
  ),
  HttpApiEndpoint.post("sessionMcpAttachment.execute", `${root}/:operationID/execute`, {
    params,
    payload: Schema.Struct({ request: McpAttachmentOperation.Request }),
    success: McpAttachmentOperation.Operation,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.sessionMcpAttachment.execute",
      summary: "Execute or join an exact reserved MCP attachment operation",
    }),
  ),
  HttpApiEndpoint.get("sessionMcpAttachment.status", `${root}/:operationID`, {
    params,
    success: McpAttachmentOperation.Operation,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.sessionMcpAttachment.status",
      summary: "Inspect an existing attachment operation without starting work",
    }),
  ),
  HttpApiEndpoint.post("sessionMcpAttachment.cancel", `${root}/:operationID/cancel`, {
    params,
    success: McpAttachmentOperation.Operation,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.sessionMcpAttachment.cancel",
      summary: "Cancel and join one Session-owned attachment operation",
    }),
  ),
)

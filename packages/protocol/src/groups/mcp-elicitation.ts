import { McpElicitation } from "@apexo/schema/mcp-elicitation"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import {
  ConflictError,
  InvalidRequestError,
  McpElicitationNotFoundError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "../errors"

const root = "/api/session/:sessionID/mcp/elicitation"
const error = [
  ConflictError,
  InvalidRequestError,
  McpElicitationNotFoundError,
  ServiceUnavailableError,
  SessionNotFoundError,
]
export const McpElicitationGroup = HttpApiGroup.make("server.mcpElicitation").add(
  HttpApiEndpoint.get("mcpElicitation.list", root, {
    params: { sessionID: SessionID },
    success: Schema.Array(McpElicitation.Request),
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.mcpElicitation.list" })),
  HttpApiEndpoint.post("mcpElicitation.reply", `${root}/:requestID/reply`, {
    params: { sessionID: SessionID, requestID: McpElicitation.ID },
    // Generated clients require a struct; Core validates the canonical discriminated Reply before settlement.
    payload: Schema.Struct({
      action: Schema.Literals(["accept", "decline", "cancel"]),
      content: Schema.optional(McpElicitation.Content),
    }).annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: HttpApiSchema.NoContent,
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.mcpElicitation.reply" })),
)

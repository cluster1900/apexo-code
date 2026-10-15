import { Mcp } from "@apexo/schema/mcp"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "../errors"

export class McpServerNotFoundError extends Schema.TaggedErrorClass<McpServerNotFoundError>()(
  "McpServerNotFoundError",
  { server: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

const errors = [ConflictError, InvalidRequestError, ServiceUnavailableError, McpServerNotFoundError]
export const McpGroup = HttpApiGroup.make("server.mcp").add(
  HttpApiEndpoint.get("mcp.status", "/api/mcp", {
    query: LocationQuery,
    success: Mcp.StatusMap,
    error: [ServiceUnavailableError],
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(
      OpenApi.annotations({
        identifier: "v2.mcp.status",
        summary: "Inspect native project MCP connections",
        description: "Read active MCP connection status and tool counts without starting model work.",
      }),
    ),
  HttpApiEndpoint.post("mcp.connect", "/api/mcp/:server/connect", {
    params: { server: Schema.String },
    query: LocationQuery,
    success: Schema.Boolean,
    error: errors,
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(
      OpenApi.annotations({
        identifier: "v2.mcp.connect",
        summary: "Connect a configured MCP server and save this project choice",
        description:
          "Saves a personal choice for this Location and applies it without editing configuration or starting model work.",
      }),
    ),
  HttpApiEndpoint.post("mcp.disconnect", "/api/mcp/:server/disconnect", {
    params: { server: Schema.String },
    query: LocationQuery,
    success: Schema.Boolean,
    error: errors,
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(
      OpenApi.annotations({
        identifier: "v2.mcp.disconnect",
        summary: "Disconnect one MCP server and save this project choice",
        description:
          "Saves a personal choice for this Location and applies it without editing configuration or starting model work.",
      }),
    ),
  HttpApiEndpoint.post("mcp.retry", "/api/mcp/:server/retry", {
    params: { server: Schema.String },
    query: LocationQuery,
    success: Schema.Boolean,
    error: errors,
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(
      OpenApi.annotations({
        identifier: "v2.mcp.retry",
        summary: "Replace one MCP connection while preserving a healthy connection on failure",
        description: "Changes only the current Location runtime. It does not write configuration or start model work.",
      }),
    ),
  HttpApiEndpoint.post("mcp.resetPreference", "/api/mcp/:server/resetPreference", {
    params: { server: Schema.String },
    query: LocationQuery,
    success: Schema.Boolean,
    error: errors,
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(
      OpenApi.annotations({
        identifier: "v2.mcp.resetPreference",
        summary: "Clear a saved MCP choice and apply current configuration",
        description:
          "Uses only currently configured trusted definitions. Does not edit configuration or start model work.",
      }),
    ),
  HttpApiEndpoint.post("mcp.authStart", "/api/mcp/:server/auth/start", {
    params: { server: Schema.String },
    query: LocationQuery,
    success: Mcp.AuthenticationStart,
    error: errors,
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(
      OpenApi.annotations({
        identifier: "v2.mcp.authStart",
        summary: "Start explicit MCP authentication",
        description:
          "Binds a backend loopback callback before returning the authorization URL. The client opens it only after explicit user action. Does not change the saved connection preference or start model work.",
      }),
    ),
  HttpApiEndpoint.delete("mcp.authCancel", "/api/mcp/:server/auth/:flowID", {
    params: { server: Schema.String, flowID: Schema.String },
    query: LocationQuery,
    success: Schema.Boolean,
    error: errors,
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(
      OpenApi.annotations({
        identifier: "v2.mcp.authCancel",
        summary: "Cancel one current MCP authentication operation",
        description:
          "Cancels and joins the exact operation. It does not disconnect a healthy transport or delete saved credentials.",
      }),
    ),
)

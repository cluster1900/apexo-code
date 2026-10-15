export * as Mcp from "./mcp"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema"

export const AuthenticationError = Schema.Literals([
  "invalid",
  "auth",
  "storage",
  "conflict",
  "not_found",
  "unsupported",
  "cancelled",
  "expired",
  "load",
]).annotate({ identifier: "Mcp.AuthenticationError" })
export type AuthenticationError = typeof AuthenticationError.Type

export const Authentication = Schema.Struct({
  supported: Schema.Boolean,
  credentials: Schema.Literals(["missing", "available"]),
  error: optional(AuthenticationError),
  flow: optional(
    Schema.Struct({
      id: Schema.String,
      phase: Schema.Literals([
        "waiting",
        "exchanging",
        "connected",
        "credentials_ready",
        "retry_required",
        "failed",
        "cancelled",
      ]),
      expiresAt: NonNegativeInt,
      error: optional(AuthenticationError),
    }),
  ),
}).annotate({ identifier: "Mcp.Authentication" })
export interface Authentication extends Schema.Schema.Type<typeof Authentication> {}
export const AuthenticationStart = Schema.Struct({
  id: Schema.String,
  authorizationUrl: Schema.String,
  expiresAt: NonNegativeInt,
}).annotate({ identifier: "Mcp.AuthenticationStart" })
export interface AuthenticationStart extends Schema.Schema.Type<typeof AuthenticationStart> {}

export const Status = Schema.Struct({
  status: Schema.Literals(["connected", "disabled", "failed", "needs_auth"]),
  tools: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  error: Schema.optional(Schema.String),
  configuredEnabled: optional(Schema.Boolean),
  preference: optional(Schema.Boolean),
  preferenceError: optional(Schema.Boolean),
  authentication: optional(Authentication),
}).annotate({ identifier: "McpStatus" })
export type Status = typeof Status.Type
export const StatusMap = Schema.Record(Schema.String, Status).annotate({
  identifier: "McpStatusMap",
})
export type StatusMap = typeof StatusMap.Type

export * as McpAttachmentOperation from "./mcp-attachment-operation"
import { Schema } from "effect"
import { SessionMcpAttachment } from "./session-mcp-attachment"
export const Failure = SessionMcpAttachment.Failure
export type Failure = SessionMcpAttachment.Failure

export const OperationID = Schema.String.check(Schema.isPattern(/^maop_[a-f0-9]{32}$/)).pipe(
  Schema.brand("SessionMcpAttachment.OperationID"),
)
export type OperationID = typeof OperationID.Type
export const Request = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("catalog"), input: SessionMcpAttachment.CatalogInput }),
  Schema.Struct({ kind: Schema.Literal("prepare"), input: SessionMcpAttachment.Input }),
])
export type Request = typeof Request.Type
export const Operation = Schema.Struct({
  id: OperationID,
  kind: Schema.Literals(["catalog", "prepare"]),
  status: Schema.Literals(["reserved", "running", "completed", "failed", "cancelled"]),
  expiresAt: Schema.Number,
  catalog: Schema.optional(SessionMcpAttachment.Catalog),
  prepared: Schema.optional(SessionMcpAttachment.Prepared),
  error: Schema.optional(Schema.Struct({ code: Schema.String, message: Schema.String })),
}).annotate({ identifier: "SessionMcpAttachment.Operation" })
export type Operation = typeof Operation.Type

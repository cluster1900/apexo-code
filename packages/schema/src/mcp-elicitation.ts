export * as McpElicitation from "./mcp-elicitation"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { optional, statics } from "./schema"
import { SessionID } from "./session-id"
import { define, inventory } from "./event"

export const ID = Schema.String.check(Schema.isPattern(/^elc_[0-9A-Za-z]+$/)).pipe(
  Schema.brand("McpElicitation.ID"),
  statics((schema) => ({ create: () => schema.make(`elc_${ascending()}`) })),
)
export type ID = typeof ID.Type

export const Option = Schema.Struct({ value: Schema.String, title: Schema.String }).annotate({
  identifier: "McpElicitation.Option",
})
export const Value = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Array(Schema.String)]).annotate(
  { identifier: "McpElicitation.Value" },
)
export type Value = typeof Value.Type
const base = {
  name: Schema.String,
  title: Schema.String,
  description: optional(Schema.String),
  required: Schema.Boolean,
}
const options = Schema.Array(Option).check(Schema.isMinLength(1), Schema.isMaxLength(100))
const length = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const Field = Schema.Union([
  Schema.Struct({
    ...base,
    type: Schema.Literal("string"),
    minLength: optional(length),
    maxLength: optional(length),
    format: optional(Schema.Literals(["email", "uri", "date", "date-time"])),
    default: optional(Schema.String),
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literals(["number", "integer"]),
    minimum: optional(Schema.Finite),
    maximum: optional(Schema.Finite),
    default: optional(Schema.Finite),
  }),
  Schema.Struct({ ...base, type: Schema.Literal("boolean"), default: optional(Schema.Boolean) }),
  Schema.Struct({ ...base, type: Schema.Literal("select"), options, default: optional(Schema.String) }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("multi"),
    options,
    minItems: optional(length),
    maxItems: optional(length),
    default: optional(Schema.Array(Schema.String)),
  }),
]).annotate({ identifier: "McpElicitation.Field" })
export type Field = typeof Field.Type
export const Form = Schema.Struct({ fields: Schema.Array(Field).check(Schema.isMaxLength(32)) }).annotate({
  identifier: "McpElicitation.Form",
})
export interface Form extends Schema.Schema.Type<typeof Form> {}
export const Content = Schema.Record(Schema.String, Value).annotate({ identifier: "McpElicitation.Content" })
export const Reply = Schema.Union([
  Schema.Struct({ action: Schema.Literal("accept"), content: Content }),
  Schema.Struct({ action: Schema.Literals(["decline", "cancel"]) }),
]).annotate({ identifier: "McpElicitation.Reply" })
export type Reply = typeof Reply.Type
export const Request = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  assistantMessageID: Schema.String,
  toolCallID: Schema.String,
  server: Schema.String,
  message: Schema.String,
  form: Form,
  createdAt: Schema.Finite,
  deadlineAt: Schema.Finite,
  status: Schema.Literal("pending"),
}).annotate({ identifier: "McpElicitation.Request" })
export interface Request extends Schema.Schema.Type<typeof Request> {}
export const Reason = Schema.Literals([
  "replied",
  "dismissed",
  "server_cancelled",
  "interrupted",
  "timed_out",
  "call_completed",
  "disconnected",
])
export type Reason = typeof Reason.Type
const Requested = define({ type: "mcp.elicitation.requested", schema: Request.fields })
const Settled = define({
  type: "mcp.elicitation.settled",
  schema: {
    sessionID: SessionID,
    requestID: ID,
    server: Schema.String,
    action: Schema.Literals(["accept", "decline", "cancel"]),
    reason: Reason,
  },
})
export const Event = { Requested, Settled, Definitions: inventory(Requested, Settled) }

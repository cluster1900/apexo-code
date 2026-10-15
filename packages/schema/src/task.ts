export * as Task from "./task"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, optional } from "./schema"
import { SessionMessage } from "./session-message"
import { SessionID } from "./session-id"

export const Status = Schema.Literals(["running", "completed", "failed", "cancelled", "interrupted"]).annotate({
  identifier: "Task.Status",
})
export type Status = typeof Status.Type
export const Summary = Schema.Struct({
  id: SessionID,
  parentSessionID: SessionID,
  description: Schema.String,
  status: Status,
  background: optional(Schema.Boolean),
  startedAt: NonNegativeInt,
  completedAt: optional(NonNegativeInt),
  blockedReason: optional(Schema.Literal("process_restart")),
}).annotate({ identifier: "Task.Summary" })
export interface Summary extends Schema.Schema.Type<typeof Summary> {}
export const Detail = Schema.Struct({
  ...Summary.fields,
  output: Schema.String,
  worktreePath: optional(Schema.String),
  interruptedByMessage: optional(Schema.Boolean),
}).annotate({
  identifier: "Task.Detail",
})
export interface Detail extends Schema.Schema.Type<typeof Detail> {}
export const List = Schema.Struct({ limit: optional(PositiveInt.check(Schema.isLessThanOrEqualTo(100))) }).annotate({
  identifier: "Task.List",
})
export interface List extends Schema.Schema.Type<typeof List> {}
export const Wait = Schema.Struct({
  timeoutMs: optional(NonNegativeInt.check(Schema.isLessThanOrEqualTo(120_000))),
}).annotate({ identifier: "Task.Wait" })
export interface Wait extends Schema.Schema.Type<typeof Wait> {}
export const WaitResult = Schema.Struct({ task: Detail, timedOut: Schema.Boolean }).annotate({
  identifier: "Task.WaitResult",
})
export interface WaitResult extends Schema.Schema.Type<typeof WaitResult> {}

export const MessageDelivery = Schema.Literals(["steer", "queue", "interject"])
export type MessageDelivery = typeof MessageDelivery.Type
export const MessageInput = Schema.Struct({
  inputID: SessionMessage.ID,
  text: Schema.String.check(Schema.isMinLength(1)),
  delivery: optional(MessageDelivery),
}).annotate({ identifier: "Task.MessageInput" })
export type MessageInput = typeof MessageInput.Type
export const MessageReceipt = Schema.Struct({
  inputID: SessionMessage.ID,
  taskID: SessionID,
  delivery: MessageDelivery,
  status: Schema.Literals(["admitted", "promoted", "cancelled", "interrupted"]),
  admittedAt: NonNegativeInt,
  promotedAt: optional(NonNegativeInt),
}).annotate({ identifier: "Task.MessageReceipt" })
export type MessageReceipt = typeof MessageReceipt.Type

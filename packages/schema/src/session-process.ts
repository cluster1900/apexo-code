export * as SessionProcess from "./session-process"

import { Schema } from "effect"
import { descending } from "./identifier"
import { NonNegativeInt, PositiveInt, optional, statics } from "./schema"
import { SessionID } from "./session-id"

export const ID = Schema.String.check(Schema.isPattern(/^proc_[A-Za-z0-9]{26}$/))
  .annotate({ identifier: "SessionProcess.ID" })
  .pipe(
    Schema.brand("SessionProcess.ID"),
    statics((schema) => ({ create: () => schema.make("proc_" + descending()) })),
  )
export type ID = typeof ID.Type
export const Status = Schema.Literals(["running", "completed", "failed", "cancelled", "interrupted"]).annotate({
  identifier: "SessionProcess.Status",
})
export type Status = typeof Status.Type
export const Monitor = Schema.Struct({
  persistent: Schema.Boolean,
  timeoutMs: NonNegativeInt,
  accepted: NonNegativeInt,
  suppressed: NonNegativeInt,
  overloaded: Schema.Boolean,
}).annotate({ identifier: "SessionProcess.Monitor" })
export interface Monitor extends Schema.Schema.Type<typeof Monitor> {}
export const Summary = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  kind: Schema.Literals(["shell", "monitor"]),
  monitor: optional(Monitor),
  description: Schema.String,
  status: Status,
  background: Schema.Boolean,
  startedAt: NonNegativeInt,
  completedAt: optional(NonNegativeInt),
  exitCode: optional(Schema.Int),
  blockedReason: optional(Schema.Literal("process_restart")),
  truncated: Schema.Boolean,
}).annotate({ identifier: "SessionProcess.Summary" })
export interface Summary extends Schema.Schema.Type<typeof Summary> {}
export const Detail = Schema.Struct({
  interruptedByMessage: optional(Schema.Boolean),
  ...Summary.fields,
  output: Schema.String,
}).annotate({
  identifier: "SessionProcess.Detail",
})
export interface Detail extends Schema.Schema.Type<typeof Detail> {}
export const List = Schema.Struct({ limit: optional(PositiveInt.check(Schema.isLessThanOrEqualTo(100))) }).annotate({
  identifier: "SessionProcess.List",
})
export interface List extends Schema.Schema.Type<typeof List> {}
export const Wait = Schema.Struct({
  timeoutMs: optional(NonNegativeInt.check(Schema.isLessThanOrEqualTo(120_000))),
}).annotate({
  identifier: "SessionProcess.Wait",
})
export interface Wait extends Schema.Schema.Type<typeof Wait> {}
export const WaitResult = Schema.Struct({ process: Detail, timedOut: Schema.Boolean }).annotate({
  identifier: "SessionProcess.WaitResult",
})
export interface WaitResult extends Schema.Schema.Type<typeof WaitResult> {}

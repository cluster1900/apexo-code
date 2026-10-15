export * as MemoryWork from "./memory-work"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema"

export const Kind = Schema.Literals(["flush", "dream"])
export type Kind = typeof Kind.Type

export interface Start extends Schema.Schema.Type<typeof Start> {}
export const Start = Schema.Struct({ kind: Kind }).annotate({ identifier: "MemoryWork.Start" })

export interface Cancel extends Schema.Schema.Type<typeof Cancel> {}
export const Cancel = Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1)) }).annotate({
  identifier: "MemoryWork.Cancel",
})

export interface Result extends Schema.Schema.Type<typeof Result> {}
export const Result = Schema.Struct({
  status: Schema.Literals([
    "completed",
    "shadow",
    "no_work",
    "disabled",
    "too_soon",
    "too_few_sessions",
    "busy",
    "denied",
    "conflict",
    "cancelled",
    "failed",
    "retry_required",
    "timed_out",
  ]),
  reason: optional(Schema.Literals(["historical_capture_ownership"])),
  eligible: optional(NonNegativeInt),
  processed: optional(NonNegativeInt),
  deferred: optional(NonNegativeInt),
  unplaceable: optional(NonNegativeInt),
  topics: optional(NonNegativeInt),
  cleaned: optional(NonNegativeInt),
  chars: optional(NonNegativeInt),
  path: optional(Schema.String),
}).annotate({ identifier: "MemoryWork.Result" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Schema.String,
  kind: Kind,
  state: Schema.Literals(["running", "finished"]),
  startedAt: NonNegativeInt,
  finishedAt: optional(NonNegativeInt),
  result: optional(Result),
}).annotate({ identifier: "MemoryWork.Info" })

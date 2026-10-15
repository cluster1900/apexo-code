export * as BackgroundTask from "./background-task"

import { Schema } from "effect"
import { NonNegativeInt } from "./schema"

export const Summary = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  title: Schema.optional(Schema.String),
  status: Schema.Literals(["running", "completed", "error", "cancelled"]),
  started_at: NonNegativeInt,
  completed_at: Schema.optional(NonNegativeInt),
  sessionID: Schema.String,
  childSessionID: Schema.optional(Schema.String),
  nextFireAt: Schema.optional(NonNegativeInt),
  background: Schema.Boolean,
}).annotate({ identifier: "BackgroundTaskSummary" })
export type Summary = typeof Summary.Type

export const Detail = Schema.Struct({
  ...Summary.fields,
  output: Schema.String,
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "BackgroundTaskDetail" })
export type Detail = typeof Detail.Type

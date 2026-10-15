export * as MemoryCaptureEvent from "./memory-capture-event"

import { Schema } from "effect"
import { Event } from "./event"
import { NonNegativeInt, optional } from "./schema"
import { SessionID } from "./session-id"

export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({
  statement: Schema.String,
  body: optional(Schema.String),
  path: Schema.String,
}).annotate({ identifier: "MemoryCaptureEntry" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  sessionID: SessionID,
  activity: Schema.Literals(["queued", "running", "completed", "no_op", "retry", "failed"]),
  fromTurn: NonNegativeInt,
  throughTurn: NonNegativeInt,
  attempt: NonNegativeInt,
  memories: optional(Schema.Array(Entry)),
}).annotate({ identifier: "MemoryCaptureActivity" })

// Opt-in diagnostics belong to the compatibility session surface. This event
// deliberately has no durable metadata and must never enter session replay.
export const Activity = Event.define({ type: "memory.capture.activity", schema: Info.fields })
export const Definitions = Event.inventory(Activity)

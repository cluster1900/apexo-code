export * as SessionInput from "./session-input"

import { Schema } from "effect"
import { optional } from "./schema"
import { Prompt } from "./prompt"
import { DateTimeUtcFromMillis, NonNegativeInt } from "./schema"
import { SessionDelivery } from "./session-delivery"
import { SessionID } from "./session-id"
import { SessionMessage } from "./session-message"

export const Delivery = SessionDelivery.Delivery
export type Delivery = SessionDelivery.Delivery

/** Invocation policy belongs to one canonical admitted input, never the mutable Session. */
export const ExecutionPolicy = Schema.Struct({
  mode: Schema.Literal("headless"),
  permissions: Schema.Literals(["reject", "approve_once"]),
}).annotate({ identifier: "SessionInput.ExecutionPolicy" })
export type ExecutionPolicy = typeof ExecutionPolicy.Type

export const ExecutionStatus = Schema.Literals([
  "admitted",
  "active",
  "completed",
  "failed",
  "interrupted",
  "superseded",
])
export type ExecutionStatus = typeof ExecutionStatus.Type
export const ExecutionReason = Schema.Literals([
  "completed",
  "provider_error",
  "turn_limit",
  "interrupted",
  "process_restart",
  "superseded",
  "withdrawn",
  "unavailable",
])
export type ExecutionReason = typeof ExecutionReason.Type

/** Sequence bounds identify this input's evidence; they never identify a Session drain. */
export const Execution = Schema.Struct({
  id: SessionMessage.ID,
  sessionID: SessionID,
  policy: ExecutionPolicy,
  status: ExecutionStatus,
  admittedSeq: NonNegativeInt,
  promotedSeq: NonNegativeInt.pipe(optional),
  startedSeq: NonNegativeInt.pipe(optional),
  endedSeq: NonNegativeInt.pipe(optional),
  reason: ExecutionReason.pipe(optional),
  finish: Schema.String.pipe(optional),
  usageIncomplete: Schema.Boolean,
}).annotate({ identifier: "SessionInput.Execution" })
export interface Execution extends Schema.Schema.Type<typeof Execution> {}
export const ExecutionWait = Schema.Struct({
  execution: Execution,
  timedOut: Schema.Boolean,
}).annotate({ identifier: "SessionInput.ExecutionWait" })
export interface ExecutionWait extends Schema.Schema.Type<typeof ExecutionWait> {}

export interface Admitted extends Schema.Schema.Type<typeof Admitted> {}
export const Admitted = Schema.Struct({
  admittedSeq: NonNegativeInt,
  id: SessionMessage.ID,
  sessionID: SessionID,
  prompt: Prompt,
  delivery: Delivery,
  executionPolicy: ExecutionPolicy.pipe(optional),
  timeCreated: DateTimeUtcFromMillis,
  promotedSeq: NonNegativeInt.pipe(optional),
  withdrawnSeq: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "SessionInput.Admitted" })

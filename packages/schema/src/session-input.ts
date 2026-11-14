export * as SessionInput from "./session-input"

import { Schema } from "effect"
import { Model } from "./model"
import { Prompt } from "./prompt"
import { DateTimeUtcFromMillis, NonNegativeInt, PositiveInt, optional } from "./schema"
import { SessionDelivery } from "./session-delivery"
import { SessionID } from "./session-id"
import { SessionMessage } from "./session-message"

export const Delivery = SessionDelivery.Delivery
export type Delivery = SessionDelivery.Delivery

export const Origin = Schema.Literals(["user", "task", "workflow", "schedule", "imported", "unknown"]).annotate({
  identifier: "SessionInput.Origin",
})
export type Origin = typeof Origin.Type

const PositiveFinite = Schema.Finite.check(Schema.isGreaterThan(0))

/** Invocation policy belongs to one canonical admitted input, never the mutable Session. */
export const ExecutionPolicy = Schema.Struct({
  mode: Schema.Literal("headless"),
  permissions: Schema.Literals(["reject", "approve_once"]),
  maxTurns: PositiveInt.pipe(optional),
  maxTokens: PositiveInt.pipe(optional),
  maxBudgetUsd: PositiveFinite.pipe(optional),
  fallbackModel: Model.Ref.pipe(optional),
  outputSchema: Schema.Record(Schema.String, Schema.Json).pipe(optional),
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
  "budget_limit",
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
  origin: Origin,
  executionPolicy: ExecutionPolicy.pipe(optional),
  timeCreated: DateTimeUtcFromMillis,
  promotedSeq: NonNegativeInt.pipe(optional),
  withdrawnSeq: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "SessionInput.Admitted" })

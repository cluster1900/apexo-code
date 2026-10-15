export * as SessionSchedule from "./session-schedule"

import { Schema } from "effect"
import { descending } from "./identifier"
import { NonNegativeInt, PositiveInt, optional, statics } from "./schema"
import { SessionID } from "./session-id"

export const ID = Schema.String.check(Schema.isPattern(/^sched_[A-Za-z0-9]{26}$/))
  .annotate({ identifier: "SessionSchedule.ID" })
  .pipe(
    Schema.brand("SessionSchedule.ID"),
    statics((schema) => ({ create: () => schema.make("sched_" + descending()) })),
  )
export type ID = typeof ID.Type

export const Status = Schema.Literals(["active", "paused", "deleted", "expired"]).annotate({
  identifier: "SessionSchedule.Status",
})
export type Status = typeof Status.Type
export const BlockedReason = Schema.Literals([
  "restart_required",
  "stopped",
  "plan_pending",
  "goal_active",
  "busy",
  "unavailable",
  "denied",
]).annotate({ identifier: "SessionSchedule.BlockedReason" })
export type BlockedReason = typeof BlockedReason.Type

export const Summary = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  promptPreview: Schema.String,
  intervalSeconds: PositiveInt,
  durable: Schema.Boolean,
  status: Status,
  blockedReason: optional(BlockedReason),
  createdAt: NonNegativeInt,
  expiresAt: NonNegativeInt,
  nextFireAt: NonNegativeInt,
  latestTaskID: optional(SessionID),
  occurrenceStatus: optional(
    Schema.Literals(["claimed", "running", "completed", "failed", "cancelled", "interrupted"]),
  ),
}).annotate({ identifier: "SessionSchedule.Summary" })
export interface Summary extends Schema.Schema.Type<typeof Summary> {}
export const Detail = Schema.Struct({ ...Summary.fields, prompt: Schema.String }).annotate({
  identifier: "SessionSchedule.Detail",
})
export interface Detail extends Schema.Schema.Type<typeof Detail> {}

/** Explicit restoration only rearms future intent; it never resumes a provider turn. */
export const RestoreReason = Schema.Literals([
  "restored",
  "already_active",
  "paused",
  "stopped",
  "expired",
  "deleted",
  "permission_required",
  "denied",
  "unavailable",
  "goal_active",
  "plan_pending",
  "headless_input",
  "unfinished_owner",
  "changed",
]).annotate({ identifier: "SessionSchedule.RestoreReason" })
export type RestoreReason = typeof RestoreReason.Type
export const RestoreOutcome = Schema.Struct({ id: ID, reason: RestoreReason }).annotate({
  identifier: "SessionSchedule.RestoreOutcome",
})
export interface RestoreOutcome extends Schema.Schema.Type<typeof RestoreOutcome> {}
export const Restoration = Schema.Struct({ sessionID: SessionID, schedules: Schema.Array(RestoreOutcome) }).annotate({
  identifier: "SessionSchedule.Restoration",
})
export interface Restoration extends Schema.Schema.Type<typeof Restoration> {}

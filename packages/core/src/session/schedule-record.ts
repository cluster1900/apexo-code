export * as SessionScheduleRecord from "./schedule-record"

import { Schema } from "effect"
import { SessionSchedule } from "@apexo/schema/session-schedule"
import { Model } from "@apexo/schema/model"
import { NonNegativeInt, PositiveInt, optional } from "@apexo/schema/schema"
import { Permission } from "@apexo/schema/permission"
import { AgentV2 } from "../agent"
import { PermissionAuthority } from "../permission/authority"
import { SessionSchema } from "./schema"
import { SessionTaskOrigin } from "./task-origin"

export const MAX_TASKS = 50
export const TTL_MS = 7 * 24 * 60 * 60 * 1000
export class Failure extends Schema.TaggedErrorClass<Failure>()("SessionScheduleFailure", {
  code: Schema.Literals(["missing", "busy", "invalid", "restart", "storage", "denied", "stale"]),
  message: Schema.String,
}) {}
export const Authority = Schema.Struct({
  parentAgent: AgentV2.ID,
  agent: AgentV2.ID,
  model: Model.Ref,
  authority: Schema.Array(PermissionAuthority.Snapshot),
  permissionSource: optional(Permission.Source),
})
export type Authority = typeof Authority.Type
export const Request = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)),
  intervalSeconds: PositiveInt.check(Schema.isGreaterThanOrEqualTo(60)),
  durable: Schema.Boolean,
  fireImmediately: Schema.Boolean,
})
export type Request = typeof Request.Type
export const Intent = Schema.Struct({
  ...Authority.fields,
  id: SessionSchedule.ID,
  sessionID: SessionSchema.ID,
  parentCreated: Schema.String,
  invocation: Schema.String,
  initial: Request,
  prompt: Request.fields.prompt,
  intervalSeconds: Request.fields.intervalSeconds,
  durable: Schema.Boolean,
  owner: Schema.String,
  revision: NonNegativeInt,
  generation: NonNegativeInt,
  status: SessionSchedule.Status,
  blockedReason: optional(SessionSchedule.BlockedReason),
  createdAt: NonNegativeInt,
  expiresAt: NonNegativeInt,
  nextFireAt: NonNegativeInt,
  lastFireAt: optional(NonNegativeInt),
  ordinal: NonNegativeInt,
  childID: optional(SessionSchema.ID),
  childGeneration: optional(NonNegativeInt),
  chainCount: NonNegativeInt,
  summary: Schema.String.check(Schema.isMaxLength(600)),
})
export type Intent = typeof Intent.Type
export const Occurrence = Schema.Struct({
  ...Authority.fields,
  id: SessionTaskOrigin.OccurrenceID,
  scheduleID: SessionSchedule.ID,
  parentID: SessionSchema.ID,
  parentCreated: Schema.String,
  owner: Schema.String,
  revision: NonNegativeInt,
  generation: NonNegativeInt,
  ordinal: PositiveInt,
  launchID: Schema.String,
  childID: SessionSchema.ID,
  followup: Schema.Boolean,
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(102_000)),
  description: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  status: Schema.Literals(["claimed", "admitted", "completed", "failed", "cancelled"]),
  createdAt: NonNegativeInt,
  completedAt: optional(NonNegativeInt),
})
export type Occurrence = typeof Occurrence.Type

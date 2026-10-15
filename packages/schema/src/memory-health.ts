export * as MemoryHealth from "./memory-health"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema"

export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
export const Snapshot = Schema.Struct({
  pendingCaptureJobs: NonNegativeInt,
  runningCaptureJobs: NonNegativeInt,
  publishingCaptureJobs: NonNegativeInt,
  retryCaptureJobs: NonNegativeInt,
  failedCaptureJobs: NonNegativeInt,
  completedCaptureJobs: NonNegativeInt,
  pendingObservations: NonNegativeInt,
  hiddenPendingObservations: NonNegativeInt,
  quarantinedObservations: NonNegativeInt,
  oldestPendingAgeSecs: Schema.NullOr(NonNegativeInt),
  dreamLease: Schema.Literals(["none", "active", "expired"]),
  dreamSnapshotSize: NonNegativeInt,
  dreamPlanPending: Schema.Boolean,
  hasCoalescedTrigger: Schema.Boolean,
  lastSuccessAt: Schema.NullOr(NonNegativeInt),
  lastFailureAt: Schema.NullOr(NonNegativeInt),
  archiveCount: NonNegativeInt,
  tombstoneCount: NonNegativeInt,
  pendingDeletions: NonNegativeInt,
}).annotate({ identifier: "MemoryHealth.Snapshot" })

export interface Scope extends Schema.Schema.Type<typeof Scope> {}
export const Scope = Schema.Struct({
  scope: Schema.Literals(["global", "workspace"]),
  state: Schema.Literals(["ready", "empty", "denied", "unavailable"]),
  reason: optional(Schema.Literals(["path", "schema", "corrupt", "storage"])),
  snapshot: optional(Snapshot),
}).annotate({ identifier: "MemoryHealth.Scope" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  backend: Schema.Literals(["legacy", "v2"]),
  enabled: Schema.Boolean,
  scopes: Schema.Array(Scope),
}).annotate({ identifier: "MemoryHealth.Info" })

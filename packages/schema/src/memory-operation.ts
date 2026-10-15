export * as MemoryOperation from "./memory-operation"

import { Schema } from "effect"
import { optional, NonNegativeInt, statics } from "./schema"
import { SessionID } from "./session-id"
import { ascending } from "./identifier"

export const ID = Schema.String.check(Schema.isPattern(/^mop_[a-zA-Z0-9-]+$/)).pipe(
  Schema.brand("MemoryOperation.ID"),
  statics((schema) => ({ create: () => schema.make(`mop_${ascending()}`) })),
)
export type ID = typeof ID.Type
export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Input = Schema.Struct({ id: ID, retryOf: optional(ID) }).annotate({ identifier: "MemoryOperation.Input" })
export interface RetryInput extends Schema.Schema.Type<typeof RetryInput> {}
export const RetryInput = Schema.Struct({ id: ID, retryOf: ID }).annotate({ identifier: "MemoryOperation.RetryInput" })
export interface Result extends Schema.Schema.Type<typeof Result> {}
export const Result = Schema.Struct({
  status: Schema.Literals([
    "completed",
    "no_work",
    "disabled",
    "denied",
    "retry_required",
    "failed",
    "cancelled",
    "timed_out",
    "conflict",
  ]),
  committed: optional(Schema.Boolean),
  topics: optional(NonNegativeInt),
  shadow: optional(Schema.Boolean),
  through: optional(NonNegativeInt),
  processed: optional(NonNegativeInt),
  deferred: optional(NonNegativeInt),
  unplaceable: optional(NonNegativeInt),
  reason: optional(
    Schema.Literals(["historical_capture_ownership", "unsupported_source", "mode_changed", "scope_changed"]),
  ),
}).annotate({ identifier: "MemoryOperation.Result" })
export interface RecoveryQuery extends Schema.Schema.Type<typeof RecoveryQuery> {}
export const RecoveryQuery = Schema.Struct({
  action: Schema.Literals(["discard", "clear"]),
  scope: Schema.Literals(["workspace", "global"]),
}).annotate({ identifier: "MemoryOperation.RecoveryQuery" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  kind: Schema.Literals(["capture", "flush", "dream", "migration", "recovery"]),
  backend: Schema.Literals(["legacy", "v2"]),
  recovery: optional(RecoveryQuery),
  state: Schema.Literals(["queued", "running", "finished"]),
  ownership: Schema.Literals(["local", "unverified", "settled"]),
  retryOf: optional(ID),
  createdAt: NonNegativeInt,
  finishedAt: optional(NonNegativeInt),
  result: optional(Result),
}).annotate({ identifier: "MemoryOperation.Info" })

export interface MigrationQuery extends Schema.Schema.Type<typeof MigrationQuery> {}
export const MigrationQuery = Schema.Struct({
  kind: Schema.Literals(["relocation", "carryover"]),
  scope: Schema.Literals(["workspace", "global"]),
}).annotate({ identifier: "MemoryOperation.MigrationQuery" })
export interface MigrationPreview extends Schema.Schema.Type<typeof MigrationPreview> {}
export const MigrationPreview = Schema.Struct({
  ...MigrationQuery.fields,
  sourceHash: Schema.String,
  targetHash: Schema.String,
  generation: Schema.String,
  available: Schema.Boolean,
}).annotate({ identifier: "MemoryOperation.MigrationPreview" })
export interface MigrationInput extends Schema.Schema.Type<typeof MigrationInput> {}
export const MigrationInput = Schema.Struct({ ...Input.fields, preview: MigrationPreview }).annotate({
  identifier: "MemoryOperation.MigrationInput",
})

export interface RecoveryPreview extends Schema.Schema.Type<typeof RecoveryPreview> {}
export const RecoveryPreview = Schema.Struct({
  ...RecoveryQuery.fields,
  generation: Schema.String,
  digest: Schema.String,
  files: NonNegativeInt,
  plans: NonNegativeInt,
  available: Schema.Boolean,
  reason: optional(
    Schema.Literals([
      "no_plan",
      "unknown_owner",
      "live_owner",
      "foreign_owner",
      "capture_active",
      "partial_publication",
      "scope_empty",
    ]),
  ),
}).annotate({ identifier: "MemoryOperation.RecoveryPreview" })
export interface RecoveryInput extends Schema.Schema.Type<typeof RecoveryInput> {}
export const RecoveryInput = Schema.Struct({ ...Input.fields, preview: RecoveryPreview }).annotate({
  identifier: "MemoryOperation.RecoveryInput",
})

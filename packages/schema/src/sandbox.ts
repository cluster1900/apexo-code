export * as Sandbox from "./sandbox"

import { Schema } from "effect"
import { DateTimeUtcFromMillis, optional } from "./schema"

export const BuiltinProfile = Schema.Literals(["off", "workspace", "read-only", "strict", "devbox"]).annotate({
  identifier: "Sandbox.BuiltinProfile",
})
export type BuiltinProfile = typeof BuiltinProfile.Type

export const Profile = Schema.String.annotate({ identifier: "Sandbox.Profile" })
export type Profile = typeof Profile.Type

export const FailureCode = Schema.Literals([
  "invalid_policy",
  "unsupported_platform",
  "unavailable",
  "identity_conflict",
  "unsafe_path",
  "missing_inheritance",
]).annotate({ identifier: "Sandbox.FailureCode" })

export interface Receipt extends Schema.Schema.Type<typeof Receipt> {}
export const Receipt = Schema.Struct({
  id: Schema.String,
  revision: Schema.String,
  backend: Schema.Literals(["seatbelt", "bwrap"]),
  confirmedAt: DateTimeUtcFromMillis,
  outcome: Schema.Literal("exited"),
  exitCode: Schema.Int,
}).annotate({ identifier: "Sandbox.Receipt" })

export interface Status extends Schema.Schema.Type<typeof Status> {}
export const Status = Schema.Struct({
  scope: Schema.Literal("native_commands"),
  stored: Schema.Boolean,
  profile: optional(Profile),
  revision: optional(Schema.String),
  backend: Schema.Struct({
    kind: Schema.Literals(["seatbelt", "bwrap", "none"]),
    availability: Schema.Literals(["unchecked", "available", "unsupported", "unavailable"]),
  }),
  network: optional(Schema.Literals(["off", "unrestricted"])),
  latestExecution: optional(Receipt),
  failure: optional(Schema.Struct({ code: FailureCode, message: Schema.String })),
}).annotate({ identifier: "Sandbox.Status" })

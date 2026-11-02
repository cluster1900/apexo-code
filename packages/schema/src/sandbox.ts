export * as Sandbox from "./sandbox"

import { Schema } from "effect"
import { DateTimeUtcFromMillis, optional } from "./schema"

export const BuiltinProfile = Schema.Literals(["off", "workspace", "read-only", "strict", "devbox"]).annotate({
  identifier: "Sandbox.BuiltinProfile",
})
export type BuiltinProfile = typeof BuiltinProfile.Type

export const BaseProfile = Schema.Literals(["workspace", "read-only", "strict", "devbox"]).annotate({
  identifier: "Sandbox.BaseProfile",
})
export type BaseProfile = typeof BaseProfile.Type

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
  base: optional(BaseProfile),
  revision: optional(Schema.String),
  backend: Schema.Struct({
    kind: Schema.Literals(["seatbelt", "bwrap", "none"]),
    availability: Schema.Literals(["unchecked", "available", "unsupported", "unavailable"]),
  }),
  network: optional(Schema.Literals(["off", "unrestricted"])),
  allowDomains: optional(Schema.Array(Schema.String)),
  latestExecution: optional(Receipt),
  failure: optional(Schema.Struct({ code: FailureCode, message: Schema.String })),
}).annotate({ identifier: "Sandbox.Status" })

export interface ProfileInfo extends Schema.Schema.Type<typeof ProfileInfo> {}
export const ProfileInfo = Schema.Struct({
  name: Profile,
  builtin: Schema.Boolean,
  base: optional(BaseProfile),
  network: Schema.Literals(["off", "unrestricted"]),
  allowDomains: Schema.Array(Schema.String),
  source: optional(Schema.Literals(["builtin", "user", "project"])),
}).annotate({ identifier: "Sandbox.ProfileInfo" })

export interface Catalog extends Schema.Schema.Type<typeof Catalog> {}
export const Catalog = Schema.Struct({
  scope: Schema.Literal("native_commands"),
  backend: Status.fields.backend,
  profiles: Schema.Array(ProfileInfo),
  failure: Status.fields.failure,
}).annotate({ identifier: "Sandbox.Catalog" })

export * as HostHooks from "./host-hooks"

import { Schema } from "effect"
import { optional } from "./schema"

export const ID = Schema.String.check(Schema.isPattern(/^hook_[a-f0-9]{64}$/)).annotate({ identifier: "HostHooks.ID" })

export interface Inspection extends Schema.Schema.Type<typeof Inspection> {}
export const Inspection = Schema.Struct({
  projectTrusted: Schema.Boolean,
  diagnostics: Schema.Array(Schema.String),
  hooks: Schema.Array(
    Schema.Struct({
      id: ID,
      name: Schema.String,
      event: Schema.String,
      source: Schema.String,
      type: Schema.String,
      matcher: Schema.optional(Schema.String),
      supported: Schema.Boolean,
      configurable: Schema.Boolean,
      configuredEnabled: Schema.Boolean,
      effectiveDisabled: optional(Schema.Boolean),
      savedDisabled: optional(Schema.Boolean),
      pendingChange: optional(Schema.Boolean),
      readOnlyReason: optional(Schema.Literals(["managed", "unknown_source", "unsupported"])),
    }),
  ),
}).annotate({ identifier: "HostHooks.Inspection" })

export const Repository = Schema.Struct({
  root: Schema.String,
  token: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  trusted: Schema.Boolean,
  allowed: Schema.Boolean,
}).annotate({ identifier: "HostHooks.Repository" })
export type Repository = Schema.Schema.Type<typeof Repository>
export const RepositoryTrust = Schema.Struct({
  root: Schema.String,
  token: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  trusted: Schema.Boolean,
}).annotate({ identifier: "HostHooks.RepositoryTrust" })
export type RepositoryTrust = Schema.Schema.Type<typeof RepositoryTrust>

export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
export const Snapshot = Schema.Struct({
  captured: Schema.Boolean,
  repository: optional(Repository),
  generation: Schema.Finite,
  preferenceRevision: optional(Schema.String),
  savedPreferenceRevision: optional(Schema.String),
  preferenceFailure: optional(Schema.Literals(["invalid", "read", "write", "conflict", "rollback"])),
  inspection: Schema.optional(Inspection),
}).annotate({ identifier: "HostHooks.Snapshot" })

export interface Preference extends Schema.Schema.Type<typeof Preference> {}
export const Preference = Schema.Struct({ hookID: ID, enabled: Schema.Boolean }).annotate({
  identifier: "HostHooks.Preference",
})

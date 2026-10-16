export * as CommandSandboxPolicy from "./policy"

import { createHash } from "node:crypto"
import { Schema } from "effect"
import { Sandbox } from "@apexo/schema/sandbox"

export class Failure extends Schema.TaggedErrorClass<Failure>()("CommandSandbox.Failure", {
  code: Sandbox.FailureCode,
  message: Schema.String,
}) {}

const Path = Schema.String.check(Schema.isMaxLength(4096))
const Identity = Schema.Struct({ path: Path, dev: Schema.String, ino: Schema.String, directory: Schema.Boolean })
export const BaseProfile = Schema.Literals(["workspace", "read-only", "strict", "devbox"])
export type BaseProfile = typeof BaseProfile.Type
export const DenyGlob = Schema.Struct({
  pattern: Path,
  regex: Schema.String.check(Schema.isMaxLength(8192)),
})
export type DenyGlob = typeof DenyGlob.Type
export const Off = Schema.Struct({
  version: Schema.Literal(1),
  scope: Schema.Literal("native_commands"),
  profile: Schema.Literal("off"),
  revision: Schema.Literal("off-v1"),
  network: Schema.Literal("unrestricted"),
})
export const Confined = Schema.Struct({
  version: Schema.Literal(1),
  scope: Schema.Literal("native_commands"),
  profile: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  base: Schema.optional(BaseProfile),
  revision: Schema.String,
  network: Schema.Literals(["off", "unrestricted"]),
  workspace: Path,
  identities: Schema.Array(Identity).check(Schema.isMaxLength(256)),
  protected: Schema.Array(Path).check(Schema.isMaxLength(256)),
  ancestors: Schema.Array(Path).check(Schema.isMaxLength(256)),
  readOnly: Schema.optional(Schema.Array(Path).check(Schema.isMaxLength(128))),
  readWrite: Schema.optional(Schema.Array(Path).check(Schema.isMaxLength(128))),
  denyLiterals: Schema.optional(Schema.Array(Path).check(Schema.isMaxLength(128))),
  denyGlobs: Schema.optional(Schema.Array(DenyGlob).check(Schema.isMaxLength(128))),
})
export const Policy = Schema.Union([Off, Confined])
export type Policy = typeof Policy.Type
export type Confined = typeof Confined.Type
export const off: typeof Off.Type = Object.freeze({
  version: 1,
  scope: "native_commands",
  profile: "off",
  revision: "off-v1",
  network: "unrestricted",
})

export const isOff = (policy: Policy): policy is typeof Off.Type => policy.profile === "off"
export const isConfined = (policy: Policy): policy is Confined => policy.profile !== "off"

export const baseProfile = (policy: Confined): BaseProfile =>
  policy.base ??
  (policy.profile === "read-only" || policy.profile === "strict" || policy.profile === "devbox"
    ? policy.profile
    : "workspace")

export const allowsWorkspaceWrites = (policy: Confined): boolean => {
  const base = baseProfile(policy)
  return base === "workspace" || base === "devbox"
}

/** Revision is diagnostic identity, never a substitute for the private capability. */
export const revision = (policy: Omit<Confined, "revision">) =>
  createHash("sha256").update(JSON.stringify(policy)).digest("hex")

export const decode = (input: unknown) => Schema.decodeUnknownEffect(Policy, { onExcessProperty: "error" })(input)

export const freeze = (policy: Policy): Policy =>
  isOff(policy)
    ? off
    : Object.freeze({
        ...policy,
        identities: Object.freeze(policy.identities.map((identity) => Object.freeze({ ...identity }))),
        protected: Object.freeze([...policy.protected]),
        ancestors: Object.freeze([...policy.ancestors]),
        ...(policy.readOnly ? { readOnly: Object.freeze([...policy.readOnly]) } : {}),
        ...(policy.readWrite ? { readWrite: Object.freeze([...policy.readWrite]) } : {}),
        ...(policy.denyLiterals ? { denyLiterals: Object.freeze([...policy.denyLiterals]) } : {}),
        ...(policy.denyGlobs
          ? { denyGlobs: Object.freeze(policy.denyGlobs.map((glob) => Object.freeze({ ...glob }))) }
          : {}),
      })

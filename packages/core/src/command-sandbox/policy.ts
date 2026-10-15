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
  profile: Schema.Literals(["workspace", "read-only"]),
  revision: Schema.String,
  network: Schema.Literal("off"),
  workspace: Path,
  identities: Schema.Array(Identity).check(Schema.isMaxLength(128)),
  protected: Schema.Array(Path).check(Schema.isMaxLength(128)),
  ancestors: Schema.Array(Path).check(Schema.isMaxLength(128)),
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

/** Revision is diagnostic identity, never a substitute for the private capability. */
export const revision = (policy: Omit<Confined, "revision">) =>
  createHash("sha256").update(JSON.stringify(policy)).digest("hex")

export const decode = (input: unknown) => Schema.decodeUnknownEffect(Policy, { onExcessProperty: "error" })(input)

export const freeze = (policy: Policy): Policy =>
  policy.profile === "off"
    ? off
    : Object.freeze({
        ...policy,
        identities: Object.freeze(policy.identities.map((identity) => Object.freeze({ ...identity }))),
        protected: Object.freeze([...policy.protected]),
        ancestors: Object.freeze([...policy.ancestors]),
      })

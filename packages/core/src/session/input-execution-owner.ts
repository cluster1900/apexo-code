export * as SessionInputExecutionOwner from "./input-execution-owner"

import { randomUUID } from "node:crypto"
import { Context, Effect, Schema } from "effect"

import { SessionLifecycle } from "./lifecycle"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"

const revisions = new WeakMap<SessionLifecycle.Claim, object>()
const capabilities = new WeakMap<
  SessionLifecycle.Claim,
  { inputID: SessionMessage.ID; revision: object; unknown: Set<object> }
>()
export const Observers = Context.Reference<Map<SessionSchema.ID, (call: object, known: boolean) => void>>(
  "@apexo/HeadlessInputUsage",
  { defaultValue: () => new Map() },
)
export const observe = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const claim = yield* SessionLifecycle.current(sessionID)
    const capability = claim && capabilities.get(claim)
    const observers = yield* Observers
    if (!capability) {
      observers.delete(sessionID)
      return
    }
    observers.set(sessionID, (call, known) => {
      if (known) capability.unknown.delete(call)
      else capability.unknown.add(call)
    })
  })
export const incomplete = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const claim = yield* SessionLifecycle.current(sessionID)
    const capability = claim && capabilities.get(claim)
    return capability ? capability.unknown.size > 0 : true
  })

/** Revocation is safe even if a later database operation rolls back this promotion. */
export const promoted = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const claim = yield* SessionLifecycle.current(sessionID)
    if (claim) revisions.set(claim, {})
  })

export const activate = (sessionID: SessionSchema.ID, inputID: SessionMessage.ID) =>
  Effect.gen(function* () {
    const claim = yield* SessionLifecycle.current(sessionID)
    const revision = claim && revisions.get(claim)
    if (!claim || !revision) return false
    capabilities.set(claim, { inputID, revision, unknown: new Set() })
    return true
  })

export function predicate(claim: SessionLifecycle.Claim, inputID: SessionMessage.ID) {
  const capability = capabilities.get(claim)
  if (!capability || capability.inputID !== inputID || revisions.get(claim) !== capability.revision) return
  return () => capabilities.get(claim) === capability && revisions.get(claim) === capability.revision
}

export const release = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const claim = yield* SessionLifecycle.current(sessionID)
    if (claim) capabilities.delete(claim)
  })

const Owner = Schema.Struct({ pid: Schema.Int.check(Schema.isGreaterThan(0)), token: Schema.String })
const current = { pid: process.pid, token: randomUUID() }
export const stamp = Schema.encodeSync(Schema.fromJsonString(Owner))(current)
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Owner))

/** Only ESRCH proves the recorded process absent; PID reuse/EPERM remain unknown. */
export function dead(stored: string | null) {
  if (!stored || stored === stamp) return false
  const owner = decode(stored)
  if (owner._tag === "None") return false
  try {
    process.kill(owner.value.pid, 0)
    return false
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH"
  }
}

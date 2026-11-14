export * as PermissionReviewState from "./review-state"

import { Context, Effect, Layer, Semaphore } from "effect"
import { PermissionReview } from "@apexo/schema/permission-review"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"
import { SessionInputAdmission } from "../session/input-admission"
import { SessionLifecycle } from "../session/lifecycle"
import { SessionSchema } from "../session/schema"

export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<PermissionReview.State, SessionLifecycle.Closed>
  readonly set: (
    sessionID: SessionSchema.ID,
    mode: PermissionReview.Mode,
  ) => Effect.Effect<PermissionReview.State, SessionLifecycle.Closed>
  /** Lock order is admission fence, then settlement gate. Never join review fibers inside. */
  readonly settle: <A, E, R>(
    claim: SessionLifecycle.Claim,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SessionLifecycle.Closed, R>
  /** Called inside settle; callback marks stale synchronously and returns cleanup to join outside. */
  readonly watch: (
    claim: SessionLifecycle.Claim,
    owner: object,
    invalidate: () => Effect.Effect<void>,
  ) => Effect.Effect<() => void, SessionLifecycle.Closed>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/PermissionReviewState") {}

const make = Effect.gen(function* () {
  const lifecycle = yield* SessionLifecycle.Service
  const admission = yield* SessionInputAdmission.Service
  const events = yield* EventV2.Service
  const entries = new WeakMap<
    SessionLifecycle.Claim,
    {
      state: PermissionReview.State
      gate: ReturnType<typeof Semaphore.makeUnsafe>
      watches: Map<object, () => Effect.Effect<void>>
    }
  >()
  const entry = (claim: SessionLifecycle.Claim) =>
    Effect.gen(function* () {
      const previous = entries.get(claim)
      if (previous) return previous
      const value = {
        state: { mode: "manual" as PermissionReview.Mode, revision: 0 },
        gate: Semaphore.makeUnsafe(1),
        watches: new Map<object, () => Effect.Effect<void>>(),
      }
      entries.set(claim, value)
      yield* admission.observe(claim, value, () => {
        const joins = [...value.watches.values()].map((invalidate) => invalidate())
        return Effect.all(joins, { discard: true, concurrency: "unbounded" })
      })
      return value
    })
  const settle: Interface["settle"] = (claim, effect) =>
    Effect.gen(function* () {
      const value = yield* entry(claim)
      // Keep the same gate available to cleanup after retirement has revoked approval.
      if (!lifecycle.available(claim)) return yield* value.gate.withPermit(effect)
      return yield* admission.fence(claim, value.gate.withPermit(effect))
    })
  return Service.of({
    settle,
    get: (sessionID) =>
      Effect.gen(function* () {
        const claim = yield* lifecycle.capture(sessionID)
        return (yield* entry(claim)).state
      }),
    set: (sessionID, mode) =>
      Effect.gen(function* () {
        const claim = yield* lifecycle.capture(sessionID)
        const value = yield* entry(claim)
        const joins = yield* settle(
          claim,
          Effect.gen(function* () {
            if (!lifecycle.available(claim)) return yield* new SessionLifecycle.Closed({ sessionID })
            if (value.state.mode === mode) return []
            value.state = { mode, revision: value.state.revision + 1 }
            const joins = [...value.watches.values()].map((invalidate) => invalidate())
            yield* events.publish(PermissionReview.Event.ModeChanged, { sessionID, ...value.state })
            return joins
          }),
        )
        yield* Effect.all(joins, { discard: true, concurrency: "unbounded" })
        return value.state
      }),
    watch: (claim, owner, invalidate) =>
      Effect.gen(function* () {
        const value = yield* entry(claim)
        value.watches.set(owner, invalidate)
        return () => {
          value.watches.delete(owner)
        }
      }),
  })
})
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [SessionLifecycle.node, SessionInputAdmission.node, EventV2.node],
})

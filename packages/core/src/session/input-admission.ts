export * as SessionInputAdmission from "./input-admission"

import { Context, Effect, Layer, Semaphore } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { SessionLifecycle } from "./lifecycle"

/** Short Session-owned admission fence. Observers synchronously invalidate; joins run after release. */
export interface Interface {
  readonly fence: <A, E, R>(
    claim: SessionLifecycle.Claim,
    action: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SessionLifecycle.Closed, R>
  readonly admit: <A, E, R>(
    claim: SessionLifecycle.Claim,
    action: Effect.Effect<{ value: A; changed: boolean }, E, R>,
  ) => Effect.Effect<A, E | SessionLifecycle.Closed, R>
  readonly observe: (
    claim: SessionLifecycle.Claim,
    owner: object,
    invalidate: () => Effect.Effect<void>,
  ) => Effect.Effect<void, SessionLifecycle.Closed>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionInputAdmission") {}
const make = Effect.gen(function* () {
  const lifecycle = yield* SessionLifecycle.Service
  const entries = new Map<
    SessionLifecycle.Claim,
    {
      readonly gate: ReturnType<typeof Semaphore.makeUnsafe>
      readonly observers: Map<object, () => Effect.Effect<void>>
    }
  >()
  const entry = (claim: SessionLifecycle.Claim) =>
    Effect.gen(function* () {
      if (!lifecycle.available(claim)) return yield* new SessionLifecycle.Closed({ sessionID: claim.sessionID })
      const previous = entries.get(claim)
      if (previous) return previous
      const value = { gate: Semaphore.makeUnsafe(1), observers: new Map<object, () => Effect.Effect<void>>() }
      entries.set(claim, value)
      yield* lifecycle.register(
        claim,
        value,
        Effect.sync(() => {
          entries.delete(claim)
        }),
      )
      return value
    })
  const fence: Interface["fence"] = (claim, action) =>
    Effect.gen(function* () {
      const value = yield* entry(claim)
      return yield* value.gate.withPermit(
        Effect.gen(function* () {
          if (!lifecycle.available(claim)) return yield* new SessionLifecycle.Closed({ sessionID: claim.sessionID })
          return yield* action
        }),
      )
    })
  const admit: Interface["admit"] = (claim, action) =>
    Effect.gen(function* () {
      const value = yield* entry(claim)
      const admitted = yield* fence(
        claim,
        action.pipe(
          Effect.map((result) => ({
            value: result.value,
            joins: result.changed ? [...value.observers.values()].map((invalidate) => invalidate()) : [],
          })),
        ),
      )
      yield* Effect.all(admitted.joins, { discard: true, concurrency: "unbounded" })
      return admitted.value
    })
  return Service.of({
    fence,
    admit,
    observe: (claim, owner, invalidate) =>
      fence(
        claim,
        Effect.gen(function* () {
          const value = yield* entry(claim)
          value.observers.set(owner, invalidate)
        }),
      ),
  })
})
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [SessionLifecycle.node],
})

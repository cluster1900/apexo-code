export * as LocationRuntimeGuard from "./location-runtime-guard"

import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { Location } from "./location"
import { makeGlobalNode } from "./effect/app-node"

export class Busy extends Schema.TaggedErrorClass<Busy>()("LocationRuntimeBusy", {}) {}

export interface Interface {
  readonly use: <A, E, R>(location: Location.Ref, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly idle: <A, E, R>(location: Location.Ref, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | Busy, R>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/LocationRuntimeGuard") {}

export const make = Effect.sync(() => {
  const entries = new Map<string, { users: number; reload?: Deferred.Deferred<void> }>()
  const entry = (location: Location.Ref) => {
    const key = JSON.stringify([location.directory, location.workspaceID ?? null])
    const value = entries.get(key) ?? { users: 0 }
    entries.set(key, value)
    return value
  }
  return Service.of({
    use: (location, effect) =>
      Effect.uninterruptibleMask((restore) => {
        const current = entry(location)
        const acquire: Effect.Effect<void> = Effect.suspend(() => {
          if (current.reload) return restore(Deferred.await(current.reload)).pipe(Effect.andThen(acquire))
          current.users++
          return Effect.void
        })
        return Effect.acquireUseRelease(
          acquire,
          () => restore(effect),
          () =>
            Effect.sync(() => {
              current.users--
            }),
        )
      }),
    idle: (location, effect) =>
      Effect.acquireUseRelease(
        Effect.suspend(() => {
          const current = entry(location)
          if (current.users || current.reload) return Effect.fail(new Busy())
          current.reload = Deferred.makeUnsafe<void>()
          return Effect.succeed(current)
        }),
        () => effect,
        (current) =>
          Effect.sync(() => {
            const done = current.reload!
            current.reload = undefined
            Deferred.doneUnsafe(done, Effect.void)
          }),
      ),
  })
})
export const node = makeGlobalNode({ service: Service, layer: Layer.effect(Service, make), deps: [] })

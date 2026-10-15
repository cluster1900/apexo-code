export * as CompatHookSnapshotLocation from "./hook-snapshot-location"

import { Context, Effect, Layer } from "effect"
import { AbsolutePath } from "@apexo/schema/schema"
import { Location } from "@apexo/core/location"
import { HookPreferences } from "@apexo/core/hook-preferences"
import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { HookSnapshotLocation } from "@apexo/core/hook-snapshot-location"
import { LocationServiceMap, locationServiceMapLayer } from "@apexo/core/location-services"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"

export class Service extends Context.Service<Service, HookSnapshotLocation.Interface>()(
  "@apexo/CompatHookSnapshotLocation",
) {}
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const run = <A, E>(effect: Effect.Effect<A, E, HookSnapshotLocation.Service>) =>
      Effect.gen(function* () {
        const instance = yield* InstanceState.context
        return yield* effect.pipe(
          Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(instance.directory) }))),
        )
      })
    return Service.of({
      select: (id) =>
        run(
          Effect.gen(function* () {
            const service = yield* HookSnapshotLocation.Service
            return yield* service.select(id)
          }),
        ).pipe(
          Effect.mapError((error) =>
            error instanceof SessionHookSnapshot.Failure ? error : new SessionHookSnapshot.Failure({ code: "load" }),
          ),
        ),
      capture: (id) =>
        run(
          Effect.gen(function* () {
            const service = yield* HookSnapshotLocation.Service
            return yield* service.capture(id)
          }),
        ).pipe(Effect.orDie),
      reload: (id) =>
        run(
          Effect.gen(function* () {
            const service = yield* HookSnapshotLocation.Service
            return yield* service.reload(id)
          }),
        ).pipe(
          Effect.mapError((error) =>
            error instanceof SessionHookSnapshot.Failure ? error : new SessionHookSnapshot.Failure({ code: "load" }),
          ),
        ),
      get: (id) =>
        run(
          Effect.gen(function* () {
            const service = yield* HookSnapshotLocation.Service
            return yield* service.get(id)
          }),
        ).pipe(Effect.orDie),
      inspect: (id) =>
        run(
          Effect.gen(function* () {
            const service = yield* HookSnapshotLocation.Service
            return yield* service.inspect(id)
          }),
        ).pipe(
          Effect.mapError((error) =>
            error instanceof SessionHookSnapshot.Failure ? error : new SessionHookSnapshot.Failure({ code: "load" }),
          ),
        ),
      preference: (id, hookID, enabled) =>
        run(
          Effect.gen(function* () {
            const service = yield* HookSnapshotLocation.Service
            return yield* service.preference(id, hookID, enabled)
          }),
        ).pipe(
          Effect.mapError((error) =>
            error instanceof SessionHookSnapshot.Failure || error instanceof HookPreferences.Failure
              ? error
              : new SessionHookSnapshot.Failure({ code: "load" }),
          ),
        ),
      trust: (id, input) =>
        run(
          Effect.gen(function* () {
            const service = yield* HookSnapshotLocation.Service
            return yield* service.trust(id, input)
          }),
        ).pipe(
          Effect.mapError((error) =>
            error instanceof SessionHookSnapshot.Failure ? error : new SessionHookSnapshot.Failure({ code: "load" }),
          ),
        ),
      release: (id) =>
        run(
          Effect.gen(function* () {
            const service = yield* HookSnapshotLocation.Service
            return yield* service.release(id)
          }),
        ).pipe(Effect.orDie),
    })
  }),
)
const locations = LayerNode.make({ service: LocationServiceMap.Service, layer: locationServiceMapLayer, deps: [] })
export const node = LayerNode.make({ service: Service, layer, deps: [locations] })

export * as CompatHookSnapshotLocation from "./hook-snapshot-location"

import { Context, Effect, Layer } from "effect"
import { AbsolutePath } from "@apexo/schema/schema"
import { migratedWorktreePaths } from "@apexo/core/app-directory"
import { Global } from "@apexo/core/global"
import { Location } from "@apexo/core/location"
import { HookPreferences } from "@apexo/core/hook-preferences"
import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionStore } from "@apexo/core/session/store"
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
    const sessions = yield* SessionStore.Service
    const global = yield* Global.Service
    const run = <A, E>(id: SessionSchema.ID, effect: Effect.Effect<A, E, HookSnapshotLocation.Service>) =>
      Effect.gen(function* () {
        const instance = yield* InstanceState.context
        const aliases = migratedWorktreePaths(global.data, instance.directory)
        const saved = aliases.length > 1 ? yield* sessions.get(id) : undefined
        // The compatibility instance resolves symlinks. Keep the stored Session's Hook owner
        // when both paths identify the same managed checkout.
        const location =
          saved && saved.location.workspaceID === undefined && aliases.includes(saved.location.directory)
            ? saved.location
            : Location.Ref.make({ directory: AbsolutePath.make(instance.directory) })
        return yield* effect.pipe(Effect.provide(locations.get(location)))
      })
    return Service.of({
      select: (id) =>
        run(
          id,
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
          id,
          Effect.gen(function* () {
            const service = yield* HookSnapshotLocation.Service
            return yield* service.capture(id)
          }),
        ).pipe(Effect.orDie),
      reload: (id) =>
        run(
          id,
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
          id,
          Effect.gen(function* () {
            const service = yield* HookSnapshotLocation.Service
            return yield* service.get(id)
          }),
        ).pipe(Effect.orDie),
      inspect: (id) =>
        run(
          id,
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
          id,
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
          id,
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
          id,
          Effect.gen(function* () {
            const service = yield* HookSnapshotLocation.Service
            return yield* service.release(id)
          }),
        ).pipe(Effect.orDie),
    })
  }),
)
const locations = LayerNode.make({ service: LocationServiceMap.Service, layer: locationServiceMapLayer, deps: [] })
export const node = LayerNode.make({ service: Service, layer, deps: [locations, SessionStore.node, Global.node] })

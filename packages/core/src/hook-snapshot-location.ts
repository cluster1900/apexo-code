export * as HookSnapshotLocation from "./hook-snapshot-location"

import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { Global } from "./global"
import { HostHooks } from "./hooks"
import { HookPreferences } from "./hook-preferences"
import { SessionLifecycle } from "./session/lifecycle"
import { Location } from "./location"
import { makeLocationNode } from "./effect/app-node"
import { SessionHookSnapshot } from "./session/hook-snapshot"
import { SessionStore } from "./session/store"
import { SessionSchema } from "./session/schema"
import { PluginBundleState } from "./plugin-bundle-state"
import { HookProjectTrust } from "./hook-project-trust"
import { Git } from "./git"
import type { RepositoryTrust } from "@apexo/schema/host-hooks"

export interface Interface {
  readonly select: (id: SessionSchema.ID) => Effect.Effect<HookPreferences.Selection, SessionHookSnapshot.Failure>
  readonly capture: (id: SessionSchema.ID) => Effect.Effect<SessionHookSnapshot.Snapshot, SessionHookSnapshot.Failure>
  readonly reload: (id: SessionSchema.ID) => Effect.Effect<SessionHookSnapshot.Snapshot, SessionHookSnapshot.Failure>
  readonly get: (id: SessionSchema.ID) => Effect.Effect<SessionHookSnapshot.Snapshot | undefined>
  readonly inspect: (
    id: SessionSchema.ID,
  ) => Effect.Effect<
    ReturnType<typeof SessionHookSnapshot.inspection> & { repository?: HookProjectTrust.Preview },
    SessionHookSnapshot.Failure
  >
  readonly preference: (
    id: SessionSchema.ID,
    hookID: string,
    enabled: boolean,
  ) => Effect.Effect<SessionHookSnapshot.Snapshot, SessionHookSnapshot.Failure | HookPreferences.Failure>
  readonly trust: (id: SessionSchema.ID, input: RepositoryTrust) => Effect.Effect<void, SessionHookSnapshot.Failure>
  readonly release: (id: SessionSchema.ID) => Effect.Effect<void>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/HookSnapshotLocation") {}
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const git = yield* Git.Service
    const global = yield* Global.Service
    const snapshots = yield* SessionHookSnapshot.Service
    const sessions = yield* SessionStore.Service
    const bundles = yield* PluginBundleState.Service
    const lifecycle = yield* SessionLifecycle.Service
    const home = process.env.GROK_HOME ?? path.join(global.home, ".grok")
    const enabled = process.env.APEXO_RUNTIME_PROFILE === "grok-build"
    const validate = Effect.fn("HookSnapshotLocation.validate")(function* (id: SessionSchema.ID) {
      const session = yield* sessions.get(id)
      if (
        !session ||
        session.location.directory !== location.directory ||
        session.location.workspaceID !== location.workspaceID
      )
        return yield* new SessionHookSnapshot.Failure({ code: "owner_conflict" })
    })
    const repository = Effect.gen(function* () {
      if (!enabled) return undefined
      const discovered = yield* git.repo.discover(location.directory)
      return yield* Effect.tryPromise(() => HookProjectTrust.capture(location.directory, global.home, discovered)).pipe(
        Effect.mapError(() => new SessionHookSnapshot.Failure({ code: "load" })),
      )
    })
    const owner = yield* snapshots
      .registerLocation(
        location,
        (id) =>
          validate(id).pipe(
            Effect.andThen(
              Effect.gen(function* () {
                const installed = yield* bundles.get
                const proof = yield* repository
                const host = enabled
                  ? yield* Effect.tryPromise(() =>
                      HostHooks.discover(
                        location.directory,
                        home,
                        global.home,
                        proof ? { proof, data: global.data } : undefined,
                      ),
                    )
                  : { sources: [], diagnostics: [], projectTrusted: false }
                return { ...host, sources: [...installed.sources, ...host.sources] }
              }),
            ),
          ),
        HookPreferences.make(global.data),
      )
      .pipe(Effect.orDie)
    return Service.of({
      select: (id) =>
        lifecycle
          .use(id, validate(id).pipe(Effect.andThen(snapshots.select(owner, id))))
          .pipe(
            Effect.catchTag("SessionLifecycle.Closed", () =>
              Effect.fail(new SessionHookSnapshot.Failure({ code: "closed" })),
            ),
          ),
      capture: (id) => validate(id).pipe(Effect.andThen(snapshots.capture(owner, id))),
      reload: (id) => validate(id).pipe(Effect.andThen(snapshots.reload(owner, id))),
      get: (id) =>
        snapshots
          .get(id)
          .pipe(
            Effect.map((snapshot) =>
              snapshot?.location.directory === location.directory &&
              snapshot.location.workspaceID === location.workspaceID
                ? snapshot
                : undefined,
            ),
          ),
      inspect: (id) =>
        Effect.gen(function* () {
          yield* validate(id)
          const snapshot = yield* snapshots.get(id)
          const saved = yield* snapshots.saved(owner).pipe(
            Effect.catch((failure) =>
              Effect.succeed(
                failure instanceof HookPreferences.Failure
                  ? failure
                  : new HookPreferences.Failure({
                      code: "conflict",
                      message: "Captured Hook choices are unavailable",
                    }),
              ),
            ),
          )
          const proof = yield* repository
          const preview = proof
            ? yield* Effect.tryPromise(() => HookProjectTrust.inspect(global.data, proof, home)).pipe(
                Effect.mapError(() => new SessionHookSnapshot.Failure({ code: "load" })),
              )
            : undefined
          return { ...SessionHookSnapshot.inspection(snapshot, saved), ...(preview ? { repository: preview } : {}) }
        }),
      preference: (id, hookID, enabled) =>
        lifecycle
          .use(id, validate(id).pipe(Effect.andThen(snapshots.preference(owner, id, hookID, enabled))))
          .pipe(
            Effect.catchTag("SessionLifecycle.Closed", () =>
              Effect.fail(new SessionHookSnapshot.Failure({ code: "closed" })),
            ),
          ),
      trust: (id, input) =>
        lifecycle
          .use(
            id,
            Effect.gen(function* () {
              yield* validate(id)
              const claim = yield* lifecycle.capture(id)
              const selection = yield* snapshots.select(owner, id)
              const proof = yield* repository
              yield* validate(id)
              if (!proof) return yield* new SessionHookSnapshot.Failure({ code: "read_only" })
              yield* Effect.tryPromise(() =>
                HookProjectTrust.change(global.data, proof, input, () => {
                  const choice = selection()
                  return (
                    lifecycle.available(claim) &&
                    !(choice instanceof HookPreferences.Failure && choice.code === "conflict")
                  )
                }),
              ).pipe(
                Effect.mapError(() => new SessionHookSnapshot.Failure({ code: "load" })),
                Effect.uninterruptible,
              )
            }),
          )
          .pipe(
            Effect.catchTag("SessionLifecycle.Closed", () =>
              Effect.fail(new SessionHookSnapshot.Failure({ code: "closed" })),
            ),
          ),
      release: (id) => snapshots.releaseSession(owner, id),
    })
  }),
)
export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Location.node,
    Git.node,
    Global.node,
    SessionHookSnapshot.node,
    SessionStore.node,
    PluginBundleState.node,
    SessionLifecycle.node,
  ],
})

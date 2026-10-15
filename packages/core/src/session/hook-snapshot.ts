export * as SessionHookSnapshot from "./hook-snapshot"

import { Context, Effect, Layer, Schema, Scope } from "effect"
import { Location } from "@apexo/schema/location"
import { HostHooks } from "../hooks"
import { HookPreferences } from "../hook-preferences"
import { KeyedMutex } from "../effect/keyed-mutex"
import { makeGlobalNode } from "../effect/app-node"
import { SessionSchema } from "./schema"

export type Owner = { readonly location: Location.Ref }
export type Snapshot = {
  readonly sessionID: SessionSchema.ID
  readonly location: Location.Ref
  readonly generation: number
  readonly registry: HostHooks.Inspection
  readonly selection: HookPreferences.Selection
}
export class Failure extends Schema.TaggedErrorClass<Failure>()("HookSnapshotFailure", {
  code: Schema.Literals([
    "closed",
    "owner_closed",
    "owner_conflict",
    "missing",
    "released",
    "load",
    "missing_hook",
    "read_only",
  ]),
}) {}
export interface Interface {
  readonly registerLocation: (
    location: Location.Ref,
    load: (id: SessionSchema.ID) => Effect.Effect<HostHooks.Inspection, unknown>,
    preferences: HookPreferences.Store,
  ) => Effect.Effect<Owner, Failure, Scope.Scope>
  readonly select: (owner: Owner, id: SessionSchema.ID) => Effect.Effect<HookPreferences.Selection, Failure>
  readonly capture: (owner: Owner, id: SessionSchema.ID) => Effect.Effect<Snapshot, Failure>
  readonly reload: (owner: Owner, id: SessionSchema.ID) => Effect.Effect<Snapshot, Failure>
  readonly get: (id: SessionSchema.ID) => Effect.Effect<Snapshot | undefined>
  readonly preference: (
    owner: Owner,
    id: SessionSchema.ID,
    hookID: string,
    enabled: boolean,
  ) => Effect.Effect<Snapshot, Failure | HookPreferences.Failure>
  readonly saved: (owner: Owner) => Effect.Effect<HookPreferences.Choices, Failure | HookPreferences.Failure>
  readonly invalidate: (id: SessionSchema.ID) => Effect.Effect<void>
  readonly releaseSession: (owner: Owner, id: SessionSchema.ID) => Effect.Effect<void>
  readonly releaseLocation: (owner: Owner) => Effect.Effect<void>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionHookSnapshot") {}

export const make = Effect.gen(function* () {
  const owners = new Map<
    Owner,
    { load: (id: SessionSchema.ID) => Effect.Effect<HostHooks.Inspection, unknown>; preferences: HookPreferences.Store }
  >()
  type Entry = { owner: Owner; snapshot?: Snapshot; choices?: HookPreferences.Choices | HookPreferences.Failure }
  const entries = new Map<SessionSchema.ID, Entry>()
  const lifecycle = { closed: false }
  const mutex = yield* KeyedMutex.make<SessionSchema.ID>()
  const releaseLocation = (owner: Owner) =>
    Effect.sync(() => {
      owners.delete(owner)
      for (const [id, entry] of entries) if (entry.owner === owner) entries.delete(id)
    })
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      lifecycle.closed = true
      owners.clear()
      entries.clear()
    }),
  )
  const selection =
    (owner: Owner, id: SessionSchema.ID, entry: Entry): HookPreferences.Selection =>
    () => {
      if (!owners.has(owner) || entries.get(id) !== entry)
        return new HookPreferences.Failure({
          code: "conflict",
          message: "Captured Hook choices are no longer available",
        })
      return entry.choices ?? { disabled: [] }
    }
  const select = (owner: Owner, id: SessionSchema.ID) =>
    mutex.withLock(id)(
      Effect.gen(function* () {
        if (lifecycle.closed) return yield* new Failure({ code: "closed" })
        const registration = owners.get(owner)
        if (!registration) return yield* new Failure({ code: "owner_closed" })
        const prior = entries.get(id)
        if (prior && prior.owner !== owner) return yield* new Failure({ code: "owner_conflict" })
        const entry: Entry = prior ?? { owner }
        entries.set(id, entry)
        if (entry.choices === undefined) {
          const choices = yield* registration.preferences.read.pipe(Effect.catch((failure) => Effect.succeed(failure)))
          if (!owners.has(owner) || entries.get(id) !== entry) return yield* new Failure({ code: "released" })
          entry.choices = choices instanceof HookPreferences.Failure ? choices : immutable(choices)
        }
        return selection(owner, id, entry)
      }),
    )
  const load = (owner: Owner, id: SessionSchema.ID, reload: boolean) =>
    mutex.withLock(id)(
      Effect.gen(function* () {
        if (lifecycle.closed) return yield* new Failure({ code: "closed" })
        const registration = owners.get(owner)
        if (!registration) return yield* new Failure({ code: "owner_closed" })
        const prior = entries.get(id)
        if (prior && prior.owner !== owner) return yield* new Failure({ code: "owner_conflict" })
        if (!reload && prior?.snapshot) return prior.snapshot
        if (reload && !prior?.snapshot) return yield* new Failure({ code: "missing" })
        const entry: Entry = prior ?? { owner }
        entries.set(id, entry)
        return yield* Effect.gen(function* () {
          const registry = yield* registration.load(id).pipe(Effect.mapError(() => new Failure({ code: "load" })))
          if (!owners.has(owner) || entries.get(id) !== entry) return yield* new Failure({ code: "released" })
          const hasUserHooks = HostHooks.inspection(registry).hooks.some(
            (hook) =>
              hook.supported &&
              hook.configuredEnabled &&
              (!("readOnlyReason" in hook) || hook.readOnlyReason !== "managed"),
          )
          const choices =
            !reload && entry.choices !== undefined
              ? entry.choices
              : hasUserHooks
                ? yield* registration.preferences.read.pipe(Effect.catch((failure) => Effect.succeed(failure)))
                : undefined
          // A failed explicit reload never substitutes a fresh enabled state for
          // the prior effective choices or partially publishes new definitions.
          if (reload && choices instanceof HookPreferences.Failure) return yield* choices
          if (!owners.has(owner) || entries.get(id) !== entry) return yield* new Failure({ code: "released" })
          entry.choices =
            choices instanceof HookPreferences.Failure ? choices : choices ? immutable(choices) : undefined
          const snapshot = immutable({
            sessionID: id,
            location: owner.location,
            generation: (entry.snapshot?.generation ?? 0) + 1,
            registry,
            selection: selection(owner, id, entry),
          })
          entry.snapshot = snapshot
          return snapshot
        }).pipe(
          Effect.mapError((error) =>
            error instanceof HookPreferences.Failure ? new Failure({ code: "load" }) : error,
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (!entry.snapshot && entry.choices === undefined && entries.get(id) === entry) entries.delete(id)
            }),
          ),
        )
      }),
    )
  return Service.of({
    registerLocation: (location, loader, preferences) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          if (lifecycle.closed) return yield* new Failure({ code: "closed" })
          const owner = Object.freeze({ location: immutable(location) })
          owners.set(owner, { load: loader, preferences })
          return owner
        }),
        releaseLocation,
      ),
    select,
    capture: (owner, id) => load(owner, id, false),
    reload: (owner, id) => load(owner, id, true),
    get: (id) => Effect.sync(() => entries.get(id)?.snapshot),
    saved: (owner) =>
      Effect.gen(function* () {
        const registration = owners.get(owner)
        if (!registration) return yield* new Failure({ code: "owner_closed" })
        return yield* registration.preferences.read
      }),
    preference: (owner, id, hookID, enabled) =>
      mutex.withLock(id)(
        Effect.gen(function* () {
          if (lifecycle.closed) return yield* new Failure({ code: "closed" })
          const registration = owners.get(owner)
          if (!registration) return yield* new Failure({ code: "owner_closed" })
          const entry = entries.get(id)
          if (!entry?.snapshot) return yield* new Failure({ code: "missing" })
          if (entry.owner !== owner) return yield* new Failure({ code: "owner_conflict" })
          const hook = HostHooks.inspection(entry.snapshot.registry).hooks.find((hook) => hook.id === hookID)
          if (!hook) return yield* new Failure({ code: "missing_hook" })
          if (!hook.configurable) return yield* new Failure({ code: "read_only" })
          return yield* registration.preferences.change(hookID, enabled, (choices) =>
            Effect.gen(function* () {
              if (!owners.has(owner) || entries.get(id) !== entry) return yield* new Failure({ code: "released" })
              entry.choices = immutable(choices)
              return entry.snapshot!
            }),
          )
        }),
      ),
    invalidate: (id) =>
      Effect.sync(() => {
        entries.delete(id)
      }),
    releaseSession: (owner, id) =>
      Effect.sync(() => {
        if (entries.get(id)?.owner === owner) entries.delete(id)
      }),
    releaseLocation,
  })
})
export const layer = Layer.effect(Service, make)
export const node = makeGlobalNode({ service: Service, layer, deps: [] })

// Discovery stores resolved handler identity in non-enumerable symbols. Preserve
// those descriptors while separating every mutable configuration container.
function immutable<T>(value: T): T {
  if (!value || typeof value !== "object") return value
  if (Array.isArray(value)) return Object.freeze(value.map(immutable)) as T
  const result = Object.create(Object.getPrototypeOf(value))
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    Object.defineProperty(
      result,
      key,
      "value" in descriptor ? { ...descriptor, value: immutable(descriptor.value) } : descriptor,
    )
  }
  return Object.freeze(result)
}

export function inspection(snapshot: Snapshot | undefined, saved?: HookPreferences.Choices | HookPreferences.Failure) {
  const effective = snapshot?.selection()
  const failure =
    saved instanceof HookPreferences.Failure
      ? saved
      : effective instanceof HookPreferences.Failure
        ? effective
        : undefined
  const inspection = snapshot ? HostHooks.inspection(snapshot.registry) : undefined
  return {
    captured: snapshot !== undefined,
    generation: snapshot?.generation ?? 0,
    ...(effective && !(effective instanceof HookPreferences.Failure) && effective.revision
      ? { preferenceRevision: effective.revision }
      : {}),
    ...(saved && !(saved instanceof HookPreferences.Failure) && saved.revision
      ? { savedPreferenceRevision: saved.revision }
      : {}),
    ...(failure ? { preferenceFailure: failure.code } : {}),
    ...(inspection
      ? {
          inspection: {
            ...inspection,
            hooks: inspection.hooks.map((hook) => ({
              ...hook,
              ...(effective && !(effective instanceof HookPreferences.Failure)
                ? {
                    effectiveDisabled:
                      (!("readOnlyReason" in hook) || hook.readOnlyReason !== "managed") &&
                      (!hook.configuredEnabled || effective.disabled.includes(hook.id)),
                  }
                : {}),
              ...(saved && !(saved instanceof HookPreferences.Failure)
                ? { savedDisabled: saved.disabled.includes(hook.id) }
                : {}),
              ...(saved &&
              !(saved instanceof HookPreferences.Failure) &&
              effective &&
              !(effective instanceof HookPreferences.Failure)
                ? {
                    pendingChange:
                      (!("readOnlyReason" in hook) || hook.readOnlyReason !== "managed") &&
                      hook.configuredEnabled &&
                      saved.disabled.includes(hook.id) !== effective.disabled.includes(hook.id),
                  }
                : {}),
            })),
          },
        }
      : {}),
  }
}

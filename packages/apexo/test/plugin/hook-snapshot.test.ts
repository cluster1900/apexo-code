import { emptyHookPreferences } from "../fixture/hook-preferences"
import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Schema } from "effect"
import { Location } from "@apexo/schema/location"
import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { SessionSchema } from "@apexo/core/session/schema"
import { testEffect } from "../lib/effect"

const test = testEffect(SessionHookSnapshot.layer)
const location = Schema.decodeUnknownSync(Location.Ref)({ directory: "/hooks-snapshot" })

test.effect(
  "capture shares one immutable registry and reload publishes atomically",
  Effect.gen(function* () {
    const service = yield* SessionHookSnapshot.Service
    const id = SessionSchema.ID.create()
    const state = { calls: 0, fail: false, registry: { sources: [], diagnostics: ["first"], projectTrusted: false } }
    const owner = yield* service.registerLocation(
      location,
      () =>
        Effect.suspend(() => {
          state.calls++
          return state.fail ? Effect.fail("private configuration error") : Effect.succeed(state.registry)
        }),
      emptyHookPreferences,
    )
    const snapshots = yield* Effect.all([service.capture(owner, id), service.capture(owner, id)], {
      concurrency: "unbounded",
    })
    expect(state.calls).toBe(1)
    expect(snapshots[0]).toBe(snapshots[1])
    state.registry.diagnostics.push("changed")
    expect(snapshots[0]!.registry.diagnostics).toEqual(["first"])
    expect(Object.isFrozen(snapshots[0]!.registry.diagnostics)).toBe(true)
    state.fail = true
    const failed = yield* service.reload(owner, id).pipe(Effect.flip)
    expect(failed.code).toBe("load")
    expect(yield* service.get(id)).toBe(snapshots[0])
    state.fail = false
    expect((yield* service.reload(owner, id)).generation).toBe(2)
    yield* service.releaseSession(owner, id)
    expect(yield* service.get(id)).toBeUndefined()
    expect((yield* service.reload(owner, id).pipe(Effect.flip)).code).toBe("missing")
  }),
)

test.effect(
  "release during loading cannot resurrect a Session and unrelated Sessions progress",
  Effect.gen(function* () {
    const service = yield* SessionHookSnapshot.Service
    const id = SessionSchema.ID.create()
    const other = SessionSchema.ID.create()
    const entered = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const owner = yield* service.registerLocation(
      location,
      (requested) =>
        Effect.gen(function* () {
          if (requested === id) {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(finish)
          }
          return { sources: [], diagnostics: [], projectTrusted: false }
        }),
      emptyHookPreferences,
    )
    const pending = yield* service.capture(owner, id).pipe(Effect.flip, Effect.forkChild)
    yield* Deferred.await(entered)
    expect((yield* service.capture(owner, other)).generation).toBe(1)
    yield* service.releaseSession(owner, id)
    yield* Deferred.succeed(finish, undefined)
    expect((yield* Fiber.join(pending)).code).toBe("released")
    expect(yield* service.get(id)).toBeUndefined()
    const replacement = yield* service.registerLocation(
      location,
      () => Effect.succeed({ sources: [], diagnostics: [], projectTrusted: true }),
      emptyHookPreferences,
    )
    expect((yield* service.capture(replacement, other).pipe(Effect.flip)).code).toBe("owner_conflict")
    yield* service.releaseLocation(owner)
    expect((yield* service.capture(replacement, other)).registry.projectTrusted).toBe(true)
    yield* service.releaseLocation(owner)
    expect(yield* service.get(other)).toBeDefined()
  }),
)

test.effect(
  "interrupted reload retains prior registry and scoped Location cleanup releases it",
  Effect.gen(function* () {
    const service = yield* SessionHookSnapshot.Service
    const id = SessionSchema.ID.create()
    const entered = yield* Deferred.make<void>()
    const state = { reload: false }
    yield* Effect.scoped(
      Effect.gen(function* () {
        const owner = yield* service.registerLocation(
          location,
          () =>
            Effect.gen(function* () {
              if (state.reload) {
                yield* Deferred.succeed(entered, undefined)
                yield* Effect.never
              }
              return { sources: [], diagnostics: ["original"], projectTrusted: false }
            }),
          emptyHookPreferences,
        )
        const original = yield* service.capture(owner, id)
        state.reload = true
        const pending = yield* service.reload(owner, id).pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        yield* Fiber.interrupt(pending)
        expect(yield* service.get(id)).toBe(original)
        state.reload = false
        expect((yield* service.reload(owner, id)).generation).toBe(2)
      }),
    )
    expect(yield* service.get(id)).toBeUndefined()
  }),
)

import { expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { Location } from "@apexo/core/location"
import { AbsolutePath } from "@apexo/schema/schema"
import { State } from "@apexo/core/state"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)
const one = Location.Ref.make({ directory: AbsolutePath.make("/plugin-guard-one") })
const two = Location.Ref.make({ directory: AbsolutePath.make("/plugin-guard-two") })

it.live("active nested users reject reload while another Location remains independent", () =>
  Effect.gen(function* () {
    const guard = yield* LocationRuntimeGuard.make
    yield* guard.use(
      one,
      guard.use(
        one,
        Effect.gen(function* () {
          const busy = yield* guard.idle(one, Effect.void).pipe(Effect.exit)
          expect(Exit.isFailure(busy)).toBe(true)
          expect(yield* guard.idle(two, Effect.succeed("other"))).toBe("other")
        }),
      ),
    )
    expect(yield* guard.idle(one, Effect.succeed("ready"))).toBe("ready")
  }),
)

it.live("reload fences new users and interrupted waiters do not leak active claims", () =>
  Effect.gen(function* () {
    const guard = yield* LocationRuntimeGuard.make
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const reload = yield* guard
      .idle(one, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const observed: string[] = []
    const user = yield* guard
      .use(
        one,
        Effect.sync(() => {
          observed.push("used")
        }),
      )
      .pipe(Effect.forkChild)
    yield* Effect.yieldNow
    expect(observed).toEqual([])
    yield* Fiber.interrupt(user)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(reload)
    expect(observed).toEqual([])
    expect(yield* guard.idle(one, Effect.succeed("released"))).toBe("released")
  }),
)

it.live("interrupted reload releases the Location fence", () =>
  Effect.gen(function* () {
    const guard = yield* LocationRuntimeGuard.make
    const entered = yield* Deferred.make<void>()
    const owner = yield* guard
      .idle(one, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)))
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* Fiber.interrupt(owner)
    expect(yield* guard.use(one, Effect.succeed("ready"))).toBe("ready")
  }),
)

it.live("interruption after reader registration releases its claim before the body proceeds", () =>
  Effect.gen(function* () {
    const guard = yield* LocationRuntimeGuard.make
    const observed: string[] = []
    const owner = yield* guard
      .use(
        one,
        Effect.yieldNow.pipe(
          Effect.andThen(
            Effect.sync(() => {
              observed.push("body")
            }),
          ),
        ),
      )
      .pipe(Effect.forkChild({ startImmediately: true }))
    yield* Fiber.interrupt(owner)
    expect(observed).toEqual([])
    expect(yield* guard.idle(one, Effect.succeed("released"))).toBe("released")
  }),
)

it.live("prepared State reloads remain invisible until commit and cannot commit after release", () =>
  Effect.gen(function* () {
    const source = { value: 1 }
    const state = State.create({ initial: () => ({ value: 0 }), draft: (value) => value })
    yield* state.transform((draft) => {
      draft.value = source.value
    })
    source.value = 2
    const scope = yield* Scope.make()
    const commit = yield* state.prepareReload.pipe(Scope.provide(scope))
    expect(state.get().value).toBe(1)
    commit()
    expect(state.get().value).toBe(2)
    yield* Scope.close(scope, Exit.void)
    expect(() => commit()).toThrow("scope is closed")
  }),
)

it.live("failed multi-domain preparation keeps all prior states and releases writer permits", () =>
  Effect.gen(function* () {
    const source = { value: 1, fail: false }
    const first = State.create({ initial: () => ({ value: 0 }), draft: (value) => value })
    const second = State.create({ initial: () => ({ value: 0 }), draft: (value) => value })
    yield* first.transform((draft) => {
      draft.value = source.value
    })
    yield* second.transform((draft) => {
      if (source.fail) throw new Error("invalid candidate")
      draft.value = source.value
    })
    source.value = 2
    source.fail = true
    const result = yield* Effect.gen(function* () {
      const a = yield* first.prepareReload
      const b = yield* second.prepareReload
      yield* Effect.sync(() => {
        a()
        b()
      })
    }).pipe(Effect.scoped, Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    expect([first.get().value, second.get().value]).toEqual([1, 1])
    source.fail = false
    yield* first.reload()
    yield* second.reload()
    expect([first.get().value, second.get().value]).toEqual([2, 2])
  }),
)

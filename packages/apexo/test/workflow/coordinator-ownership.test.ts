import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { SessionRunCoordinator } from "@apexo/core/session/run-coordinator"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

it.live("a delayed conditional interrupt cannot capture a successor drain", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstEntered = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const secondEntered = yield* Deferred.make<void>()
      const state = { calls: 0, owns: true, secondClosed: false }
      const coordinator = yield* SessionRunCoordinator.make({
        drain: () =>
          Effect.gen(function* () {
            state.calls += 1
            if (state.calls === 1) {
              yield* Deferred.succeed(firstEntered, undefined)
              yield* Deferred.await(firstRelease)
              state.owns = false
              return
            }
            yield* Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    state.secondClosed = true
                  }),
                )
                yield* Deferred.succeed(secondEntered, undefined)
                yield* Effect.never
              }),
            )
          }),
      })
      const first = yield* coordinator.run("session").pipe(Effect.forkChild)
      yield* Deferred.await(firstEntered)
      const delayedStop = coordinator.interrupt("session", () => state.owns)
      yield* Deferred.succeed(firstRelease, undefined)
      yield* Fiber.join(first)
      yield* coordinator.run("session").pipe(Effect.forkChild)
      yield* Deferred.await(secondEntered)
      yield* delayedStop
      expect((yield* coordinator.active).has("session")).toBe(true)
      expect(state.secondClosed).toBe(false)
      yield* coordinator.interrupt("session")
      expect(state.secondClosed).toBe(true)
      expect((yield* coordinator.active).has("session")).toBe(false)
    }),
  ),
)

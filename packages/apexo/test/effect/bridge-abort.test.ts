import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { EffectBridge } from "../../src/effect/bridge"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

it.live("Promise adapters receive cancellation from their invoking Effect", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<AbortSignal>()
    const cancelled = Promise.withResolvers<void>()
    const fiber = yield* EffectBridge.fromPromise((signal) => {
      signal.addEventListener("abort", () => cancelled.resolve(), { once: true })
      queueMicrotask(() => Effect.runSync(Deferred.succeed(started, signal)))
      return cancelled.promise
    }).pipe(Effect.forkChild)
    const signal = yield* Deferred.await(started)
    expect(signal.aborted).toBe(false)
    yield* Fiber.interrupt(fiber)
    yield* Effect.promise(() => cancelled.promise)
    expect(signal.aborted).toBe(true)
  }),
)

import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Fiber } from "effect"
import { Flock } from "@apexo/core/util/flock"

const directory = await mkdtemp(path.join(tmpdir(), "flock-acquire-race-"))
const acquired = Promise.withResolvers<void>()
const releaseResult = Promise.withResolvers<void>()
const original = Flock.acquire
const state = { first: true, releases: 0, body: false }
// Isolated child only: hold the result after the real lease exists, not the filesystem acquisition itself.
Flock.acquire = async (key, options) => {
  const lease = await original(key, options)
  if (!state.first) return lease
  state.first = false
  acquired.resolve()
  await releaseResult.promise
  return {
    release: async () => {
      state.releases++
      await lease.release()
    },
    [Symbol.asyncDispose]: () => lease[Symbol.asyncDispose](),
  }
}
await Effect.runPromise(
  Effect.gen(function* () {
    const worker = yield* Flock.effect("race", { dir: directory }).pipe(
      Effect.andThen(
        Effect.sync(() => {
          state.body = true
        }),
      ),
      Effect.scoped,
      Effect.forkChild,
    )
    yield* Effect.promise(() => acquired.promise)
    const stopping = yield* Fiber.interrupt(worker).pipe(Effect.forkChild)
    yield* Effect.sleep(50)
    assert.equal(stopping.pollUnsafe(), undefined)
    releaseResult.resolve()
    yield* Fiber.join(stopping)
    assert.equal(state.body, false)
    assert.equal(state.releases, 1)
    yield* Flock.effect("race", { dir: directory, timeoutMs: 300 }).pipe(Effect.scoped)
  }).pipe(Effect.scoped),
).finally(async () => {
  releaseResult.resolve()
  Flock.acquire = original
  await rm(directory, { recursive: true, force: true })
})

import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Fiber } from "effect"
import { Flock } from "@apexo/core/util/flock"
import { pollWithTimeout } from "../lib/effect"

for (const external of [false, true]) {
  test(`Flock Effect joins a real waiting acquire after ${external ? "Options.signal" : "fiber"} cancellation`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "flock-effect-"))
    const holder = await Flock.acquire("held", { dir })
    const entered = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const signal = new AbortController()
    const state = { ran: false, released: false }
    await Effect.runPromise(
      Effect.gen(function* () {
        const worker = yield* Flock.effect("held", {
          dir,
          signal: signal.signal,
          onWait: async () => {
            entered.resolve()
            await gate.promise
          },
        }).pipe(
          Effect.andThen(
            Effect.sync(() => {
              state.ran = true
            }),
          ),
          Effect.scoped,
          Effect.forkChild,
        )
        yield* Effect.promise(() => entered.promise)
        if (external) signal.abort()
        const stopping = yield* (
          external ? Fiber.await(worker).pipe(Effect.asVoid) : Fiber.interrupt(worker).pipe(Effect.asVoid)
        ).pipe(Effect.forkChild)
        yield* Effect.sleep(50)
        expect(stopping.pollUnsafe()).toBeUndefined()
        gate.resolve()
        const exit = yield* pollWithTimeout(
          Effect.sync(() => stopping.pollUnsafe()),
          "Lock cancellation did not join acquisition",
          "1 second",
        ).pipe(Effect.result)
        // Always release before asserting, so a negative control cannot strand the test process.
        yield* Effect.promise(async () => {
          await holder.release()
          state.released = true
        })
        yield* Fiber.join(stopping)
        expect(exit._tag).toBe("Success")
        expect(state.ran).toBe(false)
        yield* Flock.effect("held", { dir, timeoutMs: 300 }).pipe(Effect.scoped)
        yield* Flock.effect("held", { dir, timeoutMs: 300 }).pipe(Effect.scoped)
      }).pipe(Effect.scoped),
    ).finally(async () => {
      gate.resolve()
      if (!state.released) await holder.release()
      await rm(dir, { recursive: true, force: true })
    })
  }, 10000)
}

test("Flock Effect releases an acquired lease exactly once when interruption wins before registration", async () => {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../fixture/flock-effect-acquire-child.ts")], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer = setTimeout(() => child.kill(), 10000)
  const result = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]).finally(() => clearTimeout(timer))
  expect(result[2]).toBe("")
  expect(result[0]).toBe(0)
}, 15000)

test("Flock Effect preserves held-owner timeout failure", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flock-timeout-"))
  const lease = await Flock.acquire("held", { dir })
  await Effect.runPromise(
    Flock.effect("held", { dir, timeoutMs: 25, baseDelayMs: 5, maxDelayMs: 5 }).pipe(Effect.scoped, Effect.exit),
  )
    .then((exit) => {
      expect(exit._tag).toBe("Failure")
    })
    .finally(async () => {
      await lease.release()
      await rm(dir, { recursive: true, force: true })
    })
})

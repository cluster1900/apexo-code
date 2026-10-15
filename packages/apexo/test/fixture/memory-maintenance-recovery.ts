import { mock } from "bun:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { Effect, Fiber } from "effect"

const fs = await import("node:fs/promises")
const original = { ...fs }
const renames = { entered: 0 }
const entered = Promise.withResolvers<void>()
const released = Promise.withResolvers<void>()
mock.module("node:fs/promises", () => ({
  ...original,
  rename: async (from: string, to: string) => {
    if (to.includes("/.cleared/")) {
      renames.entered++
      entered.resolve()
      await released.promise
    }
    return original.rename(from, to)
  },
}))
const { MemoryMaintenance } = await import("@apexo/core/memory-maintenance")
const home = await original.realpath(await original.mkdtemp(path.join(os.tmpdir(), "memory-recovery-")))
const root = path.join(home, ".grok", "memory", "workspaces", "fixture")
const marker = path.join(
  home,
  ".grok",
  "memory",
  ".cleared",
  createHash("sha256").update(path.relative(home, root)).digest("hex") + ".json",
)
await original.mkdir(path.dirname(marker), { recursive: true })
await original.writeFile(marker, JSON.stringify({ generation: "before", pending: true, operation: "change" }))
const state = { action: false, competing: false }
await Effect.runPromise(
  Effect.gen(function* () {
    const writing = yield* MemoryMaintenance.writeEffect(
      { home, root },
      Effect.sync(() => {
        state.action = true
      }),
      "before",
    ).pipe(Effect.forkChild)
    yield* Effect.promise(() => entered.promise)
    const cancelling = yield* Fiber.interrupt(writing).pipe(Effect.forkChild)
    const contender = yield* Effect.promise(() =>
      MemoryMaintenance.write({ home, root }, async () => {
        state.competing = true
      }),
    ).pipe(Effect.forkChild)
    // The real lock retry interval is shorter than this observation window.
    yield* Effect.sleep(350)
    const pending = {
      interruption: cancelling.pollUnsafe() === undefined,
      contender: contender.pollUnsafe() === undefined,
      renames: renames.entered,
    }
    released.resolve()
    yield* Fiber.join(cancelling)
    yield* Fiber.join(contender)
    assert.deepEqual(
      pending,
      { interruption: true, contender: true, renames: 1 },
      "interruption and competing writer must retain ownership through recovery rename",
    )
    assert.equal(state.action, false)
    assert.equal(state.competing, true)
    const persisted = yield* Effect.promise(async () => JSON.parse(await original.readFile(marker, "utf8")))
    assert.equal(persisted.pending, false)
  }).pipe(Effect.scoped),
).finally(async () => {
  released.resolve()
  await original.rm(home, { recursive: true, force: true })
})

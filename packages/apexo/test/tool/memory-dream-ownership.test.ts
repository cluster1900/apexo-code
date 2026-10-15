import { expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const access = () => true
const request = { owner: "native", now: 1000, duration: 1000, ownership: "explicit" as const }

it.live("native Dream claims cannot be stolen by age through native or compatibility callers", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home })
    yield* store.remember("Durable observation", access)
    const lease = (yield* store.dreamClaim(request, access))!
    for (const ownership of [undefined, "explicit"] as const) {
      const result = yield* store
        .dreamClaim({ owner: "foreign", now: 9000, duration: 1000, ownership }, access)
        .pipe(Effect.result)
      expect(result._tag).toBe("Failure")
    }
    const replaced = (yield* store.dreamClaim({ ...request, now: 9000, recover: lease }, access))!
    expect(replaced.token).not.toBe(lease.token)
    expect((yield* store.dreamRelease(lease, 9001).pipe(Effect.result))._tag).toBe("Failure")
    yield* store.dreamRelease(replaced, 99999)
    expect(yield* store.dreamClaim({ ...request, now: 100000 }, access)).toBeDefined()
  }),
)

it.live("released native prepared plans survive reopen and settle from exact completed receipts", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const original = yield* Effect.scoped(
      Effect.gen(function* () {
        const store = yield* MemoryCapture.make({ home, directory: home })
        yield* store.remember("A fact to consolidate", access)
        const generation = yield* store.revision
        const lease = (yield* store.dreamClaim(request, access))!
        const input = yield* store.dreamInput(lease, 1001, access)
        yield* store.dreamPrepare(
          lease,
          [
            {
              action: "create",
              path: "topics/fact.md",
              content: "A fact",
              evidence: input.observations.map((row) => row.path),
            },
          ],
          1002,
          access,
        )
        yield* store.dreamRelease(lease, 99999)
        expect((yield* store.dreamResume(lease, 1003, access).pipe(Effect.result))._tag).toBe("Failure")
        return { lease, generation }
      }),
    )
    const store = yield* MemoryCapture.make({ home, directory: home })
    for (const ownership of [undefined, "explicit"] as const)
      expect(
        (yield* store
          .dreamClaim({ ...request, owner: "unrelated", ownership, now: 100000 }, access)
          .pipe(Effect.result))._tag,
      ).toBe("Failure")
    const resumed = (yield* store.dreamClaim(
      { ...request, owner: "replacement", now: 100000, recover: original.lease },
      access,
    ))!
    expect(resumed.planned).toBe(true)
    expect(resumed.id).toBe(original.lease.id)
    const result = yield* store.dreamResume(resumed, 100001, access)
    expect(result.status).toBe("completed")
    expect(yield* store.revision).not.toBe(original.generation)
    expect(yield* store.dreamCompleted(resumed)).toEqual(result)
    expect(yield* store.dreamCompleted(original.lease)).toBeUndefined()
    expect(yield* store.dreamCompleted({ ...resumed, token: "foreign" })).toBeUndefined()
    const reopened = yield* MemoryCapture.make({ home, directory: home })
    expect(yield* reopened.dreamCompleted(resumed)).toEqual(result)
  }),
)

it.live("native recovery refuses a different generation and unknown compatibility lease", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home })
    yield* store.remember("Legacy worker observation", access)
    const legacy = (yield* store.dreamClaim({ owner: "legacy", now: 1000, duration: 1000 }, access))!
    expect((yield* store.dreamClaim({ ...request, now: 5000 }, access).pipe(Effect.result))._tag).toBe("Failure")
    yield* store.dreamRelease(legacy, 1001)
    const lease = (yield* store.dreamClaim(request, access))!
    yield* store.clear
    yield* store.remember("New generation", access)
    expect((yield* store.dreamClaim({ ...request, now: 5000, recover: lease }, access).pipe(Effect.result))._tag).toBe(
      "Failure",
    )
    expect(yield* store.dreamCompleted(lease)).toBeUndefined()
  }),
)

import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const access = () => true
const request = {
  owner: "batch",
  now: 1000,
  duration: 5000,
  ownership: "explicit" as const,
  batch: { maxBytes: 98304, excluded: [] },
}
for (const changed of [false, true])
  it.live(
    `prepared no-change batch recovery ${changed ? "rejects changed" : "preserves exact"} read dependencies`,
    () =>
      Effect.gen(function* () {
        const home = yield* tmpdirScoped()
        const memory = yield* MemoryCapture.make({ home, directory: home }, { recover: false })
        const note = yield* memory.remember("Already known", access)
        yield* Effect.promise(() =>
          MemoryV2.publish(memory.root, "topics/existing.md", "# Fact\nAlready known.\n\n## Detail\nExisting", true),
        )
        const lease = (yield* memory.dreamClaim(request, access))!
        const input = yield* memory.dreamInput(lease, 1001, access)
        yield* memory.dreamPrepare(lease, [], 1002, access, [
          { path: input.observations[0]!.path, outcome: "no_change" },
        ])
        yield* memory.dreamRelease(lease, 1003)
        const reopened = yield* MemoryCapture.make({ home, directory: home }, { recover: false })
        if (changed)
          yield* Effect.promise(() =>
            writeFile(path.join(memory.root.path, "topics/existing.md"), "Foreign changed knowledge"),
          )
        const recovered = (yield* reopened.dreamClaim(
          { ...request, owner: "retry", now: 6001, recover: lease },
          access,
        ))!
        expect(recovered.planned).toBe(true)
        const result = yield* reopened
          .dreamBatchPublish((owned) => owned.commit(recovered, 6002, access))
          .pipe(Effect.result)
        expect(result._tag).toBe(changed ? "Failure" : "Success")
        expect(yield* Effect.promise(() => Bun.file(note.path).exists())).toBe(changed)
        if (!changed) {
          const again = yield* reopened.dreamBatchPublish((owned) => owned.commit(recovered, 6003, access))
          expect(again.observations).toBe(1)
        }
      }),
  )
it.live("duplicate batch outcomes and foreign evidence cannot publish or archive", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    const note = yield* memory.remember("Retain me", access)
    const lease = (yield* memory.dreamClaim(request, access))!
    const input = yield* memory.dreamInput(lease, 1001, access)
    const outcome = { path: input.observations[0]!.path, outcome: "no_change" as const }
    expect((yield* memory.dreamPrepare(lease, [], 1002, access, [outcome, outcome]).pipe(Effect.result))._tag).toBe(
      "Failure",
    )
    expect(
      (yield* memory
        .dreamPrepare(lease, [], 1002, access, [{ ...outcome, path: "observations/_inbox/foreign.md" }])
        .pipe(Effect.result))._tag,
    ).toBe("Failure")
    expect(yield* Effect.promise(() => Bun.file(note.path).exists())).toBe(true)
  }),
)

it.live("completed batch keeps content-free outcomes and scope clear atomically erases counters", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const memory = yield* MemoryCapture.make({ home, directory: home })
    yield* memory.remember("Private pending fact", access)
    const lease = (yield* memory.dreamClaim(request, access))!
    const input = yield* memory.dreamInput(lease, 1001, access)
    yield* memory.dreamBatchPublish((owned) =>
      owned.commit(lease, 1002, access, {
        operations: [],
        outcomes: [{ path: input.observations[0]!.path, outcome: "deferred", reason: "PRIVATE_REASON" }],
      }),
    )
    yield* Effect.sync(() => {
      using db = new Database(path.join(memory.root.path, "memory_state.sqlite"), { readonly: true })
      expect(JSON.stringify(db.query("SELECT * FROM dream_batch_state").all())).not.toContain("PRIVATE_REASON")
      expect(db.query("SELECT * FROM dream_deferrals").all()).toHaveLength(1)
    })
    yield* memory.clear
    yield* Effect.sync(() => {
      using db = new Database(path.join(memory.root.path, "memory_state.sqlite"), { readonly: true })
      expect(db.query("SELECT * FROM dream_batch_state").all()).toHaveLength(0)
      expect(db.query("SELECT * FROM dream_deferrals").all()).toHaveLength(0)
      expect(db.query("SELECT * FROM dream_runs").all()).toHaveLength(0)
    })
  }),
)

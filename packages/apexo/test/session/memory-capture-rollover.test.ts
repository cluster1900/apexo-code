import { expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
it.live("capture incarnation rollover revokes old leases and receipts but preserves committed observations", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home })
    const input = {
      sessionID: "session",
      promptID: "same-prompt",
      sourcePromptIndex: 0,
      source: "old source",
      exposed: true,
    }
    yield* store.adopt(input.sessionID, "first-created-event")
    yield* store.admit(input)
    const completed = (yield* store.claim({ owner: "first", sessionID: input.sessionID, now: 1000, duration: 5000 }))!
    yield* store.commit(
      completed,
      MemoryCapture.parse(
        JSON.stringify({
          outcome: "observations",
          observations: [
            {
              type: "project",
              topic_hint: "identity",
              statement: "Preserve completed notes",
              keywords: ["retained"],
              aliases: [],
              body: "Durable observation.",
            },
          ],
        }),
        "test/model",
        1,
      ),
      1100,
    )
    const notes = yield* store.search("retained")
    expect(notes.length).toBeGreaterThan(0)
    yield* store.admit({ ...input, promptID: "pending" })
    const stale = (yield* store.claim({ owner: "old", sessionID: input.sessionID, now: 1200, duration: 5000 }))!
    yield* store.adopt(input.sessionID, "second-created-event")
    expect((yield* store.commit(stale, { outcome: "noop", observations: [] }, 1300).pipe(Effect.flip)).reason).toBe(
      "stale_lease",
    )
    expect(yield* store.jobs(input.sessionID)).toEqual([])
    expect(yield* store.cursors(input.sessionID)).toEqual({ requested: 0, captured: 0, indexed: 0 })
    expect((yield* store.admit({ ...input, source: "replacement source" })).admitted).toBe(true)
    const replacement = (yield* store.claim({ owner: "new", sessionID: input.sessionID, now: 1400, duration: 5000 }))!
    expect(replacement.job.source).toBe("replacement source")
    yield* store.commit(
      replacement,
      MemoryCapture.parse(
        JSON.stringify({
          outcome: "observations",
          observations: [
            {
              type: "project",
              statement: "Replacement observation",
              keywords: ["replacement"],
              aliases: [],
              topic_hint: "identity",
              body: "New Session note",
            },
          ],
        }),
        "test/model",
        2,
      ),
      1500,
    )
    expect(yield* store.search("replacement")).toHaveLength(1)
    expect(yield* store.progress(input.sessionID, 1)).toEqual({ indexed: 1, failed: false, retry: false })
    expect(yield* store.search("retained")).toEqual(notes)
    const reopened = yield* MemoryCapture.make({ home, directory: home })
    yield* reopened.adopt(
      input.sessionID,
      "second-created-event",
      Effect.die("same incarnation must not inspect compacted history"),
    )
    expect((yield* reopened.admit({ ...input, source: "replacement source" })).admitted).toBe(false)
    expect(yield* reopened.search("retained")).toEqual(notes)
    expect(yield* reopened.search("replacement")).toHaveLength(1)
  }),
)

it.live("first adoption preserves proven legacy snapshots and archives unproven old receipts", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home })
    const input = {
      sessionID: "legacy",
      promptID: "same-prompt",
      sourcePromptIndex: 0,
      source: "exact legacy source",
      exposed: false,
    }
    yield* store.admit(input)
    yield* store.adopt(input.sessionID, "first-created", Effect.succeed([input.source]))
    expect((yield* store.jobs(input.sessionID))[0]?.source).toBe(input.source)
    expect((yield* store.jobs(input.sessionID))[0]?.incarnation).toBe("first-created")
    const reopened = yield* MemoryCapture.make({ home, directory: home })
    yield* reopened.adopt(input.sessionID, "first-created", Effect.die("verified legacy proof must survive compaction"))
    expect(
      (yield* reopened.claim({ sessionID: input.sessionID, owner: "restart", now: 1000, duration: 5000 }))?.job
        .incarnation,
    ).toBe("first-created")
    const other = { ...input, sessionID: "unproven" }
    yield* store.admit(other)
    yield* store.adopt(other.sessionID, "replacement-created", Effect.succeed(["different assistant snapshot"]))
    expect(yield* store.jobs(other.sessionID)).toEqual([])
    expect((yield* store.admit({ ...other, source: "new valid source" })).admitted).toBe(true)
  }),
)

it.live("receipt-only historical ownership fails closed without changing clear cutoff or deduplication", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home })
    const input = {
      sessionID: "historical",
      promptID: "same-prompt",
      sourcePromptIndex: 0,
      source: "removed historical source",
      exposed: false,
      createdAt: 1000,
    }
    yield* store.admit(input)
    const lease = (yield* store.claim({ owner: "old", now: 1000, duration: 5000 }))!
    yield* store.commit(lease, { outcome: "noop", observations: [] }, 1100)
    yield* store.clear
    expect(yield* store.jobs(input.sessionID)).toEqual([])
    const before = yield* store.cursors(input.sessionID)
    const error = yield* store.adopt(input.sessionID, "unknown-created", Effect.succeed([])).pipe(Effect.flip)
    expect(error.reason).toBe("historical_owner")
    expect(error.message).toContain("Use a new Session")
    expect(yield* store.cursors(input.sessionID)).toEqual(before)
    expect((yield* store.admit(input)).admitted).toBe(false)
    const reopened = yield* MemoryCapture.make({ home, directory: home })
    expect((yield* reopened.adopt(input.sessionID, "unknown-created").pipe(Effect.flip)).reason).toBe(
      "historical_owner",
    )
    expect((yield* reopened.admit({ ...input, promptID: "different-old-prompt" })).admitted).toBe(false)
  }),
)

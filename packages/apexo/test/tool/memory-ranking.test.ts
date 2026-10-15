import { Database } from "bun:sqlite"
import { expect } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemorySearch } from "@apexo/core/memory-search"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

it.live("session decay, evergreen exemption, source weights and staleness survive reopening", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const input = { directory, home, projectID: "ranking", watch: false }
    const memory = yield* MemorySearch.make(input)
    const root = path.dirname(WorkspaceMemory.file(directory, home, input))
    yield* Effect.promise(async () => {
      await mkdir(path.join(root, "sessions"))
      await writeFile(path.join(root, "sessions", "old.md"), "rankingneedle identical content")
      await writeFile(path.join(root, "evergreen.md"), "rankingneedle identical content")
    })
    yield* memory.refresh
    yield* Effect.sync(() => {
      using db = new Database(path.join(root, "search.sqlite"))
      db.run("UPDATE memory_ranking SET created_at = ?", [Date.now() - 30 * 86400000])
    })
    const results = (yield* memory.search({ query: "rankingneedle", min_score: 0 })).results
    expect(results[0]!.source).toBe("workspace")
    expect(results[0]!.score).toBe(1)
    expect(results[0]!.staleness).toBeUndefined()
    expect(results[1]!.score).toBeCloseTo(0.5, 3)
    expect(results[1]!.staleness).toContain("**Stale")
    const weighted = yield* MemorySearch.make({ ...input, search: { source_weights: { session: 4 } } })
    expect((yield* weighted.search({ query: "rankingneedle", min_score: 0 })).results[0]!.source).toBe("session")
    const disabled = yield* MemorySearch.make({ ...input, search: { temporal_decay: { enabled: false } } })
    expect(
      (yield* disabled.search({ query: "rankingneedle", min_score: 0 })).results.every((row) => row.score === 1),
    ).toBe(true)
  }),
)

it.live("access frequency ranks unclamped scores and MMR selects diverse candidates", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const input = { directory, home, projectID: "diversity", watch: false }
    const memory = yield* MemorySearch.make(input)
    const root = path.dirname(WorkspaceMemory.file(directory, home, input))
    yield* Effect.promise(async () => {
      await writeFile(path.join(root, "b.md"), "rankingneedle shared duplicate")
    })
    yield* memory.search({ query: "rankingneedle" })
    yield* Effect.promise(async () => {
      await writeFile(path.join(root, "a.md"), "rankingneedle shared duplicate")
      await writeFile(path.join(root, "c.md"), "rankingneedle distinct alternative")
    })
    const plain = yield* MemorySearch.make({ ...input, search: { mmr: { enabled: false } } })
    const boosted = (yield* plain.search({ query: "rankingneedle", min_score: 0 })).results
    expect(boosted[0]!.path).toEndWith("b.md")
    expect(boosted.every((row) => row.score === 1)).toBe(true)
    const diverse = yield* MemorySearch.make({ ...input, search: { mmr: { lambda: 0 } } })
    const selected = (yield* diverse.search({ query: "rankingneedle", max_results: 2, min_score: 0 })).results
    expect(selected[0]!.path).toEndWith("b.md")
    expect(selected[1]!.path).toEndWith("c.md")
    yield* Effect.promise(() => writeFile(path.join(root, "b.md"), "rankingneedle rewritten content"))
    expect((yield* plain.search({ query: "rankingneedle", min_score: 0 })).results[0]!.path).toEndWith("b.md")
  }),
)

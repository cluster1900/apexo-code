import { expect } from "bun:test"
import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemorySearch } from "@apexo/core/memory-search"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

it.live("index initialization validates redirected ancestors before creating directories", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const outside = yield* tmpdirScoped()
    yield* Effect.promise(() => symlink(outside, path.join(home, ".grok")))
    expect((yield* Effect.exit(MemorySearch.make({ directory: home, home, projectID: "redirected" })))._tag).toBe(
      "Failure",
    )
    expect(yield* Effect.promise(() => readdir(outside))).toEqual([])
  }),
)

it.live("persistent full-text search ranks scoped notes and returns accurate line ranges", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const input = { directory, home, projectID: "search-repo" }
    yield* Effect.promise(() =>
      WorkspaceMemory.update(
        directory,
        { operation: "remember", scope: "global", content: "Global authentication preference" },
        home,
        input,
      ),
    )
    const root = path.dirname(WorkspaceMemory.file(directory, home, input))
    yield* Effect.promise(async () => {
      await mkdir(path.join(root, "topics"), { recursive: true })
      await mkdir(path.join(root, "sessions"))
      await writeFile(
        path.join(root, "topics", "auth.md"),
        "# Authentication\n\nAuthentication middleware uses a session cookie.\n中文数据库连接池配置。\n",
      )
      await writeFile(path.join(root, "sessions", "old.md"), "# Session\n\nInvestigated cookie authentication.\n")
      await WorkspaceMemory.update(directory, { operation: "remember", content: "FOREIGN_AUTH_SECRET" }, home, {
        projectID: "foreign",
      })
    })
    yield* Effect.gen(function* () {
      const memory = yield* MemorySearch.make(input)
      const result = yield* memory.search({ query: "authentication", min_score: 0 })
      expect(result.results.length).toBe(3)
      expect(result.results.map((result) => result.source).sort()).toEqual(["global", "session", "workspace"])
      expect(result.results.every((result) => result.score >= 0 && result.score <= 1)).toBe(true)
      for (const match of result.results) {
        const content = yield* memory.get({
          path: match.path,
          from: match.start_line,
          lines: match.end_line - match.start_line + 1,
        })
        expect(content.content.replace(/^\d+→/gm, "").startsWith(match.snippet)).toBe(true)
      }
      expect((yield* memory.search({ query: "数据库" })).results[0]?.path).toEndWith("auth.md")
      expect((yield* memory.search({ query: "FOREIGN_AUTH_SECRET" })).results).toEqual([])
      expect((yield* memory.search({ query: "authentication", max_results: 1 })).results).toHaveLength(1)
      expect((yield* memory.search({ query: "authentication", max_results: 0 })).results).toEqual([])
      expect((yield* memory.search({ query: '" OR * () :' })).results).toEqual([])
      expect((yield* memory.search({ query: "authentication", min_score: 2 })).results).toEqual([])
      expect((yield* memory.refresh).updated).toBe(0)
    }).pipe(Effect.scoped)
    const header = yield* Effect.promise(() => readFile(path.join(root, "search.sqlite")))
    expect(header.subarray(0, 15).toString()).toBe("SQLite format 3")
    const reopened = yield* MemorySearch.make({ ...input, watch: false })
    expect((yield* reopened.search({ query: "middleware" })).results).toHaveLength(1)
  }),
)

it.live("external edit, atomic replacement, deletion and new topics refresh without restarting", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const input = { directory, home, projectID: "changes" }
    yield* Effect.promise(() =>
      WorkspaceMemory.update(directory, { operation: "remember", content: "originaltoken" }, home, input),
    )
    const memory = yield* MemorySearch.make(input)
    expect(memory.watching).toBe(true)
    expect((yield* memory.search({ query: "originaltoken" })).results).toHaveLength(1)
    const target = WorkspaceMemory.file(directory, home, input)
    yield* Effect.promise(async () => {
      await writeFile(`${target}.tmp`, "# Memory\n\nreplacementtoken\n")
      await rename(`${target}.tmp`, target)
    })
    expect((yield* memory.search({ query: "originaltoken" })).results).toEqual([])
    expect((yield* memory.search({ query: "replacementtoken" })).results).toHaveLength(1)
    yield* Effect.promise(async () => {
      await mkdir(path.join(path.dirname(target), "topics", "nested"), { recursive: true })
      await writeFile(path.join(path.dirname(target), "topics", "nested", "new.md"), "nestedtopic\n")
      await rm(target)
    })
    expect((yield* memory.search({ query: "replacementtoken" })).results).toEqual([])
    expect((yield* memory.search({ query: "nestedtopic" })).results).toHaveLength(1)
  }),
)

it.live("memory_get supports zero-based compatibility, blank final lines and scope boundaries", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const input = { directory, home, projectID: "reads" }
    const memory = yield* MemorySearch.make(input)
    const target = WorkspaceMemory.file(directory, home, input)
    yield* Effect.promise(() => writeFile(target, "alpha\nbeta\n"))
    expect((yield* memory.get({ path: "MEMORY.md", from: 0 })).content).toBe("1→alpha\n2→beta\n3→")
    expect((yield* memory.get({ path: target, from: 2, lines: 1 })).content).toBe("2→beta")
    expect((yield* memory.get({ path: target, lines: 0 })).content).toBe("")
    expect((yield* memory.get({ path: target, from: 100 })).content).toBe("")
    const outside = path.join(directory, "private.md")
    yield* Effect.promise(() => writeFile(outside, "PRIVATE_VALUE"))
    expect((yield* Effect.exit(memory.get({ path: outside })))._tag).toBe("Failure")
    expect((yield* Effect.exit(memory.get({ path: "../../private.md" })))._tag).toBe("Failure")
    yield* Effect.promise(() => symlink(outside, path.join(path.dirname(target), "linked.md")))
    expect((yield* Effect.exit(memory.get({ path: path.join(path.dirname(target), "linked.md") })))._tag).toBe(
      "Failure",
    )
    expect((yield* memory.search({ query: "PRIVATE_VALUE" })).results).toEqual([])
  }),
)

it.live("a symlink replacing an indexed topic is removed without exposing its new target", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const input = { directory, home, projectID: "symlinks" }
    const memory = yield* MemorySearch.make(input)
    const topics = path.join(path.dirname(WorkspaceMemory.file(directory, home, input)), "topics")
    const outside = path.join(directory, "outside")
    yield* Effect.promise(async () => {
      await mkdir(topics)
      await mkdir(outside)
      await writeFile(path.join(topics, "test.md"), "previousnote\n")
      await writeFile(path.join(outside, "test.md"), "outsidesecret\n")
    })
    expect((yield* memory.search({ query: "previousnote" })).results).toHaveLength(1)
    yield* Effect.promise(async () => {
      await rm(topics, { recursive: true })
      await symlink(outside, topics, "dir")
    })
    expect((yield* memory.search({ query: "previousnote outsidesecret" })).results).toEqual([])
    expect((yield* Effect.exit(memory.get({ path: path.join(topics, "test.md") })))._tag).toBe("Failure")
  }),
)

it.live("cached results recheck source permissions and large notes remain searchable and readable", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const input = { directory, home, projectID: "permissions" }
    const memory = yield* MemorySearch.make({ ...input, watch: false })
    const target = WorkspaceMemory.file(directory, home, input)
    yield* Effect.promise(() => writeFile(target, "privatecachedtoken\n"))
    const authorized: string[][] = []
    const allow = (paths: string[]) =>
      Effect.sync(() => {
        authorized.push(paths)
      })
    expect((yield* memory.search({ query: "privatecachedtoken" }, allow)).results).toHaveLength(1)
    expect((yield* memory.search({ query: "privatecachedtoken" }, allow)).results).toHaveLength(1)
    expect(authorized).toEqual([[target], [target]])
    const denied = yield* Effect.exit(
      memory.search({ query: "privatecachedtoken" }, () => Effect.die(new Error("read denied"))),
    )
    expect(denied._tag).toBe("Failure")
    yield* Effect.promise(() => writeFile(target, `${" ".repeat(4 * 1024 * 1024 + 1)}\nlargefinaltoken\n`))
    expect((yield* memory.search({ query: "privatecachedtoken" }, allow)).results).toEqual([])
    expect((yield* memory.search({ query: "largefinaltoken" }, allow)).results).toHaveLength(1)
    expect((yield* memory.get({ path: target, from: 2, lines: 1 })).content).toBe("2→largefinaltoken")
    yield* Effect.promise(() => writeFile(target, "recoveredtoken\n"))
    expect((yield* memory.search({ query: "recoveredtoken" }, allow)).results).toHaveLength(1)
  }),
)

it.live("chunks keep exact nonoverlapping line ranges after leading whitespace", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const input = { directory, home, projectID: "chunks" }
    const memory = yield* MemorySearch.make(input)
    const lines = Array.from({ length: 165 }, (_, index) =>
      index === 79 ? "boundary left" : index === 80 ? "boundary right" : "",
    )
    yield* Effect.promise(() => writeFile(WorkspaceMemory.file(directory, home, input), lines.join("\n")))
    const matches = (yield* memory.search({ query: "boundary", min_score: 0 })).results.sort(
      (a, b) => a.start_line - b.start_line,
    )
    expect(matches).toHaveLength(2)
    expect(matches[0]?.start_line).toBe(80)
    expect(matches[0]?.end_line).toBe(80)
    expect(matches[0]?.snippet).toBe("boundary left")
    expect(matches[1]?.start_line).toBe(81)
    expect((yield* memory.get({ path: matches[0]!.path, from: matches[0]!.start_line, lines: 1 })).content).toBe(
      "80→boundary left",
    )
  }),
)

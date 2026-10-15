export * as MemorySearch from "./memory-search"

import { ConfigMemory } from "./config/memory"
import { layer } from "#sqlite"
import { watch } from "node:fs"
import { lstat, mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { Global } from "./global"
import { WorkspaceMemory } from "./workspace-memory"
import { MemoryMaintenance } from "./memory-maintenance"
import { MemoryFiles } from "./memory-files"

export class MemoryError extends Schema.TaggedErrorClass<MemoryError>()("MemorySearchError", {
  message: Schema.String,
}) {}

export type Result = {
  path: string
  source: "global" | "workspace" | "session"
  start_line: number
  end_line: number
  score: number
  snippet: string
  staleness?: string
}

export type Stats = { files: number; updated: number; removed: number; skipped: string[] }

export interface Interface {
  readonly roots: readonly string[]
  readonly watching: boolean
  readonly accessPaths: (files: string[]) => string[]
  readonly refresh: Effect.Effect<Stats, MemoryError>
  readonly resolve: (file: string) => Effect.Effect<string, MemoryError>
  readonly search: (
    input: {
      query: string
      max_results?: number | null
      min_score?: number | null
    },
    authorize?: (paths: string[]) => Effect.Effect<void, MemoryError>,
  ) => Effect.Effect<{ results: Result[]; skipped: string[] }, MemoryError>
  readonly get: (input: {
    path: string
    from?: number | null
    lines?: number | null
  }) => Effect.Effect<{ path: string; content: string; from: number; lines: number }, MemoryError>
}

const words = new Intl.Segmenter("und", { granularity: "word" })

export const make = Effect.fn("MemorySearch.make")(function* (input: {
  directory: string
  projectID?: string
  home?: string
  search?: ConfigMemory.Search
  watch?: boolean
  /** Native owners join filesystem promises before releasing their Session incarnation. */
  joinIO?: boolean
}) {
  const io = <A>(run: () => Promise<A>) => {
    const work = Effect.tryPromise({ try: run, catch: toError })
    return input.joinIO ? work.pipe(Effect.uninterruptible) : work
  }
  const settings = input.search ?? {}
  const home = input.home ?? Global.Path.home
  const generation = yield* io(() =>
    MemoryMaintenance.revision(WorkspaceMemory.maintenance(input.directory, home, input)),
  )
  const roots = yield* io(async () =>
    Promise.all(
      (["global", "workspace"] as const).map(async (scope) => {
        const root = path.dirname(WorkspaceMemory.file(input.directory, home, { ...input, scope }))
        await mkdir(root, { recursive: true, mode: 0o700 })
        if ((await lstat(root)).isSymbolicLink()) throw new Error("Memory scope directories must not be symbolic links")
        return { path: await realpath(root), alias: path.resolve(root), source: scope }
      }),
    ),
  )
  // A live process may still hold the old database after another process clears
  // the workspace. A distinct filename prevents its WAL from touching the new index.
  const services = yield* Layer.build(
    layer({
      filename: path.join(roots[1]!.path, generation === "initial" ? "search.sqlite" : `search-${generation}.sqlite`),
    }),
  )
  const sql = Context.get(services, SqlClient.SqlClient)
  yield* sql`PRAGMA busy_timeout = 5000`
  yield* sql`CREATE TABLE IF NOT EXISTS memory_files (path TEXT PRIMARY KEY, signature TEXT NOT NULL)`
  yield* sql`CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks USING fts5(tokens, content UNINDEXED, path UNINDEXED, source UNINDEXED, start_line UNINDEXED, end_line UNINDEXED, tokenize = 'unicode61 remove_diacritics 2')`
  yield* sql`CREATE TABLE IF NOT EXISTS memory_ranking (path TEXT NOT NULL, start_line INTEGER NOT NULL, created_at REAL NOT NULL, access_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(path, start_line))`
  const mutex = yield* Semaphore.make(1)
  const changes = { dirty: false }
  const subscriptions =
    input.watch === false
      ? []
      : yield* Effect.forEach(roots, (root) =>
          Effect.acquireRelease(
            Effect.try({
              try: () => {
                const subscription = watch(root.path, { recursive: true, persistent: false }, (_event, name) => {
                  if (name && path.extname(name.toString()) && !name.toString().endsWith(".md")) return
                  changes.dirty = true
                })
                subscription.on("error", () => {
                  changes.dirty = true
                })
                return subscription
              },
              catch: toError,
            }).pipe(Effect.catch(() => Effect.succeed(undefined))),
            (subscription) => Effect.sync(() => subscription?.close()),
          ),
        )

  const refresh = (authorize?: (paths: string[]) => Effect.Effect<void, MemoryError>) =>
    Effect.gen(function* () {
      const current = yield* io(() =>
        MemoryMaintenance.revision(WorkspaceMemory.maintenance(input.directory, home, input)),
      )
      if (current !== generation)
        return yield* new MemoryError({ message: "Memory was cleared; retry with the current index" })
      yield* io(() =>
        MemoryMaintenance.revision(WorkspaceMemory.maintenance(input.directory, home, { scope: "global" })),
      )
      const dirty = changes.dirty
      changes.dirty = false
      const files = yield* io(() => MemoryFiles.list(roots))
      // Check sources before reading or returning cached content, including nonmatching files.
      if (authorize && files.length) yield* authorize(files.map((file) => file.path))
      const previous = new Map(
        (yield* sql<{ path: string; signature: string }>`SELECT path, signature FROM memory_files`).map((file) => [
          file.path,
          file.signature,
        ]),
      )
      const rankedPaths = new Set(
        (yield* sql<{ path: string }>`SELECT DISTINCT path FROM memory_ranking`).map((row) => row.path),
      )
      const changed = files.filter(
        (file) => dirty || !rankedPaths.has(file.path) || previous.get(file.path) !== file.signature,
      )
      const present = new Set(files.map((file) => file.path))
      const removed = [...previous.keys()].filter((file) => !present.has(file))
      const documents = yield* io(() =>
        Promise.all(
          changed.map(async (file) => ({
            file,
            content: await MemoryFiles.read(file.path, file.root)
              .then((value) => value.bytes.toString("utf8"))
              .catch((error: unknown) => {
                if (missing(error)) return undefined
                throw error
              }),
          })),
        ),
      )
      const skipped = documents
        .filter((document) => document.content === undefined)
        .map((document) => document.file.path)
      yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const file of removed) {
            yield* sql`DELETE FROM memory_chunks WHERE path = ${file}`
            yield* sql`DELETE FROM memory_files WHERE path = ${file}`
            yield* sql`DELETE FROM memory_ranking WHERE path = ${file}`
          }
          for (const document of documents) {
            yield* sql`DELETE FROM memory_chunks WHERE path = ${document.file.path}`
            yield* sql`DELETE FROM memory_files WHERE path = ${document.file.path}`
            if (document.content === undefined) continue
            for (const chunk of chunks(document.content)) {
              yield* sql`INSERT INTO memory_ranking (path, start_line, created_at) VALUES (${document.file.path}, ${chunk.start}, ${Date.now()}) ON CONFLICT(path, start_line) DO NOTHING`
              yield* sql`INSERT INTO memory_chunks (tokens, content, path, source, start_line, end_line) VALUES (${tokenize(chunk.content).join(" ")}, ${chunk.content}, ${document.file.path}, ${document.file.source}, ${chunk.start}, ${chunk.end})`
            }
            yield* sql`DELETE FROM memory_ranking WHERE path = ${document.file.path} AND NOT EXISTS (SELECT 1 FROM memory_chunks WHERE memory_chunks.path = memory_ranking.path AND memory_chunks.start_line = memory_ranking.start_line)`
            yield* sql`INSERT INTO memory_files (path, signature) VALUES (${document.file.path}, ${document.file.signature})`
          }
        }),
      )
      if (
        (yield* io(() => MemoryMaintenance.revision(WorkspaceMemory.maintenance(input.directory, home, input)))) !==
        generation
      )
        return yield* new MemoryError({ message: "Memory was cleared during indexing; retry" })
      return { files: files.length, updated: documents.length, removed: removed.length, skipped }
    }).pipe(mutex.withPermit, Effect.mapError(toError))

  const resolve = Effect.fn("MemorySearch.resolve")(function* (file: string) {
    const target = path.resolve(
      file.startsWith("~/")
        ? path.join(home, file.slice(2))
        : path.isAbsolute(file)
          ? file
          : path.join(roots[1]!.path, file),
    )
    const root = roots.find((root) => MemoryFiles.allowed(root.path, target) || MemoryFiles.allowed(root.alias, target))
    if (!root)
      return yield* new MemoryError({ message: "Path is outside this repository's global/workspace memory files" })
    return MemoryFiles.allowed(root.path, target) ? target : path.join(root.path, path.relative(root.alias, target))
  })

  const get = Effect.fn("MemorySearch.get")(function* (input: {
    path: string
    from?: number | null
    lines?: number | null
  }) {
    const target = yield* resolve(input.path)
    const root = roots.find((root) => MemoryFiles.allowed(root.path, target))!
    const generation = yield* io(() => MemoryMaintenance.revision({ home, root: root.alias }))
    const text = yield* io(() => MemoryFiles.read(target, root).then((value) => value.bytes.toString("utf8")))
    if ((yield* io(() => MemoryMaintenance.revision({ home, root: root.alias }))) !== generation)
      return yield* new MemoryError({ message: "Memory was cleared during reading; retry" })
    const from = Math.max(1, input.from ?? 1)
    const selected = text
      ? text.split(/\r?\n/).slice(from - 1, input.lines == null ? undefined : from - 1 + input.lines)
      : []
    return {
      path: target,
      content: selected.map((line, index) => `${from + index}→${line}`).join("\n"),
      from,
      lines: selected.length,
    }
  })

  const search = Effect.fn("MemorySearch.search")(function* (
    input: {
      query: string
      max_results?: number | null
      min_score?: number | null
    },
    authorize?: (paths: string[]) => Effect.Effect<void, MemoryError>,
  ) {
    const revision = io(() => Promise.all(roots.map((root) => MemoryMaintenance.revision({ home, root: root.alias }))))
    const before = yield* revision
    const stats = yield* refresh(authorize)
    const query = [...new Set(tokenize(input.query))].map((word) => `"${word.replaceAll('"', '""')}"`).join(" OR ")
    const limit = Math.max(0, input.max_results ?? settings.max_results ?? 6)
    if (!query || !limit) return { results: [], skipped: stats.skipped }
    const candidates = yield* sql<{
      path: string
      source: Result["source"]
      start_line: number
      end_line: number
      content: string
      rank: number
    }>`SELECT path, source, start_line, end_line, content, bm25(memory_chunks) AS rank FROM memory_chunks WHERE memory_chunks MATCH ${query} ORDER BY rank, path, start_line LIMIT ${Math.min(Number.MAX_SAFE_INTEGER, limit * 3)}`
    const evergreen = yield* sql<
      (typeof candidates)[number]
    >`SELECT path, source, start_line, end_line, content, bm25(memory_chunks) AS rank FROM memory_chunks WHERE memory_chunks MATCH ${query} AND source IN ('global', 'workspace') ORDER BY rank, path, start_line LIMIT ${Math.min(Number.MAX_SAFE_INTEGER, limit * 3)}`
    const rows = [
      ...new Map([...candidates, ...evergreen].map((row) => [`${row.path}:${row.start_line}`, row])).values(),
    ]
    const metadata = new Map(
      (yield* sql<{
        path: string
        start_line: number
        created_at: number
        access_count: number
      }>`SELECT path, start_line, created_at, access_count FROM memory_ranking`).map((row) => [
        `${row.path}:${row.start_line}`,
        row,
      ]),
    )
    const best = Math.min(...rows.map((row) => row.rank))
    const range = Math.max(Math.max(...rows.map((row) => row.rank)) - best, Number.EPSILON)
    const halfLife =
      settings.temporal_decay?.enabled !== false
        ? (settings.temporal_decay?.half_life_days ?? 30)
        : settings.recency_decay &&
            settings.recency_decay !== 0.95 &&
            settings.recency_decay > 0 &&
            settings.recency_decay < 1
          ? -1 / Math.log2(settings.recency_decay)
          : 0
    const now = Date.now()
    const ranked = rows
      .map((row) => {
        const record = metadata.get(`${row.path}:${row.start_line}`)
        const age = Math.max(0, (now - (record?.created_at ?? now)) / 86400000)
        const decay = row.source === "session" && halfLife > 0 ? Math.pow(2, -age / halfLife) : 1
        const raw =
          (1 - (row.rank - best) / range) *
          decay *
          (settings.source_weights?.[row.source] ?? 1) *
          (1 + Math.log1p(record?.access_count ?? 0) * 0.05)
        return {
          raw,
          tokens: new Set(
            row.content
              .toLowerCase()
              .split(/[^\p{L}\p{N}_]+/u)
              .filter(Boolean),
          ),
          result: {
            path: row.path,
            source: row.source,
            start_line: Number(row.start_line),
            end_line: Number(row.end_line),
            score: Math.max(0, Math.min(1, raw)),
            snippet: row.content.slice(0, 2000),
            ...(row.source === "session" && age > 1
              ? {
                  staleness:
                    age > 7
                      ? `**Stale (${Math.round(age / 7)} week${Math.round(age / 7) === 1 ? "" : "s"} ago):** Verify current state before relying on this.`
                      : `**Note (${Math.floor(age)} day${Math.floor(age) === 1 ? "" : "s"} ago):** Verify this is still current.`,
                }
              : {}),
          },
        }
      })
      .filter((row) => row.result.score >= (input.min_score ?? settings.min_score ?? 0.7))
      .sort((a, b) => b.raw - a.raw)
    const selected: typeof ranked = []
    const lambda = Math.max(0, Math.min(1, settings.mmr?.lambda ?? 0.7))
    const minimum = Math.min(...ranked.map((row) => row.raw))
    const spread = Math.max(Math.max(...ranked.map((row) => row.raw)) - minimum, Number.EPSILON)
    while (ranked.length && selected.length < limit) {
      const scores = ranked.map((row) =>
        settings.mmr?.enabled === false || lambda === 1
          ? row.raw
          : (lambda * (row.raw - minimum)) / spread -
            (1 - lambda) *
              Math.max(
                0,
                ...selected.map((other) => {
                  const intersection = [...row.tokens].filter((token) => other.tokens.has(token)).length
                  return intersection / Math.max(1, row.tokens.size + other.tokens.size - intersection)
                }),
              ),
      )
      selected.push(...ranked.splice(scores.indexOf(Math.max(...scores)), 1))
    }
    const results = selected.map((row) => row.result)
    if ((yield* revision).join(":") !== before.join(":"))
      return yield* new MemoryError({ message: "Memory was cleared during search; retry" })
    yield* sql
      .withTransaction(
        Effect.forEach(
          results,
          (result) =>
            sql`UPDATE memory_ranking SET access_count = access_count + 1 WHERE path = ${result.path} AND start_line = ${result.start_line}`,
        ),
      )
      .pipe(Effect.ignore)
    return { results, skipped: stats.skipped }
  }, Effect.mapError(toError))

  return {
    roots: roots.map((root) => root.path),
    watching: subscriptions.some(Boolean),
    accessPaths: (files) => [
      ...new Set(
        files.flatMap((file) => {
          const root = roots.find((root) => MemoryFiles.allowed(root.path, file))
          return root ? [file, path.join(root.alias, path.relative(root.path, file))] : [file]
        }),
      ),
    ],
    refresh: refresh(),
    resolve,
    search,
    get,
  } satisfies Interface
}, Effect.mapError(toError))

function chunks(content: string) {
  const lines = content.split(/\r?\n/)
  return Array.from({ length: Math.ceil(lines.length / 80) }, (_, index) => {
    const window = lines.slice(index * 80, index * 80 + 80)
    const start =
      index * 80 +
      Math.max(
        0,
        window.findIndex((line) => line.trim()),
      )
    const end = Math.min((index + 1) * 80, lines.length)
    return { content: lines.slice(start, end).join("\n"), start: start + 1, end }
  }).filter((chunk) => chunk.content.replace(/^#+\s.*$/gm, "").trim())
}

function tokenize(text: string) {
  return Array.from(words.segment(text.normalize("NFKC")), (word) =>
    word.isWordLike ? word.segment.toLowerCase() : "",
  ).filter(Boolean)
}

function missing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

function toError(error: unknown) {
  return error instanceof MemoryError
    ? error
    : new MemoryError({ message: error instanceof Error ? error.message : String(error) })
}

function io<A>(run: () => Promise<A>) {
  return Effect.tryPromise({ try: run, catch: toError })
}

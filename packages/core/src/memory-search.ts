export * as MemorySearch from "./memory-search"

import { ConfigMemory } from "./config/memory"
import { layer } from "#sqlite"
import { watch } from "node:fs"
import { lstat, mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer, Option, Schema, Semaphore } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { Global } from "./global"
import { WorkspaceMemory } from "./workspace-memory"
import { MemoryEmbedding } from "./memory-embedding"
import { MemoryMaintenance } from "./memory-maintenance"
import { MemoryFiles } from "./memory-files"
import { MemoryV2 } from "./memory-v2"

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

export type SearchMode = "fts" | "hybrid"
export type SearchFallback = MemoryEmbedding.Reason

export type SemanticDuplicateResult =
  | {
      duplicate: true
      embeddingIdentity: string
      threshold: number
      similarity: number
      neighborPath: string
      neighborStartLine: number
      neighborFileHash: string
      neighborChunkHash: string
      candidateHash: string
    }
  | {
      duplicate: false
      embeddingIdentity?: string
      threshold: number
      maxSimilarity?: number
      fallback?: SearchFallback
    }

export type EmbeddingSource =
  | MemoryEmbedding.Client
  | (() => Effect.Effect<MemoryEmbedding.Client | undefined, MemoryEmbedding.Error | MemoryError>)

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
  ) => Effect.Effect<{ results: Result[]; skipped: string[]; mode: SearchMode; fallback?: SearchFallback }, MemoryError>
  readonly semanticDuplicate: (
    input: {
      content: string
      threshold?: number | null
    },
    authorize?: (paths: string[]) => Effect.Effect<void, MemoryError>,
  ) => Effect.Effect<SemanticDuplicateResult, MemoryError>
  readonly get: (input: {
    path: string
    from?: number | null
    lines?: number | null
  }) => Effect.Effect<{ path: string; content: string; from: number; lines: number }, MemoryError>
}

const words = new Intl.Segmenter("und", { granularity: "word" })
const VECTOR_PAGE_SIZE = 128

export const make = Effect.fn("MemorySearch.make")(function* (input: {
  directory: string
  projectID?: string
  home?: string
  search?: ConfigMemory.Search
  embedding?: EmbeddingSource
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
  yield* sql`CREATE TABLE IF NOT EXISTS memory_vectors (path TEXT NOT NULL, start_line INTEGER NOT NULL, content_hash TEXT NOT NULL, embedding_identity TEXT NOT NULL, dimensions INTEGER NOT NULL, vector TEXT NOT NULL, PRIMARY KEY(path, start_line))`
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

  const accessPaths = (files: string[]) => [
    ...new Set(
      files.flatMap((file) => {
        const root = roots.find((root) => MemoryFiles.allowed(root.path, file))
        return root ? [file, path.join(root.alias, path.relative(root.path, file))] : [file]
      }),
    ),
  ]

  const refreshUnlocked = (authorize?: (paths: string[]) => Effect.Effect<void, MemoryError>) =>
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
            yield* sql`DELETE FROM memory_vectors WHERE path = ${file}`
          }
          for (const document of documents) {
            yield* sql`DELETE FROM memory_chunks WHERE path = ${document.file.path}`
            yield* sql`DELETE FROM memory_files WHERE path = ${document.file.path}`
            if (document.content === undefined) {
              yield* sql`DELETE FROM memory_ranking WHERE path = ${document.file.path}`
              yield* sql`DELETE FROM memory_vectors WHERE path = ${document.file.path}`
              continue
            }
            for (const chunk of chunks(document.content)) {
              const contentHash = MemoryV2.hash(chunk.content)
              yield* sql`INSERT INTO memory_ranking (path, start_line, created_at) VALUES (${document.file.path}, ${chunk.start}, ${Date.now()}) ON CONFLICT(path, start_line) DO NOTHING`
              yield* sql`INSERT INTO memory_chunks (tokens, content, path, source, start_line, end_line) VALUES (${tokenize(chunk.content).join(" ")}, ${chunk.content}, ${document.file.path}, ${document.file.source}, ${chunk.start}, ${chunk.end})`
              yield* sql`DELETE FROM memory_vectors WHERE path = ${document.file.path} AND start_line = ${chunk.start} AND content_hash != ${contentHash}`
            }
            yield* sql`DELETE FROM memory_ranking WHERE path = ${document.file.path} AND NOT EXISTS (SELECT 1 FROM memory_chunks WHERE memory_chunks.path = memory_ranking.path AND memory_chunks.start_line = memory_ranking.start_line)`
            yield* sql`DELETE FROM memory_vectors WHERE path = ${document.file.path} AND NOT EXISTS (SELECT 1 FROM memory_chunks WHERE memory_chunks.path = memory_vectors.path AND memory_chunks.start_line = memory_vectors.start_line)`
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
    }).pipe(Effect.mapError(toError))

  const refresh = (authorize?: (paths: string[]) => Effect.Effect<void, MemoryError>) =>
    refreshUnlocked(authorize).pipe(mutex.withPermit, Effect.mapError(toError))

  const resolveEmbeddingClient = () =>
    Effect.gen(function* () {
      if (!input.embedding) return { client: undefined, fallback: undefined }
      if (typeof input.embedding !== "function") return { client: input.embedding, fallback: undefined }
      return yield* input.embedding().pipe(
        Effect.map((client) => ({ client, fallback: undefined })),
        Effect.catchIf(
          (error): error is MemoryEmbedding.Error => error instanceof MemoryEmbedding.Error,
          (error) => Effect.succeed({ client: undefined, fallback: error.reason }),
        ),
      )
    })

  const embedWithSync = (
    targetText: string,
    authorize: ((paths: string[]) => Effect.Effect<void, MemoryError>) | undefined,
    beforeRevisions: readonly string[],
  ) =>
    Effect.gen(function* () {
      const revision = io(() => Promise.all(roots.map((root) => MemoryMaintenance.revision({ home, root: root.alias }))))
      const resolved = yield* resolveEmbeddingClient()
      if (!resolved.client) {
        return {
          mode: "fts" as const,
          ...(resolved.fallback ? { fallback: resolved.fallback } : {}),
        }
      }
      const client = resolved.client
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM memory_vectors WHERE embedding_identity != ${client.identity} OR dimensions != ${client.dimensions}`
          yield* sql`DELETE FROM memory_vectors WHERE NOT EXISTS (SELECT 1 FROM memory_chunks WHERE memory_chunks.path = memory_vectors.path AND memory_chunks.start_line = memory_vectors.start_line)`
        }),
      )
      const chunkRows = yield* sql<{
        path: string
        start_line: number
        content: string
        cached_hash: string | null
        cached_identity: string | null
        cached_dimensions: number | null
      }>`SELECT c.path AS path, c.start_line AS start_line, c.content AS content, v.content_hash AS cached_hash, v.embedding_identity AS cached_identity, v.dimensions AS cached_dimensions FROM memory_chunks c LEFT JOIN memory_vectors v ON v.path = c.path AND v.start_line = c.start_line ORDER BY c.path ASC, c.start_line ASC`
      if (!chunkRows.length) {
        return {
          mode: "hybrid" as const,
          client,
          queryVector: undefined,
        }
      }
      const missing = chunkRows
        .map((row) => ({
          path: row.path,
          start_line: Number(row.start_line),
          content: row.content,
          contentHash: MemoryV2.hash(row.content),
          cachedHash: row.cached_hash,
          cachedIdentity: row.cached_identity,
          cachedDimensions: row.cached_dimensions === null ? null : Number(row.cached_dimensions),
        }))
        .filter(
          (row) =>
            row.cachedHash !== row.contentHash ||
            row.cachedIdentity !== client.identity ||
            row.cachedDimensions !== client.dimensions,
        )
      const fileSignatures = new Map(
        (yield* sql<{ path: string; signature: string }>`SELECT path, signature FROM memory_files`).map((file) => [
          file.path,
          file.signature,
        ]),
      )
      if ((yield* revision).join(":") !== beforeRevisions.join(":"))
        return yield* new MemoryError({ message: "Memory was cleared during search; retry" })
      if (authorize && fileSignatures.size) yield* authorize([...fileSignatures.keys()])

      const embedded = yield* client
        .embed([...missing.map((item) => item.content), targetText])
        .pipe(
          Effect.map((vectors) => ({ ok: true as const, vectors })),
          Effect.catchTag("MemoryEmbeddingError", (error) =>
            Effect.succeed({ ok: false as const, reason: error.reason }),
          ),
        )

      if ((yield* revision).join(":") !== beforeRevisions.join(":"))
        return yield* new MemoryError({ message: "Memory was cleared during search; retry" })
      const currentAfter = yield* io(() =>
        MemoryMaintenance.revision(WorkspaceMemory.maintenance(input.directory, home, input)),
      )
      if (currentAfter !== generation)
        return yield* new MemoryError({ message: "Memory was cleared during search; retry" })

      const afterClient = yield* resolveEmbeddingClient()
      const currentFiles = yield* io(() => MemoryFiles.list(roots))
      const allAuthorizedPaths = [...new Set([...fileSignatures.keys(), ...currentFiles.map((file) => file.path)])]
      if (authorize && allAuthorizedPaths.length) yield* authorize(allAuthorizedPaths)

      const currentSignatures = new Map(currentFiles.map((file) => [file.path, file.signature]))
      const filesChanged =
        currentSignatures.size !== fileSignatures.size ||
        [...fileSignatures.entries()].some(([filePath, sig]) => currentSignatures.get(filePath) !== sig)
      if (filesChanged) {
        changes.dirty = true
        yield* refreshUnlocked(authorize)
      }

      if (!embedded.ok) {
        return {
          mode: "fts" as const,
          fallback: embedded.reason,
        }
      }
      if (!afterClient.client || afterClient.client.identity !== client.identity) {
        return {
          mode: "fts" as const,
          fallback: afterClient.fallback ?? "unavailable_provider",
        }
      }

      if (missing.length) {
        yield* sql.withTransaction(
          Effect.gen(function* () {
            for (let index = 0; index < missing.length; index++) {
              const item = missing[index]!
              if (currentSignatures.get(item.path) !== fileSignatures.get(item.path)) continue
              const existing = yield* sql<{ content: string }>`SELECT content FROM memory_chunks WHERE path = ${item.path} AND start_line = ${item.start_line}`
              if (!existing[0] || MemoryV2.hash(existing[0].content) !== item.contentHash) continue
              yield* sql`INSERT INTO memory_vectors (path, start_line, content_hash, embedding_identity, dimensions, vector) VALUES (${item.path}, ${item.start_line}, ${item.contentHash}, ${client.identity}, ${client.dimensions}, ${JSON.stringify(embedded.vectors[index]!)}) ON CONFLICT(path, start_line) DO UPDATE SET content_hash = excluded.content_hash, embedding_identity = excluded.embedding_identity, dimensions = excluded.dimensions, vector = excluded.vector`
            }
          }),
        )
      }

      if ((yield* revision).join(":") !== beforeRevisions.join(":"))
        return yield* new MemoryError({ message: "Memory was cleared during search; retry" })

      return {
        mode: "hybrid" as const,
        client,
        queryVector: embedded.vectors[missing.length]!,
        filesChanged,
      }
    })

  const scanVectorNeighbors = (
    client: MemoryEmbedding.Client,
    queryVector: readonly number[],
    candidateLimit: number,
    includeEvergreen: boolean,
  ) =>
    Effect.gen(function* () {
      type Candidate = {
        path: string
        source: Result["source"]
        start_line: number
        end_line: number
        content: string
        similarity: number
      }
      const insertBounded = (list: Candidate[], item: Candidate) => {
        if (candidateLimit <= 0) return
        list.push(item)
        list.sort(
          (a, b) =>
            b.similarity - a.similarity || a.path.localeCompare(b.path) || a.start_line - b.start_line,
        )
        if (list.length > candidateLimit) list.length = candidateLimit
      }
      const topAll: Candidate[] = []
      const topEvergreen: Candidate[] = []
      let cursorPath = ""
      let cursorLine = -1
      while (true) {
        const page = yield* sql<{
          path: string
          source: Result["source"]
          start_line: number
          end_line: number
          content: string
          content_hash: string
          vector: string
        }>`SELECT v.path AS path, c.source AS source, v.start_line AS start_line, c.end_line AS end_line, c.content AS content, v.content_hash AS content_hash, v.vector AS vector FROM memory_vectors v INNER JOIN memory_chunks c ON c.path = v.path AND c.start_line = v.start_line WHERE v.embedding_identity = ${client.identity} AND v.dimensions = ${client.dimensions} AND (v.path > ${cursorPath} OR (v.path = ${cursorPath} AND v.start_line > ${cursorLine})) ORDER BY v.path ASC, v.start_line ASC LIMIT ${VECTOR_PAGE_SIZE}`
        if (!page.length) break
        for (const row of page) {
          cursorPath = row.path
          cursorLine = Number(row.start_line)
          if (MemoryV2.hash(row.content) !== row.content_hash) continue
          const parsed = parseVector(row.vector, client.dimensions)
          if (!parsed) continue
          const similarity = vectorSimilarity(queryVector, parsed)
          const candidate: Candidate = {
            path: row.path,
            source: row.source,
            start_line: Number(row.start_line),
            end_line: Number(row.end_line),
            content: row.content,
            similarity,
          }
          insertBounded(topAll, candidate)
          if (includeEvergreen && (row.source === "global" || row.source === "workspace")) {
            insertBounded(topEvergreen, candidate)
          }
        }
        if (page.length < VECTOR_PAGE_SIZE) break
      }
      return [
        ...new Map(
          [...topAll, ...topEvergreen].map((row) => [`${row.path}:${row.start_line}`, row]),
        ).values(),
      ]
    })

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
    return yield* Effect.gen(function* () {
      const revision = io(() => Promise.all(roots.map((root) => MemoryMaintenance.revision({ home, root: root.alias }))))
      const before = yield* revision
      const stats = yield* refreshUnlocked(authorize)
      const tokens = [...new Set(tokenize(input.query))]
      const query = tokens.map((word) => `"${word.replaceAll('"', '""')}"`).join(" OR ")
      const limit = Math.max(0, input.max_results ?? settings.max_results ?? 6)
      if (!query || !limit) return { results: [], skipped: stats.skipped, mode: "fts" as const }

      const embedded = yield* embedWithSync(input.query.trim(), authorize, before)
      const candidateLimit = Math.min(Number.MAX_SAFE_INTEGER, limit * 3)
      const candidates = yield* sql<{
        path: string
        source: Result["source"]
        start_line: number
        end_line: number
        content: string
        rank: number
      }>`SELECT path, source, start_line, end_line, content, bm25(memory_chunks) AS rank FROM memory_chunks WHERE memory_chunks MATCH ${query} ORDER BY rank, path, start_line LIMIT ${candidateLimit}`
      const evergreen = yield* sql<
        (typeof candidates)[number]
      >`SELECT path, source, start_line, end_line, content, bm25(memory_chunks) AS rank FROM memory_chunks WHERE memory_chunks MATCH ${query} AND source IN ('global', 'workspace') ORDER BY rank, path, start_line LIMIT ${candidateLimit}`
      const ftsRows = [
        ...new Map([...candidates, ...evergreen].map((row) => [`${row.path}:${row.start_line}`, row])).values(),
      ]
      const best = ftsRows.length ? Math.min(...ftsRows.map((row) => row.rank)) : 0
      const range = ftsRows.length
        ? Math.max(Math.max(...ftsRows.map((row) => row.rank)) - best, Number.EPSILON)
        : Number.EPSILON
      const ftsMap = new Map(
        ftsRows.map((row) => [
          `${row.path}:${row.start_line}`,
          {
            ...row,
            start_line: Number(row.start_line),
            end_line: Number(row.end_line),
            ftsScore: 1 - (row.rank - best) / range,
          },
        ]),
      )

      const vectorRows =
        embedded.mode === "hybrid" && embedded.queryVector
          ? yield* scanVectorNeighbors(embedded.client, embedded.queryVector, candidateLimit, true)
          : []
      const vecMap = new Map(vectorRows.map((row) => [`${row.path}:${row.start_line}`, row]))

      const allKeys = [...new Set([...ftsMap.keys(), ...vecMap.keys()])]
      if (!allKeys.length) {
        if ((yield* revision).join(":") !== before.join(":"))
          return yield* new MemoryError({ message: "Memory was cleared during search; retry" })
        return {
          results: [],
          skipped: stats.skipped,
          mode: embedded.mode,
          ...(embedded.mode === "fts" && embedded.fallback ? { fallback: embedded.fallback } : {}),
        }
      }

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
      const halfLife =
        settings.temporal_decay?.enabled !== false
          ? (settings.temporal_decay?.half_life_days ?? 30)
          : settings.recency_decay &&
              settings.recency_decay !== 0.95 &&
              settings.recency_decay > 0 &&
              settings.recency_decay < 1
            ? -1 / Math.log2(settings.recency_decay)
            : 0
      const vectorWeight = settings.vector_weight ?? 0.7
      const textWeight = settings.text_weight ?? 0.3
      const now = Date.now()
      const ranked = allKeys
        .map((key) => {
          const fts = ftsMap.get(key)
          const vec = vecMap.get(key)
          const row = (fts ?? vec)!
          const record = metadata.get(key)
          const age = Math.max(0, (now - (record?.created_at ?? now)) / 86400000)
          const decay = row.source === "session" && halfLife > 0 ? Math.pow(2, -age / halfLife) : 1
          const relevance =
            fts && vec
              ? Math.max(fts.ftsScore, textWeight * fts.ftsScore + vectorWeight * vec.similarity)
              : fts
                ? fts.ftsScore
                : vectorWeight * vec!.similarity
          const raw =
            relevance *
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
        .sort((a, b) => b.raw - a.raw || a.result.path.localeCompare(b.result.path) || a.result.start_line - b.result.start_line)
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
      return {
        results,
        skipped: stats.skipped,
        mode: embedded.mode,
        ...(embedded.mode === "fts" && embedded.fallback ? { fallback: embedded.fallback } : {}),
      }
    }).pipe(mutex.withPermit, Effect.mapError(toError))
  }, Effect.mapError(toError))

  const semanticDuplicate = Effect.fn("MemorySearch.semanticDuplicate")(function* (
    input: {
      content: string
      threshold?: number | null
    },
    authorize?: (paths: string[]) => Effect.Effect<void, MemoryError>,
  ) {
    return yield* Effect.gen(function* () {
      const threshold = input.threshold ?? 0.92
      const candidate = input.content.trim()
      if (!candidate) return { duplicate: false as const, threshold }
      const revision = io(() => Promise.all(roots.map((root) => MemoryMaintenance.revision({ home, root: root.alias }))))
      const before = yield* revision
      yield* refreshUnlocked(authorize)
      const embedded = yield* embedWithSync(candidate, authorize, before)
      if (embedded.mode !== "hybrid") {
        return {
          duplicate: false as const,
          threshold,
          ...(embedded.fallback ? { fallback: embedded.fallback } : {}),
        }
      }
      if (embedded.filesChanged) {
        return yield* new MemoryError({ message: "Matched memory file changed during duplicate check; retry" })
      }
      if (!embedded.queryVector) {
        return {
          duplicate: false as const,
          embeddingIdentity: embedded.client.identity,
          threshold,
        }
      }
      const neighbors = yield* scanVectorNeighbors(embedded.client, embedded.queryVector, 3, false)
      if ((yield* revision).join(":") !== before.join(":"))
        return yield* new MemoryError({ message: "Memory was cleared during duplicate check; retry" })
      const best = neighbors[0]
      if (!best || best.similarity <= threshold) {
        return {
          duplicate: false as const,
          embeddingIdentity: embedded.client.identity,
          threshold,
          ...(best ? { maxSimilarity: best.similarity } : {}),
        }
      }
      if (authorize) yield* authorize(accessPaths([best.path]))
      const root = roots.find((item) => MemoryFiles.allowed(item.path, best.path))
      if (!root) return yield* new MemoryError({ message: "Matched memory file is outside allowed roots" })
      const diskText = yield* io(() => MemoryFiles.read(best.path, root).then((value) => value.bytes.toString("utf8")))
      const matchingChunk = chunks(diskText).find((item) => item.start === best.start_line)
      const neighborChunkHash = MemoryV2.hash(best.content)
      if (!matchingChunk || MemoryV2.hash(matchingChunk.content) !== neighborChunkHash)
        return yield* new MemoryError({ message: "Matched memory file changed during duplicate check; retry" })
      if ((yield* revision).join(":") !== before.join(":"))
        return yield* new MemoryError({ message: "Memory was cleared during duplicate check; retry" })
      return {
        duplicate: true as const,
        embeddingIdentity: embedded.client.identity,
        threshold,
        similarity: best.similarity,
        neighborPath: best.path,
        neighborStartLine: best.start_line,
        neighborFileHash: MemoryV2.hash(diskText),
        neighborChunkHash,
        candidateHash: MemoryV2.hash(candidate),
      }
    }).pipe(mutex.withPermit, Effect.mapError(toError))
  }, Effect.mapError(toError))

  return {
    roots: roots.map((root) => root.path),
    watching: subscriptions.some(Boolean),
    accessPaths,
    refresh: refresh(),
    resolve,
    search,
    semanticDuplicate,
    get,
  } satisfies Interface
}, Effect.mapError(toError))

export function chunks(content: string) {
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

export function vectorSimilarity(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length || !a.length) return 0
  let sumSquares = 0
  for (let index = 0; index < a.length; index++) {
    const diff = a[index]! - b[index]!
    sumSquares += diff * diff
  }
  return Math.max(0, Math.min(1, 1 - Math.sqrt(sumSquares) / 2))
}

function parseVector(raw: string, expectedDimensions: number): readonly number[] | undefined {
  const decoded = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(raw)
  if (Option.isNone(decoded) || !Array.isArray(decoded.value) || decoded.value.length !== expectedDimensions)
    return undefined
  for (const item of decoded.value) {
    if (typeof item !== "number" || !Number.isFinite(item)) return undefined
  }
  return decoded.value as readonly number[]
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

export * as MemoryV2Notes from "./memory-v2-notes"

import { randomUUID } from "node:crypto"
import { lstat } from "node:fs/promises"
import path from "node:path"
import { Effect, Stream } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { MemoryNote } from "@apexo/schema/memory-note"
import { MemoryCatalog } from "./memory-catalog"
import { MemoryV2 } from "./memory-v2"
import { MemoryManifest } from "./memory-manifest"
import { MemoryV2Scan } from "./memory-v2-scan"

export type Access = (relative: string, action: "read" | "edit") => boolean
export type Row = { path: string; content: string; content_hash: string; state: string; is_exposed: number }

// All operations run under the scope lock owned by MemoryCapture. The journal
// is shared with capture so a clear can fence a live worker in another process.
export function make(root: MemoryV2.Root, sql: SqlClient.SqlClient, compact = false) {
  const initialize = Effect.gen(function* () {
    yield* sql`CREATE TABLE IF NOT EXISTS memory_imports (source_key TEXT NOT NULL, source_hash TEXT NOT NULL, generation TEXT NOT NULL, path TEXT NOT NULL, content_hash TEXT NOT NULL, PRIMARY KEY(source_key, source_hash))`
    yield* sql`CREATE TABLE IF NOT EXISTS memory_notes (path TEXT PRIMARY KEY, content TEXT NOT NULL, content_hash TEXT NOT NULL, state TEXT NOT NULL, is_exposed INTEGER NOT NULL)`
    yield* sql`CREATE TABLE IF NOT EXISTS memory_tombstones (path TEXT PRIMARY KEY, content_hash TEXT NOT NULL, settled INTEGER NOT NULL DEFAULT 0)`
    yield* sql`CREATE TABLE IF NOT EXISTS memory_v2_topic_reads (relative_path TEXT PRIMARY KEY, read_count INTEGER NOT NULL, last_read_at INTEGER NOT NULL)`
    yield* sql`INSERT OR IGNORE INTO capture_meta VALUES ('generation', 'initial')`
    yield* sql`INSERT OR IGNORE INTO capture_meta VALUES ('clear_cutoff', '0')`
  })
  const revision = sql<{ value: string }>`SELECT value FROM capture_meta WHERE key = 'generation'`.pipe(
    Effect.map((rows) => rows[0]!.value),
  )
  const importLegacy = (
    input: { sourceKey: string; sourceHash: string; generation: string; content: string },
    access: Access,
  ) =>
    Effect.gen(function* () {
      if (MemoryV2.hash(input.content) !== input.sourceHash || Buffer.byteLength(input.content) > 256 * 1024)
        return yield* error("changed", "Legacy migration source changed")
      const existing = (yield* sql<{
        path: string
        generation: string
      }>`SELECT path, generation FROM memory_imports WHERE source_key = ${input.sourceKey} AND source_hash = ${input.sourceHash}`)[0]
      // Retained journals survive clear/forget: an exact old import never resurrects it.
      if (existing) return { path: existing.path, imported: false }
      if ((yield* revision) !== input.generation)
        return yield* error("changed", "Memory generation changed after migration preview")
      const cleared = (yield* sql<{ value: string }>`SELECT value FROM capture_meta WHERE key = 'clear_cutoff'`)[0]
      if (cleared && Number(cleared.value) > 0)
        return yield* error("changed", "A cleared scope cannot import retained historical notes")
      const content = input.content.replace(/<!--[\s\S]*?(?:-->|$)/g, "").trim()
      if (!content || /^(?:# Memory\s*)?(?:Add project-specific knowledge here[.\s]*)?$/i.test(content))
        return { path: "", imported: false }
      const relative = `topics/legacy-${MemoryV2.hash(input.sourceKey).slice(0, 16)}-${input.sourceHash.slice(0, 16)}.md`
      if (!access(relative, "read") || !access(relative, "edit"))
        return yield* error("forbidden", "Importing legacy Memory is not permitted")
      if ((yield* sql`SELECT path FROM memory_tombstones WHERE path = ${relative}`).length)
        return yield* error("changed", "A deleted topic cannot be restored by migration")
      const current = yield* io(() => MemoryV2.read(root, relative, 256 * 1024))
      if (current !== undefined && current !== content)
        return yield* error("changed", "Migration destination already contains different data")
      yield* sql`INSERT INTO memory_notes (path, content, content_hash, state, is_exposed) VALUES (${relative}, ${content}, ${MemoryV2.hash(content)}, 'pending', 1) ON CONFLICT(path) DO NOTHING`
      yield* sql`INSERT INTO memory_imports (source_key, source_hash, generation, path, content_hash) VALUES (${input.sourceKey}, ${input.sourceHash}, ${input.generation}, ${relative}, ${MemoryV2.hash(content)})`
      return { path: relative, imported: true }
    })
  const hidden = Effect.gen(function* () {
    const rows = yield* sql<{
      path: string
    }>`SELECT path FROM memory_tombstones UNION SELECT source AS path FROM dream_archives UNION SELECT f.path FROM capture_files f JOIN capture_jobs j USING(job_id) WHERE j.is_exposed = 0 OR f.state NOT IN ('pending', 'live') UNION SELECT path FROM memory_notes WHERE is_exposed = 0 OR state IN ('deleted', 'archived')`
    return new Set(rows.map((row) => row.path))
  })
  const settleTombstones = (targets: ReadonlyArray<{ path: string; hash: string }>) =>
    sql.withTransaction(
      Effect.gen(function* () {
        for (const target of targets) {
          const current = (yield* sql<{
            content_hash: string
            settled: number
          }>`SELECT content_hash, settled FROM memory_tombstones WHERE path = ${target.path}`)[0]
          if (!current || current.content_hash !== target.hash)
            return yield* error("changed", "Memory deletion journal no longer matches its original action")
          if (current.settled === 1) continue
          yield* io(() => MemoryV2.remove(root, target.path, target.hash))
          yield* sql`UPDATE memory_tombstones SET settled = 1 WHERE path = ${target.path} AND content_hash = ${target.hash}`
        }
      }),
    )
  const recover = Effect.gen(function* () {
    while (true) {
      const tombstones = yield* sql<{
        path: string
        content_hash: string
      }>`SELECT path, content_hash FROM memory_tombstones WHERE settled = 0 ORDER BY path LIMIT 256`
      if (!tombstones.length) break
      yield* settleTombstones(tombstones.map((item) => ({ path: item.path, hash: item.content_hash })))
    }
    while (true) {
      const pending = yield* sql<Row>`SELECT * FROM memory_notes WHERE state = 'pending' ORDER BY path LIMIT 256`
      if (!pending.length) break
      yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const item of pending) {
            yield* io(() => MemoryV2.publish(root, item.path, item.content, true))
            yield* sql`UPDATE memory_notes SET state = 'live' WHERE path = ${item.path}`
          }
        }),
      )
    }
    const excluded = yield* hidden
    const captured = new Set((yield* sql<{ path: string }>`SELECT path FROM capture_files`).map((row) => row.path))
    const files = yield* io(() => MemoryV2Scan.discover(root, excluded))
    for (const file of files) {
      if (excluded.has(file) || captured.has(file)) continue
      const content = yield* io(() =>
        MemoryV2.read(root, file, file.startsWith("topics/") ? 256 * 1024 : 64 * 1024),
      ).pipe(Effect.result)
      if (content._tag === "Failure" || content.success === undefined) continue
      yield* sql`INSERT INTO memory_notes (path, content, content_hash, state, is_exposed) VALUES (${file}, ${content.success}, ${MemoryV2.hash(content.success)}, 'live', 1) ON CONFLICT(path) DO UPDATE SET content = excluded.content, content_hash = excluded.content_hash, state = 'live' WHERE memory_notes.state != 'deleted'`
    }
    const live =
      yield* sql<Row>`SELECT * FROM memory_notes WHERE state = 'live' ORDER BY path NOT LIKE 'topics/%', path LIMIT ${MemoryV2Scan.maxFiles}`
    for (const item of live) {
      const content = yield* io(() =>
        MemoryV2.read(root, item.path, item.path.startsWith("topics/") ? 256 * 1024 : 64 * 1024),
      ).pipe(Effect.result)
      if (content._tag === "Failure" || content.success === undefined)
        yield* sql`UPDATE memory_notes SET state = 'missing' WHERE path = ${item.path}`
    }
  })
  const visible = sql<Row>`SELECT * FROM memory_notes WHERE state = 'live' AND is_exposed = 1 ORDER BY path NOT LIKE 'topics/%', path LIMIT ${MemoryV2Scan.maxFiles}`
  const inspect = (relative: string, access: Access) =>
    Effect.gen(function* () {
      if (!allowed(relative)) return yield* error("forbidden", "Path is outside this scope's memory notes")
      if (!access(relative, "read")) return yield* error("forbidden", "Reading this memory is not permitted")
      if ((yield* hidden).has(relative)) return yield* error("not_found", "Memory note not found")
      const file = yield* io(() => MemoryV2.validate(root, relative))
      const info = yield* io(() => lstat(file))
      return {
        path: file,
        name: relative,
        source: root.scope,
        size: info.size,
        modified: info.mtimeMs,
        deletable: relative !== "MEMORY.md" && info.size <= 256 * 1024 && access(relative, "edit"),
      } satisfies MemoryNote.Summary
    })
  const preview = (relative: string, access: Access) =>
    Effect.gen(function* () {
      const summary = yield* inspect(relative, access)
      const value = yield* io(() => MemoryV2.preview(root, relative, 256 * 1024))
      if (!value) return yield* error("not_found", "Memory note not found")
      return { ...summary, ...value, deletable: summary.deletable && !value.truncated } satisfies MemoryNote.Detail
    })
  const list = (query: string, access: Access) =>
    Effect.gen(function* () {
      const terms = query.normalize("NFKC").toLowerCase().split(/\s+/u).filter(Boolean)
      const excluded = yield* hidden
      const files = yield* io(() => MemoryV2Scan.discover(root, excluded))
      const notes: MemoryNote.Summary[] = []
      for (const file of files) {
        if (excluded.has(file) || !access(file, "read")) continue
        const note = yield* inspect(file, access)
        if (terms.length) {
          const value = yield* preview(file, access)
          const text = `${file}\n${value.content}`.normalize("NFKC").toLowerCase()
          if (!terms.every((term) => text.includes(term))) continue
        }
        notes.push(note)
      }
      const counts = yield* readCounts
      notes.sort((a, b) =>
        MemoryManifest.compare(
          { path: a.name, content: "", modified: a.modified, readCount: counts.get(a.name) ?? 0 },
          { path: b.name, content: "", modified: b.modified, readCount: counts.get(b.name) ?? 0 },
          compact,
        ),
      )
      if (notes.length && !terms.length && access("MEMORY.md", "read")) {
        const manifest = yield* inspect("MEMORY.md", access).pipe(Effect.result)
        if (manifest._tag === "Success") notes.push(manifest.success)
      }
      return notes
    })
  const remember = (content: string, access: Access, exposed: boolean) =>
    Effect.gen(function* () {
      if (!content.trim() || Buffer.byteLength(content) > 64 * 1024)
        return yield* error("invalid", "A manual observation must contain 1–65536 UTF-8 bytes")
      const relative = `observations/_inbox/remember-${randomUUID()}.md`
      if (!access(relative, "read") || !access(relative, "edit"))
        return yield* error("forbidden", "Saving this memory is not permitted")
      yield* sql`INSERT INTO memory_notes (path, content, content_hash, state, is_exposed) VALUES (${relative}, ${content}, ${MemoryV2.hash(content)}, 'pending', ${exposed ? 1 : 0})`
      return { path: path.join(root.path, relative) }
    })
  const forget = <E>(relative: string, hash: string, access: Access, before: Effect.Effect<void, E> = Effect.void) =>
    Effect.gen(function* () {
      if (relative === "MEMORY.md") return yield* error("not_deletable", "The generated memory index is protected")
      const value = yield* preview(relative, access)
      if (!access(relative, "edit")) return yield* error("forbidden", "Deleting this memory is not permitted")
      if (value.truncated || value.hash !== hash)
        return yield* error("changed", "This note changed after preview; read it again before deleting")
      yield* before
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`INSERT INTO memory_tombstones (path, content_hash) VALUES (${relative}, ${hash}) ON CONFLICT(path) DO NOTHING`
          yield* sql`UPDATE capture_files SET state = 'deleted', content = '' WHERE path = ${relative}`
          yield* sql`UPDATE memory_notes SET state = 'deleted', content = '' WHERE path = ${relative}`
          yield* sql`DELETE FROM capture_fts WHERE path = ${relative}`
          yield* sql`DELETE FROM dream_deferrals WHERE path = ${relative}`
          yield* sql`UPDATE capture_meta SET value = ${randomUUID()} WHERE key = 'generation'`
        }),
      )
      yield* recover
      return true
    })
  const prepareClear = (files?: ReadonlyArray<{ path: string; hash: string }>) =>
    Effect.gen(function* () {
      const targets = { count: 0 }
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const stage = (file: string, hash: string) =>
            Effect.gen(function* () {
              yield* sql`INSERT INTO memory_tombstones (path, content_hash, settled) VALUES (${file}, ${hash}, 0) ON CONFLICT(path) DO UPDATE SET content_hash = excluded.content_hash, settled = 0`
              targets.count++
            })
          if (files) yield* Effect.forEach(files, (file) => stage(file.path, file.hash), { discard: true })
          if (!files)
            yield* Stream.fromAsyncIterable(MemoryV2Scan.walk(root, { archives: true }), (cause) =>
              error("failed", String(cause)),
            ).pipe(
              Stream.runForEach((file) =>
                Effect.gen(function* () {
                  const content = yield* io(() => MemoryV2.fingerprint(root, file))
                  if (content) yield* stage(file, content.hash)
                }),
              ),
            )
          yield* sql`UPDATE capture_meta SET value = ${randomUUID()} WHERE key = 'generation'`
          yield* sql`UPDATE capture_meta SET value = ${String(Date.now())} WHERE key = 'clear_cutoff'`
          yield* sql`DELETE FROM capture_files`
          yield* sql`DELETE FROM memory_notes`
          yield* sql`DELETE FROM memory_v2_topic_reads`
          yield* sql`DELETE FROM dream_batch_state`
          yield* sql`DELETE FROM dream_deferrals`
          yield* sql`DELETE FROM dream_runs`
          yield* sql`DELETE FROM dream_ownership`
          yield* sql`DELETE FROM dream_provenance`
          yield* sql`DELETE FROM dream_archives`
          yield* sql`DELETE FROM dream_shadow`
          yield* sql`DELETE FROM memory_gc_archives`
          yield* sql`DELETE FROM capture_meta WHERE key IN ('last_dream_success_at', 'dream_trigger_pending')`
          // Keep content-free admissions and monotonic cursors. Old transcript
          // messages cannot be re-admitted when a still-open session next wakes.
          yield* sql`DELETE FROM capture_jobs`
          yield* sql`DELETE FROM capture_outcomes`
          yield* sql`DELETE FROM capture_fts`
          yield* sql`UPDATE capture_sessions SET captured = requested, indexed = requested`
        }),
      )
      return targets.count
    })
  const clear = prepareClear().pipe(Effect.tap(() => recover))
  const readCounts = sql<{
    relative_path: string
    read_count: number
  }>`SELECT relative_path, read_count FROM memory_v2_topic_reads`.pipe(
    Effect.map((rows) => new Map(rows.map((row) => [row.relative_path, row.read_count]))),
    Effect.catchCause(() => Effect.succeed(new Map<string, number>())),
  )
  const manifest = (access: Access) =>
    Effect.gen(function* () {
      const excluded = yield* hidden
      const captured = new Map(
        (yield* sql<{
          path: string
          content_hash: string
          state: string
        }>`SELECT path, content_hash, state FROM capture_files`).map((row) => [row.path, row]),
      )
      const counts = yield* readCounts
      const budget = MemoryManifest.budget(compact)
      const source = { entries: [] as MemoryManifest.Entry[], filtered: false }
      const candidates: MemoryManifest.Entry[] = []
      for (const file of yield* io(() => MemoryV2Scan.discover(root, excluded))) {
        if (excluded.has(file)) continue
        if (!access(file, "read")) {
          source.filtered = true
          continue
        }
        const capture = captured.get(file)
        if (capture && capture.state !== "live") continue
        if (!budget.includeObservations && !file.startsWith("topics/")) continue
        const info = yield* io(() => lstat(path.join(root.path, file))).pipe(Effect.result)
        if (info._tag === "Failure" || !info.success.isFile()) continue
        candidates.push({
          path: file,
          content: "",
          modified: info.success.mtimeMs,
          readCount: counts.get(file) ?? 0,
        })
      }
      for (const entry of candidates.sort((a, b) => MemoryManifest.compare(a, b, compact))) {
        const capture = captured.get(entry.path)
        // The renderer can use at most 64/512 entries. Unselected manual files
        // only contribute to the omitted count, so avoid opening every body.
        // Captured observations still need integrity checks before counting.
        if (source.entries.length < budget.maxEntries || capture) {
          const value = yield* io(() => MemoryV2.preview(root, entry.path, 64 * 1024)).pipe(Effect.result)
          if (value._tag === "Failure" || !value.success) continue
          if (capture && capture.content_hash !== value.success.hash) continue
          entry.content = value.success.content
        }
        source.entries.push(entry)
      }
      return {
        ...MemoryManifest.render(root, source.entries, budget),
        filtered: source.filtered,
      }
    })
  const context = (access: Access) =>
    Effect.gen(function* () {
      if (!access("MEMORY.md", "read")) return yield* error("forbidden", "Reading the memory index is not permitted")
      const snapshot = yield* manifest(access)
      // A permission-filtered view must never replace the shared scope index.
      if (!snapshot.filtered && access("MEMORY.md", "edit") && access("memory_state.sqlite", "edit"))
        yield* io(() => MemoryV2.publish(root, "MEMORY.md", snapshot.content, false))
      return {
        generation: yield* revision,
        content: snapshot.content,
        paths: snapshot.paths.map((file) => path.join(root.path, file)),
      }
    })
  return {
    initialize,
    importLegacy,
    recover,
    visible,
    revision,
    list,
    preview,
    remember,
    forget,
    clear,
    prepareClear,
    settleTombstones,
    context,
    manifest,
  }
}

function allowed(relative: string) {
  return relative === "MEMORY.md" || /^(topics|observations)\/(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\\]+\.md$/.test(relative)
}

function error(reason: MemoryCatalog.Error["reason"], message: string) {
  return new MemoryCatalog.Error({ reason, message })
}

function io<A>(run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      cause instanceof MemoryCatalog.Error
        ? cause
        : error(
            typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT"
              ? "not_found"
              : "failed",
            String(cause),
          ),
  })
}

export * as MemoryRetention from "./memory-retention"

import { Effect, Schema } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { MemoryV2 } from "./memory-v2"
import type { MemoryV2Notes } from "./memory-v2-notes"

export class RetentionError extends Schema.TaggedErrorClass<RetentionError>()("MemoryRetentionError", {
  reason: Schema.Literals(["invalid", "busy", "denied", "conflict", "storage"]),
  message: Schema.String,
}) {}
export type Policy = { archivedDays: number; jobDays: number }
export type Result = { archives: number; jobs: number }
type Archive = { source: string; path: string; content_hash: string }

// The caller holds MemoryCapture's scope lock. Files are removed only after a
// durable, content-free journal exists; interruption can resume without a model.
export function make(root: MemoryV2.Root, sql: SqlClient.SqlClient) {
  const initialize = sql`CREATE TABLE IF NOT EXISTS memory_gc_archives (source TEXT PRIMARY KEY, path TEXT NOT NULL, content_hash TEXT NOT NULL)`
  const permitted = (item: Archive, access: MemoryV2Notes.Access) =>
    Effect.gen(function* () {
      if (!/^archive\/[^/]+\.md$/.test(item.path) || !/^observations\/_inbox\/[^/]+\.md$/.test(item.source))
        return yield* new RetentionError({ reason: "invalid", message: "Invalid retained observation path" })
      if ([item.path, item.source].some((file) => !access(file, "read") || !access(file, "edit")))
        return yield* new RetentionError({ reason: "denied", message: "Memory retention access denied" })
      const value = yield* io(() => MemoryV2.preview(root, item.path, 256 * 1024))
      if (value && (value.truncated || value.hash !== item.content_hash))
        return yield* new RetentionError({ reason: "conflict", message: "An archived observation was edited" })
    })
  const remove = (item: Archive) =>
    Effect.gen(function* () {
      yield* io(() => MemoryV2.remove(root, item.path, item.content_hash))
      yield* sql.withTransaction(
        Effect.gen(function* () {
          // Keep the source suppressed even if its old filename is recreated.
          yield* sql`INSERT OR IGNORE INTO memory_tombstones (path, content_hash, settled) VALUES (${item.source}, ${item.content_hash}, 1)`
          yield* sql`DELETE FROM capture_fts WHERE path = ${item.source}`
          yield* sql`DELETE FROM capture_files WHERE path = ${item.source} AND state = 'archived'`
          yield* sql`DELETE FROM memory_notes WHERE path = ${item.source} AND state = 'archived'`
          yield* sql`DELETE FROM dream_shadow WHERE path = ${item.source}`
          yield* sql`DELETE FROM dream_deferrals WHERE path = ${item.source}`
          yield* sql`DELETE FROM dream_archives WHERE source = ${item.source}`
          yield* sql`DELETE FROM memory_gc_archives WHERE source = ${item.source}`
        }),
      )
    })
  const gc = (now: number, policy: Policy, access: MemoryV2Notes.Access) =>
    Effect.gen(function* () {
      if (
        !Number.isSafeInteger(now) ||
        now < 0 ||
        [policy.archivedDays, policy.jobDays].some(
          (days) => !Number.isSafeInteger(days) || days < 0 || !Number.isSafeInteger(days * 86400_000),
        )
      )
        return yield* new RetentionError({ reason: "invalid", message: "Invalid memory retention period" })
      if (["memory_state.sqlite", "MEMORY.md"].some((file) => !access(file, "read") || !access(file, "edit")))
        return yield* new RetentionError({ reason: "denied", message: "Memory retention access denied" })
      if (
        (yield* sql`SELECT id FROM dream_runs WHERE status != 'completed' AND (expires > ${now} OR changes IS NOT NULL) LIMIT 1`)
          .length
      )
        return yield* new RetentionError({ reason: "busy", message: "Dream must finish or recover before retention" })

      const pending = yield* sql<Archive>`SELECT * FROM memory_gc_archives ORDER BY source LIMIT 257`
      if (pending.length > 256)
        return yield* new RetentionError({ reason: "invalid", message: "Memory retention journal exceeds its bound" })
      for (const item of pending) yield* permitted(item, access)
      for (const item of pending) yield* remove(item)
      const archives =
        yield* sql<Archive>`SELECT source, path, content_hash FROM dream_archives WHERE archived_at <= ${now - policy.archivedDays * 86400_000} ORDER BY archived_at, source LIMIT ${256 - pending.length}`
      for (const item of archives) yield* permitted(item, access)
      yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const item of archives)
            yield* sql`INSERT INTO memory_gc_archives VALUES (${item.source}, ${item.path}, ${item.content_hash})`
        }),
      )
      for (const item of archives) yield* remove(item)

      const jobs = yield* sql<{
        job_id: string
      }>`SELECT j.job_id FROM capture_jobs j JOIN capture_sessions s USING(session_id) WHERE j.terminal_at <= ${now - policy.jobDays * 86400_000} AND (j.status = 'completed' OR (j.status = 'failed' AND j.terminal = 1)) AND j.through_turn <= s.indexed AND NOT EXISTS (SELECT 1 FROM capture_files f WHERE f.job_id = j.job_id AND f.state IN ('pending', 'live')) ORDER BY j.terminal_at, j.job_id LIMIT 256`
      yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const job of jobs) {
            const files = yield* sql<{
              path: string
              content_hash: string
            }>`SELECT path, content_hash FROM capture_files WHERE job_id = ${job.job_id}`
            if (files.some((file) => !access(file.path, "read") || !access(file.path, "edit")))
              return yield* new RetentionError({ reason: "denied", message: "Memory job retention access denied" })
            for (const file of files) {
              yield* sql`INSERT OR IGNORE INTO memory_tombstones (path, content_hash, settled) VALUES (${file.path}, ${file.content_hash}, 1)`
              yield* sql`DELETE FROM capture_fts WHERE path = ${file.path}`
              yield* sql`DELETE FROM dream_shadow WHERE path = ${file.path}`
            }
            yield* sql`DELETE FROM capture_files WHERE job_id = ${job.job_id}`
            yield* sql`DELETE FROM capture_outcomes WHERE job_id = ${job.job_id}`
            yield* sql`DELETE FROM capture_jobs WHERE job_id = ${job.job_id}`
          }
        }),
      )
      return { archives: pending.length + archives.length, jobs: jobs.length } satisfies Result
    })
  return { initialize, gc }
}

function io<A>(run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: () => new RetentionError({ reason: "storage", message: "Memory retention filesystem operation failed" }),
  })
}

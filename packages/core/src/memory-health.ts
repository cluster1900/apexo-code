export * as MemoryHealth from "./memory-health"

import { lstat, realpath } from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer, Schema } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { MemoryHealth } from "@apexo/schema/memory-health"
import { layer } from "#sqlite"
import { MemoryV2 } from "./memory-v2"
import { MemoryFilesystem } from "./memory-filesystem"
import type { MemoryCatalog } from "./memory-catalog"
import { Flock } from "./util/flock"

export { Info } from "@apexo/schema/memory-health"

// A diagnostic read must not reconcile notes, reclaim Dream leases, initialize
// a missing store, or turn an unreadable database into plausible zero counts.
export const inspect = Effect.fn("MemoryHealth.inspect")(
  function* (input: MemoryCatalog.Location, scope: "global" | "workspace", now: number) {
    if (!Number.isSafeInteger(now) || now < 0)
      return { scope, state: "unavailable", reason: "storage" } satisfies MemoryHealth.Scope
    const home = yield* Effect.tryPromise(() => realpath(input.home))
    const root: MemoryV2.Root = {
      home,
      path: MemoryV2.directory({ ...input, home, scope }),
      scope,
      locks: path.join(home, ".grok", "memory-v2", "apexo", ".locks"),
    }
    const alias = MemoryV2.directory({ ...input, scope })
    const permitted = (relative: string) =>
      input.permitted([path.join(root.path, relative), path.join(alias, relative)], "read")
    if (!permitted("memory_state.sqlite")) return { scope, state: "denied" } satisfies MemoryHealth.Scope
    const exists = yield* Effect.tryPromise(() =>
      lstat(root.path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      }),
    )
    if (!exists) return { scope, state: "empty" } satisfies MemoryHealth.Scope
    yield* Effect.tryPromise(() => MemoryFilesystem.requireLocal(root.path))
    yield* Effect.tryPromise(() => MemoryFilesystem.requireLocal(root.locks))
    const valid = yield* Effect.tryPromise(async () => {
      for (const relative of ["memory_state.sqlite", "memory_state.sqlite-wal", "memory_state.sqlite-shm"])
        await MemoryV2.validate(root, relative)
    }).pipe(Effect.result)
    if (valid._tag === "Failure") return { scope, state: "unavailable", reason: "path" } satisfies MemoryHealth.Scope
    const file = path.join(root.path, "memory_state.sqlite")
    const before = yield* Effect.tryPromise(() =>
      lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      }),
    )
    if (!before) return { scope, state: "empty" } satisfies MemoryHealth.Scope
    if ((yield* Effect.tryPromise(() => realpath(root.locks))) !== root.locks)
      return { scope, state: "unavailable", reason: "path" } satisfies MemoryHealth.Scope
    yield* Flock.effect(root.path, { dir: root.locks, reclaimDeadOwner: true }).pipe(Effect.timeout("5 seconds"))
    // Open the existing file without changing journal mode. Bun needs write
    // access to recreate WAL sidecars after another runtime checkpoints them;
    // query_only prohibits SQL writes and no migration/recovery is run here.
    const services = yield* Layer.build(layer({ filename: file, create: false, readwrite: true, disableWAL: true }))
    const sql = Context.get(services, SqlClient.SqlClient)
    yield* sql`PRAGMA query_only = ON`
    yield* sql`PRAGMA busy_timeout = 5000`
    const result = yield* sql.withTransaction(
      Effect.gen(function* () {
        const tables = new Set(
          (yield* sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table'`).map((row) => row.name),
        )
        if (
          ![
            "capture_meta",
            "capture_jobs",
            "capture_outcomes",
            "capture_files",
            "memory_notes",
            "memory_tombstones",
            "dream_runs",
            "dream_archives",
            "memory_gc_archives",
          ].every((name) => tables.has(name))
        )
          return { scope, state: "unavailable", reason: "schema" } satisfies MemoryHealth.Scope
        if ((yield* sql<{ value: string }>`SELECT value FROM capture_meta WHERE key = 'version'`)[0]?.value !== "1")
          return { scope, state: "unavailable", reason: "schema" } satisfies MemoryHealth.Scope
        if ((yield* sql<{ quick_check: string }>`PRAGMA quick_check(1)`).some((row) => row.quick_check !== "ok"))
          return { scope, state: "unavailable", reason: "corrupt" } satisfies MemoryHealth.Scope
        const jobs = (yield* sql<{
          pendingCaptureJobs: number
          runningCaptureJobs: number
          publishingCaptureJobs: number
          retryCaptureJobs: number
          failedCaptureJobs: number
          completedCaptureJobs: number
        }>`SELECT COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pendingCaptureJobs, COUNT(CASE WHEN status = 'running' THEN 1 END) AS runningCaptureJobs, COUNT(CASE WHEN status = 'publishing' THEN 1 END) AS publishingCaptureJobs, COUNT(CASE WHEN status = 'failed' AND terminal = 0 THEN 1 END) AS retryCaptureJobs, COUNT(CASE WHEN status = 'failed' AND terminal = 1 THEN 1 END) AS failedCaptureJobs, COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completedCaptureJobs FROM capture_jobs`)[0]!
        const files = yield* sql<{
          path: string
          state: string
          exposed: number
          committed: number | null
        }>`SELECT f.path, f.state, j.is_exposed AS exposed, o.committed_at AS committed FROM capture_files f JOIN capture_jobs j USING(job_id) LEFT JOIN capture_outcomes o USING(job_id) UNION ALL SELECT path, state, is_exposed AS exposed, NULL AS committed FROM memory_notes WHERE path LIKE 'observations/%'`
        const visible = files.filter((row) => row.state === "live" && row.exposed === 1 && permitted(row.path))
        const ages = visible.flatMap((row) =>
          row.committed === null ? [] : [Math.max(0, Math.floor((now - row.committed) / 1000))],
        )
        const dream = (yield* sql<{
          expires: number
          size: number
          planned: number
        }>`SELECT expires, json_array_length(input, '$.observations') AS size, changes IS NOT NULL AS planned FROM dream_runs WHERE status != 'completed' ORDER BY rowid LIMIT 1`)[0]
        const history = (yield* sql<{
          success: number | null
          failure: number | null
        }>`SELECT (SELECT MAX(at) FROM (SELECT committed_at AS at FROM capture_outcomes UNION ALL SELECT CAST(value AS INTEGER) FROM capture_meta WHERE key = 'last_dream_success_at')) AS success, (SELECT MAX(terminal_at) FROM capture_jobs WHERE status = 'failed' AND terminal = 1) AS failure`)[0]!
        const counts = (yield* sql<{
          archives: number
          tombstones: number
          deletions: number
        }>`SELECT (SELECT COUNT(*) FROM dream_archives) AS archives, (SELECT COUNT(*) FROM memory_tombstones) AS tombstones, (SELECT COUNT(*) FROM memory_gc_archives) AS deletions`)[0]!
        const snapshot = yield* Schema.decodeUnknownEffect(MemoryHealth.Snapshot)({
          ...jobs,
          pendingObservations: visible.length,
          hiddenPendingObservations: files.filter(
            (row) => row.state === "live" && row.exposed === 0 && permitted(row.path),
          ).length,
          quarantinedObservations: files.filter(
            (row) => ["quarantined", "missing"].includes(row.state) && permitted(row.path),
          ).length,
          oldestPendingAgeSecs: ages.length ? Math.max(...ages) : null,
          dreamLease: !dream ? "none" : dream.expires > now ? "active" : "expired",
          dreamSnapshotSize: dream?.size ?? 0,
          dreamPlanPending: Boolean(dream?.planned),
          hasCoalescedTrigger:
            (yield* sql<{ value: string }>`SELECT value FROM capture_meta WHERE key = 'dream_trigger_pending'`)[0]
              ?.value === "1",
          lastSuccessAt: history.success,
          lastFailureAt: history.failure,
          archiveCount: counts.archives,
          tombstoneCount: counts.tombstones,
          pendingDeletions: counts.deletions,
        })
        return { scope, state: "ready", snapshot } satisfies MemoryHealth.Scope
      }),
    )
    const after = yield* Effect.tryPromise(() => lstat(file))
    if (after.ino !== before.ino || after.dev !== before.dev)
      return { scope, state: "unavailable", reason: "path" } satisfies MemoryHealth.Scope
    return result
  },
  Effect.scoped,
  (effect, _input, scope) =>
    effect.pipe(
      Effect.catchCause(() => Effect.succeed({ scope, state: "unavailable", reason: "storage" } as const)),
      Effect.map((result): MemoryHealth.Scope => result),
    ),
)

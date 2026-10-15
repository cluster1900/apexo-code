export * as MemoryRecovery from "./memory-recovery"

import os from "node:os"
import { Effect, Option, Schema, Stream } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { MemoryOperation } from "@apexo/schema/memory-operation"
import { MemoryConsolidation } from "./memory-consolidation"
import { MemoryV2 } from "./memory-v2"
import { MemoryV2Notes } from "./memory-v2-notes"
import { MemoryV2Scan } from "./memory-v2-scan"

export class Failure extends Schema.TaggedErrorClass<Failure>()("MemoryRecoveryFailure", {
  code: Schema.Literals(["changed", "unavailable", "forbidden", "storage", "limit"]),
  message: Schema.String,
}) {}
export type Authority = { id: string; sessionID: string; createdEventID: string }
type Run = {
  id: string
  owner: string
  token: string
  generation: string
  status: string
  input: string
  changes: string | null
  plan_hash: string | null
}
type Receipt = {
  id: string
  scope: string
  session_id: string
  created_event_id: string
  request: string
  state: string
  files: number
  targets: string
}
const Targets = Schema.Array(Schema.Struct({ path: Schema.String, hash: Schema.String })).check(
  Schema.isMaxLength(MemoryV2Scan.maxFiles),
)
const Changes = Schema.Array(
  Schema.Struct({ path: Schema.String, before: Schema.NullOr(Schema.String), content: Schema.NullOr(Schema.String) }),
).check(Schema.isMaxLength(128))
const Input = Schema.Struct({
  observations: Schema.Array(Schema.Struct({ path: Schema.String, hash: Schema.String, content: Schema.String })).check(
    Schema.isMaxLength(512),
  ),
  topics: Schema.Array(Schema.Struct({ path: Schema.String, hash: Schema.String, content: Schema.String })).check(
    Schema.isMaxLength(512),
  ),
})

// All methods are called under MemoryCapture's canonical scope lock. Execution
// additionally holds the native Dream lock; it never adopts the abandoned lease.
export function make(root: MemoryV2.Root, sql: SqlClient.SqlClient, notes: ReturnType<typeof MemoryV2Notes.make>) {
  const initialize = sql`CREATE TABLE IF NOT EXISTS memory_recovery (id TEXT PRIMARY KEY, scope TEXT NOT NULL, session_id TEXT NOT NULL, created_event_id TEXT NOT NULL, request TEXT NOT NULL, state TEXT NOT NULL, files INTEGER NOT NULL, generation TEXT NOT NULL, targets TEXT NOT NULL)`
  const table = (name: string) =>
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}`.pipe(
      Effect.map((rows) => rows.length > 0),
    )
  const state = Effect.gen(function* () {
    const generation = (yield* sql<{ value: string }>`SELECT value FROM capture_meta WHERE key = 'generation'`)[0]
      ?.value
    if (generation === undefined)
      return yield* new Failure({ code: "storage", message: "Memory generation is unavailable" })
    const bytes = (yield* sql<{
      bytes: number
    }>`SELECT COALESCE(SUM(length(CAST(input AS BLOB)) + COALESCE(length(CAST(changes AS BLOB)), 0)), 0) AS bytes FROM dream_runs WHERE status != 'completed'`)[0]!
      .bytes
    if (bytes > 16 * 1024 * 1024)
      return yield* new Failure({ code: "limit", message: "Memory recovery exceeds the supported journal byte bound" })
    const runs =
      yield* sql<Run>`SELECT id, owner, token, generation, status, input, changes, plan_hash FROM dream_runs WHERE status != 'completed' ORDER BY id LIMIT 65`
    if (runs.length > 64)
      return yield* new Failure({ code: "limit", message: "Memory recovery exceeds the supported plan bound" })
    const owners = (yield* table("dream_ownership"))
      ? yield* sql<{
          id: string
          owner: string
          token: string
          released: number
        }>`SELECT o.id, o.owner, o.token, o.released FROM dream_ownership o JOIN dream_runs r ON r.id = o.id WHERE r.status != 'completed' ORDER BY o.id`
      : []
    const proofs = (yield* table("dream_provenance"))
      ? yield* sql<{
          id: string
          owner: string
          token: string
          proof: string
        }>`SELECT p.id, p.owner, p.token, p.proof FROM dream_provenance p JOIN dream_runs r ON r.id = p.id WHERE r.status != 'completed' ORDER BY p.id`
      : []
    const captures = yield* sql<{
      job_id: string
      lease_owner: string | null
      lease_token: string | null
      status: string
    }>`SELECT job_id, lease_owner, lease_token, status FROM capture_jobs WHERE status IN ('running', 'publishing') ORDER BY job_id LIMIT 4097`
    if (captures.length > 4096)
      return yield* new Failure({ code: "limit", message: "Memory recovery exceeds the supported capture bound" })
    return { generation, runs, owners, proofs, captures }
  })
  const snapshot = (query: MemoryOperation.RecoveryQuery, access: MemoryV2Notes.Access) =>
    Effect.gen(function* () {
      const current = yield* state
      const generation = current.generation
      const runs = current.runs
      const owners = current.owners
      const proofs = current.proofs
      const captures = current.captures
      const files: { path: string; hash: string }[] = []
      yield* Stream.fromAsyncIterable(MemoryV2Scan.walk(root, { archives: true }), storage).pipe(
        Stream.runForEach((file) =>
          Effect.gen(function* () {
            if (files.length >= MemoryV2Scan.maxFiles)
              return yield* new Failure({
                code: "limit",
                message: "Memory clear requires a complete inventory within its supported bound",
              })
            if (!access(file, "read") || !access(file, "edit"))
              return yield* new Failure({
                code: "forbidden",
                message: "Memory recovery is not permitted for every affected file",
              })
            const value = yield* io(() => MemoryV2.fingerprint(root, file))
            if (value) files.push({ path: file, hash: value.hash })
          }),
        ),
      )
      if (query.action === "clear") {
        if (!access("MEMORY.md", "read") || !access("MEMORY.md", "edit"))
          return yield* new Failure({
            code: "forbidden",
            message: "Clearing the generated Memory index is not permitted",
          })
        const index = yield* io(() => MemoryV2.fingerprint(root, "MEMORY.md"))
        if (index) {
          if (files.length >= MemoryV2Scan.maxFiles)
            return yield* new Failure({ code: "limit", message: "Memory clear inventory exceeds its supported bound" })
          files.push({ path: "MEMORY.md", hash: index.hash })
        }
      }
      files.sort((a, b) => a.path.localeCompare(b.path))
      const reasons: NonNullable<MemoryOperation.RecoveryPreview["reason"]>[] = []
      for (const run of runs) {
        const owned = owners.find(
          (value) => value.id === run.id && value.owner === run.owner && value.token === run.token,
        )
        const saved = proofs.find(
          (value) => value.id === run.id && value.owner === run.owner && value.token === run.token,
        )
        if (!owned) {
          reasons.push("unknown_owner")
          continue
        }
        if (owned.released === 1) continue
        const decoded =
          saved &&
          Schema.decodeUnknownOption(
            Schema.UnknownFromJsonString.pipe(Schema.decodeTo(MemoryConsolidation.Provenance)),
          )(saved.proof)
        if (!decoded || Option.isNone(decoded) || decoded.value.scope !== root.path) {
          reasons.push("unknown_owner")
          continue
        }
        if (decoded.value.hostname !== os.hostname()) {
          reasons.push("foreign_owner")
          continue
        }
        const observed = yield* Effect.sync(() => ownerState(decoded.value.pid))
        if (observed !== "dead") reasons.push(observed)
      }
      if (query.action === "clear" && captures.length) reasons.push("capture_active")
      if (query.action === "discard") {
        if (runs.length !== 1 || !runs[0]?.changes) reasons.push("no_plan")
        if (runs.length === 1 && runs[0]?.changes) {
          const run = runs[0]
          const changes = yield* Schema.decodeUnknownEffect(
            Schema.UnknownFromJsonString.pipe(Schema.decodeTo(Changes)),
          )(run.changes)
          const input = yield* Schema.decodeUnknownEffect(Schema.UnknownFromJsonString.pipe(Schema.decodeTo(Input)))(
            run.input,
          )
          const archived = yield* Effect.forEach(input.observations, (value) =>
            sql`SELECT source FROM dream_archives WHERE source = ${value.path} LIMIT 1`.pipe(
              Effect.map((rows) => rows.length > 0),
            ),
          )
          if (run.status !== "planned" || archived.some(Boolean)) reasons.push("partial_publication")
          for (const change of changes) {
            if (!access(change.path, "read") || !access(change.path, "edit"))
              return yield* new Failure({ code: "forbidden", message: "Discard is not permitted for a planned target" })
            const actual = yield* io(() => MemoryV2.fingerprint(root, change.path))
            if ((actual?.hash ?? null) !== change.before) reasons.push("partial_publication")
          }
        }
      }
      const relevantOwners = owners.filter((value) => runs.some((run) => run.id === value.id))
      const relevantProofs = proofs.filter((value) => runs.some((run) => run.id === value.id))
      const digest = MemoryV2.hash(
        JSON.stringify({
          scope: root.path,
          query: MemoryOperation.RecoveryQuery.make(query),
          generation,
          runs,
          owners: relevantOwners,
          proofs: relevantProofs,
          captures: query.action === "clear" ? captures : [],
          files,
        }),
      )
      return {
        state: current,
        files,
        runs,
        preview: MemoryOperation.RecoveryPreview.make({
          ...query,
          generation,
          digest,
          files: files.length,
          plans: runs.length,
          available: reasons.length === 0,
          ...(reasons[0] ? { reason: reasons[0] } : {}),
        }),
      }
    })
  const preview = (query: MemoryOperation.RecoveryQuery, access: MemoryV2Notes.Access) =>
    snapshot(query, access).pipe(Effect.map((value) => value.preview))
  const prepare = (authority: Authority, expected: MemoryOperation.RecoveryPreview, access: MemoryV2Notes.Access) =>
    Effect.gen(function* () {
      const previous = (yield* sql<Receipt>`SELECT * FROM memory_recovery WHERE id = ${authority.id}`)[0]
      if (previous) {
        const request = yield* Schema.decodeUnknownEffect(
          Schema.UnknownFromJsonString.pipe(Schema.decodeTo(MemoryOperation.RecoveryPreview)),
        )(previous.request)
        if (
          previous.scope !== root.path ||
          previous.session_id !== authority.sessionID ||
          previous.created_event_id !== authority.createdEventID ||
          !Schema.toEquivalence(MemoryOperation.RecoveryPreview)(request, expected)
        )
          return yield* new Failure({
            code: "changed",
            message: "Recovery action ID belongs to another request or Session incarnation",
          })
        return { previous, current: undefined, authority, expected }
      }
      const current = yield* snapshot(expected, access)
      if (!Schema.toEquivalence(MemoryOperation.RecoveryPreview)(current.preview, expected))
        return yield* new Failure({ code: "changed", message: "Memory recovery preview changed; inspect it again" })
      if (!current.preview.available)
        return yield* new Failure({
          code: "unavailable",
          message: `Memory recovery is unavailable: ${current.preview.reason}`,
        })
      return { previous: undefined, current, authority, expected }
    })
  const commit = (prepared: Effect.Success<ReturnType<typeof prepare>>, access: MemoryV2Notes.Access) =>
    sql.withTransaction(
      Effect.gen(function* () {
        if (prepared.previous) return prepared.previous
        const current = prepared.current!
        // The caller holds the canonical scope lock across inventory, admission and
        // this short transaction. Recheck the exact database ownership, never expiry.
        if (JSON.stringify(yield* state) !== JSON.stringify(current.state))
          return yield* new Failure({ code: "changed", message: "Memory ownership changed before publication" })
        if (current.files.some((file) => !access(file.path, "read") || !access(file.path, "edit")))
          return yield* new Failure({ code: "forbidden", message: "Memory recovery file permissions changed" })
        if (prepared.expected.action === "discard") {
          const changes = yield* Schema.decodeUnknownEffect(
            Schema.UnknownFromJsonString.pipe(Schema.decodeTo(Changes)),
          )(current.runs[0]!.changes)
          if (changes.some((file) => !access(file.path, "read") || !access(file.path, "edit")))
            return yield* new Failure({ code: "forbidden", message: "Dream discard target permission changed" })
        }
        if (prepared.expected.action === "clear") yield* notes.prepareClear(current.files)
        if (prepared.expected.action === "discard") {
          const run = current.runs[0]!
          const removed =
            yield* sql`DELETE FROM dream_runs WHERE id = ${run.id} AND owner = ${run.owner} AND token = ${run.token} AND generation = ${run.generation} AND status = ${run.status} AND plan_hash = ${run.plan_hash} RETURNING id`
          if (removed.length !== 1)
            return yield* new Failure({ code: "changed", message: "Dream owner changed before discard" })
          yield* sql`DELETE FROM dream_batch_state WHERE id = ${run.id}`
          yield* sql`DELETE FROM dream_ownership WHERE id = ${run.id} AND owner = ${run.owner} AND token = ${run.token}`
          yield* sql`DELETE FROM dream_provenance WHERE id = ${run.id} AND owner = ${run.owner} AND token = ${run.token}`
        }
        const generation = yield* notes.revision
        yield* sql`INSERT INTO memory_recovery (id, scope, session_id, created_event_id, request, state, files, generation, targets) VALUES (${prepared.authority.id}, ${root.path}, ${prepared.authority.sessionID}, ${prepared.authority.createdEventID}, ${JSON.stringify(MemoryOperation.RecoveryPreview.make(prepared.expected))}, 'committed', ${prepared.expected.action === "clear" ? prepared.expected.files : 0}, ${generation}, ${JSON.stringify(prepared.expected.action === "clear" ? current.files : [])})`
        return (yield* sql<Receipt>`SELECT * FROM memory_recovery WHERE id = ${prepared.authority.id}`)[0]!
      }),
    )
  const settle = (receipt: Receipt, access: MemoryV2Notes.Access) =>
    Effect.gen(function* () {
      if (receipt.state !== "finished") {
        // Only clear owns filesystem settlement. Discard never publishes or cleans up a plan.
        const request = yield* Schema.decodeUnknownEffect(
          Schema.UnknownFromJsonString.pipe(Schema.decodeTo(MemoryOperation.RecoveryPreview)),
        )(receipt.request)
        if (request.action === "clear") {
          const targets = yield* Schema.decodeUnknownEffect(
            Schema.UnknownFromJsonString.pipe(Schema.decodeTo(Targets)),
          )(receipt.targets)
          if (targets.some((item) => !access(item.path, "read") || !access(item.path, "edit")))
            return yield* new Failure({
              code: "forbidden",
              message: "Settling committed Memory deletion is not currently permitted",
            })
          yield* notes.settleTombstones(targets)
        }
        yield* sql`UPDATE memory_recovery SET state = 'finished' WHERE id = ${receipt.id} AND session_id = ${receipt.session_id} AND created_event_id = ${receipt.created_event_id} AND request = ${receipt.request}`
      }
      return { status: "completed", committed: true, processed: receipt.files } satisfies MemoryOperation.Result
    })
  return { initialize, preview, prepare, commit, settle }
}
function ownerState(pid: number) {
  try {
    process.kill(pid, 0)
    return "live_owner" as const
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ESRCH") return "dead" as const
    return "unknown_owner" as const
  }
}
function storage() {
  return new Failure({ code: "storage", message: "Memory recovery storage is unavailable" })
}
function io<A>(run: () => Promise<A>) {
  return Effect.tryPromise({ try: run, catch: storage })
}

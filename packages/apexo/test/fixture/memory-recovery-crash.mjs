import { Database } from "bun:sqlite"
import { mkdirSync, writeFileSync, promises } from "node:fs"
import path from "node:path"
const home = process.argv[2]
const phase = process.argv[3]
const marker = path.join(home, "recovery-checkpoint")
const park = () => {
  writeFileSync(marker, phase)
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000)
  throw new Error("Recovery fixture parent did not reap checkpointed child")
}
mkdirSync(home, { recursive: true })
const pending = new WeakMap()
const wrapped = new WeakSet()
const query = Database.prototype.query
Database.prototype.query = function (sql) {
  const statement = Reflect.apply(query, this, [sql])
  if (wrapped.has(statement)) return statement
  wrapped.add(statement)
  const database = this
  const all = statement.all
  statement.all = function (...args) {
    const result = Reflect.apply(all, this, args)
    if (
      (phase === "clear-committed" && sql.includes("INSERT INTO memory_recovery")) ||
      (phase === "dream-planned" && sql.includes("UPDATE dream_runs SET status = 'planned'"))
    )
      pending.set(database, true)
    if (/^ROLLBACK\b/i.test(sql.trim())) pending.delete(database)
    if (/^COMMIT\b/i.test(sql.trim()) && pending.get(database)) park()
    if (phase === "clear-finished" && sql.includes("UPDATE memory_recovery SET state = 'finished'")) park()
    return result
  }
  return statement
}
const unlink = promises.unlink
promises.unlink = async (file) => {
  await unlink(file)
  if (phase === "clear-unlinked" && String(file).endsWith(".md")) park()
}
const { Effect } = await import("effect")
const { MemoryCapture } = await import("@apexo/core/memory-capture")
const { MemoryConsolidation } = await import("@apexo/core/memory-consolidation")
const { Flock } = await import("@apexo/core/util/flock")
Flock.setGlobal({ state: path.join(home, "state") })
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const store = yield* MemoryCapture.make({ home, directory: home }, { recover: false, strictOwner: true })
      yield* store.remember("Preserved source fact", () => true)
      if (phase === "dream-planned") {
        const lease = yield* store.dreamClaim(
          {
            owner: "crashed",
            now: Date.now(),
            duration: 300000,
            ownership: "explicit",
            provenance: MemoryConsolidation.provenance({
              sessionID: "original",
              createdEventID: "original-created",
              operationID: "original-operation",
              scope: store.root.path,
            }),
          },
          () => true,
        )
        const input = yield* store.dreamInput(lease, Date.now(), () => true)
        yield* store.dreamPrepare(
          lease,
          [
            {
              action: "create",
              path: "topics/never-published.md",
              content: "Never execute the orphan plan",
              evidence: input.observations.map((value) => value.path),
            },
          ],
          Date.now(),
          () => true,
        )
        throw new Error("Prepared crash checkpoint was not reached")
      }
      const preview = yield* store.recoveryPreview({ action: "clear", scope: "workspace" }, () => true)
      const authority = { id: "crash-clear", sessionID: "operator", createdEventID: "operator-created" }
      yield* Effect.promise(() =>
        Bun.write(path.join(home, "recovery-input.json"), JSON.stringify({ preview, authority })),
      )
      yield* store.recoverExplicit(
        authority,
        preview,
        () => true,
        (work) => work,
        Effect.void,
      )
      throw new Error("Clear crash checkpoint was not reached")
    }),
  ),
)

// Test-only observer: park only after the real Dream transaction has committed.
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const marker = join(process.env.XDG_STATE_HOME, "dream-crash-checkpoint")
if (!existsSync(marker)) {
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
      if (sql.includes(`UPDATE dream_runs SET status = '${process.env.MEMORY_DREAM_CRASH_STAGE}'`))
        pending.set(database, true)
      if (/^COMMIT\b/i.test(sql.trim()) && pending.get(database)) {
        pending.delete(database)
        mkdirSync(process.env.XDG_STATE_HOME, { recursive: true })
        writeFileSync(marker, process.env.MEMORY_DREAM_CRASH_STAGE)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000)
        throw new Error("Dream crash fixture parent did not reap its checkpointed child")
      }
      if (/^ROLLBACK\b/i.test(sql.trim())) pending.delete(database)
      return result
    }
    return statement
  }
}

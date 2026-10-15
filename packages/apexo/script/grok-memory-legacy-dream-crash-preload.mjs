// Test-only observer parks after a real durable write; the parent kills and reaps the process.
import { Database } from "bun:sqlite"
import { plugin } from "bun"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const marker = join(process.env.XDG_STATE_HOME, "legacy-dream-crash-checkpoint")
const stage = process.env.LEGACY_DREAM_CRASH_STAGE
const park = () => {
  if (existsSync(marker)) return
  mkdirSync(process.env.XDG_STATE_HOME, { recursive: true })
  writeFileSync(marker, stage)
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000)
  throw new Error("Legacy Dream crash fixture did not reap checkpointed child")
}
if (!existsSync(marker)) {
  if (stage === "prepared") {
    const query = Database.prototype.query
    const wrapped = new WeakSet()
    Database.prototype.query = function (sql) {
      const statement = Reflect.apply(query, this, [sql])
      if (wrapped.has(statement)) return statement
      wrapped.add(statement)
      for (const name of ["all", "get", "run", "values"]) {
        const execute = statement[name]
        statement[name] = function (...args) {
          const result = Reflect.apply(execute, this, args)
          if (
            /update.*session_memory_operation/i.test(sql) &&
            args.some((arg) => typeof arg === "string" && arg.includes('"legacyDream":'))
          )
            park()
          return result
        }
      }
      return statement
    }
  } else {
    plugin({
      name: "native-legacy-dream-publication-observer",
      setup(build) {
        build.onLoad({ filter: /packages\/core\/src\/memory-dream\.ts$/ }, ({ path }) => {
          const source = readFileSync(path, "utf8")
          const target = "await rename(temporary, file).catch"
          if (!source.includes(target)) throw new Error("Dream publication boundary changed")
          return {
            loader: "ts",
            contents: source.replace(
              target,
              `await rename(temporary, file).then(async () => {
            if (file.endsWith(${JSON.stringify(stage === "memory" ? "/MEMORY.md" : "/.dream-state.json")})) {
              const fs = await import("node:fs")
              if (!fs.existsSync(${JSON.stringify(marker)})) {
                fs.mkdirSync(${JSON.stringify(process.env.XDG_STATE_HOME)}, { recursive: true })
                fs.writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(stage)})
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000)
                throw new Error("Legacy Dream parent did not reap publication checkpoint")
              }
            }
          }).catch`,
            ),
          }
        })
      },
    })
  }
}

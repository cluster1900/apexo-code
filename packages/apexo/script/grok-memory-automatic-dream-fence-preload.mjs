// Test-only observer: preserve real SQLite admission and publication, pausing only at a named boundary.
import { Database } from "bun:sqlite"
import { plugin } from "bun"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const directory = process.env.XDG_STATE_HOME
const checkpoint = join(directory, "automatic-dream-before-publication")
const release = join(directory, "automatic-dream-release-publication")
const admitted = join(directory, "automatic-dream-new-input-admitted")
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
      if (/insert.*session_input/i.test(sql) && args.some((arg) => arg === process.env.AUTOMATIC_DREAM_FENCE_INPUT)) {
        mkdirSync(directory, { recursive: true })
        writeFileSync(admitted, "actual durable insert completed")
      }
      return result
    }
  }
  return statement
}
plugin({
  name: "automatic-dream-publication-order-observer",
  setup(build) {
    build.onLoad({ filter: /packages\/core\/src\/memory-dream(?:-native)?\.ts$/ }, ({ path }) => {
      const source = readFileSync(path, "utf8")
      if (path.endsWith("memory-dream-native.ts")) {
        const fence = "ownership.automatic ? admission.fence(ownership.automatic.claim, commit) : commit"
        if (!source.includes(fence)) throw new Error("Automatic Dream admission fence changed")
        return {
          loader: "ts",
          contents: process.env.AUTOMATIC_DREAM_FENCE_NEGATIVE === "1" ? source.replace(fence, "commit") : source,
        }
      }
      const target = "  const current = await snapshot(location.file, input, 1_000_000)"
      if (!source.includes(target)) throw new Error("Automatic Dream storage publication boundary changed")
      return {
        loader: "ts",
        contents: source.replace(
          target,
          `
          await Bun.write(${JSON.stringify(checkpoint)}, "validated before actual publication")
          const deadline = Date.now() + 15000
          while (!(await Bun.file(${JSON.stringify(release)}).exists())) {
            if (Date.now() > deadline) throw new Error("Automatic Dream fence observer was not released")
            await Bun.sleep(10)
          }
          ${target}`,
        ),
      }
    })
  },
})

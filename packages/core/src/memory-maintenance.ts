export * as MemoryMaintenance from "./memory-maintenance"

import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect, Schema } from "effect"
import { Flock } from "./util/flock"

const State = Schema.Struct({
  generation: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9-]{1,64}$/)),
  pending: Schema.Boolean,
  operation: Schema.optional(Schema.Literal("change")),
})
export type Location = { home: string; root: string }

export async function inspect(input: Location) {
  const paths = await location(input)
  const value = await state(paths.marker)
  if (value?.pending) throw new Error("Memory maintenance is incomplete")
  return value?.generation ?? "initial"
}

export async function revision(input: Location) {
  const paths = await location(input)
  const value = await state(paths.marker)
  if (value?.pending && value.operation === "change")
    return Flock.withLock(paths.root, () => ready(paths.marker), { dir: paths.locks })
  if (value?.pending) throw new Error("Memory clear is incomplete; run memory clear again")
  return value?.generation ?? "initial"
}

// Serialize short storage mutations with clear, never the model request itself.
export async function write<A>(input: Location, action: () => Promise<A>, expected?: string, ownership?: "explicit") {
  const paths = await location(input)
  return Flock.withLock(
    paths.root,
    async () => {
      const current = await ready(paths.marker)
      if (expected !== undefined && current !== expected) throw new Error("Memory was cleared during this operation")
      return action()
    },
    { dir: paths.locks, deadOwnerOnly: ownership === "explicit" },
  )
}

// Keep Effect authority checks inside the same maintenance lease as publication.
export const writeEffect = <A, E, R>(input: Location, action: Effect.Effect<A, E, R>, expected: string) =>
  Effect.gen(function* () {
    const paths = yield* Effect.tryPromise(() => location(input))
    yield* Flock.effect(paths.root, { dir: paths.locks, deadOwnerOnly: true })
    const current = yield* Effect.tryPromise(() => ready(paths.marker)).pipe(Effect.uninterruptible)
    if (current !== expected) return yield* Effect.fail(new Error("Memory was cleared during this operation"))
    return yield* action
  }).pipe(Effect.scoped)

// Prepare under the same lock as writers, then invalidate readers before and
// after the mutation. A reader recovers an interrupted change after acquiring
// this lock; it never reuses a snapshot made before the interrupted mutation.
export async function change<A>(input: Location, prepare: () => Promise<() => Promise<A>>) {
  const paths = await location(input)
  return Flock.withLock(
    paths.root,
    async () => {
      await ready(paths.marker)
      const commit = await prepare()
      await save(paths.marker, { generation: randomUUID(), pending: true, operation: "change" })
      try {
        return await commit()
      } finally {
        await save(paths.marker, { generation: randomUUID(), pending: false })
      }
    },
    { dir: paths.locks },
  )
}

async function ready(marker: string) {
  const value = await state(marker)
  if (!value?.pending) return value?.generation ?? "initial"
  if (value.operation !== "change") throw new Error("Memory clear is incomplete; run memory clear again")
  const recovered = { generation: randomUUID(), pending: false }
  await save(marker, recovered)
  return recovered.generation
}

export async function targets(input: Location, scope: "global" | "workspace") {
  const paths = await location(input)
  if (scope === "workspace")
    return (await exists(paths.root)) || (await state(paths.marker))?.pending ? [paths.root] : []
  const files = (
    await readdir(paths.root, { withFileTypes: true }).catch((error: unknown) => {
      if (missing(error)) return []
      throw error
    })
  )
    .filter((entry) => entry.name.endsWith(".md") || ["topics", "sessions", "observations"].includes(entry.name))
    .map((entry) => path.join(paths.root, entry.name))
    .sort()
  return files.length || !(await state(paths.marker))?.pending ? files : [path.join(paths.root, "MEMORY.md")]
}

export async function clear(input: Location, scope: "global" | "workspace", invalidate = false) {
  const paths = await location(input)
  return Flock.withLock(
    paths.root,
    async () => {
      const files = await targets(input, scope)
      const previous = await state(paths.marker)
      if (!files.length && !previous?.pending && !invalidate) return false
      const value = { generation: randomUUID(), pending: true }
      // The marker lives outside the workspace. It invalidates cached contexts and
      // also prevents retained legacy migration sources from resurrecting notes.
      await save(paths.marker, value)
      for (const file of files) await rm(file, { recursive: true, force: true })
      await save(paths.marker, { ...value, pending: false })
      return true
    },
    { dir: paths.locks },
  )
}

async function location(input: Location) {
  const home = await realpath(input.home)
  const relative = path.relative(path.resolve(input.home), path.resolve(input.root))
  const parts = relative.split(path.sep)
  if (parts[0] !== ".grok" || parts[1] !== "memory" || parts.some((part) => part === ".."))
    throw new Error("Invalid memory scope")
  const root = path.join(home, relative)
  const base = path.join(home, ".grok", "memory")
  const marker = path.join(base, ".cleared", `${createHash("sha256").update(relative).digest("hex")}.json`)
  const locks = path.join(base, ".locks")
  for (const target of [root, path.dirname(marker), locks]) {
    const segments = path.relative(home, target).split(path.sep)
    for (const [index] of segments.entries()) {
      const file = path.join(home, ...segments.slice(0, index + 1))
      const info = await lstat(file).catch((error: unknown) => {
        if (missing(error)) return undefined
        throw error
      })
      if (info && (!info.isDirectory() || info.isSymbolicLink()))
        throw new Error("Memory directories must not be redirected or symbolic links")
    }
  }
  return { root, marker, locks }
}

async function state(file: string) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(
    (error: unknown) => {
      if (missing(error)) return undefined
      throw error
    },
  )
  if (!handle) return
  await using opened = handle
  const info = await opened.stat()
  if (!info.isFile() || info.size > 4096) throw new Error("Invalid memory clear marker")
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(State))(await opened.readFile("utf8"))
  if (decoded._tag === "None") throw new Error("Invalid memory clear marker")
  return decoded.value
}

async function save(file: string, value: Schema.Schema.Type<typeof State>) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" })
  await rename(temporary, file).catch(async (error: unknown) => {
    await rm(temporary, { force: true })
    throw error
  })
}

async function exists(file: string) {
  return lstat(file).then(
    () => true,
    (error: unknown) => {
      if (missing(error)) return false
      throw error
    },
  )
}

function missing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

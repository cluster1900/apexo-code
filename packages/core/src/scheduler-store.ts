export * as SchedulerStore from "./scheduler-store"

import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { Effect, Schema, Scope, Semaphore } from "effect"
import { migratedWorktreeAliases } from "./app-directory"
import { Global } from "./global"
import { Flock } from "./util/flock"
import { ModelV2 } from "./model"
import { ProviderV2 } from "./provider"

export const Resume = Schema.Struct({
  createdEventID: Schema.optional(Schema.String),
  agent: Schema.String,
  messageID: Schema.String,
  model: Schema.Struct({
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
    variant: Schema.optional(Schema.String),
  }),
})

export const Record = Schema.Struct({
  id: Schema.String,
  ownerSessionId: Schema.String,
  prompt: Schema.String,
  intervalSeconds: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(60)),
  recurring: Schema.Boolean,
  durable: Schema.Boolean,
  createdAt: Schema.Number.check(Schema.isFinite()),
  expiresAt: Schema.Number.check(Schema.isFinite()),
  lastFireAt: Schema.optional(Schema.Number.check(Schema.isFinite())),
  inFlight: Schema.optional(Schema.Boolean),
  resume: Schema.optional(Resume),
})
export type Record = typeof Record.Type

const File = Schema.fromJsonString(Schema.Struct({ version: Schema.Literal(1), tasks: Schema.Array(Record) }))

export class StorageError extends Schema.TaggedErrorClass<StorageError>()("SchedulerStorageError", {
  message: Schema.String,
}) {}

export function directory(workspace: string, root = path.join(Global.Path.data, "scheduler")) {
  return path.join(root, createHash("sha256").update(path.resolve(workspace)).digest("hex"))
}
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"

/** The lease lives for the instance scope, including idle intervals between fires. */
export const make = Effect.fn("SchedulerStore.make")(function* (
  workspace: string,
  root = path.join(Global.Path.data, "scheduler"),
) {
  const scope = yield* Scope.Scope
  const mutex = yield* Semaphore.make(1)
  const leases = new Set<string>()
  const worktree = migratedWorktreeAliases(path.dirname(root), path.resolve(workspace))
  const storage = worktree ? path.join(worktree.data, path.basename(root)) : root
  const dir = directory(worktree?.directory ?? workspace, storage)
  const directories = [
    dir,
    ...new Set(
      worktree?.paths
        .map((alias) => directory(alias, storage))
        .filter((alias) => alias !== dir)
        .toSorted(),
    ),
  ]
  const name = (owner: string) => `${createHash("sha256").update(owner).digest("hex")}.json`
  const io = <A>(run: (signal: AbortSignal) => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (error) => new StorageError({ message: String(error) }) })

  const read = (nameOfFile: string) =>
    io(async () => {
      // A canonical record with zero tasks is authoritative after deletion.
      for (const dir of directories) {
        const raw = await readFile(path.join(dir, nameOfFile), "utf8").catch((error: unknown) => {
          if (missing(error)) return undefined
          throw error
        })
        if (raw !== undefined) return raw
      }
      return '{"version":1,"tasks":[]}'
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(File)),
      Effect.mapError(
        (error) => new StorageError({ message: `Cannot read scheduler state ${path.join(dir, nameOfFile)}: ${error}` }),
      ),
      Effect.flatMap(({ tasks }) =>
        tasks.some((task) => name(task.ownerSessionId) !== nameOfFile)
          ? Effect.fail(
              new StorageError({ message: `Scheduler state has conflicting session ownership: ${nameOfFile}` }),
            )
          : Effect.succeed(tasks),
      ),
    )

  const claim = (owner: string) =>
    mutex.withPermit(
      Effect.gen(function* () {
        if (leases.has(owner)) return
        yield* Effect.acquireRelease(
          io((signal) =>
            Flock.acquire(path.join(dir, name(owner)), {
              dir: path.join(dir, ".locks"),
              timeoutMs: 0,
              signal,
              reclaimDeadOwner: true,
            }),
          ),
          (lease) => Effect.promise(() => lease.release()),
        ).pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.mapError(
            (error) =>
              new StorageError({
                message: `Cannot acquire scheduler ownership for session ${owner}: ${error.message}`,
              }),
          ),
        )
        leases.add(owner)
      }),
    )

  const change = (owner: string, update: (tasks: readonly Record[]) => readonly Record[]) =>
    claim(owner).pipe(
      Effect.andThen(
        mutex.withPermit(
          Effect.gen(function* () {
            const nameOfFile = name(owner)
            const target = path.join(dir, nameOfFile)
            const tasks = update(yield* read(nameOfFile))
            yield* io(async () => {
              await mkdir(dir, { recursive: true, mode: 0o700 })
              const temporary = `${target}.${randomUUID()}.tmp`
              const handle = await open(temporary, "wx", 0o600)
              await handle
                .writeFile(JSON.stringify({ version: 1, tasks }))
                .then(() => handle.sync())
                .finally(() => handle.close())
                .then(() => rename(temporary, target))
                .catch(async (error: unknown) => {
                  await rm(temporary, { force: true })
                  throw error
                })
              // On POSIX, persist the directory entry as well as the file contents.
              if (process.platform !== "win32") {
                const parent = await open(dir, "r")
                await parent.sync().finally(() => parent.close())
              }
            })
          }),
        ),
      ),
      Effect.asVoid,
    )

  const load = (owner?: string) => {
    if (owner !== undefined) return read(name(owner))
    return Effect.forEach(directories, (dir) =>
      io(() =>
        readdir(dir).catch((error: unknown) => {
          if (missing(error)) return []
          throw error
        }),
      ),
    ).pipe(
      Effect.flatMap((files) =>
        Effect.forEach(new Set(files.flat().filter((name) => /^[a-f0-9]{64}\.json$/.test(name))), read),
      ),
      Effect.map((groups) => groups.flat()),
    )
  }

  return {
    load,
    claim,
    save: (task: Record) =>
      change(task.ownerSessionId, (tasks) => [...tasks.filter((item) => item.id !== task.id), task]),
    remove: (id: string, owner: string) => change(owner, (tasks) => tasks.filter((item) => item.id !== id)),
  }
})

export type Interface = Effect.Success<ReturnType<typeof make>>

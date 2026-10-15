export * as McpPreferences from "./mcp-preferences"

import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { Effect, Exit, Schema } from "effect"
import type { Location } from "./location"
import { Flock } from "./util/flock"

const Entry = Schema.Struct({
  server: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024), Schema.isPattern(/^[^\0]+$/)),
  enabled: Schema.Boolean,
})
const Document = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    revision: Schema.String.check(Schema.isMinLength(1)),
    location: Schema.String,
    servers: Schema.Array(Entry).check(Schema.isMaxLength(10000)),
  }),
)
const MAX_BYTES = 1024 * 1024
export class Failure extends Schema.TaggedErrorClass<Failure>()("McpPreferences.Failure", {
  kind: Schema.Literals(["read", "invalid", "write", "conflict", "rollback"]),
  message: Schema.String,
}) {}

type Snapshot = {
  raw?: string
  revision?: string
  values: Map<string, boolean>
}
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
export const key = (location: Location.Ref) =>
  createHash("sha256")
    .update(JSON.stringify([path.resolve(location.directory), location.workspaceID ?? null]))
    .digest("hex")
export const file = (location: Location.Ref, data: string) =>
  path.join(data, "mcp-preferences", `${key(location)}.json`)

/** Pure user preferences: definitions, credentials, and shared project files never enter this store. */
export function make(location: Location.Ref, data: string) {
  const target = file(location, data)
  const directory = path.dirname(target)
  const identity = key(location)
  const read = Effect.tryPromise({
    try: async () => {
      const info = await stat(target).catch((error) => {
        if (missing(error)) return undefined
        throw error
      })
      if (!info) return undefined
      if (!info.isFile() || info.size > MAX_BYTES)
        throw new Failure({
          kind: "invalid",
          message: "Saved MCP connection choices are invalid",
        })
      const raw = await readFile(target, "utf8")
      if (Buffer.byteLength(raw) > MAX_BYTES)
        throw new Failure({
          kind: "invalid",
          message: "Saved MCP connection choices exceed their limit",
        })
      return raw
    },
    catch: (error) =>
      error instanceof Failure
        ? error
        : new Failure({
            kind: "read",
            message: "Could not read saved MCP connection choices",
          }),
  }).pipe(
    Effect.flatMap((raw) => {
      if (raw === undefined)
        return Effect.succeed({
          values: new Map<string, boolean>(),
        } as Snapshot)
      return Schema.decodeUnknownEffect(Document)(raw).pipe(
        Effect.mapError(
          () =>
            new Failure({
              kind: "invalid",
              message: "Saved MCP connection choices are invalid",
            }),
        ),
        Effect.flatMap((value) => {
          const values = new Map(value.servers.map((entry) => [entry.server, entry.enabled]))
          if (value.location !== identity || values.size !== value.servers.length)
            return Effect.fail(
              new Failure({
                kind: "invalid",
                message: "Saved MCP connection choices have conflicting ownership or identifiers",
              }),
            )
          return Effect.succeed({
            raw,
            revision: value.revision,
            values,
          } as Snapshot)
        }),
      )
    }),
  )
  const write = (raw: string | undefined) =>
    Effect.tryPromise({
      try: async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 })
        if (raw === undefined) await rm(target, { force: true })
        if (raw !== undefined) {
          const temporary = `${target}.${randomUUID()}.tmp`
          const handle = await open(temporary, "wx", 0o600)
          await handle
            .writeFile(raw)
            .then(() => handle.sync())
            .finally(() => handle.close())
            .then(() => rename(temporary, target))
            .catch(async (error: unknown) => {
              await rm(temporary, { force: true })
              throw error
            })
        }
        if (process.platform !== "win32") {
          const parent = await open(directory, "r")
          await parent.sync().finally(() => parent.close())
        }
      },
      catch: () =>
        new Failure({
          kind: "write",
          message: "Could not save MCP connection choices",
        }),
    })
  const lock = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const controller = new AbortController()
      const waiting = Flock.acquire(target, {
        dir: path.join(directory, ".locks"),
        signal: controller.signal,
        timeoutMs: 5000,
        reclaimDeadOwner: true,
      })
      // Register ownership before restoring interruption. If acquisition wins the
      // abort race, this finalizer still joins it and releases the acquired lease.
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          controller.abort()
          const lease = await waiting.catch(() => undefined)
          await lease?.release()
        }),
      )
      return yield* restore(
        Effect.tryPromise({
          try: () => waiting,
          catch: () =>
            new Failure({ kind: "write", message: "Could not lock saved MCP connection choices; try again" }),
        }),
      )
    }),
  )
  const inspect = <A, E, R>(commit: (values: ReadonlyMap<string, boolean>) => Effect.Effect<A, E, R>) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* lock
        const snapshot = yield* read
        return yield* commit(snapshot.values)
      }),
    )
  const change = <E, R>(
    server: string,
    enabled: boolean | undefined,
    commit: (values: ReadonlyMap<string, boolean>) => Effect.Effect<void, E, R>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(Entry)({
          server,
          enabled: enabled ?? false,
        }).pipe(
          Effect.mapError(
            () =>
              new Failure({
                kind: "invalid",
                message: "MCP server identifier is invalid",
              }),
          ),
        )
        yield* lock
        const previous = yield* read
        const values = new Map(previous.values)
        if (enabled === undefined) values.delete(server)
        if (enabled !== undefined) values.set(server, enabled)
        const revision = randomUUID()
        const raw = yield* Schema.encodeEffect(Document)({
          version: 1,
          revision,
          location: identity,
          servers: [...values]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([server, enabled]) => ({ server, enabled })),
        }).pipe(
          Effect.mapError(
            () =>
              new Failure({
                kind: "invalid",
                message: "MCP connection choices cannot be encoded",
              }),
          ),
        )
        if (Buffer.byteLength(raw) > MAX_BYTES)
          return yield* new Failure({
            kind: "invalid",
            message: "Saved MCP connection choices exceed their limit",
          })
        // The staged write and synchronous runtime commit cannot be interrupted apart.
        // Rollback checks exact bytes/revision, even if a non-cooperating writer bypasses the lock.
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const result = yield* write(raw).pipe(Effect.andThen(commit(values)), Effect.exit)
            if (Exit.isSuccess(result)) return values
            const observed = yield* read.pipe(
              Effect.mapError(
                () =>
                  new Failure({
                    kind: "rollback",
                    message: "MCP connection change failed and its saved choice could not be verified",
                  }),
              ),
            )
            if (observed.raw === previous.raw) return yield* Effect.failCause(result.cause)
            if (observed.revision !== revision || observed.raw !== raw)
              return yield* new Failure({
                kind: "conflict",
                message: "Saved MCP connection choices changed elsewhere; refresh before trying again",
              })
            yield* write(previous.raw).pipe(
              Effect.mapError(
                () =>
                  new Failure({
                    kind: "rollback",
                    message: "MCP connection change failed and its previous saved choice could not be restored",
                  }),
              ),
            )
            return yield* Effect.failCause(result.cause)
          }),
        )
      }),
    )
  return {
    read: read.pipe(Effect.map((snapshot) => snapshot.values)),
    inspect,
    change,
  }
}

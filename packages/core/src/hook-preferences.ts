export * as HookPreferences from "./hook-preferences"

import { randomUUID } from "node:crypto"
import { mkdir, open, rename, rm } from "node:fs/promises"
import path from "node:path"
import { Effect, Exit, Schema } from "effect"
import { Flock } from "./util/flock"
import { HostHooks } from "@apexo/schema/host-hooks"

export const ID = HostHooks.ID
const Document = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    revision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
    disabled: Schema.Array(ID).check(Schema.isMaxLength(4096)),
  }),
)
export type Choices = { readonly revision?: string; readonly disabled: readonly string[] }
export type Selection = () => Choices | Failure
export class Failure extends Schema.TaggedErrorClass<Failure>()("HookPreferences.Failure", {
  code: Schema.Literals(["invalid", "read", "write", "conflict", "rollback"]),
  message: Schema.String,
}) {}
export interface Store {
  readonly read: Effect.Effect<Choices, Failure>
  readonly change: <A, E, R>(
    id: string,
    enabled: boolean,
    commit: (choices: Choices) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | Failure, R>
}
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
export const file = (data: string) => path.join(data, "hooks", "preferences.json")

/** Stores user disables only; it never grants trust or loads executable definitions. */
export function make(data: string): Store {
  const target = file(data)
  const directory = path.dirname(target)
  const read = Effect.tryPromise({
    try: async () => {
      const handle = await open(target, "r").catch((error) => {
        if (missing(error)) return undefined
        throw error
      })
      if (!handle) return undefined
      return await handle
        .stat()
        .then(async (info) => {
          const limit = 1024 * 1024
          if (!info.isFile() || info.size > limit)
            throw new Failure({ code: "invalid", message: "Saved Hook choices are invalid" })
          // Read from the opened descriptor into a bounded buffer: replacing or
          // growing the path after stat cannot cause an unbounded allocation.
          const bytes = Buffer.alloc(limit + 1)
          let size = 0
          while (size < bytes.length) {
            const read = await handle.read(bytes, size, bytes.length - size, size)
            if (!read.bytesRead) break
            size += read.bytesRead
          }
          if (size > limit) throw new Failure({ code: "invalid", message: "Saved Hook choices exceed their limit" })
          return bytes.subarray(0, size).toString("utf8")
        })
        .finally(() => handle.close())
    },
    catch: (error) =>
      error instanceof Failure ? error : new Failure({ code: "read", message: "Could not read saved Hook choices" }),
  }).pipe(
    Effect.flatMap((raw): Effect.Effect<{ raw: string | undefined; choices: Choices }, Failure> => {
      if (raw === undefined) return Effect.succeed({ raw, choices: { disabled: [] } as Choices })
      return Schema.decodeUnknownEffect(Document)(raw).pipe(
        Effect.mapError(() => new Failure({ code: "invalid", message: "Saved Hook choices are invalid" })),
        Effect.flatMap((value) =>
          new Set(value.disabled).size !== value.disabled.length
            ? Effect.fail(new Failure({ code: "invalid", message: "Saved Hook choices contain duplicate identifiers" }))
            : Effect.succeed({ raw, choices: { revision: value.revision, disabled: value.disabled } as Choices }),
        ),
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
      catch: () => new Failure({ code: "write", message: "Could not save Hook choices" }),
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
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          controller.abort()
          const lease = await waiting.catch(() => undefined)
          await lease?.release()
        }),
      )
      return yield* restore(
        Effect.tryPromise({
          try: (signal) => {
            signal.addEventListener("abort", () => controller.abort(), { once: true })
            return waiting
          },
          catch: () => new Failure({ code: "write", message: "Could not lock saved Hook choices; try again" }),
        }),
      )
    }),
  )
  const change: Store["change"] = (id, enabled, commit) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(ID)(id).pipe(
          Effect.mapError(() => new Failure({ code: "invalid", message: "Hook identifier is invalid" })),
        )
        yield* lock
        const previous = yield* read
        const disabled = new Set(previous.choices.disabled)
        if (disabled.has(id) === !enabled) return yield* commit(previous.choices)
        if (enabled) disabled.delete(id)
        if (!enabled) disabled.add(id)
        const choices: Choices = { revision: randomUUID(), disabled: [...disabled].sort() }
        const raw = yield* Schema.encodeEffect(Document)({
          version: 1,
          revision: choices.revision!,
          disabled: choices.disabled,
        }).pipe(
          Effect.mapError(() => new Failure({ code: "invalid", message: "Saved Hook choices exceed their limit" })),
        )
        // Hold the writer lock through publication or exact-byte rollback. A cancelled
        // caller cannot leave a durable choice detached from its admitted Session update.
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const result = yield* write(raw).pipe(Effect.andThen(commit(choices)), Effect.exit)
            if (Exit.isSuccess(result)) return result.value
            const observed = yield* read.pipe(
              Effect.mapError(
                () =>
                  new Failure({
                    code: "rollback",
                    message: "Hook choice update failed and its saved state could not be verified",
                  }),
              ),
            )
            if (observed.raw === previous.raw) return yield* Effect.failCause(result.cause)
            if (observed.raw !== raw || observed.choices.revision !== choices.revision)
              return yield* new Failure({
                code: "conflict",
                message: "Saved Hook choices changed elsewhere; refresh before retrying",
              })
            yield* write(previous.raw).pipe(
              Effect.mapError(
                () =>
                  new Failure({
                    code: "rollback",
                    message: "Hook choice update failed and its previous saved state could not be restored",
                  }),
              ),
            )
            return yield* Effect.failCause(result.cause)
          }),
        )
      }),
    )
  return { read: read.pipe(Effect.map((snapshot) => snapshot.choices)), change }
}

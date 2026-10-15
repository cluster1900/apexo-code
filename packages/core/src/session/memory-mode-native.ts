export * as SessionMemoryModeNative from "./memory-mode-native"

import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { MemoryMode } from "@apexo/schema/memory-mode"
import { SessionID } from "@apexo/schema/session-id"
import { ConfigMemory } from "../config/memory"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex"
import { MemoryPolicy } from "../memory-policy"
import { SessionLifecycle } from "./lifecycle"
import { SessionStore } from "./store"
import { SessionMemoryModeTable } from "./sql"

export class Failure extends Schema.TaggedErrorClass<Failure>()("NativeMemoryFailure", {
  code: Schema.Literals(["missing", "disabled", "unsupported", "busy", "changed", "forbidden", "invalid", "storage"]),
  message: Schema.String,
}) {}
export type Settings = { memory?: typeof ConfigMemory.Info.Type; memory_v2?: typeof ConfigMemory.V2.Type }
export type Snapshot = { info: MemoryMode.Info; revision: string; backend: "legacy" | "v2" }
export interface Interface {
  readonly get: (id: SessionID, settings: Settings) => Effect.Effect<Snapshot, Failure | SessionLifecycle.Closed>
  readonly set: (
    id: SessionID,
    settings: Settings,
    enabled: boolean,
    busy: boolean,
  ) => Effect.Effect<Snapshot, Failure | SessionLifecycle.Closed>
  readonly run: <A, E, R>(
    id: SessionID,
    settings: Settings,
    revision: string,
    action: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | Failure | SessionLifecycle.Closed, R>
  readonly commit: <A, E, R>(
    id: SessionID,
    settings: Settings,
    revision: string,
    action: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | Failure | SessionLifecycle.Closed, R>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionMemoryModeNative") {}
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const sessions = yield* SessionStore.Service
    const lifecycle = yield* SessionLifecycle.Service
    const flags = yield* MemoryPolicy.flags.pipe(Effect.orDie)
    const locks = KeyedMutex.makeUnsafe<SessionID>()
    const active = new Map<SessionID, Set<{ abort: AbortController; done: Deferred.Deferred<void> }>>()
    const snapshot = Effect.fn("SessionMemoryModeNative.snapshot")(function* (id: SessionID, settings: Settings) {
      if (!(yield* sessions.get(id))) return yield* new Failure({ code: "missing", message: "Session not found" })
      const policy = yield* MemoryPolicy.backend(database.db, id, { ...settings, profile: flags.profile })
      const row = yield* database.db
        .select()
        .from(SessionMemoryModeTable)
        .where(eq(SessionMemoryModeTable.session_id, id))
        .get()
        .pipe(Effect.orDie)
      const source = !flags.profile
        ? "profile"
        : flags.enabled === false || policy.restricted
          ? "process"
          : row
            ? "session"
            : flags.enabled !== undefined
              ? "environment"
              : policy.configured !== undefined
                ? "config"
                : "default"
      return {
        info: {
          enabled:
            flags.profile &&
            flags.enabled !== false &&
            !policy.restricted &&
            (row?.enabled ?? flags.enabled ?? policy.configured ?? false),
          busy: false,
          canToggle: flags.profile && flags.enabled !== false && !policy.restricted,
          source,
        } satisfies MemoryMode.Info,
        revision: row?.revision ?? "initial",
        backend: policy.backend,
      }
    })
    return Service.of({
      get: (id, settings) => lifecycle.use(id, snapshot(id, settings)),
      set: (id, settings, enabled, busy) =>
        Effect.gen(function* () {
          const stopped: Deferred.Deferred<void>[] = []
          const result = yield* lifecycle.use(
            id,
            locks.withLock(id)(
              Effect.gen(function* () {
                const current = yield* snapshot(id, settings)
                if (!current.info.canToggle)
                  return yield* new Failure({
                    code: "disabled",
                    message: "Memory is disabled by the active profile or process policy",
                  })
                if (enabled && !current.info.enabled && busy)
                  return yield* new Failure({ code: "busy", message: "Enable Memory when the Session is idle" })
                if (current.info.source !== "session" || current.info.enabled !== enabled) {
                  const values = { session_id: id, enabled, revision: randomUUID() }
                  yield* database.db
                    .insert(SessionMemoryModeTable)
                    .values(values)
                    .onConflictDoUpdate({ target: SessionMemoryModeTable.session_id, set: values })
                    .run()
                    .pipe(Effect.orDie)
                  for (const worker of active.get(id) ?? []) {
                    stopped.push(worker.done)
                    worker.abort.abort()
                  }
                }
                return yield* snapshot(id, settings)
              }).pipe(Effect.uninterruptible),
            ),
          )
          // Join after releasing the short mutation lease and keyed commit lock.
          yield* Effect.forEach(stopped, (done) => Deferred.await(done), { discard: true })
          return result
        }),
      run: <A, E, R>(id: SessionID, settings: Settings, revision: string, action: Effect.Effect<A, E, R>) =>
        lifecycle.run(
          id,
          Effect.acquireUseRelease(
            locks.withLock(id)(
              Effect.gen(function* () {
                const current = yield* snapshot(id, settings)
                if (!current.info.enabled || current.revision !== revision)
                  return yield* new Failure({ code: "changed", message: "Memory mode changed before execution" })
                const worker = { abort: new AbortController(), done: Deferred.makeUnsafe<void>() }
                const entries = active.get(id) ?? new Set<typeof worker>()
                entries.add(worker)
                active.set(id, entries)
                return worker
              }),
            ),
            (worker) =>
              action.pipe(
                Effect.raceFirst(
                  Effect.callback<never, Failure>((resume) => {
                    const abort = () =>
                      resume(
                        Effect.fail(new Failure({ code: "changed", message: "Memory mode changed during execution" })),
                      )
                    if (worker.abort.signal.aborted) abort()
                    worker.abort.signal.addEventListener("abort", abort, { once: true })
                    return Effect.sync(() => worker.abort.signal.removeEventListener("abort", abort))
                  }),
                ),
              ),
            (worker) =>
              Effect.gen(function* () {
                active.get(id)?.delete(worker)
                if (active.get(id)?.size === 0) active.delete(id)
                yield* Deferred.succeed(worker.done, undefined)
              }),
          ),
        ),
      commit: (id, settings, revision, action) =>
        lifecycle.use(
          id,
          locks.withLock(id)(
            Effect.gen(function* () {
              const current = yield* snapshot(id, settings)
              if (!current.info.enabled || current.revision !== revision)
                return yield* new Failure({ code: "changed", message: "Memory mode changed; retry the operation" })
              return yield* action
            }).pipe(Effect.uninterruptible),
          ),
        ),
    })
  }),
)
export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, SessionStore.node, SessionLifecycle.node],
})

import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { Database } from "@apexo/core/database/database"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { SessionMemoryModeTable } from "@apexo/core/session/sql"
import { MemoryMode } from "@apexo/schema/memory-mode"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"
import { SessionMemoryBackend } from "./memory-backend"

export class Disabled extends Schema.TaggedErrorClass<Disabled>()("SessionMemoryDisabled", {}) {}
export class Busy extends Schema.TaggedErrorClass<Busy>()("SessionMemoryBusy", {}) {}

export interface Interface {
  readonly get: (id?: SessionID) => Effect.Effect<MemoryMode.Info>
  readonly set: (id: SessionID, enabled: boolean) => Effect.Effect<MemoryMode.Info, Disabled | Busy>
  readonly run: <A, E, R>(
    id: SessionID,
    action: (revision: string) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | Disabled, R>
  readonly commit: <A, E, R>(
    id: SessionID,
    revision: string,
    action: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | Disabled, R>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionMemoryMode") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.Service
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const status = yield* SessionStatus.Service
    const backend = yield* SessionMemoryBackend.Service
    const state = yield* InstanceState.make(() =>
      Effect.gen(function* () {
        const entries = new Map<SessionID, { lock: Semaphore.Semaphore; abort: AbortController }>()
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            for (const entry of entries.values()) entry.abort.abort()
            entries.clear()
          }),
        )
        return entries
      }),
    )
    const entry = Effect.fn("SessionMemoryMode.entry")(function* (id: SessionID) {
      const entries = yield* InstanceState.get(state)
      const found = entries.get(id)
      if (found) return found
      const value = { lock: Semaphore.makeUnsafe(1), abort: new AbortController() }
      entries.set(id, value)
      return value
    })
    const snapshot = Effect.fn("SessionMemoryMode.snapshot")(function* (id?: SessionID) {
      const row = id
        ? yield* database.db
            .select()
            .from(SessionMemoryModeTable)
            .where(eq(SessionMemoryModeTable.session_id, id))
            .get()
            .pipe(Effect.orDie)
        : undefined
      const policy = yield* backend.get(id)
      const configured = policy.configured
      const source =
        flags.runtimeProfile !== "grok-build"
          ? "profile"
          : flags.grokMemory === false
            ? "process"
            : row
              ? "session"
              : flags.grokMemory === true
                ? "environment"
                : configured !== undefined
                  ? "config"
                  : "default"
      return {
        info: {
          enabled:
            source === "profile" || source === "process" || policy.restricted
              ? false
              : row
                ? row.enabled
                : (flags.grokMemory ?? configured ?? false),
          busy: id ? (yield* status.get(id)).type !== "idle" : false,
          canToggle: source !== "profile" && source !== "process" && !policy.restricted,
          source,
        } satisfies MemoryMode.Info,
        revision: row?.revision ?? "initial",
      }
    })
    const save = Effect.fn("SessionMemoryMode.save")(function* (id: SessionID, enabled: boolean) {
      const values = { session_id: id, enabled, revision: randomUUID() }
      yield* database.db
        .insert(SessionMemoryModeTable)
        .values(values)
        .onConflictDoUpdate({ target: SessionMemoryModeTable.session_id, set: values })
        .run()
        .pipe(Effect.orDie)
      const current = yield* entry(id)
      current.abort.abort()
      current.abort = new AbortController()
    })
    return Service.of({
      get: Effect.fn("SessionMemoryMode.get")(function* (id) {
        return (yield* snapshot(id)).info
      }),
      set: Effect.fn("SessionMemoryMode.set")(
        function* (id, enabled) {
          const current = yield* entry(id)
          return yield* current.lock.withPermit(
            Effect.gen(function* () {
              const value = yield* snapshot(id)
              if (!value.info.canToggle) return yield* new Disabled()
              if (enabled && !value.info.enabled && value.info.busy) return yield* new Busy()
              if (value.info.source !== "session" || value.info.enabled !== enabled) yield* save(id, enabled)
              return (yield* snapshot(id)).info
            }).pipe(Effect.uninterruptible),
          )
        },
        (effect, id, _enabled) =>
          lifecycle.use(id, effect).pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.fail(new Disabled()))),
      ),
      run: <A, E, R>(id: SessionID, action: (revision: string) => Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
          const current = yield* entry(id)
          const start = yield* current.lock.withPermit(
            Effect.gen(function* () {
              const value = yield* snapshot(id)
              if (!value.info.enabled) return yield* new Disabled()
              return { revision: value.revision, signal: current.abort.signal }
            }),
          )
          return yield* action(start.revision).pipe(
            Effect.raceFirst(
              Effect.callback<never, Disabled>((resume) => {
                const abort = () => resume(Effect.fail(new Disabled()))
                if (start.signal.aborted) abort()
                start.signal.addEventListener("abort", abort, { once: true })
                return Effect.sync(() => start.signal.removeEventListener("abort", abort))
              }),
            ),
          )
        }).pipe(
          (effect) => lifecycle.run(id, effect),
          Effect.catchTag("SessionLifecycle.Closed", () => Effect.fail(new Disabled())),
        ),
      commit: <A, E, R>(id: SessionID, revision: string, action: Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
          const current = yield* entry(id)
          return yield* current.lock.withPermit(
            Effect.gen(function* () {
              const value = yield* snapshot(id)
              if (!value.info.enabled || value.revision !== revision) return yield* new Disabled()
              return yield* action
            }).pipe(Effect.uninterruptible),
          )
        }).pipe(
          (effect) => lifecycle.use(id, effect),
          Effect.catchTag("SessionLifecycle.Closed", () => Effect.fail(new Disabled())),
        ),
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [SessionLifecycle.node, RuntimeFlags.node, Database.node, SessionStatus.node, SessionMemoryBackend.node],
})
export * as SessionMemoryMode from "./memory-mode"

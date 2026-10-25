export * as SessionRunCoordinator from "./run-coordinator"

import { Cause, Deferred, Effect, Exit, Fiber, FiberSet, Schema, Scope } from "effect"

export class ControlCancelled extends Schema.TaggedErrorClass<ControlCancelled>()("Session.ControlCancelled", {}) {}

/** Serializes execution and explicit controls for each key within this process. */
export interface Coordinator<Key, E> {
  readonly active: Effect.Effect<ReadonlySet<Key>>
  readonly run: (key: Key) => Effect.Effect<void, E>
  readonly wake: (key: Key) => Effect.Effect<void>
  /** Joins the captured ownership chain without starting or restarting a drain. */
  readonly wait: (key: Key) => Effect.Effect<void, E>
  readonly control: <A, CE>(key: Key, action: Effect.Effect<A, CE>) => Effect.Effect<A, CE | ControlCancelled>
  readonly interrupt: (key: Key, when?: () => boolean) => Effect.Effect<void>
}

type Control = {
  state: "queued" | "claimed" | "cancelled"
  readonly execute: Effect.Effect<void>
  readonly cancel: () => void
}
type Entry<E> = {
  readonly done: Deferred.Deferred<void, E>
  readonly controls: Control[]
  owner?: Fiber.Fiber<void, never>
  mode: "drain" | "control"
  observed: boolean
  pendingWake: boolean
  pendingForce: boolean
  stopping: boolean
}

export const make = <Key, E>(options: {
  /** A revoked incarnation may neither join work nor create a successor. Checked at registration. */
  readonly available?: (key: Key) => boolean
  /** Invoke controls only at provider-safe boundaries, before loading the next projected history. */
  readonly drain: (key: Key, force: boolean, controls: Effect.Effect<void>) => Effect.Effect<void, E>
}): Effect.Effect<Coordinator<Key, E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const active = new Map<Key, Entry<E>>()
    const unobservedFailure = new Map<Key, Cause.Cause<E>>()
    const available = (key: Key) => options.available?.(key) ?? true
    const fork = yield* FiberSet.makeRuntime<never, void, never>()
    const makeEntry = (observed = false): Entry<E> => ({
      done: Deferred.makeUnsafe<void, E>(),
      controls: [],
      mode: "drain",
      observed,
      pendingWake: false,
      pendingForce: false,
      stopping: false,
    })
    const flush = (key: Key, entry: Entry<E>): Effect.Effect<void> =>
      Effect.suspend(() => {
        // Bound one boundary's work. New controls are picked up at the next boundary or final handoff.
        const count = entry.controls.length
        return Effect.forEach(
          Array.from({ length: count }),
          () =>
            Effect.suspend(() => {
              const control = entry.controls.shift()
              if (!control || control.state !== "queued" || entry.stopping || !available(key)) {
                control?.cancel()
                return Effect.void
              }
              control.state = "claimed"
              return control.execute
            }),
          { discard: true },
        )
      })
    const start = (key: Key, entry: Entry<E>, mode: Entry<E>["mode"], force: boolean, successor = false) => {
      const ready = Deferred.makeUnsafe<void>()
      entry.mode = mode
      const owner = fork(
        (successor ? Effect.yieldNow : Deferred.await(ready)).pipe(
          Effect.andThen(
            Effect.suspend(() =>
              !available(key)
                ? Effect.interrupt
                : mode === "control"
                  ? flush(key, entry)
                  : options.drain(key, force, flush(key, entry)),
            ),
          ),
          Effect.onExit((exit) => Effect.sync(() => settle(key, entry, exit))),
          Effect.exit,
          Effect.asVoid,
        ),
      )
      entry.owner = owner
      if (!successor) Deferred.doneUnsafe(ready, Effect.void)
    }
    const settle = (key: Key, entry: Entry<E>, exit: Exit.Exit<void, E>) => {
      if (Exit.isSuccess(exit) && !entry.stopping && available(key)) {
        if (entry.mode === "control" && (entry.pendingWake || entry.pendingForce)) {
          const force = entry.pendingForce
          entry.pendingWake = false
          entry.pendingForce = false
          start(key, entry, "drain", force, true)
          return
        }
        if (entry.controls.some((control) => control.state === "queued")) {
          start(key, entry, "control", false, true)
          return
        }
        if (entry.pendingWake || entry.pendingForce) {
          const force = entry.pendingForce
          entry.pendingWake = false
          entry.pendingForce = false
          start(key, entry, "drain", force, true)
          return
        }
      }
      for (const control of entry.controls) control.cancel()
      entry.controls.length = 0
      const successor = entry.pendingWake && available(key) ? makeEntry() : undefined
      if (successor === undefined) {
        active.delete(key)
        if (Exit.isFailure(exit) && !Cause.hasInterrupts(exit.cause) && !entry.observed) {
          unobservedFailure.set(key, exit.cause)
        }
      } else {
        active.set(key, successor)
        start(key, successor, "drain", false, true)
      }
      Deferred.doneUnsafe(entry.done, exit)
    }
    const run = (key: Key): Effect.Effect<void, E> =>
      Effect.uninterruptibleMask((restore) => {
        if (!available(key)) return restore(Effect.interrupt)
        unobservedFailure.delete(key)
        const entry = active.get(key)
        if (entry !== undefined) {
          if (entry.stopping) return restore(Deferred.await(entry.done).pipe(Effect.andThen(run(key))))
          if (entry.mode === "control") entry.pendingForce = true
          entry.observed = true
          return restore(Deferred.await(entry.done))
        }
        const next = makeEntry(true)
        active.set(key, next)
        start(key, next, "drain", true)
        return restore(Deferred.await(next.done))
      })
    const wake = (key: Key) =>
      Effect.sync(() => {
        if (!available(key)) return
        unobservedFailure.delete(key)
        const entry = active.get(key)
        if (entry !== undefined) {
          entry.pendingWake = true
          return
        }
        const next = makeEntry(false)
        active.set(key, next)
        start(key, next, "drain", false)
      })
    const wait = (key: Key) =>
      Effect.suspend(() => {
        const entry = active.get(key)
        if (entry) {
          entry.observed = true
          return Deferred.await(entry.done)
        }
        const failed = unobservedFailure.get(key)
        if (failed) {
          unobservedFailure.delete(key)
          return Effect.failCause(failed)
        }
        return Effect.void
      })
    const control = <A, CE>(key: Key, action: Effect.Effect<A, CE>): Effect.Effect<A, CE | ControlCancelled> =>
      Effect.uninterruptibleMask((restore) => {
        const previous = active.get(key)
        if (!available(key) || previous?.stopping) return Effect.fail(new ControlCancelled())
        unobservedFailure.delete(key)
        const entry = previous ?? makeEntry(true)
        const result = Deferred.makeUnsafe<A, CE | ControlCancelled>()
        const item: Control = {
          state: "queued",
          cancel: () => {
            if (item.state !== "queued") return
            item.state = "cancelled"
            Deferred.doneUnsafe(result, Effect.fail(new ControlCancelled()))
          },
          execute: Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const exit = yield* restore(action).pipe(Effect.exit)
              yield* Deferred.done(result, exit)
              if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) return yield* Effect.interrupt
            }),
          ),
        }
        entry.controls.push(item)
        if (!previous) {
          active.set(key, entry)
          start(key, entry, "control", false)
        }
        return restore(Deferred.await(result)).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              item.cancel()
              if (item.state === "cancelled") {
                const index = entry.controls.indexOf(item)
                if (index >= 0) entry.controls.splice(index, 1)
              }
            }),
          ),
        )
      })
    const interrupt = (key: Key, when?: () => boolean): Effect.Effect<void> =>
      Effect.suspend(() => {
        unobservedFailure.delete(key)
        const entry = active.get(key)
        if (entry?.owner === undefined || (when && !when())) return Effect.void
        entry.stopping = true
        entry.pendingWake = false
        entry.pendingForce = false
        for (const control of entry.controls) control.cancel()
        return Fiber.interrupt(entry.owner)
      })
    return { active: Effect.sync(() => new Set(active.keys())), run, wake, wait, control, interrupt }
  })

export * as SessionScheduleOwner from "./schedule-owner"

import { Clock, Context, Deferred, Effect, Fiber, FiberSet, Layer } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { SessionLifecycle } from "./lifecycle"
import { SessionScheduleStore } from "./schedule-store"
import { SessionTaskOrigin } from "./task-origin"
import type { SessionScheduleRecord } from "./schedule-record"

export type Launch = (id: SessionTaskOrigin.OccurrenceID, current: () => boolean) => Effect.Effect<void>
type Entry = {
  readonly claim: SessionLifecycle.Claim
  readonly token: object
  launch: Launch
  epoch: number
  stopped: boolean
  closed: boolean
  changed: Deferred.Deferred<void>
  readonly jobs: Map<SessionTaskOrigin.OccurrenceID, Fiber.Fiber<void, never>>
  readonly restoring: Map<object, { epoch: number; intents: readonly SessionScheduleRecord.Intent[] }>
  timer?: Fiber.Fiber<void, never>
  admitting?: Deferred.Deferred<void>
  stop?: {
    readonly done: Deferred.Deferred<void>
    readonly admitting?: Deferred.Deferred<void>
    started: boolean
    reason: "stopped" | "restart_required"
    readonly restoring: readonly SessionScheduleRecord.Intent[]
  }
  release: () => void
}

const make = Effect.gen(function* () {
  const lifecycle = yield* SessionLifecycle.Service
  const store = yield* SessionScheduleStore.Service
  const fork = yield* FiberSet.makeRuntime<never, void, never>()
  const entries = new Map<SessionLifecycle.Claim, Entry>()
  const signal = (entry: Entry) => Deferred.succeed(entry.changed, undefined)
  const stop = (claim: SessionLifecycle.Claim, reason: "stopped" | "restart_required" = "stopped") => {
    const entry = entries.get(claim)
    if (!entry) return
    entry.stop ??= {
      done: Deferred.makeUnsafe<void>(),
      admitting: entry.admitting,
      started: false,
      reason,
      restoring: [...entry.restoring.values()]
        .filter((item) => item.epoch === entry.epoch)
        .flatMap((item) => item.intents),
    }
    entry.stopped = true
    entry.epoch++
    if (reason === "stopped") entry.stop.reason = reason
  }
  const joinStop = (claim: SessionLifecycle.Claim) =>
    Effect.gen(function* () {
      const entry = entries.get(claim)
      if (!entry?.stopped || !entry.stop) return
      const stop = entry.stop
      if (stop.started) return yield* Deferred.await(stop.done)
      stop.started = true
      const reason = stop.reason
      yield* signal(entry)
      yield* store.list(claim.sessionID).pipe(
        Effect.flatMap((items) =>
          Effect.forEach(
            items.filter((item) => item.owner === store.owner && item.status === "active"),
            (item) => store.pause(claim.sessionID, item.id, reason),
            { discard: true },
          ),
        ),
        Effect.catch(() =>
          Effect.logWarning("Stopped schedules could not retain paused state; their current owner remains fenced"),
        ),
        Effect.ensuring(
          Effect.gen(function* () {
            if (stop.admitting) yield* Deferred.await(stop.admitting)
            yield* Effect.forEach([...entry.jobs.values()], Fiber.interrupt, {
              discard: true,
              concurrency: "unbounded",
            })
            if (reason === "restart_required" && stop.reason === "stopped")
              yield* store.list(claim.sessionID).pipe(
                Effect.flatMap((items) =>
                  Effect.forEach(
                    items.filter(
                      (item) =>
                        item.owner === store.owner &&
                        item.status === "paused" &&
                        item.blockedReason === "restart_required",
                    ),
                    (item) => store.pause(claim.sessionID, item.id, "stopped"),
                    { discard: true },
                  ),
                ),
                Effect.catch(() => Effect.logWarning("Stopped schedule pause reason could not be retained")),
              )
            if (stop.reason === "stopped")
              yield* Effect.forEach(stop.restoring, store.stopRestoration, { discard: true }).pipe(
                Effect.catch(() => Effect.logWarning("Interrupted restoration could not retain stopped intent")),
              )
          }),
        ),
        Effect.ensuring(Deferred.succeed(stop.done, undefined)),
      )
    }).pipe(Effect.uninterruptible)
  const close = (entry: Entry) =>
    Effect.gen(function* () {
      if (entries.get(entry.claim) !== entry) return
      stop(entry.claim, "restart_required")
      entry.closed = true
      yield* joinStop(entry.claim)
      if (entry.timer) yield* Fiber.interrupt(entry.timer)
      entries.delete(entry.claim)
      entry.release()
    })
  const restoring = <A, E, R>(
    claim: SessionLifecycle.Claim,
    intents: readonly SessionScheduleRecord.Intent[],
    effect: Effect.Effect<A, E, R>,
  ) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const entry = entries.get(claim)
        const key = {}
        if (entry && !entry.stopped && !entry.closed && lifecycle.available(claim))
          entry.restoring.set(key, { epoch: entry.epoch, intents })
        return () => {
          entry?.restoring.delete(key)
        }
      }),
      () => effect,
      (release) => Effect.sync(release),
    )
  const run = (entry: Entry) =>
    Effect.gen(function* () {
      while (!entry.closed && lifecycle.available(entry.claim)) {
        // Capture the wake before reading storage; a mutation during the read cannot be lost.
        entry.changed = Deferred.makeUnsafe<void>()
        const changed = entry.changed
        if (entry.stopped) {
          yield* Deferred.await(changed)
          continue
        }
        const now = yield* Clock.currentTimeMillis
        const items = (yield* store.list(entry.claim.sessionID)).filter(
          (item) => item.owner === store.owner && store.state(item, now).status === "active",
        )
        for (const item of items) {
          if (entry.stopped || entry.closed) break
          if (item.nextFireAt > now) continue
          const epoch = entry.epoch
          const admitting = Deferred.makeUnsafe<void>()
          entry.admitting = admitting
          const claimed = yield* store.claim(entry.claim.sessionID, item.id).pipe(
            Effect.catch(() => store.pause(entry.claim.sessionID, item.id, "unavailable").pipe(Effect.as(undefined))),
            Effect.ensuring(Deferred.succeed(admitting, undefined)),
            Effect.ensuring(
              Effect.sync(() => {
                if (entry.admitting === admitting) entry.admitting = undefined
              }),
            ),
          )
          if (!claimed) continue
          if (entry.epoch !== epoch || entry.stopped || entry.closed) {
            yield* store.failClaim(claimed.id, true)
            continue
          }
          const ready = Deferred.makeUnsafe<void>()
          const current = () =>
            !entry.closed && !entry.stopped && entry.epoch === epoch && lifecycle.available(entry.claim)
          const job = fork(
            Deferred.await(ready).pipe(
              Effect.andThen(lifecycle.owned(entry.claim, entry.launch(claimed.id, current))),
              Effect.ensuring(Effect.sync(() => entry.jobs.delete(claimed.id))),
            ),
          )
          entry.jobs.set(claimed.id, job)
          yield* Deferred.succeed(ready, undefined)
        }
        const latest = (yield* store.list(entry.claim.sessionID)).filter(
          (item) => item.owner === store.owner && store.state(item, now).status === "active",
        )
        const deadline = Math.min(...latest.map((item) => Math.min(item.nextFireAt, item.expiresAt)))
        if (!Number.isFinite(deadline)) yield* Deferred.await(changed)
        else
          yield* Effect.raceFirst(
            Effect.sleep(Math.max(1, deadline - (yield* Clock.currentTimeMillis))),
            Deferred.await(changed),
          )
      }
    }).pipe(Effect.catch(() => Effect.logWarning("Schedule timer stopped because its saved intent is unavailable")))
  yield* Effect.addFinalizer(() => Effect.forEach([...entries.values()], close, { discard: true }))
  return {
    stop,
    joinStop,
    restoring,
    checkpoint: (claim: SessionLifecycle.Claim) => {
      const entry = entries.get(claim)
      const epoch = entry?.epoch
      return () =>
        !!entry &&
        entries.get(claim) === entry &&
        entry.epoch === epoch &&
        !entry.stopped &&
        !entry.closed &&
        lifecycle.available(claim)
    },
    bind: (claim: SessionLifecycle.Claim, launch: Launch) =>
      Effect.gen(function* () {
        const previous = entries.get(claim)
        if (previous) return previous.token
        const entry: Entry = {
          claim,
          token: {},
          launch,
          epoch: 0,
          stopped: false,
          closed: false,
          changed: Deferred.makeUnsafe<void>(),
          jobs: new Map(),
          restoring: new Map(),
          release: () => {},
        }
        entry.release = yield* lifecycle.register(claim, entry, close(entry))
        entries.set(claim, entry)
        const ready = Deferred.makeUnsafe<void>()
        entry.timer = fork(Deferred.await(ready).pipe(Effect.andThen(run(entry))))
        yield* Deferred.succeed(ready, undefined)
        return entry.token
      }),
    changed: (claim: SessionLifecycle.Claim, activate = false) =>
      Effect.gen(function* () {
        const entry = entries.get(claim)
        if (!entry || entry.closed) return
        // Only explicit create/resume calls activate. Reads/prompts/Plan replies never rearm timers.
        if (activate) {
          yield* joinStop(claim)
          entry.stopped = false
          entry.stop = undefined
        }
        yield* signal(entry)
      }),
    unbind: (claim: SessionLifecycle.Claim, token: object) =>
      Effect.suspend(() => {
        const entry = entries.get(claim)
        return entry?.token === token ? close(entry) : Effect.void
      }),
  }
})
export type Interface = Effect.Success<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionScheduleOwner") {}
export const node = makeGlobalNode({
  service: Service,
  deps: [SessionLifecycle.node, SessionScheduleStore.node],
  layer: Layer.effect(Service, make),
})

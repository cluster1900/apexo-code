export * as Scheduler from "./scheduler"

import { randomUUID } from "node:crypto"
import { Cause, Clock, Deferred, Effect, Exit, Schema, Semaphore } from "effect"
import { BackgroundJob } from "./background-job"
import { SchedulerStore } from "./scheduler-store"

export const MAX_TASKS = 50
export const TTL_MS = 7 * 24 * 60 * 60 * 1000

export type Schedule = SchedulerStore.Record

export class SchedulerError extends Schema.TaggedErrorClass<SchedulerError>()("SchedulerError", {
  message: Schema.String,
}) {}

type Entry = {
  schedule: Schedule
  changed: Deferred.Deferred<void>
  run: (schedule: Schedule) => Effect.Effect<string, unknown>
  stopped: Deferred.Deferred<void>
  done: Deferred.Deferred<void>
}

export function nextFireAt(schedule: Schedule) {
  return (schedule.lastFireAt ?? schedule.createdAt) + schedule.intervalSeconds * 1000
}

/** One engine per background registry; updates wake timers without cancelling an in-flight fire. */
export type Ownership = {
  current: (sessionID: string) => Effect.Effect<string | undefined, unknown>
  legacy: (schedule: Schedule) => Effect.Effect<boolean, unknown>
}

export function make(background: BackgroundJob.Interface, store?: SchedulerStore.Interface, ownership?: Ownership) {
  const entries = new Map<string, Entry>()
  const recoveryErrors = new Map<string, string>()
  const lock = Semaphore.makeUnsafe(1)
  const persist = (schedule: Schedule) =>
    store && schedule.resume
      ? store.save(schedule).pipe(Effect.mapError((error) => new SchedulerError({ message: error.message })))
      : Effect.void
  const forget = (schedule: Schedule) =>
    store && schedule.resume
      ? store
          .remove(schedule.id, schedule.ownerSessionId)
          .pipe(Effect.mapError((error) => new SchedulerError({ message: error.message })))
      : Effect.void

  const verify = (schedule: Schedule) =>
    Effect.gen(function* () {
      if (!ownership || !schedule.resume) return schedule
      const createdEventID = yield* ownership.current(schedule.ownerSessionId)
      if (!createdEventID) return
      if (schedule.resume.createdEventID)
        return schedule.resume.createdEventID === createdEventID ? schedule : undefined
      if (!(yield* ownership.legacy(schedule)))
        return yield* new SchedulerError({
          message: "Legacy schedule ownership could not be verified; the saved schedule remains inactive",
        })
      return { ...schedule, resume: { ...schedule.resume, createdEventID } }
    }).pipe(
      Effect.mapError((error) =>
        error instanceof SchedulerError
          ? error
          : new SchedulerError({ message: "Cannot verify scheduled Session ownership" }),
      ),
    )

  const report = (schedule: Schedule) =>
    background.report({
      id: schedule.id,
      metadata: { ...schedule, scheduler: true, nextFireAt: nextFireAt(schedule) },
    })

  const drain = Effect.fn("Scheduler.drain")(function* (entry: Entry) {
    let output = ""
    while (entries.get(entry.schedule.id) === entry) {
      const now = yield* Clock.currentTimeMillis
      const wakeAt = Math.min(nextFireAt(entry.schedule), entry.schedule.expiresAt)
      if (wakeAt > now) {
        yield* Effect.raceFirst(Effect.sleep(wakeAt - now), Deferred.await(entry.changed))
        continue
      }
      const fire = yield* lock.withPermit(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const next = nextFireAt(entry.schedule)
          if (next > entry.schedule.expiresAt) {
            yield* forget(entry.schedule)
            return { done: true } as const
          }
          // An update can win the timer race; recheck while holding the mutation lock.
          if (next > now) return { done: false } as const
          const owner = yield* verify(entry.schedule)
          if (!owner) {
            yield* forget(entry.schedule)
            return { done: true } as const
          }
          const scheduled = { ...owner, lastFireAt: now, inFlight: true }
          // Commit admission before executing external work; a restart never replays this fire.
          yield* persist(scheduled)
          entry.schedule = scheduled
          yield* report(entry.schedule)
          return { done: false, schedule: { ...entry.schedule } } as const
        }),
      )
      if (fire.done) return output
      if (!fire.schedule) continue
      const result = yield* entry.run(fire.schedule).pipe(Effect.exit)
      if (Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause)) return yield* Effect.failCause(result.cause)
      output = Exit.isSuccess(result) ? result.value : String(Cause.squash(result.cause))
      yield* background.report({
        id: entry.schedule.id,
        output,
        metadata: { lastError: Exit.isFailure(result) ? output : undefined },
      })
      yield* lock.withPermit(
        Effect.gen(function* () {
          if (entries.get(entry.schedule.id) !== entry) return
          const completed = { ...entry.schedule, inFlight: false }
          yield* completed.recurring ? persist(completed) : forget(completed)
          entry.schedule = completed
        }),
      )
      if (!entry.schedule.recurring) return output
    }
    return output
  })

  const start = Effect.fn("Scheduler.start")(function* (schedule: Schedule, run: Entry["run"]) {
    const entry: Entry = {
      schedule,
      changed: yield* Deferred.make<void>(),
      run,
      stopped: yield* Deferred.make<void>(),
      done: yield* Deferred.make<void>(),
    }
    entries.set(schedule.id, entry)
    return yield* background.start({
      id: schedule.id,
      type: "scheduler",
      title: schedule.prompt.slice(0, 60),
      metadata: {
        ...schedule,
        scheduler: true,
        recoveredInterrupted: schedule.inFlight === true,
        nextFireAt: nextFireAt(schedule),
      },
      onCancel: lock
        .withPermit(
          Effect.gen(function* () {
            yield* forget(entry.schedule)
            entries.delete(schedule.id)
          }),
        )
        .pipe(Effect.orDie),
      run: Effect.raceFirst(drain(entry), Deferred.await(entry.stopped).pipe(Effect.andThen(Effect.interrupt))).pipe(
        Effect.interruptible,
        Effect.ensuring(Effect.sync(() => entries.delete(schedule.id))),
        Effect.ensuring(Deferred.succeed(entry.done, undefined)),
      ),
    })
  })

  const create = Effect.fn("Scheduler.create")(function* (input: {
    ownerSessionId: string
    prompt: string
    intervalSeconds: number
    recurring: boolean
    fireImmediately: boolean
    durable?: boolean
    resume?: typeof SchedulerStore.Resume.Type
    run: Entry["run"]
  }) {
    return yield* lock.withPermit(
      Effect.gen(function* () {
        const active = (yield* background.list()).filter(
          (job) =>
            job.type === "scheduler" &&
            job.status === "running" &&
            job.metadata?.ownerSessionId === input.ownerSessionId,
        )
        if (active.length >= MAX_TASKS)
          return yield* new SchedulerError({ message: `Maximum ${MAX_TASKS} active scheduled tasks per session` })
        const now = yield* Clock.currentTimeMillis
        if (input.durable && (!store || !input.resume))
          return yield* new SchedulerError({
            message: "Durable scheduling requires a persistent store and a recoverable session context",
          })
        const createdEventID =
          ownership && input.resume
            ? yield* ownership
                .current(input.ownerSessionId)
                .pipe(
                  Effect.mapError(() => new SchedulerError({ message: "Cannot verify scheduled Session ownership" })),
                )
            : undefined
        if (ownership && input.resume && !createdEventID)
          return yield* new SchedulerError({ message: "Scheduled Session has no durable creation identity" })
        const schedule: Schedule = {
          id: `job_${randomUUID()}`,
          ownerSessionId: input.ownerSessionId,
          prompt: input.prompt,
          intervalSeconds: input.intervalSeconds,
          recurring: input.recurring,
          durable: input.durable === true,
          resume: input.resume && createdEventID ? { ...input.resume, createdEventID } : input.resume,
          createdAt: now - (input.fireImmediately ? input.intervalSeconds * 1000 : 0),
          expiresAt: now + TTL_MS,
        }
        yield* persist(schedule)
        const job = yield* start(schedule, input.run)
        return { job, schedule }
      }).pipe(Effect.uninterruptible),
    )
  })

  const update = Effect.fn("Scheduler.update")(function* (input: {
    id: string
    ownerSessionId: string
    prompt?: string
    intervalSeconds?: number
    recurring?: boolean
  }) {
    return yield* lock.withPermit(
      Effect.gen(function* () {
        const entry = entries.get(input.id)
        const job = yield* background.get(input.id)
        if (!entry || job?.status !== "running" || entry.schedule.ownerSessionId !== input.ownerSessionId)
          return yield* new SchedulerError({ message: `Scheduled task ${input.id} was not found` })
        const now = yield* Clock.currentTimeMillis
        const next = {
          ...entry.schedule,
          prompt: input.prompt ?? entry.schedule.prompt,
          intervalSeconds: input.intervalSeconds ?? entry.schedule.intervalSeconds,
          recurring: input.recurring ?? entry.schedule.recurring,
        }
        // Shortening an interval into the past schedules one interval from now, not a catch-up burst.
        const updated =
          input.intervalSeconds !== undefined && nextFireAt(next) <= now ? { ...next, lastFireAt: now } : next
        yield* persist(updated)
        entry.schedule = updated
        const changed = entry.changed
        entry.changed = yield* Deferred.make<void>()
        yield* report(entry.schedule)
        yield* Deferred.succeed(changed, undefined)
        return { job: (yield* background.get(input.id))!, schedule: { ...entry.schedule } }
      }).pipe(Effect.uninterruptible),
    )
  })

  const recover = Effect.fn("Scheduler.recover")(function* (
    resolve: (schedule: Schedule) => Effect.Effect<Entry["run"] | undefined, unknown>,
  ) {
    if (!store) return
    const loaded = yield* store.load().pipe(Effect.exit)
    if (Exit.isFailure(loaded)) {
      recoveryErrors.set("*", String(Cause.squash(loaded.cause)))
      return
    }
    recoveryErrors.clear()
    const saved = loaded.value
    yield* Effect.forEach(
      saved,
      (schedule) =>
        lock
          .withPermit(
            Effect.gen(function* () {
              if (entries.has(schedule.id)) return
              yield* store.claim(schedule.ownerSessionId)
              if (
                schedule.expiresAt <= (yield* Clock.currentTimeMillis) ||
                (!schedule.recurring && schedule.lastFireAt !== undefined)
              ) {
                yield* forget(schedule)
                return
              }
              const owner = yield* verify(schedule)
              if (!owner) {
                yield* forget(schedule)
                return
              }
              if (owner !== schedule) yield* persist(owner)
              const run = yield* resolve(owner)
              if (!run) {
                yield* forget(owner)
                return
              }
              yield* start(owner, run)
            }),
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                recoveryErrors.set(schedule.ownerSessionId, String(Cause.squash(cause)))
              }),
            ),
          ),
      { discard: true },
    )
  })

  const shutdown = Effect.gen(function* () {
    const running = Array.from(entries.values())
    yield* Effect.forEach(running, (entry) => Deferred.succeed(entry.stopped, undefined), { discard: true })
    yield* Effect.forEach(running, (entry) => Deferred.await(entry.done), { discard: true })
  })
  return {
    create,
    update,
    recover,
    shutdown,
    recoveryError: (owner: string) => recoveryErrors.get(owner) ?? recoveryErrors.get("*"),
  }
}

export type Interface = ReturnType<typeof make>

import { SessionLifecycle } from "./session/lifecycle"
import { SessionSchema } from "./session/schema"
export * as BackgroundJob from "./background-job"

import { randomUUID } from "node:crypto"
import { and, asc, eq } from "drizzle-orm"
import { Cause, Clock, Context, Deferred, Effect, Exit, Layer, Scope, Schema, SynchronizedRef } from "effect"
import { Identifier } from "./id/id"
import { makeGlobalNode } from "./effect/app-node"
import { Database } from "./database/database"
import { BackgroundJobTable } from "./background-job.sql"

export type Status = "running" | "completed" | "error" | "cancelled"

export type Info = {
  id: string
  type: string
  title?: string
  status: Status
  started_at: number
  completed_at?: number
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

type Active = {
  info: Info
  done: Deferred.Deferred<Info>
  scope: Scope.Closeable
  token: object
  pending: number
  next: number
  output?: { sequence: number; text: string }
  tail: Deferred.Deferred<void>
  promoted: Deferred.Deferred<Info>
  onPromote?: Effect.Effect<void>
  onCancel?: Effect.Effect<void>
  onSettled?: (info: Info) => Effect.Effect<void>
}

type State = {
  jobs: SynchronizedRef.SynchronizedRef<Map<string, Active>>
  scope: Scope.Scope
}

type FinishResult = {
  info?: Info
  done?: Deferred.Deferred<Info>
  scope?: Scope.Closeable
  onSettled?: (info: Info) => Effect.Effect<void>
}

type PromoteResult = {
  info?: Info
  promoted?: Deferred.Deferred<Info>
  onPromote?: Effect.Effect<void>
}

type StartResult = { info: Info } | { info: Info; scope: Scope.Closeable; token: object }

type ExtendResult =
  | { extended: false }
  | {
      extended: true
      previous: Deferred.Deferred<void>
      scope: Scope.Closeable
      tail: Deferred.Deferred<void>
      token: object
      sequence: number
    }

export type StartInput = {
  id?: string
  type: string
  title?: string
  metadata?: Record<string, unknown>
  onPromote?: Effect.Effect<void>
  onCancel?: Effect.Effect<void>
  onSettled?: (info: Info) => Effect.Effect<void>
  run: Effect.Effect<string, unknown>
}

export type ReportInput = { id: string; output?: string; metadata?: Record<string, unknown> }

export type ExtendInput = {
  id: string
  run: Effect.Effect<string, unknown>
}

export type WaitInput = {
  id: string
  timeout?: number
}

export type WaitResult = {
  info?: Info
  timedOut: boolean
}

export type ResumeInput = {
  id: string
  run: Effect.Effect<string, unknown>
}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly start: (input: StartInput) => Effect.Effect<Info>
  readonly report: (input: ReportInput) => Effect.Effect<void>
  readonly extend: (input: ExtendInput) => Effect.Effect<boolean>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly waitForPromotion: (id: string) => Effect.Effect<Info>
  readonly promote: (id: string) => Effect.Effect<Info | undefined>
  readonly cancel: (id: string) => Effect.Effect<Info | undefined>
  /** Reclaims a persisted running job after an owner restart and starts its continuation. */
  readonly resume: (input: ResumeInput) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/BackgroundJob") {}

function snapshot(job: Active): Info {
  return {
    ...job.info,
    ...(job.info.metadata ? { metadata: { ...job.info.metadata } } : {}),
  }
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Makes one scoped, process-local registry. Entries are intentionally not
 * durable: process restart or owner-scope closure loses status and interrupts
 * live work. Persisted observation, restart recovery, and remote workers need a
 * separate durable ownership slice rather than pretending this registry has
 * those semantics.
 */
export const make = Effect.gen(function* () {
  const state: State = {
    jobs: yield* SynchronizedRef.make(new Map()),
    scope: yield* Scope.Scope,
  }

  const settle = Effect.fn("BackgroundJob.settle")(function* (
    id: string,
    token: object,
    sequence: number,
    exit: Exit.Exit<string, unknown>,
  ) {
    const completed_at = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [FinishResult, Map<string, Active>] => {
      const job = jobs.get(id)
      if (!job) return [{}, jobs]
      if (job.token !== token) return [{}, jobs]
      if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
      const pending = job.pending - 1
      const output =
        Exit.isSuccess(exit) && (!job.output || sequence > job.output.sequence)
          ? { sequence, text: exit.value }
          : job.output
      if (Exit.isSuccess(exit) && pending > 0) {
        return [{}, new Map(jobs).set(id, { ...job, pending, output })]
      }
      const status: Exclude<Status, "running"> = Exit.isSuccess(exit)
        ? "completed"
        : Cause.hasInterruptsOnly(exit.cause)
          ? "cancelled"
          : "error"
      const next = {
        ...job,
        onPromote: undefined,
        pending: 0,
        output,
        info: {
          ...job.info,
          status,
          completed_at,
          ...(output ? { output: output.text } : {}),
          ...(Exit.isFailure(exit) ? { error: errorText(Cause.squash(exit.cause)) } : {}),
        },
      }
      return [
        { info: snapshot(next), done: job.done, scope: job.scope, onSettled: job.onSettled },
        new Map(jobs).set(id, next),
      ]
    })
    if (result.info && result.onSettled) yield* result.onSettled(result.info).pipe(Effect.ignore)
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
    if (result.scope) {
      yield* Scope.close(result.scope, Exit.void).pipe(Effect.forkIn(state.scope, { startImmediately: true }))
    }
    return result.info
  })

  const fork = Effect.fn("BackgroundJob.fork")(function* (
    scope: Scope.Scope,
    id: string,
    token: object,
    sequence: number,
    run: Effect.Effect<string, unknown>,
  ) {
    return yield* run.pipe(
      Effect.matchCauseEffect({
        onSuccess: (output) => settle(id, token, sequence, Exit.succeed(output)),
        onFailure: (cause) => settle(id, token, sequence, Exit.failCause(cause)),
      }),
      Effect.asVoid,
      Effect.forkIn(scope, { startImmediately: true }),
    )
  })

  const list: Interface["list"] = Effect.fn("BackgroundJob.list")(function* () {
    return Array.from((yield* SynchronizedRef.get(state.jobs)).values())
      .map(snapshot)
      .toSorted((a, b) => a.started_at - b.started_at)
  })

  const get: Interface["get"] = Effect.fn("BackgroundJob.get")(function* (id) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job) return
    return snapshot(job)
  })

  const start: Interface["start"] = Effect.fn("BackgroundJob.start")(function* (input) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const id = input.id ?? Identifier.ascending("job")
        const started_at = yield* Clock.currentTimeMillis
        const done = yield* Deferred.make<Info>()
        const promoted = yield* Deferred.make<Info>()
        const tail = yield* Deferred.make<void>()
        const result = yield* SynchronizedRef.modifyEffect(
          state.jobs,
          Effect.fnUntraced(function* (jobs) {
            const existing = jobs.get(id)
            if (existing?.info.status === "running") {
              return [{ info: snapshot(existing) }, jobs] as readonly [StartResult, Map<string, Active>]
            }
            const scope = yield* Scope.fork(state.scope, "parallel")
            const token = {}
            const job = {
              info: {
                id,
                type: input.type,
                title: input.title,
                status: "running" as const,
                started_at,
                metadata: input.metadata,
              },
              done,
              scope,
              token,
              pending: 1,
              next: 1,
              tail,
              promoted,
              onPromote: input.onPromote,
              onCancel: input.onCancel,
              onSettled: input.onSettled,
            }
            return [{ info: snapshot(job), scope, token }, new Map(jobs).set(id, job)] as readonly [
              StartResult,
              Map<string, Active>,
            ]
          }),
        )
        if ("scope" in result)
          yield* fork(
            result.scope,
            id,
            result.token,
            0,
            restore(input.run).pipe(Effect.ensuring(Deferred.succeed(tail, undefined))),
          )
        return result.info
      }),
    )
  })

  const report: Interface["report"] = (input) =>
    SynchronizedRef.update(state.jobs, (jobs) => {
      const job = jobs.get(input.id)
      if (!job || job.info.status !== "running") return jobs
      return new Map(jobs).set(input.id, {
        ...job,
        info: {
          ...job.info,
          ...(input.output === undefined ? {} : { output: input.output.slice(-64 * 1024) }),
          metadata: { ...job.info.metadata, ...input.metadata },
        },
      })
    })

  const extend: Interface["extend"] = Effect.fn("BackgroundJob.extend")(function* (input) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const tail = yield* Deferred.make<void>()
        const result = yield* SynchronizedRef.modify(
          state.jobs,
          (jobs): readonly [ExtendResult, Map<string, Active>] => {
            const job = jobs.get(input.id)
            if (!job || job.info.status !== "running") return [{ extended: false }, jobs]
            return [
              { extended: true, previous: job.tail, scope: job.scope, tail, token: job.token, sequence: job.next },
              new Map(jobs).set(input.id, {
                ...job,
                pending: job.pending + 1,
                next: job.next + 1,
                tail,
              }),
            ]
          },
        )
        if (!result.extended) return false
        yield* fork(
          result.scope,
          input.id,
          result.token,
          result.sequence,
          Deferred.await(result.previous).pipe(
            Effect.andThen(restore(input.run)),
            Effect.ensuring(Deferred.succeed(result.tail, undefined)),
          ),
        )
        return true
      }),
    )
  })

  const wait: Interface["wait"] = Effect.fn("BackgroundJob.wait")(function* (input) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(input.id)
    if (!job) return { timedOut: false }
    if (job.info.status !== "running") return { info: snapshot(job), timedOut: false }
    if (input.timeout === undefined) return { info: yield* Deferred.await(job.done), timedOut: false }
    if (input.timeout <= 0) return { info: snapshot(job), timedOut: true }
    // Effect's live clock cannot schedule a timer above the platform's signed-32-bit limit.
    // A host may raise the Grok wait ceiling, so split long waits instead of silently waiting forever.
    let remaining = input.timeout
    while (remaining > 0) {
      const duration = Math.min(remaining, 2 ** 31 - 1)
      const info = yield* Deferred.await(job.done).pipe(Effect.timeoutOption(duration))
      if (info._tag === "Some") return { info: info.value, timedOut: false }
      remaining -= duration
    }
    return { info: yield* get(input.id), timedOut: true }
  })

  const waitForPromotion: Interface["waitForPromotion"] = Effect.fn("BackgroundJob.waitForPromotion")(function* (id) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job || job.info.status !== "running") return yield* Effect.never
    if (job.info.metadata?.background === true) return snapshot(job)
    return yield* Deferred.await(job.promoted)
  })

  const promote: Interface["promote"] = Effect.fn("BackgroundJob.promote")(function* (id) {
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs) {
        const job = jobs.get(id)
        if (!job || job.info.status !== "running") return [{}, jobs] as readonly [PromoteResult, Map<string, Active>]
        if (job.info.metadata?.background === true)
          return [{ info: snapshot(job) }, jobs] as readonly [PromoteResult, Map<string, Active>]
        const next = {
          ...job,
          onPromote: undefined,
          info: {
            ...job.info,
            metadata: { ...job.info.metadata, background: true },
          },
        }
        return [
          { info: snapshot(next), onPromote: job.onPromote, promoted: job.promoted },
          new Map(jobs).set(id, next),
        ] as readonly [PromoteResult, Map<string, Active>]
      }),
    )
    if (result.info && result.promoted) yield* Deferred.succeed(result.promoted, result.info).pipe(Effect.ignore)
    if (result.onPromote) yield* result.onPromote.pipe(Effect.ignore)
    return result.info
  })

  const cancel: Interface["cancel"] = Effect.fn("BackgroundJob.cancel")(function* (id) {
    const active = (yield* SynchronizedRef.get(state.jobs)).get(id)
    // Durable owners must acknowledge deletion before cancellation can be reported.
    if (active?.info.status === "running" && active.onCancel) yield* active.onCancel
    const completed_at = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [FinishResult, Map<string, Active>] => {
      const job = jobs.get(id)
      if (!job || job.token !== active?.token) return [{}, jobs]
      if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
      const next = {
        ...job,
        onPromote: undefined,
        pending: 0,
        info: {
          ...job.info,
          status: "cancelled" as const,
          completed_at,
        },
      }
      return [
        { info: snapshot(next), done: job.done, scope: job.scope, onSettled: job.onSettled },
        new Map(jobs).set(id, next),
      ]
    })
    if (result.info && result.onSettled) yield* result.onSettled(result.info).pipe(Effect.ignore)
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
    if (result.scope) yield* Scope.close(result.scope, Exit.void)
    return result.info
  }, Effect.uninterruptible)

  const resume: Interface["resume"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* get(input.id)
      return yield* start({
        id: input.id,
        type: existing?.type ?? "resume",
        ...(existing?.title === undefined ? {} : { title: existing.title }),
        ...(existing?.metadata === undefined ? {} : { metadata: existing.metadata }),
        run: input.run,
      })
    })

  return Service.of({ list, get, start, report, extend, wait, waitForPromotion, promote, cancel, resume })
})

type DurableRow = typeof BackgroundJobTable.$inferSelect

function durableInfo(row: DurableRow, ownerID: string): Info {
  const metadata = row.metadata ? { ...row.metadata } : undefined
  const stale = row.status === "running" && row.owner_id !== ownerID
  return {
    id: row.id,
    type: row.type,
    ...(row.title === null ? {} : { title: row.title }),
    status: row.status as Status,
    started_at: row.started_at,
    ...(row.completed_at === null ? {} : { completed_at: row.completed_at }),
    ...(row.output === null ? {} : { output: row.output }),
    ...(row.error === null ? {} : { error: row.error }),
    ...(metadata || stale
      ? {
          metadata: {
            ...metadata,
            ...(stale ? { blockedReason: "process_restart" } : {}),
          },
        }
      : {}),
  }
}

/**
 * Adds durable observation and database-backed owner fencing to the process-local
 * engine. A persisted running job is intentionally not resumed implicitly after
 * restart; callers must invoke resume with an explicit continuation effect.
 */
export const makeDurable = Effect.gen(function* () {
  const database = yield* Database.Service
  const memory = yield* make
  const ownerID = randomUUID()
  const generations = new Map<string, number>()

  const read = (id: string) =>
    database.db.select().from(BackgroundJobTable).where(eq(BackgroundJobTable.id, id)).get().pipe(Effect.orDie)

  const isCurrentOwner = (row: DurableRow | undefined, id: string): row is DurableRow =>
    row !== undefined && row.owner_id === ownerID && row.owner_generation === generations.get(id)

  const persistFinished = (id: string, generation: number, info: Info) =>
    database.db
      .update(BackgroundJobTable)
      .set({
        status: info.status,
        completed_at: info.completed_at ?? null,
        output: info.output ?? null,
        error: info.error ?? null,
        metadata: info.metadata ?? null,
        time_updated: Date.now(),
      })
      .where(
        and(
          eq(BackgroundJobTable.id, id),
          eq(BackgroundJobTable.owner_id, ownerID),
          eq(BackgroundJobTable.owner_generation, generation),
          eq(BackgroundJobTable.status, "running"),
        ),
      )
      .run()
      .pipe(Effect.orDie, Effect.asVoid)

  const reserve = Effect.fn("BackgroundJob.reserve")(function* (input: StartInput) {
    const id = input.id ?? Identifier.ascending("job")
    const startedAt = yield* Clock.currentTimeMillis
    return yield* database.db
      .transaction(
        () =>
          Effect.gen(function* () {
            const previous = yield* read(id)
            if (previous?.status === "running" && previous.owner_id !== ownerID)
              return { blocked: true as const, info: durableInfo(previous, ownerID) }
            if (previous?.status === "running" && isCurrentOwner(previous, id)) {
              const active = yield* memory.get(id)
              if (active) return { blocked: true as const, info: active }
            }
            const generation = (previous?.owner_generation ?? 0) + 1
            const values = {
              id,
              type: input.type,
              title: input.title ?? null,
              status: "running",
              started_at: startedAt,
              completed_at: null,
              output: null,
              error: null,
              metadata: input.metadata ?? null,
              owner_id: ownerID,
              owner_generation: generation,
              time_updated: startedAt,
            }
            yield* database.db
              .insert(BackgroundJobTable)
              .values(values)
              .onConflictDoUpdate({ target: BackgroundJobTable.id, set: values })
              .run()
              .pipe(Effect.orDie)
            return { blocked: false as const, generation, id, startedAt }
          }),
        { behavior: "immediate" },
      )
      .pipe(Effect.orDie)
  })

  const list: Interface["list"] = Effect.fn("BackgroundJob.durable.list")(function* () {
    const rows = yield* database.db
      .select()
      .from(BackgroundJobTable)
      .orderBy(asc(BackgroundJobTable.started_at))
      .all()
      .pipe(Effect.orDie)
    const active = new Map((yield* memory.list()).map((job) => [job.id, job]))
    return rows.map((row) => {
      const current = active.get(row.id)
      if (current && isCurrentOwner(row, row.id)) return current
      return durableInfo(row, ownerID)
    })
  })

  const get: Interface["get"] = Effect.fn("BackgroundJob.durable.get")(function* (id) {
    const row = yield* read(id)
    const current = yield* memory.get(id)
    if (current && (!row || isCurrentOwner(row, id))) return current
    return row ? durableInfo(row, ownerID) : current
  })

  const start: Interface["start"] = Effect.fn("BackgroundJob.durable.start")(function* (input) {
    const reserved = yield* reserve(input)
    if (reserved.blocked) return reserved.info
    generations.set(reserved.id, reserved.generation)
    const settled = (info: Info) =>
      Effect.all(
        [
          persistFinished(reserved.id, reserved.generation, info),
          input.onSettled ? input.onSettled(info) : Effect.void,
        ],
        { discard: true },
      )
    return yield* memory.start({
      ...input,
      id: reserved.id,
      onSettled: settled,
    })
  })

  const report: Interface["report"] = (input) =>
    Effect.gen(function* () {
      const current = yield* read(input.id)
      if (!isCurrentOwner(current, input.id) || current.status !== "running") return
      yield* memory.report(input)
      const metadata = { ...(current.metadata ?? {}), ...(input.metadata ?? {}) }
      yield* database.db
        .update(BackgroundJobTable)
        .set({
          ...(input.output === undefined ? {} : { output: input.output.slice(-64 * 1024) }),
          metadata,
          time_updated: Date.now(),
        })
        .where(
          and(
            eq(BackgroundJobTable.id, input.id),
            eq(BackgroundJobTable.owner_id, ownerID),
            eq(BackgroundJobTable.owner_generation, current.owner_generation),
            eq(BackgroundJobTable.status, "running"),
          ),
        )
        .run()
        .pipe(Effect.orDie)
    })

  const extend: Interface["extend"] = (input) =>
    Effect.gen(function* () {
      const current = yield* read(input.id)
      if (!isCurrentOwner(current, input.id) || current.status !== "running") return false
      return yield* memory.extend(input)
    })

  const wait: Interface["wait"] = (input) =>
    Effect.gen(function* () {
      const current = yield* memory.get(input.id)
      if (current) return yield* memory.wait(input)
      const row = yield* read(input.id)
      if (!row) return { timedOut: false }
      const info = durableInfo(row, ownerID)
      if (info.status !== "running") return { info, timedOut: false }
      return { info, timedOut: true }
    })

  const waitForPromotion: Interface["waitForPromotion"] = (id) =>
    Effect.gen(function* () {
      const current = yield* memory.get(id)
      if (current) return yield* memory.waitForPromotion(id)
      const row = yield* read(id)
      if (row?.status === "running" && row.metadata?.background === true) return durableInfo(row, ownerID)
      return yield* Effect.never
    })

  const promote: Interface["promote"] = (id) =>
    Effect.gen(function* () {
      const current = yield* read(id)
      if (!isCurrentOwner(current, id) || current.status !== "running") return undefined
      const result = yield* memory.promote(id)
      if (!result) return result
      yield* database.db
        .update(BackgroundJobTable)
        .set({
          metadata: { ...(current.metadata ?? {}), background: true },
          time_updated: Date.now(),
        })
        .where(
          and(
            eq(BackgroundJobTable.id, id),
            eq(BackgroundJobTable.owner_id, ownerID),
            eq(BackgroundJobTable.owner_generation, current.owner_generation),
            eq(BackgroundJobTable.status, "running"),
          ),
        )
        .run()
        .pipe(Effect.orDie)
      return result
    })

  const cancel: Interface["cancel"] = Effect.fn("BackgroundJob.durable.cancel")(function* (id) {
    const row = yield* read(id)
    const current = yield* memory.get(id)
    if (current && (!row || isCurrentOwner(row, id))) return yield* memory.cancel(id)
    if (!row) return undefined
    if (row.status !== "running") return durableInfo(row, ownerID)
    if (row.owner_id !== ownerID) return durableInfo(row, ownerID)
    const completedAt = yield* Clock.currentTimeMillis
    const generation = row.owner_generation + 1
    yield* database.db
      .update(BackgroundJobTable)
      .set({
        status: "cancelled",
        completed_at: completedAt,
        owner_id: ownerID,
        owner_generation: generation,
        time_updated: completedAt,
      })
      .where(
        and(
          eq(BackgroundJobTable.id, id),
          eq(BackgroundJobTable.owner_id, ownerID),
          eq(BackgroundJobTable.owner_generation, row.owner_generation),
          eq(BackgroundJobTable.status, "running"),
        ),
      )
      .run()
      .pipe(Effect.orDie)
    return yield* get(id)
  })

  const resume: Interface["resume"] = Effect.fn("BackgroundJob.durable.resume")(function* (input) {
    const row = yield* read(input.id)
    if (!row || row.status !== "running") return undefined
    const generation = row.owner_generation + 1
    const metadata = { ...(row.metadata ?? {}) }
    delete metadata.blockedReason
    const updated = yield* database.db
      .update(BackgroundJobTable)
      .set({ owner_id: ownerID, owner_generation: generation, metadata, time_updated: Date.now() })
      .where(
        and(
          eq(BackgroundJobTable.id, input.id),
          eq(BackgroundJobTable.owner_generation, row.owner_generation),
          eq(BackgroundJobTable.status, "running"),
        ),
      )
      .returning({ id: BackgroundJobTable.id })
      .get()
      .pipe(Effect.orDie)
    if (!updated) return undefined
    generations.set(row.id, generation)
    return yield* memory.start({
      id: row.id,
      type: row.type,
      ...(row.title === null ? {} : { title: row.title }),
      metadata,
      onSettled: (info) => persistFinished(row.id, generation, info),
      run: input.run,
    })
  })

  return Service.of({ list, get, start, report, extend, wait, waitForPromotion, promote, cancel, resume })
})

/** Application registries bind concrete jobs to Session incarnations. The standalone engine remains generic. */
const makeOwnedFor = <R>(create: Effect.Effect<Interface, never, R>) =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.Service
    const jobs = yield* create
    const owners = new Map<string, { claims: SessionLifecycle.Claim[]; releases: (() => void)[] }>()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const owner of owners.values()) for (const release of owner.releases) release()
        owners.clear()
      }),
    )
    const owned = <A, E, R>(claims: SessionLifecycle.Claim[], effect: Effect.Effect<A, E, R>) =>
      claims.reduce((effect, claim) => lifecycle.owned(claim, effect), effect)
    const admitted = <A, E, R>(claims: SessionLifecycle.Claim[], effect: Effect.Effect<A, E, R>) =>
      owned(
        claims,
        claims.reduce<Effect.Effect<A, E | SessionLifecycle.Closed, R>>(
          (effect, claim) => lifecycle.use(claim.sessionID, effect),
          effect,
        ),
      ).pipe(Effect.orDie)
    const work = (claims: SessionLifecycle.Claim[], effect: Effect.Effect<string, unknown>) =>
      Effect.interruptible(
        owned(
          claims,
          Effect.suspend(() => (claims.every(lifecycle.available) ? effect : Effect.interrupt)),
        ),
      )
    return Service.of({
      ...jobs,
      cancel: (id) =>
        Effect.gen(function* () {
          const owner = owners.get(id)
          if (owner) {
            for (const claim of owner.claims) if ((yield* lifecycle.find(claim.sessionID)) !== claim) return undefined
            if (owners.get(id) !== owner) return undefined
          }
          return yield* jobs.cancel(id)
        }),
      start: (input) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const previous = input.id ? yield* jobs.get(input.id) : undefined
            if (previous?.status === "running") return previous
            const ids = [
              ...new Set(
                [input.metadata?.ownerSessionId, input.metadata?.parentSessionId, input.metadata?.sessionId].filter(
                  Schema.is(SessionSchema.ID),
                ),
              ),
            ]
            const claims = yield* Effect.forEach(ids, lifecycle.capture).pipe(Effect.orDie)
            return yield* admitted(
              claims,
              Effect.gen(function* () {
                const result = yield* jobs.start({
                  ...input,
                  run: work(claims, input.run),
                  ...(input.onPromote ? { onPromote: owned(claims, input.onPromote) } : {}),
                  ...(input.onCancel ? { onCancel: owned(claims, input.onCancel) } : {}),
                })
                const owner = { claims, releases: [] as (() => void)[] }
                for (const release of owners.get(result.id)?.releases ?? []) release()
                owners.set(result.id, owner)
                for (const claim of claims)
                  owner.releases.push(
                    yield* lifecycle
                      .register(
                        claim,
                        owner,
                        Effect.suspend(() =>
                          owners.get(result.id) === owner ? jobs.cancel(result.id).pipe(Effect.asVoid) : Effect.void,
                        ),
                      )
                      .pipe(Effect.orDie),
                  )
                return result
              }),
            )
          }),
        ),
      extend: (input) =>
        Effect.suspend(() => {
          const owner = owners.get(input.id)
          return owner
            ? admitted(owner.claims, jobs.extend({ ...input, run: work(owner.claims, input.run) }))
            : jobs.extend(input)
        }),
      resume: (input) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const existing = yield* jobs.get(input.id)
            if (!existing || existing.status !== "running") return undefined
            const ids = [
              ...new Set(
                [
                  existing.metadata?.ownerSessionId,
                  existing.metadata?.parentSessionId,
                  existing.metadata?.sessionId,
                ].filter(Schema.is(SessionSchema.ID)),
              ),
            ]
            const claims = yield* Effect.forEach(ids, lifecycle.capture).pipe(Effect.orDie)
            return yield* admitted(
              claims,
              Effect.gen(function* () {
                const result = yield* jobs.resume({
                  ...input,
                  run: work(claims, input.run),
                })
                if (!result) return undefined
                const owner = { claims, releases: [] as (() => void)[] }
                for (const release of owners.get(result.id)?.releases ?? []) release()
                owners.set(result.id, owner)
                for (const claim of claims)
                  owner.releases.push(
                    yield* lifecycle
                      .register(
                        claim,
                        owner,
                        Effect.suspend(() =>
                          owners.get(result.id) === owner ? jobs.cancel(result.id).pipe(Effect.asVoid) : Effect.void,
                        ),
                      )
                      .pipe(Effect.orDie),
                  )
                return result
              }),
            )
          }),
        ),
    })
  })

export const makeOwned = makeOwnedFor(make)
export const makeOwnedDurable = makeOwnedFor(makeDurable)
const layer = Layer.effect(Service, makeOwnedDurable)

export const node = makeGlobalNode({ service: Service, layer, deps: [SessionLifecycle.node, Database.node] })

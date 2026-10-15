import { SessionLifecycle } from "./session/lifecycle"
import { SessionSchema } from "./session/schema"
export * as BackgroundJob from "./background-job"

import { Cause, Clock, Context, Deferred, Effect, Exit, Layer, Scope, Schema, SynchronizedRef } from "effect"
import { Identifier } from "./id/id"
import { makeGlobalNode } from "./effect/app-node"

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
}

type State = {
  jobs: SynchronizedRef.SynchronizedRef<Map<string, Active>>
  scope: Scope.Scope
}

type FinishResult = {
  info?: Info
  done?: Deferred.Deferred<Info>
  scope?: Scope.Closeable
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
      return [{ info: snapshot(next), done: job.done, scope: job.scope }, new Map(jobs).set(id, next)]
    })
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
      return [{ info: snapshot(next), done: job.done, scope: job.scope }, new Map(jobs).set(id, next)]
    })
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
    if (result.scope) yield* Scope.close(result.scope, Exit.void)
    return result.info
  }, Effect.uninterruptible)

  return Service.of({ list, get, start, report, extend, wait, waitForPromotion, promote, cancel })
})

/** Application registries bind concrete jobs to Session incarnations. The standalone engine remains generic. */
export const makeOwned = Effect.gen(function* () {
  const lifecycle = yield* SessionLifecycle.Service
  const jobs = yield* make
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
  })
})
const layer = Layer.effect(Service, makeOwned)

export const node = makeGlobalNode({ service: Service, layer, deps: [SessionLifecycle.node] })

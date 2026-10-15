export * as SessionLifecycle from "./lifecycle"

import { Context, Deferred, Effect, Exit, FiberSet, Layer, Schema } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { SessionSchema } from "./schema"

export class Closed extends Schema.TaggedErrorClass<Closed>()("SessionLifecycle.Closed", {
  sessionID: SessionSchema.ID,
}) {}
export class Failure extends Schema.TaggedErrorClass<Failure>()("SessionLifecycle.Failure", {
  sessionID: SessionSchema.ID,
  message: Schema.String,
}) {}

const identity = Symbol("Session incarnation")
export interface Claim {
  readonly sessionID: SessionSchema.ID
  readonly [identity]: true
}
interface Lease {
  active: boolean
}
interface Entry {
  readonly claim: Claim
  readonly owners: Map<object, Effect.Effect<void>>
  readonly drained: Deferred.Deferred<void>
  users: number
  readers: number
  retained: boolean
  closing: boolean
  retirement?: Deferred.Deferred<void, Failure>
}

const Current = Context.Reference<ReadonlyMap<SessionSchema.ID, Claim>>("@apexo/SessionLifecycle/Current", {
  defaultValue: () => new Map(),
})
const Admissions = Context.Reference<ReadonlyMap<Claim, Lease>>("@apexo/SessionLifecycle/Admissions", {
  defaultValue: () => new Map(),
})

/** The publisher's inherited incarnation only; never discovers or allocates by ID. */
export const current = (sessionID: SessionSchema.ID) => Effect.map(Current, (claims) => claims.get(sessionID))

export interface Interface {
  /** Scoped HTTP/read identity; unused missing-ID claims are pruned when the last reader exits. */
  readonly read: <A, E, R>(
    sessionID: SessionSchema.ID,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | Closed, R>
  readonly capture: (sessionID: SessionSchema.ID) => Effect.Effect<Claim, Closed>
  readonly find: (sessionID: SessionSchema.ID) => Effect.Effect<Claim | undefined>
  readonly available: (claim: Claim) => boolean
  /** Carries identity through an owned drain without holding a mutation lease. */
  readonly owned: <A, E, R>(claim: Claim, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /** Tracks long-running work as a cancellable owner, never as a mutation lease. */
  readonly run: <A, E, R>(
    sessionID: SessionSchema.ID,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | Closed, R>
  readonly use: <A, E, R>(
    sessionID: SessionSchema.ID,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | Closed, R>
  readonly child: <A, E, R>(
    parentID: SessionSchema.ID,
    childID: SessionSchema.ID,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | Closed, R>
  /** Capture before forking; the action cannot address a later Session reusing this ID. */
  readonly bind: <A, E, R>(
    sessionID: SessionSchema.ID,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<Effect.Effect<A, E | Closed, R>, Closed>
  /** Cancellation must join the concrete owner, and must not rediscover ownership by bare ID. */
  readonly register: (claim: Claim, owner: object, stop: Effect.Effect<void>) => Effect.Effect<() => void, Closed>
  /** The body is already bound to its storage/Location services; request cancellation only stops waiting. */
  readonly retire: (
    sessionID: SessionSchema.ID,
    body: Effect.Effect<void, unknown>,
    expected?: Claim,
  ) => Effect.Effect<void, Failure>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionLifecycle") {}

export const make = Effect.gen(function* () {
  const entries = new Map<SessionSchema.ID, Entry>()
  const fork = yield* FiberSet.makeRuntime<never, void, never>()
  const entry = (sessionID: SessionSchema.ID) => {
    const previous = entries.get(sessionID)
    if (previous) return previous
    const value: Entry = {
      claim: { sessionID, [identity]: true },
      owners: new Map(),
      drained: Deferred.makeUnsafe<void>(),
      users: 0,
      readers: 0,
      retained: false,
      closing: false,
    }
    entries.set(sessionID, value)
    return value
  }
  const available = (claim: Claim) => {
    const value = entries.get(claim.sessionID)
    return value?.claim === claim && !value.closing
  }
  const capture = (sessionID: SessionSchema.ID) =>
    Effect.gen(function* () {
      const current = yield* Current
      const claim = current.get(sessionID) ?? entry(sessionID).claim
      if (!available(claim)) return yield* new Closed({ sessionID })
      entry(sessionID).retained = true
      return claim
    })
  const owned: Interface["owned"] = (claim, effect) =>
    Effect.flatMap(Current, (current) =>
      effect.pipe(Effect.provideService(Current, new Map(current).set(claim.sessionID, claim))),
    )
  const read: Interface["read"] = (sessionID, effect) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const inherited = (yield* Current).get(sessionID)
        return yield* Effect.acquireUseRelease(
          Effect.suspend(() => {
            const value = entry(sessionID)
            if ((inherited && inherited !== value.claim) || value.closing) return Effect.fail(new Closed({ sessionID }))
            value.readers++
            return Effect.succeed(value)
          }),
          (value) => restore(owned(value.claim, effect)),
          (value) =>
            Effect.sync(() => {
              value.readers--
              if (
                !value.readers &&
                !value.users &&
                !value.owners.size &&
                !value.retained &&
                !value.closing &&
                entries.get(sessionID) === value
              )
                entries.delete(sessionID)
            }),
        )
      }),
    )
  const use: Interface["use"] = (sessionID, effect) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const current = yield* Current
        const admissions = yield* Admissions
        const claim = current.get(sessionID) ?? entry(sessionID).claim
        // A child fiber can inherit this reference; the lease stops being reentrant after release.
        const value = entries.get(sessionID)
        const lease: Lease = { active: true }
        return yield* Effect.acquireUseRelease(
          Effect.suspend(() => {
            if (value?.claim !== claim || (value.closing && !admissions.get(claim)?.active))
              return Effect.fail(new Closed({ sessionID }))
            value.retained = true
            value.users++
            return Effect.succeed(value)
          }),
          () =>
            restore(
              owned(claim, effect).pipe(Effect.provideService(Admissions, new Map(admissions).set(claim, lease))),
            ),
          (admitted) =>
            Effect.sync(() => {
              lease.active = false
              admitted.users--
              if (admitted.closing && admitted.users === 0) Deferred.doneUnsafe(admitted.drained, Effect.void)
            }),
        )
      }),
    )
  const bind: Interface["bind"] = (sessionID, effect) =>
    Effect.gen(function* () {
      const claim = yield* capture(sessionID)
      const current = new Map(yield* Current).set(sessionID, claim)
      return Effect.gen(function* () {
        if (!available(claim)) return yield* new Closed({ sessionID })
        return yield* effect
      }).pipe(
        Effect.provideService(Current, current),
        // A delayed callback owns identity, never the caller's short-lived write admission.
        Effect.provideService(Admissions, new Map()),
      )
    })
  const register: Interface["register"] = (claim, owner, stop) =>
    Effect.flatMap(Admissions, (admissions) =>
      Effect.suspend(() => {
        const value = entries.get(claim.sessionID)
        if (value?.claim !== claim || (value.closing && !admissions.get(claim)?.active))
          return Effect.fail(new Closed({ sessionID: claim.sessionID }))
        value.retained = true
        value.owners.set(owner, stop)
        return Effect.succeed(() => {
          if (value.owners.get(owner) === stop) value.owners.delete(owner)
        })
      }),
    )
  const run = <A, E, R>(sessionID: SessionSchema.ID, effect: Effect.Effect<A, E, R>) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const claim = yield* capture(sessionID)
        const ready = Deferred.makeUnsafe<void>()
        const fiber = yield* Effect.interruptible(
          Deferred.await(ready).pipe(
            Effect.andThen(owned(claim, effect)),
            Effect.provideService(Admissions, new Map()),
          ),
        ).pipe(Effect.forkChild)
        // Observe settlement once: cancellation and the ordinary caller share the same finalizer-aware Exit.
        const settled = Deferred.makeUnsafe<Exit.Exit<A, E>>()
        fiber.addObserver((exit) => Deferred.doneUnsafe(settled, Effect.succeed(exit)))
        const stop = Effect.withFiber((caller) =>
          Effect.sync(() => fiber.interruptUnsafe(caller.id)).pipe(
            Effect.andThen(Deferred.await(settled)),
            Effect.asVoid,
          ),
        )
        const registration = yield* register(claim, fiber, stop).pipe(Effect.exit)
        if (Exit.isFailure(registration)) {
          yield* stop
          return yield* Effect.failCause(registration.cause)
        }
        return yield* Effect.acquireUseRelease(
          Effect.succeed(registration.value),
          () =>
            Deferred.succeed(ready, undefined).pipe(
              Effect.andThen(restore(Deferred.await(settled).pipe(Effect.flatMap((exit) => exit)))),
            ),
          (release) => stop.pipe(Effect.andThen(Effect.sync(release))),
        )
      }),
    )
  const retire: Interface["retire"] = (sessionID, body, expected) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const inherited = (yield* Current).get(sessionID)
        if (expected && entries.get(sessionID)?.claim !== expected) return
        const value = entry(sessionID)
        if (inherited && inherited !== value.claim)
          return yield* new Failure({ sessionID, message: "Session incarnation has already been retired" })
        if (value.retirement) return yield* restore(Deferred.await(value.retirement))
        value.closing = true
        if (value.users === 0) Deferred.doneUnsafe(value.drained, Effect.void)
        const done = Deferred.makeUnsafe<void, Failure>()
        value.retirement = done
        fork(
          Effect.interruptible(
            Deferred.await(value.drained).pipe(
              Effect.andThen(
                Effect.suspend(() =>
                  Effect.all([...value.owners.values()], { concurrency: "unbounded", discard: true }),
                ),
              ),
              Effect.andThen(body),
            ),
          ).pipe(
            Effect.onExit((exit) =>
              Effect.gen(function* () {
                if (Exit.isFailure(exit)) yield* Effect.logError("Session retirement failed", exit.cause)
                yield* Effect.sync(() => {
                  if (Exit.isSuccess(exit)) {
                    if (entries.get(sessionID) === value) entries.delete(sessionID)
                    value.owners.clear()
                    Deferred.doneUnsafe(done, Effect.void)
                    return
                  }
                  // Keep the revoked incarnation retryable; never reopen after partial durable deletion.
                  value.retirement = undefined
                  Deferred.doneUnsafe(
                    done,
                    Effect.fail(new Failure({ sessionID, message: "Session retirement did not complete" })),
                  )
                })
              }),
            ),
            Effect.exit,
            Effect.asVoid,
          ),
        )
        return yield* restore(Deferred.await(done))
      }),
    )
  return Service.of({
    read,
    capture,
    find: (sessionID) => Effect.map(Current, (current) => current.get(sessionID) ?? entries.get(sessionID)?.claim),
    available,
    owned,
    run,
    use,
    child: (parentID, childID, effect) => use(parentID, use(childID, effect)),
    bind,
    register,
    retire,
  })
})
export const node = makeGlobalNode({ service: Service, layer: Layer.effect(Service, make), deps: [] })

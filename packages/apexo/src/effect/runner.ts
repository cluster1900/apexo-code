import { Cause, Deferred, Effect, Exit, Fiber, Latch, Schema, Scope, SynchronizedRef } from "effect"

export interface Runner<A, E = never> {
  readonly state: State<A, E>
  readonly busy: boolean
  readonly ensureRunning: (work: Effect.Effect<A, E>) => Effect.Effect<A, E>
  readonly startExclusive: (work: Effect.Effect<A, E>, owner?: object) => Effect.Effect<A, E | Busy>
  readonly startShell: (work: Effect.Effect<A, E>, ready?: Latch.Latch) => Effect.Effect<A, E | Busy>
  readonly control: <B, CE>(action: Effect.Effect<B, CE>) => Effect.Effect<B, CE | Cancelled>
  readonly controls: Effect.Effect<void>
  readonly cancel: Effect.Effect<void>
  readonly cancelOwned: (owner: object) => Effect.Effect<void>
}

export class Cancelled extends Schema.TaggedErrorClass<Cancelled>()("RunnerCancelled", {}) {}
export class Busy extends Schema.TaggedErrorClass<Busy>()("RunnerBusy", {}) {}

interface RunHandle<A, E> {
  id: number
  done: Deferred.Deferred<A, E | Cancelled>
  fiber: Fiber.Fiber<A, E>
  owner?: object
}

interface ShellHandle<A, E> {
  id: number
  cancelled: Deferred.Deferred<void>
  ready?: Latch.Latch
  fiber: Fiber.Fiber<A, E>
}

interface PendingHandle<A, E> {
  id: number
  done: Deferred.Deferred<A, E | Cancelled>
  work: Effect.Effect<A, E>
}

export type State<A, E> =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Running"; readonly run: RunHandle<A, E> }
  | { readonly _tag: "Shell"; readonly shell: ShellHandle<A, E> }
  | { readonly _tag: "ShellThenRun"; readonly shell: ShellHandle<A, E>; readonly run: PendingHandle<A, E> }

export const make = <A, E = never>(
  scope: Scope.Scope,
  opts?: {
    available?: () => boolean
    onIdle?: Effect.Effect<void>
    onBusy?: Effect.Effect<void>
    onInterrupt?: Effect.Effect<A, E>
  },
): Runner<A, E> => {
  const ref = SynchronizedRef.makeUnsafe<State<A, E>>({ _tag: "Idle" })
  const idle = opts?.onIdle ?? Effect.void
  const onBusy = opts?.onBusy ?? Effect.void
  const onInterrupt = opts?.onInterrupt
  const available = () => opts?.available?.() ?? true
  const guarded = (work: Effect.Effect<A, E>) => Effect.suspend(() => (available() ? work : Effect.interrupt))
  const pending: { execute: Effect.Effect<void>; cancel: () => void }[] = []
  const controls = Effect.suspend(() => {
    const batch = pending.slice()
    return Effect.forEach(
      batch,
      (item) =>
        Effect.suspend(() => {
          const index = pending.indexOf(item)
          if (index >= 0) pending.splice(index, 1)
          return item.execute
        }),
      { discard: true },
    ).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit)
          ? Effect.sync(() => {
              for (const item of batch) item.cancel()
            })
          : Effect.void,
      ),
    )
  })
  const cancelControls = () => {
    for (const item of pending.splice(0)) item.cancel()
  }
  const control = <B, CE>(action: Effect.Effect<B, CE>): Effect.Effect<B, CE | Cancelled> =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<B, CE | Cancelled>()
      const item = {
        cancelled: false,
        execute: Effect.void as Effect.Effect<void>,
        cancel: () => {
          item.cancelled = true
          Deferred.doneUnsafe(result, Effect.fail(new Cancelled()))
        },
      }
      item.execute = Effect.uninterruptible(
        Effect.gen(function* () {
          if (item.cancelled || !available()) {
            item.cancel()
            return
          }
          const exit = yield* Effect.interruptible(action).pipe(Effect.exit)
          yield* Deferred.done(result, exit)
          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) return yield* Effect.interrupt
        }),
      )
      yield* SynchronizedRef.modifyEffect(ref, (st) =>
        Effect.gen(function* () {
          if (!available()) item.cancel()
          else if (st._tag === "Idle") yield* item.execute
          else pending.push(item)
          return [undefined, st] as const
        }),
      )
      return yield* Deferred.await(result).pipe(Effect.onInterrupt(() => Effect.sync(item.cancel)))
    })
  let ids = 0

  const state = () => SynchronizedRef.getUnsafe(ref)
  const next = () => {
    ids += 1
    return ids
  }

  const complete = (done: Deferred.Deferred<A, E | Cancelled>, exit: Exit.Exit<A, E>) =>
    Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
      ? Deferred.fail(done, new Cancelled()).pipe(Effect.asVoid)
      : Deferred.done(done, exit).pipe(Effect.asVoid)

  const awaitDone = (done: Deferred.Deferred<A, E | Cancelled>) =>
    Deferred.await(done).pipe(Effect.catchTag("RunnerCancelled", (e) => onInterrupt ?? Effect.die(e)))

  const idleIfCurrent = () =>
    SynchronizedRef.modify(ref, (st) => [st._tag === "Idle" ? idle : Effect.void, st] as const).pipe(Effect.flatten)

  const finishRun = (
    id: number,
    done: Deferred.Deferred<A, E | Cancelled>,
    exit: Exit.Exit<A, E>,
  ): Effect.Effect<void> =>
    SynchronizedRef.modify(ref, (st) => {
      if (st._tag === "Running" && st.run.id === id) {
        if (Exit.isSuccess(exit) && pending.length)
          return [controls.pipe(Effect.andThen(Effect.suspend(() => finishRun(id, done, exit)))), st] as const
        if (Exit.isFailure(exit)) cancelControls()
        return [idle.pipe(Effect.andThen(complete(done, exit))), { _tag: "Idle" } as const] as const
      }
      return [complete(done, exit), st] as const
    }).pipe(Effect.flatten)

  const startRun = (work: Effect.Effect<A, E>, done: Deferred.Deferred<A, E | Cancelled>, owner?: object) =>
    Effect.gen(function* () {
      const id = next()
      const fiber = yield* guarded(work).pipe(
        Effect.onExit((exit) => finishRun(id, done, exit)),
        Effect.forkIn(scope),
      )
      return { id, done, fiber, owner } satisfies RunHandle<A, E>
    })

  const finishShell = (id: number): Effect.Effect<void> =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        if (st._tag === "Shell" && st.shell.id === id) {
          if (pending.length) return [controls.pipe(Effect.andThen(Effect.suspend(() => finishShell(id)))), st] as const
          return [idle, { _tag: "Idle" }] as const
        }
        if (st._tag === "ShellThenRun" && st.shell.id === id) {
          if (!available()) {
            cancelControls()
            return [Deferred.fail(st.run.done, new Cancelled()).pipe(Effect.andThen(idle)), { _tag: "Idle" }] as const
          }
          const run = yield* startRun(st.run.work, st.run.done)
          return [Effect.void, { _tag: "Running", run }] as const
        }
        return [Effect.void, st] as const
      }),
    ).pipe(Effect.flatten)

  const stopShell = (shell: ShellHandle<A, E>) =>
    Effect.gen(function* () {
      if (shell.ready) yield* shell.ready.await.pipe(Effect.exit, Effect.asVoid)
      yield* Deferred.succeed(shell.cancelled, undefined).pipe(Effect.asVoid)
      yield* Fiber.interrupt(shell.fiber)
    })

  const ensureRunning = (work: Effect.Effect<A, E>) =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        if (!available()) return [Effect.interrupt, st] as const
        switch (st._tag) {
          case "Running":
          case "ShellThenRun":
            return [awaitDone(st.run.done), st] as const
          case "Shell": {
            const run = {
              id: next(),
              done: yield* Deferred.make<A, E | Cancelled>(),
              work,
            } satisfies PendingHandle<A, E>
            return [awaitDone(run.done), { _tag: "ShellThenRun", shell: st.shell, run }] as const
          }
          case "Idle": {
            const done = yield* Deferred.make<A, E | Cancelled>()
            const run = yield* startRun(work, done)
            return [awaitDone(done), { _tag: "Running", run }] as const
          }
        }
      }),
    ).pipe(Effect.flatten)

  const startExclusive = (work: Effect.Effect<A, E>, owner?: object): Effect.Effect<A, E | Busy> =>
    SynchronizedRef.modifyEffect(ref, (st) =>
      Effect.gen(function* () {
        if (!available()) return [Effect.interrupt, st] as const
        if (st._tag !== "Idle") return yield* new Busy()
        const done = yield* Deferred.make<A, E | Cancelled>()
        const run = yield* startRun(work, done, owner)
        return [awaitDone(done), { _tag: "Running", run }] as const
      }),
    ).pipe(Effect.flatten)

  const startShell = (work: Effect.Effect<A, E>, ready?: Latch.Latch): Effect.Effect<A, E | Busy> =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        if (!available()) return [Effect.interrupt, st] as const
        if (st._tag !== "Idle") {
          const reject: Effect.Effect<A, E | Busy> = Effect.fail(new Busy())
          return [reject, st] as const
        }
        yield* onBusy
        const id = next()
        const cancelled = yield* Deferred.make<void>()
        const fiber = yield* guarded(work).pipe(Effect.ensuring(finishShell(id)), Effect.forkChild)
        const shell = { id, cancelled, ready, fiber } satisfies ShellHandle<A, E>
        return [
          Effect.gen(function* () {
            const exit = yield* Fiber.await(fiber)
            if (Exit.isSuccess(exit)) return exit.value
            if (
              Cause.hasInterruptsOnly(exit.cause) ||
              ((yield* Deferred.isDone(cancelled)) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause))
            ) {
              if (onInterrupt) return yield* onInterrupt
              return yield* Effect.die(new Cancelled())
            }
            return yield* Effect.failCause(exit.cause)
          }),
          { _tag: "Shell", shell },
        ] as const
      }),
    ).pipe(Effect.flatten)

  const cancel = (owner?: object) =>
    SynchronizedRef.modify(ref, (st) => {
      if (owner && (st._tag !== "Running" || st.run.owner !== owner)) return [Effect.void, st] as const
      cancelControls()
      switch (st._tag) {
        case "Idle":
          return [Effect.void, st] as const
        case "Running":
          return [
            Effect.gen(function* () {
              yield* Fiber.interrupt(st.run.fiber)
              yield* Deferred.fail(st.run.done, new Cancelled()).pipe(Effect.asVoid)
              yield* idleIfCurrent()
            }),
            { _tag: "Idle" } as const,
          ] as const
        case "Shell":
          return [
            Effect.gen(function* () {
              yield* stopShell(st.shell)
              yield* idleIfCurrent()
            }),
            { _tag: "Idle" } as const,
          ] as const
        case "ShellThenRun":
          return [
            Effect.gen(function* () {
              yield* stopShell(st.shell)
              yield* Deferred.fail(st.run.done, new Cancelled()).pipe(Effect.asVoid)
              yield* idleIfCurrent()
            }),
            { _tag: "Idle" } as const,
          ] as const
      }
    }).pipe(Effect.flatten)

  return {
    get state() {
      return state()
    },
    get busy() {
      return state()._tag !== "Idle"
    },
    ensureRunning,
    control,
    controls,
    startExclusive,
    startShell,
    cancel: cancel(),
    cancelOwned: cancel,
  }
}

export * as Runner from "./runner"

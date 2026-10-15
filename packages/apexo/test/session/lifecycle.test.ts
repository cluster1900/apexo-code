import { expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionRunCoordinator } from "@apexo/core/session/run-coordinator"
import { SessionSchema } from "@apexo/core/session/schema"
import { Runner } from "@/effect/runner"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)
const id = () => SessionSchema.ID.create()
const closing = (lifecycle: SessionLifecycle.Interface, claim: SessionLifecycle.Claim): Effect.Effect<void> =>
  Effect.suspend(() =>
    lifecycle.available(claim) ? Effect.yieldNow.pipe(Effect.andThen(closing(lifecycle, claim))) : Effect.void,
  )

it.live("retirement drains admitted writes, joins owners, then removes; unrelated IDs remain usable", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const sessionID = id()
    const claim = yield* lifecycle.capture(sessionID)
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const stopped = yield* Deferred.make<void>()
    const joined = yield* Deferred.make<void>()
    const order: string[] = []
    yield* lifecycle.register(
      claim,
      {},
      Deferred.succeed(stopped, undefined).pipe(Effect.andThen(Deferred.await(joined))),
    )
    const write = yield* lifecycle
      .use(
        sessionID,
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.tap(() => Effect.sync(() => order.push("write"))),
        ),
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const deletion = yield* lifecycle
      .retire(
        sessionID,
        Effect.sync(() => {
          order.push("delete")
        }),
      )
      .pipe(Effect.forkChild)
    yield* closing(lifecycle, claim)
    expect((yield* lifecycle.capture(sessionID).pipe(Effect.flip))._tag).toBe("SessionLifecycle.Closed")
    expect(yield* Deferred.isDone(stopped)).toBe(false)
    expect(yield* lifecycle.use(id(), Effect.succeed("other"))).toBe("other")
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(write)
    yield* Deferred.await(stopped)
    expect(order).toEqual(["write"])
    yield* Deferred.succeed(joined, undefined)
    yield* Fiber.join(deletion)
    expect(order).toEqual(["write", "delete"])
    expect(yield* lifecycle.capture(sessionID)).not.toBe(claim)
  }),
)

it.live("an interrupted admitted body releases registration before retirement", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const sessionID = id()
    const exit = yield* lifecycle.use(sessionID, Effect.interrupt).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    yield* lifecycle.retire(sessionID, Effect.void)
    expect(lifecycle.available(yield* lifecycle.capture(sessionID))).toBe(true)
  }),
)

it.live("short admission may enqueue execution without making deletion wait for model completion", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const sessionID = id()
    const claim = yield* lifecycle.capture(sessionID)
    const entered = yield* Deferred.make<void>()
    const ended = yield* Deferred.make<void>()
    const coordinator = yield* SessionRunCoordinator.make<SessionLifecycle.Claim, never>({
      available: lifecycle.available,
      drain: () =>
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(ended, undefined)),
        ),
    })
    yield* lifecycle.register(claim, {}, coordinator.interrupt(claim))
    yield* lifecycle.use(sessionID, coordinator.wake(claim))
    yield* Deferred.await(entered)
    yield* lifecycle.retire(sessionID, Effect.void)
    expect(yield* Deferred.isDone(ended)).toBe(true)
    expect((yield* coordinator.active).size).toBe(0)
  }),
)

it.live("inherited child context cannot keep using a released parent admission after reuse", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const sessionID = id()
    const release = yield* Deferred.make<void>()
    const writes: string[] = []
    const child = yield* lifecycle.use(
      sessionID,
      Deferred.await(release).pipe(
        Effect.andThen(
          lifecycle.use(
            sessionID,
            Effect.sync(() => {
              writes.push("late")
            }),
          ),
        ),
        Effect.exit,
        Effect.forkChild,
      ),
    )
    yield* lifecycle.retire(sessionID, Effect.void)
    yield* lifecycle.capture(sessionID)
    yield* Deferred.succeed(release, undefined)
    expect(Exit.isFailure(yield* Fiber.join(child))).toBe(true)
    expect(writes).toEqual([])
  }),
)

it.live("a delayed bound resume cannot target the replacement Session or borrow its caller's lease", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const sessionID = id()
    const runs: string[] = []
    const action = yield* lifecycle.use(
      sessionID,
      lifecycle.bind(
        sessionID,
        lifecycle.use(
          sessionID,
          Effect.sync(() => {
            runs.push("old")
          }),
        ),
      ),
    )
    yield* lifecycle.retire(sessionID, Effect.void)
    yield* lifecycle.use(
      sessionID,
      Effect.sync(() => {
        runs.push("new")
      }),
    )
    expect((yield* action.pipe(Effect.flip))._tag).toBe("SessionLifecycle.Closed")
    expect(runs).toEqual(["new"])
  }),
)

it.live("request cancellation stops waiting but does not abandon retirement; concurrent callers join", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const sessionID = id()
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const state = { bodies: 0 }
    const first = yield* lifecycle
      .retire(
        sessionID,
        Effect.sync(() => {
          state.bodies++
        }).pipe(Effect.andThen(Deferred.succeed(entered, undefined)), Effect.andThen(Deferred.await(release))),
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const second = yield* lifecycle
      .retire(
        sessionID,
        Effect.sync(() => {
          state.bodies += 100
        }),
      )
      .pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* Fiber.interrupt(first)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(second)
    expect(state.bodies).toBe(1)
  }),
)

it.live("failed retirement remains closed, and concurrent retries share one new owned result", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const sessionID = id()
    const claim = yield* lifecycle.capture(sessionID)
    expect((yield* lifecycle.retire(sessionID, Effect.fail("storage unavailable")).pipe(Effect.flip))._tag).toBe(
      "SessionLifecycle.Failure",
    )
    expect(lifecycle.available(claim)).toBe(false)
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const bodies: number[] = []
    const retry = yield* lifecycle
      .retire(
        sessionID,
        Effect.sync(() => {
          bodies.push(1)
        }).pipe(Effect.andThen(Deferred.succeed(entered, undefined)), Effect.andThen(Deferred.await(release))),
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const joined = yield* lifecycle
      .retire(
        sessionID,
        Effect.sync(() => {
          bodies.push(2)
        }),
      )
      .pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(retry)
    yield* Fiber.join(joined)
    expect(bodies).toEqual([1])
    expect(yield* lifecycle.capture(sessionID)).not.toBe(claim)
  }),
)

it.live("coordinator revocation cancels queued controls and prevents pending wake successor", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const sessionID = id()
    const claim = yield* lifecycle.capture(sessionID)
    const entered = yield* Deferred.make<void>()
    const released = yield* Deferred.make<void>()
    const state = { drains: 0, controls: 0 }
    const coordinator = yield* SessionRunCoordinator.make<SessionLifecycle.Claim, never>({
      available: lifecycle.available,
      drain: () =>
        Effect.sync(() => {
          state.drains++
        }).pipe(Effect.andThen(Deferred.succeed(entered, undefined)), Effect.andThen(Deferred.await(released))),
    })
    yield* lifecycle.register(claim, {}, coordinator.interrupt(claim))
    yield* coordinator.wake(claim)
    yield* Deferred.await(entered)
    yield* coordinator.wake(claim)
    const control = yield* coordinator
      .control(
        claim,
        Effect.sync(() => {
          state.controls++
        }),
      )
      .pipe(Effect.exit, Effect.forkChild)
    yield* Effect.yieldNow
    yield* lifecycle.retire(sessionID, Effect.void)
    expect(Exit.isFailure(yield* Fiber.join(control))).toBe(true)
    yield* coordinator.wake(claim)
    expect(Exit.isFailure(yield* coordinator.run(claim).pipe(Effect.exit))).toBe(true)
    expect(state).toEqual({ drains: 1, controls: 0 })
  }),
)

it.live("ordinary interruption still permits a later drain of the same live incarnation", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const claim = yield* lifecycle.capture(id())
    const entered = yield* Deferred.make<void>()
    const state = { drains: 0 }
    const coordinator = yield* SessionRunCoordinator.make<SessionLifecycle.Claim, never>({
      available: lifecycle.available,
      drain: () =>
        Effect.suspend(() =>
          ++state.drains === 1 ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)) : Effect.void,
        ),
    })
    yield* coordinator.wake(claim)
    yield* Deferred.await(entered)
    yield* coordinator.interrupt(claim)
    yield* coordinator.run(claim)
    expect(state.drains).toBe(2)
  }),
)

it.live("registered compatibility Runner joins cancellation and cannot restart after revocation", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const sessionID = id()
    const claim = yield* lifecycle.capture(sessionID)
    const entered = yield* Deferred.make<void>()
    const finished = yield* Deferred.make<void>()
    const runner = Runner.make<void>(yield* Scope.Scope, {
      available: () => lifecycle.available(claim),
      onInterrupt: Effect.void,
    })
    yield* lifecycle.register(claim, runner, runner.cancel)
    const running = yield* runner
      .ensureRunning(
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(finished, undefined)),
        ),
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* lifecycle.retire(sessionID, Effect.void)
    yield* Fiber.join(running)
    expect(yield* Deferred.isDone(finished)).toBe(true)
    expect(Exit.isFailure(yield* runner.ensureRunning(Effect.die("must not execute")).pipe(Effect.exit))).toBe(true)
  }),
)

it.live("long-running auxiliary ownership is canceled without borrowing a short write lease", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const sessionID = id()
    const entered = yield* Deferred.make<void>()
    const closed = yield* Deferred.make<void>()
    const worker = yield* lifecycle
      .run(
        sessionID,
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(closed, undefined)),
        ),
      )
      .pipe(Effect.exit, Effect.forkChild)
    yield* Deferred.await(entered)
    yield* lifecycle.retire(sessionID, Effect.void)
    expect(yield* Deferred.isDone(closed)).toBe(true)
    expect(Exit.isFailure(yield* Fiber.join(worker))).toBe(true)
  }),
)

it.live("read-only missing identities are pruned without revoking concurrent admitted creation", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const absent = id()
    yield* lifecycle.read(absent, Effect.void)
    expect(yield* lifecycle.find(absent)).toBeUndefined()
    const created = id()
    const claim = yield* lifecycle.read(created, lifecycle.use(created, lifecycle.capture(created)))
    expect(yield* lifecycle.find(created)).toBe(claim)
    expect(lifecycle.available(claim)).toBe(true)
  }),
)

it.live("a read waiting on asynchronous setup cannot mutate a replacement incarnation", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const sessionID = id()
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const old = yield* lifecycle
      .read(
        sessionID,
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(lifecycle.use(sessionID, Effect.succeed("stale"))),
        ),
      )
      .pipe(Effect.exit, Effect.forkChild)
    yield* Deferred.await(entered)
    yield* lifecycle.retire(sessionID, Effect.void)
    const replacement = yield* lifecycle.capture(sessionID)
    yield* Deferred.succeed(release, undefined)
    expect(Exit.isFailure(yield* Fiber.join(old))).toBe(true)
    expect(lifecycle.available(replacement)).toBe(true)
  }),
)

it.live("binding during read retains its identity after the read exits", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const sessionID = id()
    const action = yield* lifecycle.read(
      sessionID,
      lifecycle.bind(sessionID, lifecycle.use(sessionID, Effect.succeed("owned"))),
    )
    expect(yield* action).toBe("owned")
    yield* lifecycle.retire(sessionID, Effect.void)
    yield* lifecycle.capture(sessionID)
    expect((yield* action.pipe(Effect.flip))._tag).toBe("SessionLifecycle.Closed")
  }),
)

it.live("owned work preserves success and failure after its finalizers settle", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const sessionID = id()
    const exits: string[] = []
    expect(
      yield* lifecycle.run(
        sessionID,
        Effect.succeed(42).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              exits.push("success")
            }),
          ),
        ),
      ),
    ).toBe(42)
    expect(exits).toEqual(["success"])
    expect(
      yield* lifecycle
        .run(
          sessionID,
          Effect.fail("failed").pipe(
            Effect.ensuring(
              Effect.sync(() => {
                exits.push("failure")
              }),
            ),
          ),
        )
        .pipe(Effect.flip),
    ).toBe("failed")
    expect(exits).toEqual(["success", "failure"])
    yield* lifecycle.retire(sessionID, Effect.void)
  }),
)

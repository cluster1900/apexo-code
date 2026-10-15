import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { SessionRunCoordinator } from "@apexo/core/session/run-coordinator"
import { testEffect } from "../lib/effect"
const it = testEffect(Layer.empty)

it.live("idle wait and controls never start a model drain", () =>
  Effect.gen(function* () {
    const drains: boolean[] = []
    const coordinator = yield* SessionRunCoordinator.make({
      drain: (_, force) =>
        Effect.sync(() => {
          drains.push(force)
        }),
    })
    yield* coordinator.wait("session")
    expect(yield* coordinator.control("session", Effect.succeed(42))).toBe(42)
    yield* coordinator.wait("session")
    expect(drains).toEqual([])
    expect((yield* coordinator.active).size).toBe(0)
  }),
)

it.live("controls flush FIFO at a provider boundary and isolate action errors", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const order: string[] = []
    const coordinator = yield* SessionRunCoordinator.make({
      drain: (_, __, controls) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          yield* controls
          order.push("next-turn")
        }),
    })
    const owner = yield* coordinator.run("session").pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const first = yield* coordinator
      .control(
        "session",
        Effect.sync(() => {
          order.push("first")
          return 1
        }),
      )
      .pipe(Effect.forkChild)
    const failed = yield* coordinator
      .control("session", Effect.fail("control failed"))
      .pipe(Effect.flip, Effect.forkChild)
    const last = yield* coordinator
      .control(
        "session",
        Effect.sync(() => {
          order.push("last")
          return 2
        }),
      )
      .pipe(Effect.forkChild)
    yield* Effect.yieldNow
    expect(order).toEqual([])
    yield* Deferred.succeed(release, undefined)
    expect(yield* Fiber.join(first)).toBe(1)
    expect(yield* Fiber.join(failed)).toBe("control failed")
    expect(yield* Fiber.join(last)).toBe(2)
    yield* Fiber.join(owner)
    expect(order).toEqual(["first", "last", "next-turn"])
  }),
)

it.live("wait joins current cleanup and does not request a follow-up drain", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const cleanup = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const state = { drains: 0, waited: false }
    const coordinator = yield* SessionRunCoordinator.make({
      drain: () =>
        Effect.scoped(
          Effect.gen(function* () {
            state.drains++
            yield* Effect.addFinalizer(() =>
              Deferred.succeed(cleanup, undefined).pipe(Effect.andThen(Deferred.await(finish))),
            )
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
          }),
        ),
    })
    const owner = yield* coordinator.run("session").pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const waiter = yield* coordinator.wait("session").pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          state.waited = true
        }),
      ),
      Effect.forkChild,
    )
    yield* Deferred.succeed(release, undefined)
    yield* Deferred.await(cleanup)
    expect(state.waited).toBe(false)
    yield* Deferred.succeed(finish, undefined)
    yield* Fiber.join(waiter)
    yield* Fiber.join(owner)
    expect(state.drains).toBe(1)
    expect(state.waited).toBe(true)
  }),
)

it.live("wake and explicit resume during idle control retain their drain semantics", () =>
  Effect.gen(function* () {
    for (const force of [false, true]) {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const drains: boolean[] = []
      const coordinator = yield* SessionRunCoordinator.make({
        drain: (_, forced) =>
          Effect.sync(() => {
            drains.push(forced)
          }),
      })
      const control = yield* coordinator
        .control("session", Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))
        .pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      const next = yield* (force ? coordinator.run("session") : coordinator.wake("session")).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(control)
      yield* Fiber.join(next)
      yield* coordinator.wait("session")
      expect(drains).toEqual([force])
    }
  }),
)

it.live("unclaimed caller cancellation removes a control and interrupt cancels remaining controls", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const state = { executed: 0 }
    const coordinator = yield* SessionRunCoordinator.make({
      drain: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
    })
    yield* coordinator.run("session").pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const cancelled = yield* coordinator
      .control(
        "session",
        Effect.sync(() => {
          state.executed++
        }),
      )
      .pipe(Effect.forkChild)
    const pending = yield* coordinator
      .control(
        "session",
        Effect.sync(() => {
          state.executed++
        }),
      )
      .pipe(Effect.flip, Effect.forkChild)
    yield* Effect.yieldNow
    yield* Fiber.interrupt(cancelled)
    yield* coordinator.interrupt("session")
    expect((yield* Fiber.join(pending))._tag).toBe("Session.ControlCancelled")
    expect(state.executed).toBe(0)
    expect((yield* coordinator.active).size).toBe(0)
  }),
)

it.live("a control queued just before drain settlement is not stranded", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const state = { calls: 0 }
    const coordinator = yield* SessionRunCoordinator.make({
      drain: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
    })
    const owner = yield* coordinator.run("session").pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const control = yield* coordinator
      .control(
        "session",
        Effect.sync(() => {
          state.calls++
          return "done"
        }),
      )
      .pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* Deferred.succeed(release, undefined)
    expect(yield* Fiber.join(control)).toBe("done")
    yield* Fiber.join(owner)
    expect(state.calls).toBe(1)
    expect((yield* coordinator.active).size).toBe(0)
  }),
)

it.live("cancelling a claimed caller does not abandon ownership and interrupt awaits control cleanup", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const closed = yield* Deferred.make<void>()
    const coordinator = yield* SessionRunCoordinator.make({ drain: () => Effect.die("Unexpected drain") })
    const caller = yield* coordinator
      .control(
        "session",
        Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() => Deferred.succeed(closed, undefined))
            yield* Deferred.succeed(entered, undefined)
            return yield* Effect.never
          }),
        ),
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* Fiber.interrupt(caller)
    expect((yield* coordinator.active).has("session")).toBe(true)
    expect(yield* Deferred.isDone(closed)).toBe(false)
    yield* coordinator.interrupt("session")
    expect(yield* Deferred.isDone(closed)).toBe(true)
    expect((yield* coordinator.active).size).toBe(0)
  }),
)

it.live("wait propagates the captured drain failure while other Sessions proceed", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const coordinator = yield* SessionRunCoordinator.make({
      drain: (key: string) =>
        key === "failed"
          ? Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(Effect.fail("provider failed")),
            )
          : Effect.void,
    })
    const owner = yield* coordinator.run("failed").pipe(Effect.flip, Effect.forkChild)
    yield* Deferred.await(entered)
    const waiter = yield* coordinator.wait("failed").pipe(Effect.flip, Effect.forkChild)
    yield* Effect.yieldNow
    expect(yield* coordinator.control("other", Effect.succeed("independent"))).toBe("independent")
    yield* Deferred.succeed(release, undefined)
    expect(yield* Fiber.join(owner)).toBe("provider failed")
    expect(yield* Fiber.join(waiter)).toBe("provider failed")
    yield* coordinator.wait("failed")
  }),
)

it.live("interrupt settles a still-waiting claimed control only after its finalizer", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const closing = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const state = { closed: false, answered: false }
    const coordinator = yield* SessionRunCoordinator.make({ drain: () => Effect.die("Unexpected drain") })
    const caller = yield* coordinator
      .control(
        "session",
        Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.gen(function* () {
                yield* Deferred.succeed(closing, undefined)
                yield* Deferred.await(release)
                state.closed = true
              }),
            )
            yield* Deferred.succeed(entered, undefined)
            return yield* Effect.never
          }),
        ),
      )
      .pipe(
        Effect.exit,
        Effect.tap(() =>
          Effect.sync(() => {
            state.answered = true
          }),
        ),
        Effect.forkChild,
      )
    yield* Deferred.await(entered)
    const stop = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
    yield* Deferred.await(closing)
    expect(state.answered).toBe(false)
    yield* Deferred.succeed(release, undefined)
    expect((yield* Fiber.join(caller))._tag).toBe("Failure")
    yield* Fiber.join(stop)
    expect(state.closed).toBe(true)
    expect(state.answered).toBe(true)
  }),
)

it.live("a control defect settles its caller and preserves the unrelated drain", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const state = { finished: false }
    const coordinator = yield* SessionRunCoordinator.make({
      drain: (_, __, controls) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          yield* controls
          state.finished = true
        }),
    })
    const owner = yield* coordinator.run("session").pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const caller = yield* coordinator
      .control("session", Effect.die("control defect"))
      .pipe(Effect.exit, Effect.forkChild)
    yield* Effect.yieldNow
    yield* Deferred.succeed(release, undefined)
    expect((yield* Fiber.join(caller))._tag).toBe("Failure")
    yield* Fiber.join(owner)
    expect(state.finished).toBe(true)
  }),
)

it.live("a pending drain receives ownership after one control batch", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const order: string[] = []
    const coordinator = yield* SessionRunCoordinator.make({
      drain: (_, __, controls) =>
        Effect.gen(function* () {
          order.push("drain")
          yield* controls
        }),
    })
    const first = yield* coordinator
      .control("session", Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const second = yield* coordinator
      .control(
        "session",
        Effect.sync(() => {
          order.push("second")
        }),
      )
      .pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* coordinator.wake("session")
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(first)
    yield* Fiber.join(second)
    yield* coordinator.wait("session")
    expect(order).toEqual(["drain", "second"])
  }),
)

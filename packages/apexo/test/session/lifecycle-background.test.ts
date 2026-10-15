import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { BackgroundJob } from "@apexo/core/background-job"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionSchema } from "@apexo/core/session/schema"
import { testEffect } from "../lib/effect"
const it = testEffect(Layer.empty)

it.live("deletion cancels and joins detached concrete jobs while unrelated Session jobs remain live", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const jobs = yield* BackgroundJob.makeOwned.pipe(Effect.provideService(SessionLifecycle.Service, lifecycle))
    const first = SessionSchema.ID.create()
    const other = SessionSchema.ID.create()
    const entered = yield* Deferred.make<void>()
    const ended = yield* Deferred.make<void>()
    const cancelled: string[] = []
    const job = yield* jobs.start({
      type: "test",
      metadata: { ownerSessionId: first },
      onCancel: Effect.sync(() => {
        cancelled.push(first)
      }),
      run: Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(Deferred.succeed(ended, undefined)),
      ),
    })
    const unrelated = yield* jobs.start({ type: "test", metadata: { ownerSessionId: other }, run: Effect.never })
    yield* Deferred.await(entered)
    yield* lifecycle.retire(first, Effect.void)
    expect(yield* Deferred.isDone(ended)).toBe(true)
    expect((yield* jobs.get(job.id))?.status).toBe("cancelled")
    expect((yield* jobs.get(unrelated.id))?.status).toBe("running")
    expect(cancelled).toEqual([first])
    yield* jobs.cancel(unrelated.id)
  }),
)

it.live("a stale background launch cannot address a replacement Session", () =>
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.make
    const jobs = yield* BackgroundJob.makeOwned.pipe(Effect.provideService(SessionLifecycle.Service, lifecycle))
    const sessionID = SessionSchema.ID.create()
    const late = yield* lifecycle.bind(
      sessionID,
      jobs.start({ type: "test", metadata: { ownerSessionId: sessionID }, run: Effect.succeed("old") }),
    )
    yield* lifecycle.retire(sessionID, Effect.void)
    yield* lifecycle.capture(sessionID)
    expect((yield* late.pipe(Effect.flip))._tag).toBe("SessionLifecycle.Closed")
    expect(yield* jobs.list()).toEqual([])
  }),
)

it.live("delayed cancellation of a completed background job cannot cancel a replacement with the same job ID", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<string>()
    const id = "reused-job"
    yield* jobs.start({
      id,
      type: "test",
      run: Deferred.await(finish),
      onCancel: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
    })
    const cancellation = yield* jobs.cancel(id).pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* Deferred.succeed(finish, "first finished")
    yield* jobs.wait({ id })
    yield* jobs.start({ id, type: "test", run: Effect.never })
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(cancellation)
    expect((yield* jobs.get(id))?.status).toBe("running")
    yield* jobs.cancel(id)
  }),
)

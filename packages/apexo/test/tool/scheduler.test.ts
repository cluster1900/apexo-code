import { expect } from "bun:test"
import { Deferred, Effect, Exit, Layer } from "effect"
import { TestClock } from "effect/testing"
import { BackgroundJob } from "@apexo/core/background-job"
import { Scheduler } from "@apexo/core/scheduler"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)
const input = {
  ownerSessionId: "owner",
  prompt: "original",
  intervalSeconds: 60,
  recurring: true,
  fireImmediately: false,
  run: () => Effect.succeed("done"),
}

it.effect("scheduler prompt updates preserve the timer, expiry and background job", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const scheduler = Scheduler.make(jobs)
    const prompts: string[] = []
    const created = yield* scheduler.create({
      ...input,
      run: (schedule) =>
        Effect.sync(() => {
          prompts.push(schedule.prompt)
          return schedule.prompt
        }),
    })
    yield* TestClock.adjust(30_000)
    const updated = yield* scheduler.update({ id: created.job.id, ownerSessionId: "owner", prompt: "updated" })
    expect(updated.job.started_at).toBe(created.job.started_at)
    expect(updated.schedule.createdAt).toBe(created.schedule.createdAt)
    expect(updated.schedule.expiresAt).toBe(created.schedule.expiresAt)
    expect(Scheduler.nextFireAt(updated.schedule)).toBe(60_000)
    yield* TestClock.adjust(30_000)
    expect(prompts).toEqual(["updated"])
    expect((yield* jobs.get(created.job.id))?.metadata?.nextFireAt).toBe(120_000)
    yield* jobs.cancel(created.job.id)
  }),
)

it.effect("scheduler interval updates retain the anchor and wake the existing timer", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const scheduler = Scheduler.make(jobs)
    const calls: string[] = []
    const created = yield* scheduler.create({
      ...input,
      run: () =>
        Effect.sync(() => {
          calls.push("fire")
          return "done"
        }),
    })
    yield* TestClock.adjust(30_000)
    const updated = yield* scheduler.update({ id: created.job.id, ownerSessionId: "owner", intervalSeconds: 180 })
    expect(Scheduler.nextFireAt(updated.schedule)).toBe(180_000)
    yield* TestClock.adjust(149_999)
    expect(calls).toEqual([])
    yield* TestClock.adjust(1)
    expect(calls).toEqual(["fire"])
    yield* TestClock.adjust(90_000)
    const shortened = yield* scheduler.update({ id: created.job.id, ownerSessionId: "owner", intervalSeconds: 60 })
    expect(shortened.schedule.createdAt).toBe(0)
    expect(shortened.schedule.lastFireAt).toBe(270_000)
    expect(Scheduler.nextFireAt(shortened.schedule)).toBe(330_000)
    expect(calls).toHaveLength(1)
    yield* TestClock.adjust(60_000)
    expect(calls).toHaveLength(2)
    yield* jobs.cancel(created.job.id)
  }),
)

it.effect("scheduler updates do not interrupt an active fire and the next fire uses the new prompt", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const scheduler = Scheduler.make(jobs)
    const release = yield* Deferred.make<void>()
    const calls: string[] = []
    const cancelled: string[] = []
    const created = yield* scheduler.create({
      ...input,
      run: (schedule) =>
        Effect.gen(function* () {
          calls.push(schedule.prompt)
          if (calls.length === 1) yield* Deferred.await(release)
          return schedule.prompt
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              cancelled.push(schedule.prompt)
            }),
          ),
        ),
    })
    yield* TestClock.adjust(60_000)
    expect(calls).toEqual(["original"])
    yield* TestClock.adjust(10_000)
    const updated = yield* scheduler.update({ id: created.job.id, ownerSessionId: "owner", prompt: "next" })
    expect(Scheduler.nextFireAt(updated.schedule)).toBe(120_000)
    expect(cancelled).toEqual([])
    yield* Deferred.succeed(release, undefined)
    yield* TestClock.adjust(50_000)
    expect(calls).toEqual(["original", "next"])
    expect(cancelled).toEqual([])
    yield* jobs.cancel(created.job.id)
  }),
)

it.effect("scheduler enforces the 50-task limit atomically and releases slots on cancellation", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const scheduler = Scheduler.make(jobs)
    const results = yield* Effect.all(
      Array.from({ length: 51 }, () => scheduler.create(input).pipe(Effect.exit)),
      { concurrency: "unbounded" },
    )
    expect(results.filter(Exit.isSuccess)).toHaveLength(50)
    expect(results.filter(Exit.isFailure)).toHaveLength(1)
    const active = yield* jobs.list()
    yield* jobs.cancel(active[0]!.id)
    const replacement = yield* scheduler.create(input)
    expect(replacement.job.status).toBe("running")
    const other = yield* scheduler.create({ ...input, ownerSessionId: "other" })
    expect(other.job.status).toBe("running")
    yield* Effect.forEach(yield* jobs.list(), (job) => jobs.cancel(job.id), { discard: true })
  }),
)

it.effect("scheduler rejects foreign and completed task updates without changing state", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const scheduler = Scheduler.make(jobs)
    const created = yield* scheduler.create({ ...input, recurring: false })
    const foreign = yield* scheduler
      .update({ id: created.job.id, ownerSessionId: "other", prompt: "hijacked" })
      .pipe(Effect.exit)
    expect(Exit.isFailure(foreign)).toBe(true)
    expect((yield* jobs.get(created.job.id))?.metadata?.prompt).toBe("original")
    yield* TestClock.adjust(60_000)
    expect((yield* jobs.get(created.job.id))?.status).toBe("completed")
    const finished = yield* scheduler
      .update({ id: created.job.id, ownerSessionId: "owner", prompt: "restart" })
      .pipe(Effect.exit)
    expect(Exit.isFailure(finished)).toBe(true)
  }),
)

it.effect("scheduler continues after a failed fire without spinning or postponing expiry", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const scheduler = Scheduler.make(jobs)
    const calls: number[] = []
    const created = yield* scheduler.create({
      ...input,
      run: () =>
        Effect.gen(function* () {
          calls.push(calls.length)
          if (calls.length === 1) return yield* Effect.fail(new Error("temporary failure"))
          return "recovered"
        }),
    })
    yield* TestClock.adjust(60_000)
    expect((yield* jobs.get(created.job.id))?.metadata?.lastError).toContain("temporary failure")
    expect((yield* jobs.get(created.job.id))?.status).toBe("running")
    yield* TestClock.adjust(60_000)
    expect(calls).toHaveLength(2)
    expect((yield* jobs.get(created.job.id))?.output).toBe("recovered")
    expect((yield* jobs.get(created.job.id))?.metadata?.expiresAt).toBe(Scheduler.TTL_MS)
    yield* jobs.cancel(created.job.id)
  }),
)

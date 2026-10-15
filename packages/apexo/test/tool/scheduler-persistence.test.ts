import { expect } from "bun:test"
import { Deferred, Effect, Exit, Scope } from "effect"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { BackgroundJob } from "@apexo/core/background-job"
import { Scheduler } from "@apexo/core/scheduler"
import { SchedulerStore } from "@apexo/core/scheduler-store"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import path from "node:path"
import { readdir, readFile, writeFile, utimes } from "node:fs/promises"
import { tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))
const input = {
  ownerSessionId: "owner",
  prompt: "check",
  intervalSeconds: 60,
  recurring: true,
  durable: true,
  fireImmediately: false,
  resume: {
    agent: "build",
    messageID: "origin",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
  },
  run: () => Effect.succeed("ok"),
}

const launch = (root: string) =>
  Effect.gen(function* () {
    const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
    const runtime = yield* Effect.gen(function* () {
      const jobs = yield* BackgroundJob.make
      const store = yield* SchedulerStore.make("/workspace", root)
      const scheduler = Scheduler.make(jobs, store)
      return { jobs, store, scheduler }
    }).pipe(Effect.provideService(Scope.Scope, scope))
    return { ...runtime, stop: runtime.scheduler.shutdown.pipe(Effect.andThen(Scope.close(scope, Exit.void))) }
  })

it.live("scheduler persists creation and updates, resumes with the same identity, and durably deletes", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const first = yield* launch(dir)
    const created = yield* first.scheduler.create(input)
    yield* first.scheduler.update({
      id: created.job.id,
      ownerSessionId: "owner",
      prompt: "updated",
      intervalSeconds: 120,
    })
    const saved = (yield* first.store.load())[0]!
    expect(saved.prompt).toBe("updated")
    expect(saved.resume).toEqual(input.resume)
    yield* first.stop
    const second = yield* launch(dir)
    yield* second.scheduler.recover(() => Effect.succeed(input.run))
    const resumed = yield* second.jobs.get(created.job.id)
    expect(resumed?.status).toBe("running")
    expect(resumed?.metadata?.nextFireAt).toBe(created.schedule.createdAt + 120_000)
    expect(resumed?.metadata?.expiresAt).toBe(created.schedule.expiresAt)
    yield* second.jobs.cancel(created.job.id)
    expect(yield* second.store.load()).toEqual([])
    yield* second.stop
    const third = yield* launch(dir)
    yield* third.scheduler.recover(() => Effect.succeed(input.run))
    expect(yield* third.jobs.list()).toEqual([])
  }),
)

it.live("scheduler does not replay an interrupted fire after restart", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const first = yield* launch(dir)
    const started = yield* Deferred.make<void>()
    const created = yield* first.scheduler.create({
      ...input,
      fireImmediately: true,
      run: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    })
    yield* awaitWithTimeout(Deferred.await(started), "first fire never started")
    const saved = (yield* first.store.load())[0]!
    expect(saved.inFlight).toBe(true)
    expect(saved.lastFireAt).toBeDefined()
    yield* first.stop
    const second = yield* launch(dir)
    const calls: string[] = []
    yield* second.scheduler.recover(() =>
      Effect.succeed(() =>
        Effect.sync(() => {
          calls.push("replayed")
          return "ok"
        }),
      ),
    )
    const resumed = yield* second.jobs.get(created.job.id)
    expect(resumed?.metadata?.recoveredInterrupted).toBe(true)
    expect(resumed?.metadata?.nextFireAt).toBe(saved.lastFireAt! + 60_000)
    expect(calls).toEqual([])
    yield* second.jobs.cancel(created.job.id)
  }),
)

it.live("scheduler resumes an overdue task once and drops expired and orphaned tasks", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const first = yield* launch(dir)
    const created = yield* first.scheduler.create(input)
    yield* first.store.save({ ...created.schedule, createdAt: Date.now() - 61_000 })
    yield* first.store.save({ ...created.schedule, id: "expired", expiresAt: Date.now() - 1 })
    yield* first.store.save({ ...created.schedule, id: "orphan", ownerSessionId: "missing-owner" })
    yield* first.stop
    const second = yield* launch(dir)
    const fired = yield* Deferred.make<void>()
    const calls: string[] = []
    yield* second.scheduler.recover((schedule) =>
      Effect.succeed(
        schedule.id === "orphan"
          ? undefined
          : (schedule) =>
              Effect.sync(() => {
                calls.push(schedule.id)
              }).pipe(Effect.andThen(Deferred.succeed(fired, undefined)), Effect.as("done")),
      ),
    )
    yield* awaitWithTimeout(Deferred.await(fired), "overdue task never fired")
    expect(calls).toEqual([created.job.id])
    expect((yield* second.store.load()).map((schedule) => schedule.id)).toEqual([created.job.id])
    yield* second.jobs.cancel(created.job.id)
  }),
)

it.live("scheduler refuses a competing owner, then recovers after the first owner closes", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const first = yield* launch(dir)
    const created = yield* first.scheduler.create(input)
    const second = yield* launch(dir)
    yield* second.scheduler.recover(() => Effect.succeed(input.run))
    expect(yield* second.jobs.list()).toEqual([])
    expect(second.scheduler.recoveryError("owner")).toContain("ownership")
    yield* first.stop
    yield* second.scheduler.recover(() => Effect.succeed(input.run))
    expect(second.scheduler.recoveryError("owner")).toBeUndefined()
    expect((yield* second.jobs.get(created.job.id))?.status).toBe("running")
    yield* second.jobs.cancel(created.job.id)
  }),
)

it.live("scheduler persistence failures leave the running schedule unchanged", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const scheduler = Scheduler.make(jobs, {
      load: () => Effect.succeed([]),
      claim: () => Effect.void,
      save: (schedule) =>
        schedule.prompt === "invalid"
          ? Effect.fail(new SchedulerStore.StorageError({ message: "disk full" }))
          : Effect.void,
      remove: () => Effect.fail(new SchedulerStore.StorageError({ message: "disk full" })),
    })
    const created = yield* scheduler.create(input)
    const updated = yield* scheduler
      .update({ id: created.job.id, ownerSessionId: "owner", prompt: "invalid" })
      .pipe(Effect.exit)
    expect(Exit.isFailure(updated)).toBe(true)
    expect((yield* jobs.get(created.job.id))?.metadata?.prompt).toBe("check")
    const cancelled = yield* jobs.cancel(created.job.id).pipe(Effect.exit)
    expect(Exit.isFailure(cancelled)).toBe(true)
    expect((yield* jobs.get(created.job.id))?.status).toBe("running")
    yield* scheduler.shutdown
  }),
)

it.live("scheduler resumes ordinary session schedules and reports corrupt state without overwriting it", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const first = yield* launch(dir)
    const created = yield* first.scheduler.create({ ...input, durable: false })
    yield* first.stop
    const storage = SchedulerStore.directory("/workspace", dir)
    const files = yield* Effect.promise(() => readdir(storage))
    const file = path.join(storage, files.find((file) => file.endsWith(".json"))!)
    const original = yield* Effect.promise(() => readFile(file, "utf8"))
    yield* Effect.promise(() => writeFile(file, "corrupted"))
    const second = yield* launch(dir)
    yield* second.scheduler.recover(() => Effect.succeed(input.run))
    expect(second.scheduler.recoveryError("owner")).toContain("Cannot read scheduler state")
    expect(yield* second.jobs.list()).toEqual([])
    expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe("corrupted")
    yield* Effect.promise(() => writeFile(file, original))
    yield* second.scheduler.recover(() => Effect.succeed(input.run))
    expect(second.scheduler.recoveryError("owner")).toBeUndefined()
    expect((yield* second.jobs.get(created.job.id))?.metadata?.durable).toBe(false)
    yield* second.jobs.cancel(created.job.id)
  }),
)

it.live("scheduler only reclaims a crashed process lease, even when a live owner's heartbeat is stale", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const first = yield* launch(dir)
    const created = yield* first.scheduler.create(input)
    yield* first.stop
    const storage = SchedulerStore.directory("/workspace", dir)
    const files = yield* Effect.promise(() => readdir(storage))
    const ready = path.join(dir, "owner-ready")
    const worker = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.spawn(
          [
            process.execPath,
            path.join(import.meta.dir, "../fixture/flock-worker.ts"),
            JSON.stringify({
              key: path.join(storage, files.find((file) => file.endsWith(".json"))!),
              dir: path.join(storage, ".locks"),
              ready,
              holdMs: 60_000,
            }),
          ],
          { stdout: "ignore", stderr: "pipe" },
        ),
      ),
      (worker) =>
        Effect.promise(async () => {
          worker.kill()
          await worker.exited
        }),
    )
    yield* pollWithTimeout(
      Effect.promise(() => Bun.file(ready).exists()).pipe(Effect.map((ready) => (ready ? true : undefined))),
      "lock owner did not become ready",
    )
    const locks = yield* Effect.promise(() => readdir(path.join(storage, ".locks")))
    const old = new Date(Date.now() - 120_000)
    yield* Effect.promise(() => utimes(path.join(storage, ".locks", locks[0]!, "heartbeat"), old, old))
    const second = yield* launch(dir)
    yield* second.scheduler.recover(() => Effect.succeed(input.run))
    expect(second.scheduler.recoveryError("owner")).toContain("ownership")
    expect(yield* second.jobs.list()).toEqual([])
    worker.kill("SIGKILL")
    yield* Effect.promise(() => worker.exited)
    yield* second.scheduler.recover(() => Effect.succeed(input.run))
    expect(second.scheduler.recoveryError("owner")).toBeUndefined()
    expect((yield* second.jobs.get(created.job.id))?.status).toBe("running")
    yield* second.jobs.cancel(created.job.id)
  }),
)

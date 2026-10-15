// Off-tree supplement. Integrate as packages/apexo/test/tool/scheduler-owner-adversarial.test.ts.
import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { TestClock } from "effect/testing"
import path from "node:path"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { BackgroundJob } from "@apexo/core/background-job"
import { Scheduler } from "@apexo/core/scheduler"
import { SchedulerStore } from "@apexo/core/scheduler-store"
import { SessionSchedulerOwner } from "@apexo/core/session/scheduler-owner"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionSchema } from "@apexo/core/session/schema"
import { EventV2 } from "@apexo/core/event"
import { EventTable, EventSequenceTable } from "@apexo/core/event/sql"
import { ProjectV2 } from "@apexo/core/project"
import { ProjectTable } from "@apexo/core/project/sql"
import { SessionTable } from "@apexo/core/session/sql"
import { SessionV1, MessageID } from "@apexo/core/v1/session"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const sessionID = SessionSchema.ID.make("ses_scheduler_adversarial")
const input = {
  ownerSessionId: sessionID,
  prompt: "Do not run for a replacement Session",
  intervalSeconds: 60,
  recurring: true,
  durable: true,
  fireImmediately: false,
  resume: {
    agent: "build",
    messageID: MessageID.make("msg_scheduler_adversarial"),
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
  },
  run: () => Effect.succeed("done"),
}

const seed = Effect.fnUntraced(function* (db: Database.Interface["db"], directory: string) {
  const projectID = ProjectV2.ID.make("scheduler-adversarial-project")
  yield* db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make(directory), sandboxes: [] })
    .onConflictDoNothing()
    .run()
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: projectID,
      slug: "scheduler-adversarial",
      directory,
      title: "Scheduler",
      version: "1",
    })
    .run()
  yield* db.insert(EventSequenceTable).values({ aggregate_id: sessionID, seq: 1 }).run()
  const id = EventV2.ID.create()
  yield* db
    .insert(EventTable)
    .values({
      id,
      aggregate_id: sessionID,
      seq: 1,
      type: EventV2.versionedType(SessionV1.Event.Created.type, SessionV1.Event.Created.durable!.version),
      data: { sessionID },
    })
    .run()
  return id
})

const launch = Effect.fnUntraced(function* (
  root: string,
  ownership: Scheduler.Ownership,
  lifecycle?: SessionLifecycle.Interface,
) {
  const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
  const runtime = yield* Effect.gen(function* () {
    const jobs = lifecycle
      ? yield* BackgroundJob.makeOwned.pipe(Effect.provideService(SessionLifecycle.Service, lifecycle))
      : yield* BackgroundJob.make
    const store = yield* SchedulerStore.make(root, path.join(root, "adversarial-store"))
    return { jobs, store, scheduler: Scheduler.make(jobs, store, ownership) }
  }).pipe(Effect.provideService(Scope.Scope, scope))
  return { ...runtime, stop: runtime.scheduler.shutdown.pipe(Effect.andThen(Scope.close(scope, Exit.void))) }
})

it.live("an existing unstamped Session keeps modern and legacy saved schedules inactive", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const database = yield* Database.Service
      const lifecycle = yield* SessionLifecycle.make
      const ownership = SessionSchedulerOwner.make(database.db, lifecycle)
      yield* seed(database.db, root)
      const first = yield* launch(root, ownership)
      const created = yield* first.scheduler.create(input)
      const legacy = { ...created.schedule, id: "job_unstamped_legacy", resume: { ...input.resume } }
      yield* first.store.save(legacy)
      const saved = yield* first.store.load()
      yield* first.stop
      // Explicit synthetic pre-event state, not fabricated historical runtime evidence.
      yield* database.db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, sessionID)).run()
      expect(
        yield* database.db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get(),
      ).toEqual({ id: sessionID })
      expect(yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, sessionID)).all()).toEqual(
        [],
      )
      const second = yield* launch(root, ownership)
      const resolved: string[] = []
      const calls: string[] = []
      yield* second.scheduler.recover((schedule) =>
        Effect.sync(() => {
          resolved.push(schedule.id)
          return () =>
            Effect.sync(() => {
              calls.push(schedule.id)
              return "forbidden"
            })
        }),
      )
      expect(yield* second.store.load()).toEqual(saved)
      expect(yield* second.jobs.list()).toEqual([])
      expect(second.scheduler.recoveryError(sessionID)).toBeDefined()
      expect(resolved).toEqual([])
      expect(calls).toEqual([])
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }),
)

it.live(
  "deletion and ID reuse after recovery proof but before background registration never execute the old task",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const lifecycle = yield* SessionLifecycle.make
        const ownership = SessionSchedulerOwner.make(database.db, lifecycle)
        const original = yield* seed(database.db, root)
        const first = yield* launch(root, ownership, lifecycle)
        const created = yield* first.scheduler.create(input)
        // Recovery will be due immediately, so a stale registration cannot hide behind a future timer.
        yield* first.store.save({ ...created.schedule, createdAt: Date.now() - 120_000 })
        yield* first.stop
        const second = yield* launch(root, ownership, lifecycle)
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
        const proofs: string[] = []
        const calls: string[] = []
        const recovery = yield* second.scheduler
          .recover((schedule) =>
            Effect.gen(function* () {
              proofs.push(schedule.resume!.createdEventID!)
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(release)
              return () =>
                Effect.sync(() => {
                  calls.push(schedule.id)
                  return "forbidden"
                })
            }),
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(entered).pipe(Effect.timeout("3 seconds"))
        expect(proofs).toEqual([original])
        yield* lifecycle.retire(
          sessionID,
          Effect.gen(function* () {
            yield* database.db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
            yield* database.db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, sessionID)).run()
          }),
        )
        expect(yield* seed(database.db, root)).not.toBe(original)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(recovery).pipe(Effect.timeout("3 seconds"))
        // An implementation may reject before registration or register an inert worker;
        // either must settle without executing and remove the proved-stale saved record.
        const job = yield* second.jobs.get(created.job.id)
        if (job) expect((yield* second.jobs.wait({ id: job.id, timeout: 3000 })).timedOut).toBe(false)
        expect(calls).toEqual([])
        expect(yield* second.store.load()).toEqual([])
        expect((yield* second.jobs.list()).some((item) => item.status === "running")).toBe(false)
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
    }),
)

it.effect("a same-process timer revalidates changed durable proof before its first fire", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const database = yield* Database.Service
      const lifecycle = yield* SessionLifecycle.make
      const ownership = SessionSchedulerOwner.make(database.db, lifecycle)
      const original = yield* seed(database.db, root)
      // Use the real standalone background engine to isolate the Scheduler proof check:
      // lifecycle cancellation must not make this assertion pass before the timer fires.
      const runtime = yield* launch(root, ownership)
      const calls: string[] = []
      const created = yield* runtime.scheduler.create({
        ...input,
        run: () =>
          Effect.sync(() => {
            calls.push("forbidden")
            return "bad"
          }),
      })
      expect(created.schedule.resume?.createdEventID).toBe(original)
      const replacement = EventV2.ID.create()
      yield* database.db.update(EventTable).set({ id: replacement }).where(eq(EventTable.id, original)).run()
      expect(yield* ownership.current(sessionID)).toBe(replacement)
      expect((yield* runtime.jobs.get(created.job.id))?.status).toBe("running")
      yield* TestClock.adjust(60_000)
      const settled = yield* runtime.jobs.wait({ id: created.job.id })
      expect(settled.info?.status).toBe("completed")
      expect(calls).toEqual([])
      expect(yield* runtime.store.load()).toEqual([])
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }),
)

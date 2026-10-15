import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Exit, Scope } from "effect"
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
import { SessionTable, MessageTable, PartTable } from "@apexo/core/session/sql"
import { SessionV1, MessageID, PartID } from "@apexo/core/v1/session"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const sessionID = SessionSchema.ID.make("ses_scheduler_owner")
const messageID = MessageID.make("msg_scheduler_owner")
const input = {
  ownerSessionId: sessionID,
  prompt: "Only this Session may run this task",
  intervalSeconds: 3600,
  recurring: true,
  durable: true,
  fireImmediately: false,
  resume: {
    agent: "build",
    messageID,
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
  },
  run: () => Effect.succeed("done"),
}

const seed = Effect.fnUntraced(function* (db: Database.Interface["db"], directory: string) {
  const projectID = ProjectV2.ID.make("scheduler-owner-project")
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
      slug: "scheduler-owner",
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

const launch = Effect.fnUntraced(function* (root: string, ownership: Scheduler.Ownership) {
  const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
  const runtime = yield* Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const store = yield* SchedulerStore.make(root, path.join(root, "schedule-store"))
    return { jobs, store, scheduler: Scheduler.make(jobs, store, ownership) }
  }).pipe(Effect.provideService(Scope.Scope, scope))
  return { ...runtime, stop: runtime.scheduler.shutdown.pipe(Effect.andThen(Scope.close(scope, Exit.void))) }
})

const receipt = Effect.fnUntraced(function* (db: Database.Interface["db"], taskID: string) {
  const message = SessionV1.Assistant.make({
    id: messageID,
    sessionID,
    role: "assistant",
    time: { created: 1, completed: 2 },
    parentID: MessageID.make("msg_parent"),
    modelID: ModelV2.ID.make("test"),
    providerID: ProviderV2.ID.make("test"),
    mode: "build",
    agent: "build",
    path: { cwd: "/workspace", root: "/workspace" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "stop",
  })
  yield* db
    .insert(MessageTable)
    .values({ id: messageID, session_id: sessionID, data: message })
    .onConflictDoNothing()
    .run()
  const part = SessionV1.ToolPart.make({
    id: PartID.make("prt_scheduler_owner"),
    messageID,
    sessionID,
    type: "tool",
    callID: "scheduler-owner-call",
    tool: "scheduler_create",
    state: {
      status: "completed",
      input: { prompt: input.prompt },
      output: "Scheduled",
      title: "Scheduled",
      metadata: { task_id: taskID },
      time: { start: 1, end: 2 },
    },
  })
  yield* db.insert(PartTable).values({ id: part.id, message_id: messageID, session_id: sessionID, data: part }).run()
})

it.live("durable scheduler creation identity survives restart and transcript compaction", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const database = yield* Database.Service
      const lifecycle = yield* SessionLifecycle.make
      const ownership = SessionSchedulerOwner.make(database.db, lifecycle)
      const createdEventID = yield* seed(database.db, root)
      const first = yield* launch(root, ownership)
      const created = yield* first.scheduler.create(input)
      expect(created.schedule.resume?.createdEventID).toBe(createdEventID)
      yield* receipt(database.db, created.job.id)
      yield* first.stop
      // Compaction may remove projected tool history, but never the Session Created event.
      yield* database.db.delete(MessageTable).where(eq(MessageTable.session_id, sessionID)).run()
      const second = yield* launch(root, ownership)
      yield* second.scheduler.recover(() => Effect.succeed(input.run))
      expect((yield* second.jobs.get(created.job.id))?.status).toBe("running")
      expect((yield* second.store.load())[0]?.resume?.createdEventID).toBe(createdEventID)
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }),
)

it.live("an unopened durable scheduler cannot recover work into a reused Session ID", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const database = yield* Database.Service
      const lifecycle = yield* SessionLifecycle.make
      const ownership = SessionSchedulerOwner.make(database.db, lifecycle)
      const before = yield* seed(database.db, root)
      const first = yield* launch(root, ownership)
      const created = yield* first.scheduler.create(input)
      yield* first.store.save({ ...created.schedule, createdAt: Date.now() - 3_700_000 })
      yield* first.stop
      yield* lifecycle.retire(
        sessionID,
        Effect.gen(function* () {
          yield* database.db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
          yield* database.db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, sessionID)).run()
        }),
      )
      expect(yield* seed(database.db, root)).not.toBe(before)
      const second = yield* launch(root, ownership)
      const calls: string[] = []
      yield* second.scheduler.recover(() =>
        Effect.succeed(() =>
          Effect.sync(() => {
            calls.push("forbidden")
            return "bad"
          }),
        ),
      )
      expect(yield* second.jobs.list()).toEqual([])
      expect(yield* second.store.load()).toEqual([])
      expect(calls).toEqual([])
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }),
)

it.live("legacy scheduler upgrades exact persisted task receipts and preserves unverified records inactive", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const database = yield* Database.Service
      const lifecycle = yield* SessionLifecycle.make
      const ownership = SessionSchedulerOwner.make(database.db, lifecycle)
      const createdEventID = yield* seed(database.db, root)
      const first = yield* launch(root, ownership)
      const created = yield* first.scheduler.create(input)
      const legacy = { ...created.schedule, resume: { ...input.resume } }
      yield* first.store.save(legacy)
      yield* first.store.save({ ...legacy, id: "job_unknown_legacy" })
      yield* receipt(database.db, created.job.id)
      yield* first.stop
      const second = yield* launch(root, ownership)
      yield* second.scheduler.recover(() => Effect.succeed(input.run))
      expect((yield* second.jobs.get(created.job.id))?.status).toBe("running")
      expect(yield* second.jobs.get("job_unknown_legacy")).toBeUndefined()
      expect(second.scheduler.recoveryError(sessionID)).toContain("ownership could not be verified")
      expect((yield* second.store.load()).find((item) => item.id === created.job.id)?.resume?.createdEventID).toBe(
        createdEventID,
      )
      expect((yield* second.store.load()).some((item) => item.id === "job_unknown_legacy")).toBe(true)
      yield* second.stop
      yield* database.db.delete(PartTable).where(eq(PartTable.session_id, sessionID)).run()
      const third = yield* launch(root, ownership)
      yield* third.scheduler.recover(() => Effect.succeed(input.run))
      expect((yield* third.jobs.get(created.job.id))?.status).toBe("running")
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }),
)

it.live("old admitted scheduler callbacks cannot stamp a replacement Session", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const database = yield* Database.Service
      const lifecycle = yield* SessionLifecycle.make
      yield* seed(database.db, root)
      const runtime = yield* launch(root, SessionSchedulerOwner.make(database.db, lifecycle))
      const delayed = yield* lifecycle.bind(sessionID, runtime.scheduler.create(input))
      yield* lifecycle.retire(
        sessionID,
        Effect.gen(function* () {
          yield* database.db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
          yield* database.db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, sessionID)).run()
        }),
      )
      yield* seed(database.db, root)
      expect(Exit.isFailure(yield* delayed.pipe(Effect.exit))).toBe(true)
      expect(yield* runtime.store.load()).toEqual([])
      expect(yield* runtime.jobs.list()).toEqual([])
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }),
)

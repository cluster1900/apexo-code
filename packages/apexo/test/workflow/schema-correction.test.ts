import { expect } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { WorkflowRunTable } from "@apexo/core/workflow/sql"
import { SessionID } from "@apexo/schema/session-id"
import { AbsolutePath } from "@apexo/schema/schema"
import { Database } from "@apexo/core/database/database"
import { WorkflowStore } from "@apexo/core/workflow/store"
import { WorkflowEngine } from "@apexo/core/workflow/engine"
import { SessionTable } from "@apexo/core/session/sql"
import { ProjectTable } from "@apexo/core/project/sql"
import { ProjectV2 } from "@apexo/core/project"
import { testEffect } from "../lib/effect"

const it = testEffect(Database.layerFromPath(":memory:"))
const fixture = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  const sessionID = SessionID.create()
  const projectID = ProjectV2.ID.make("workflow-tests")
  yield* database.db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make("/tmp"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
  yield* database.db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: projectID,
      slug: "workflow",
      directory: "/tmp",
      title: "Workflow",
      version: "1",
    })
    .run()
  const store = WorkflowStore.make(database.db)
  return { database, sessionID, store, engine: WorkflowEngine.make(store) }
})

it.live("schema attempt claims serialize and permit exactly initial plus one correction", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const run = yield* f.store.create(f.sessionID, {
      source: {
        type: "definition",
        definition: {
          name: "claims",
          description: "Claims",
          stages: [{ name: "child", prompt: "Review" }],
        },
      },
    })
    yield* f.engine.run(f.sessionID, run.info.id, (task) =>
      Effect.gen(function* () {
        const initial = yield* Effect.all(
          [0, 0].map(() => f.store.claimSchemaAttempt(f.sessionID, run.info.id, task.key, 0).pipe(Effect.result)),
          { concurrency: "unbounded" },
        )
        expect(initial.filter((result) => result._tag === "Success")).toHaveLength(1)
        expect(initial.filter((result) => result._tag === "Failure")).toHaveLength(1)
        const correction = yield* Effect.all(
          [1, 1].map(() => f.store.claimSchemaAttempt(f.sessionID, run.info.id, task.key, 1).pipe(Effect.result)),
          { concurrency: "unbounded" },
        )
        expect(correction.filter((result) => result._tag === "Success")).toHaveLength(1)
        expect(correction.filter((result) => result._tag === "Failure")).toHaveLength(1)
        expect(
          yield* f.store.claimSchemaAttempt(f.sessionID, run.info.id, task.key, 0).pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "stale" } })
        return yield* Effect.fail(new WorkflowStore.Failure({ code: "invalid", message: "Controlled stop" }))
      }),
    )
    const state = yield* f.store.read(f.sessionID, run.info.id)
    expect(state.tasks[0]?.schemaAttempt).toBe(1)
    expect(state.info.agentsSpent).toBe(1)
    expect(state.info.status).toBe("failed")
  }),
)

it.live("usage receipts merge once in either order and never reopen a terminal Workflow", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const run = yield* f.store.create(f.sessionID, {
      source: {
        type: "definition",
        definition: {
          name: "usage",
          description: "Usage",
          stages: [{ name: "child", prompt: "Review" }],
        },
      },
    })
    const child = SessionID.create()
    yield* f.engine.run(f.sessionID, run.info.id, (task) =>
      Effect.gen(function* () {
        yield* task.attach(child)
        yield* f.store.recordUsage(f.sessionID, run.info.id, task.key, child, { first: { finished: false } })
        expect((yield* f.store.read(f.sessionID, run.info.id)).info).toMatchObject({ tokens: 0, usageIncomplete: true })
        yield* f.store.recordUsage(f.sessionID, run.info.id, task.key, child, {
          first: { tokens: 5, finished: true },
          second: { tokens: 2, finished: false },
        })
        expect((yield* f.store.read(f.sessionID, run.info.id)).info).toMatchObject({ tokens: 7, usageIncomplete: true })
        return yield* Effect.fail(new WorkflowStore.Failure({ code: "invalid", message: "Controlled failure" }))
      }),
    )
    const key = "child:0"
    yield* f.store.recordUsage(f.sessionID, run.info.id, key, child, {
      first: { tokens: 3, finished: false },
      second: { tokens: 7, finished: true },
    })
    yield* f.store.recordUsage(f.sessionID, run.info.id, key, child, {
      first: { tokens: 5, finished: true },
      second: { tokens: 7, finished: true },
    })
    const done = yield* f.store.read(f.sessionID, run.info.id)
    expect(done.info).toMatchObject({ status: "failed", tokens: 12, usageIncomplete: false })
    expect(done.info.message).toContain("Controlled failure")
    expect(done.tasks[0]?.usage).toEqual({
      first: { tokens: 5, finished: true },
      second: { tokens: 7, finished: true },
    })
    expect(
      yield* f.store.recordUsage(f.sessionID, run.info.id, key, SessionID.create(), {}).pipe(Effect.flip),
    ).toMatchObject({ code: "stale" })
    expect((yield* f.store.read(f.sessionID, run.info.id)).info.tokens).toBe(12)
  }),
)

it.live("an unobserved correction stays incomplete through old receipts and store reconstruction", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const run = yield* f.store.create(f.sessionID, {
      source: {
        type: "definition",
        definition: {
          name: "pending",
          description: "Pending",
          stages: [{ name: "child", prompt: "Review" }],
        },
      },
    })
    const child = SessionID.create()
    yield* f.engine.run(f.sessionID, run.info.id, (task) =>
      Effect.gen(function* () {
        yield* task.attach(child)
        yield* f.store.claimSchemaAttempt(f.sessionID, run.info.id, task.key, 0)
        yield* f.store.recordUsage(f.sessionID, run.info.id, task.key, child, {
          initial: { tokens: 5, finished: true },
        })
        expect((yield* f.store.read(f.sessionID, run.info.id)).info.usageIncomplete).toBe(false)
        yield* f.store.claimSchemaAttempt(f.sessionID, run.info.id, task.key, 1)
        yield* f.store.recordUsage(f.sessionID, run.info.id, task.key, child, {
          initial: { tokens: 5, finished: true },
        })
        expect((yield* f.store.read(f.sessionID, run.info.id)).info).toMatchObject({ tokens: 5, usageIncomplete: true })
        return yield* Effect.fail(new WorkflowStore.Failure({ code: "invalid", message: "Interrupted correction" }))
      }),
    )
    const reopened = WorkflowStore.make(f.database.db)
    const retained = yield* reopened.read(f.sessionID, run.info.id)
    expect(retained.info).toMatchObject({ status: "failed", tokens: 5, usageIncomplete: true })
    expect(retained.tasks[0]).toMatchObject({ schemaAttempt: 1, schemaPending: true, schemaPriorCalls: ["initial"] })
    expect(yield* reopened.checkResumeOwner(f.sessionID, run.info.id).pipe(Effect.flip)).toMatchObject({
      code: "restart",
    })
    expect(yield* reopened.resume(f.sessionID, run.info.id).pipe(Effect.flip)).toMatchObject({ code: "restart" })
    yield* reopened.recordUsage(f.sessionID, run.info.id, "child:0", child, { initial: { tokens: 5, finished: true } })
    expect((yield* reopened.read(f.sessionID, run.info.id)).info.usageIncomplete).toBe(true)
    yield* reopened.recordUsage(f.sessionID, run.info.id, "child:0", child, {
      correction: { tokens: 8, finished: true },
    })
    expect((yield* reopened.read(f.sessionID, run.info.id)).info).toMatchObject({
      status: "failed",
      tokens: 13,
      usageIncomplete: false,
    })
  }),
)

it.live("schema preflight rejects async and unavailable reference validators", () =>
  Effect.gen(function* () {
    expect(yield* WorkflowEngine.compile({ $async: true, type: "object" }).pipe(Effect.flip)).toMatchObject({
      code: "invalid",
      message: expect.stringContaining("Asynchronous"),
    })
    expect(
      yield* WorkflowEngine.compile({ $ref: "https://example.invalid/schema.json" }).pipe(Effect.flip),
    ).toMatchObject({ code: "invalid" })
    expect(yield* WorkflowEngine.compile({ description: "x".repeat(256 * 1024) }).pipe(Effect.flip)).toMatchObject({
      code: "invalid",
      message: expect.stringContaining("size limit"),
    })
  }),
)

it.live("resume refuses a claimed unfinished schema task without changing its paused state", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const run = yield* f.store.create(f.sessionID, {
      source: {
        type: "definition",
        definition: {
          name: "paused-claim",
          description: "Pause before provider admission",
          stages: [{ name: "child", prompt: "Review" }],
        },
      },
    })
    yield* f.engine.run(f.sessionID, run.info.id, (task) =>
      Effect.gen(function* () {
        yield* f.store.claimSchemaAttempt(f.sessionID, run.info.id, task.key, 0)
        yield* f.store.stop(f.sessionID, run.info.id)
        return yield* Effect.fail(
          new WorkflowStore.Failure({ code: "invalid", message: "Interrupted before provider admission" }),
        )
      }),
    )
    const prior = yield* f.store.read(f.sessionID, run.info.id)
    expect(prior.info).toMatchObject({ status: "paused", tokens: 0, usageIncomplete: true })
    expect(yield* f.store.resume(f.sessionID, run.info.id).pipe(Effect.flip)).toMatchObject({
      code: "stale",
      message: expect.stringContaining("start a new Workflow run"),
    })
    expect(yield* f.store.read(f.sessionID, run.info.id)).toEqual(prior)
    const reopened = WorkflowStore.make(f.database.db)
    expect(yield* reopened.resume(f.sessionID, run.info.id).pipe(Effect.flip)).toMatchObject({ code: "restart" })
    expect(yield* reopened.read(f.sessionID, run.info.id)).toEqual(prior)
    expect(f.store.info(prior).resumeBlockedReason).toBe("schema_attempt_claimed")
    expect((yield* f.store.list(f.sessionID))[0]?.resumeBlockedReason).toBe("schema_attempt_claimed")
    expect(reopened.info(prior).resumeBlockedReason).toBe("process_restart")
    expect((yield* reopened.list(f.sessionID))[0]?.resumeBlockedReason).toBe("process_restart")
    expect(prior.info).not.toHaveProperty("resumeBlockedReason")
    for (const status of ["completed", "failed"] as const) {
      expect(reopened.info({ ...prior, info: { ...prior.info, status } }).resumeBlockedReason).toBeUndefined()
    }
    yield* f.store.change(f.sessionID, run.info.id, (state) => ({ ...state, info: f.store.info(state) }))
    const row = yield* f.database.db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.id, run.info.id)).get()
    expect(row?.data).not.toHaveProperty("info.resumeBlockedReason")
    expect((yield* f.store.read(f.sessionID, run.info.id)).info).not.toHaveProperty("resumeBlockedReason")
    expect(yield* f.store.resume(f.sessionID, run.info.id).pipe(Effect.flip)).toMatchObject({ code: "stale" })
  }),
)

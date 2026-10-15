import { expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { Workflow } from "@apexo/schema/workflow"
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
const definition: Workflow.Definition = {
  name: "review",
  description: "Independent review",
  stages: [
    {
      name: "plan",
      prompt: "Plan",
      outputSchema: {
        type: "object",
        required: ["items"],
        properties: { items: { type: "array", items: { type: "string" } } },
      },
    },
    { name: "review", prompt: "Review", input: "plan", foreach: "items", readOnly: true },
  ],
}
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

it.live("reserves the whole panel and replays durable child receipts after a budget increase", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const run = yield* f.store.create(f.sessionID, { source: { type: "definition", definition }, agentBudget: 2 })
    const calls: string[] = []
    const driver: WorkflowEngine.Driver = (task) =>
      Effect.gen(function* () {
        calls.push(task.key)
        const sessionID = SessionID.create()
        yield* task.attach(sessionID)
        return { sessionID, output: task.stage.name === "plan" ? { items: ["a", "b"] } : task.key, tokens: 7 }
      })
    expect(yield* f.engine.run(f.sessionID, run.info.id, driver)).toMatchObject({
      status: "budget_limited",
      agentsSpent: 1,
      tokens: 7,
    })
    expect(calls).toEqual(["plan:0"])
    expect(yield* f.store.resume(f.sessionID, run.info.id, 2).pipe(Effect.flip)).toMatchObject({ code: "budget" })
    yield* f.store.resume(f.sessionID, run.info.id, 3)
    expect(yield* f.engine.run(f.sessionID, run.info.id, driver)).toMatchObject({
      status: "completed",
      agentsSpent: 3,
      tokens: 21,
      result: ["review:0", "review:1"],
    })
    expect(calls).toEqual(["plan:0", "review:0", "review:1"])
    const reopened = WorkflowStore.make(f.database.db)
    expect((yield* reopened.read(f.sessionID, run.info.id)).info.status).toBe("completed")
    expect(yield* reopened.resume(f.sessionID, run.info.id).pipe(Effect.flip)).toMatchObject({ code: "restart" })
    expect(yield* f.store.read(SessionID.create(), run.info.id).pipe(Effect.flip)).toMatchObject({ code: "missing" })
  }),
)

it.live("interruption closes children and requires explicit same-process resume", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const run = yield* f.store.create(f.sessionID, {
      source: { type: "definition", definition: { ...definition, stages: [{ name: "held", prompt: "Wait" }] } },
    })
    const entered = yield* Deferred.make<void>()
    const closed = yield* Deferred.make<void>()
    const driver: WorkflowEngine.Driver = () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() => Deferred.succeed(closed, undefined))
          yield* Deferred.succeed(entered, undefined)
          return yield* Effect.never
        }),
      )
    const fiber = yield* f.engine.run(f.sessionID, run.info.id, driver).pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    expect(yield* WorkflowEngine.make(f.store).run(f.sessionID, run.info.id, driver).pipe(Effect.flip)).toMatchObject({
      code: "busy",
    })
    yield* Fiber.interrupt(fiber)
    yield* Deferred.await(closed)
    expect((yield* f.store.read(f.sessionID, run.info.id)).info.status).toBe("paused")
    expect(yield* f.engine.run(f.sessionID, run.info.id, driver).pipe(Effect.flip)).toMatchObject({ code: "busy" })
    yield* f.store.resume(f.sessionID, run.info.id)
    expect(
      yield* f.engine.run(f.sessionID, run.info.id, () =>
        Effect.succeed({ sessionID: SessionID.create(), output: "done", tokens: 3 }),
      ),
    ).toMatchObject({ status: "completed", agentsSpent: 1 })
  }),
)

it.live("invalid structured evidence fails before later agents execute", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const run = yield* f.store.create(f.sessionID, { source: { type: "definition", definition } })
    const calls: string[] = []
    const info = yield* f.engine.run(f.sessionID, run.info.id, (task) =>
      Effect.sync(() => {
        calls.push(task.key)
        return { sessionID: SessionID.create(), output: { items: 42 }, tokens: 1 }
      }),
    )
    expect(info?.status).toBe("failed")
    expect(calls).toEqual(["plan:0"])
  }),
)

it.live("Core rejects oversized durable journals before updating the stored run", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const run = yield* f.store.create(f.sessionID, { source: { type: "definition", definition } })
    const calls = Array.from({ length: 17 }, (_, id) => ({ id, hash: "bounded", result: "x".repeat(999_000) }))
    expect(
      yield* f.store.change(f.sessionID, run.info.id, (state) => ({ ...state, calls })).pipe(Effect.flip),
    ).toMatchObject({ code: "invalid" })
    expect((yield* f.store.read(f.sessionID, run.info.id)).calls).toEqual([])
    expect((yield* f.store.read(f.sessionID, run.info.id)).revision).toBe(0)
    expect(
      yield* f.store
        .change(f.sessionID, run.info.id, (state) => ({
          ...state,
          calls: Array.from({ length: 10_001 }, (_, id) => ({ id, hash: "bounded", result: null })),
        }))
        .pipe(Effect.flip),
    ).toMatchObject({ code: "invalid" })
    expect((yield* f.store.read(f.sessionID, run.info.id)).revision).toBe(0)
  }),
)

it.live("a settling script preserves a committed pause or cancellation", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    for (const status of ["paused", "cancelled"] as const) {
      for (const failure of [false, true]) {
        const run = yield* f.store.create(f.sessionID, {
          source: { type: "script", name: "settling", script: 'complete("done");' },
        })
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const script: WorkflowEngine.Script = () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            if (failure) return yield* new WorkflowStore.Failure({ code: "invalid", message: "late script failure" })
            return { status: "completed", result: "late result" }
          })
        const fiber = yield* f.engine
          .run(f.sessionID, run.info.id, () => Effect.die("No child expected"), script)
          .pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        yield* f.store.stop(f.sessionID, run.info.id, status === "cancelled")
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(fiber)
        expect((yield* f.store.read(f.sessionID, run.info.id)).info.status).toBe(status)
      }
    }
  }),
)

it.live("stopping a completed run preserves its result and live ownership ends with the scope", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const run = yield* f.store.create(f.sessionID, {
      source: { type: "script", name: "complete", script: 'complete("done");' },
    })
    expect(f.store.owns(run.info.id)).toBe(false)
    yield* f.engine.run(
      f.sessionID,
      run.info.id,
      () => Effect.die("No child expected"),
      () =>
        Effect.sync(() => {
          expect(f.store.owns(run.info.id)).toBe(true)
          return { status: "completed", result: "done" }
        }),
    )
    expect(f.store.owns(run.info.id)).toBe(false)
    expect((yield* f.store.stop(f.sessionID, run.info.id)).info).toMatchObject({ status: "completed", result: "done" })
    expect((yield* f.store.stop(f.sessionID, run.info.id, true)).info).toMatchObject({
      status: "completed",
      result: "done",
    })
    expect(WorkflowStore.make(f.database.db).owns(run.info.id)).toBe(false)
  }),
)

it.live("stop cancels paused and budget-limited runs without changing completed results", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    for (const status of ["paused", "budget_limited"] as const) {
      const run = yield* f.store.create(f.sessionID, { source: { type: "definition", definition } })
      yield* f.store.change(f.sessionID, run.info.id, (state) => ({ ...state, info: { ...state.info, status } }))
      expect((yield* f.store.stop(f.sessionID, run.info.id, true)).info).toMatchObject({
        status: "cancelled",
        message: "Stopped by user",
      })
      expect((yield* f.store.read(f.sessionID, run.info.id)).info.status).toBe("cancelled")
    }
  }),
)

import { createHash } from "node:crypto"
import { expect } from "bun:test"
import { Deferred, Effect, Fiber, FileSystem, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { AppProcess } from "@apexo/core/process"
import { Database } from "@apexo/core/database/database"
import { WorkflowStore } from "@apexo/core/workflow/store"
import { WorkflowEngine } from "@apexo/core/workflow/engine"
import { WorkflowScript } from "@apexo/core/workflow/script"
import { SessionID } from "@apexo/schema/session-id"
import { AbsolutePath } from "@apexo/schema/schema"
import { SessionTable } from "@apexo/core/session/sql"
import { ProjectTable } from "@apexo/core/project/sql"
import { ProjectV2 } from "@apexo/core/project"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(Database.layerFromPath(":memory:"), LayerNode.compile(AppProcess.node), NodeFileSystem.layer),
)
const fixture = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  const process = yield* AppProcess.Service
  const fs = yield* FileSystem.FileSystem
  const sessionID = SessionID.create()
  const projectID = ProjectV2.ID.make("workflow-script-tests")
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
  return { store, process, fs, sessionID, engine: WorkflowEngine.make(store) }
})

it.live("await_user is durable before teardown and resumes past its receipt exactly once", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const closing = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const process: AppProcess.Interface = {
      ...f.process,
      spawn: (command) =>
        f.process.spawn(command).pipe(
          Effect.map((child) => ({
            ...child,
            kill: (...args) =>
              Effect.gen(function* () {
                yield* Deferred.succeed(closing, undefined)
                yield* Deferred.await(release)
                return yield* child.kill(...args)
              }),
          })),
        ),
    }
    const script = WorkflowScript.make(f.store, process, f.fs, () => Effect.die("Unexpected host call"))
    const run = yield* f.store.create(f.sessionID, {
      source: {
        type: "script",
        name: "checkpoint",
        script:
          'await_user("blocked", "Review evidence"); let result = agent("after checkpoint"); complete(result.output);',
      },
    })
    const calls: string[] = []
    const driver: WorkflowEngine.Driver = (task) =>
      Effect.sync(() => {
        calls.push(task.key)
        return { sessionID: SessionID.create(), output: "done", tokens: 3 }
      })
    const fiber = yield* f.engine.run(f.sessionID, run.info.id, driver, script).pipe(Effect.forkChild)
    yield* Deferred.await(closing)
    const paused = yield* f.store.read(f.sessionID, run.info.id)
    expect(paused.info).toMatchObject({ status: "paused", pauseKind: "verification", message: "Review evidence" })
    expect(paused.calls).toHaveLength(1)
    expect(paused.calls[0]?.result).toBeNull()
    expect(calls).toEqual([])
    expect(yield* f.store.resume(f.sessionID, run.info.id).pipe(Effect.flip)).toMatchObject({ code: "busy" })
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(fiber)
    yield* f.store.resume(f.sessionID, run.info.id)
    expect(yield* f.engine.run(f.sessionID, run.info.id, driver, script)).toMatchObject({
      status: "completed",
      result: "done",
      agentsSpent: 1,
    })
    expect(calls).toHaveLength(1)
    expect((yield* f.store.read(f.sessionID, run.info.id)).calls).toHaveLength(2)
  }),
)

it.live("cancellation during checkpoint teardown stays authoritative", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const closing = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const process: AppProcess.Interface = {
      ...f.process,
      spawn: (command) =>
        f.process.spawn(command).pipe(
          Effect.map((child) => ({
            ...child,
            kill: (...args) =>
              Effect.gen(function* () {
                yield* Deferred.succeed(closing, undefined)
                yield* Deferred.await(release)
                yield* child.kill(...args)
                return yield* Effect.die(new Error("Delayed cleanup failure"))
              }),
          })),
        ),
    }
    const script = WorkflowScript.make(f.store, process, f.fs, () => Effect.die("Unexpected host call"))
    const run = yield* f.store.create(f.sessionID, {
      source: { type: "script", name: "cancel", script: 'await_user("user", "Review"); complete("unreachable");' },
    })
    const fiber = yield* f.engine
      .run(f.sessionID, run.info.id, () => Effect.die("No child"), script)
      .pipe(Effect.forkChild)
    yield* Deferred.await(closing)
    yield* f.store.stop(f.sessionID, run.info.id, true)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(fiber)
    expect((yield* f.store.read(f.sessionID, run.info.id)).info.status).toBe("cancelled")
  }),
)

it.live("terminal pause repeats on resume, aliases normalize, and invalid kinds fail", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const script = WorkflowScript.make(f.store, f.process, f.fs, () => Effect.die("Unexpected host call"))
    const driver: WorkflowEngine.Driver = () => Effect.die("No child")
    const run = yield* f.store.create(f.sessionID, {
      source: { type: "script", name: "pause", script: 'pause("backoff", "Wait"); complete();' },
    })
    for (const repeat of [false, true]) {
      if (repeat) yield* f.store.resume(f.sessionID, run.info.id)
      expect(yield* f.engine.run(f.sessionID, run.info.id, driver, script)).toMatchObject({
        status: "paused",
        pauseKind: "back_off",
      })
      expect((yield* f.store.read(f.sessionID, run.info.id)).calls).toEqual([])
    }
    for (const operation of ["pause", "await_user"]) {
      const invalid = yield* f.store.create(f.sessionID, {
        source: { type: "script", name: "invalid", script: `${operation}("invented", "No"); complete();` },
      })
      expect(yield* f.engine.run(f.sessionID, invalid.info.id, driver, script)).toMatchObject({ status: "failed" })
      expect((yield* f.store.read(f.sessionID, invalid.info.id)).calls).toEqual([])
    }
  }),
)

it.live("cancellation before checkpoint commit prevents its receipt", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const store: WorkflowStore.Interface = {
      ...f.store,
      change: (sessionID, id, update) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          return yield* f.store.change(sessionID, id, update)
        }),
    }
    const script = WorkflowScript.make(store, f.process, f.fs, () => Effect.die("Unexpected host call"))
    const run = yield* f.store.create(f.sessionID, {
      source: { type: "script", name: "cancel-before", script: 'await_user("user", "Review"); complete();' },
    })
    const fiber = yield* f.engine
      .run(f.sessionID, run.info.id, () => Effect.die("No child"), script)
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* f.store.stop(f.sessionID, run.info.id, true)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(fiber)
    const state = yield* f.store.read(f.sessionID, run.info.id)
    expect(state.info.status).toBe("cancelled")
    expect(state.calls).toEqual([])
  }),
)

it.live("journal capacity rejects a checkpoint before receipt or paused mutation", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const run = yield* f.store.create(f.sessionID, {
      source: {
        type: "script",
        name: "capacity",
        script: 'for i in 0..16 { log("seed"); } await_user("user", "Review"); complete();',
      },
    })
    const calls = Array.from({ length: 16 }, (_, id) => ({
      id,
      hash: createHash("sha256")
        .update(JSON.stringify({ kind: "log", payload: { value: "seed" } }))
        .digest("hex"),
      result: "x".repeat(950_000),
    }))
    yield* f.store.change(f.sessionID, run.info.id, (state) => ({ ...state, calls }))
    const script = WorkflowScript.make(f.store, f.process, f.fs, () => Effect.die("Unexpected host call"))
    expect(yield* f.engine.run(f.sessionID, run.info.id, () => Effect.die("No child"), script)).toMatchObject({
      status: "failed",
    })
    const state = yield* f.store.read(f.sessionID, run.info.id)
    expect(state.info.message).toContain("journal capacity")
    expect(state.calls).toHaveLength(16)
    expect(state.info.pauseKind).toBeUndefined()
  }),
)

it.live("explicit child agents survive interpreter admission and exact saved replay", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const script = WorkflowScript.make(f.store, f.process, f.fs, () => Effect.die("Unexpected host call"))
    const run = yield* f.store.create(f.sessionID, {
      source: {
        type: "script",
        name: "selected-agents",
        script:
          'let results = parallel([#{prompt:"first",agent_type:"reviewer"},#{prompt:"second",agent_type:"explore"}]); await_user("verification", "Inspect agents"); complete(results);',
      },
      agentBudget: 2,
    })
    const agents: Array<string | undefined> = []
    const driver: WorkflowEngine.Driver = (task) =>
      Effect.sync(() => {
        agents.push(task.agent)
        return { sessionID: SessionID.create(), output: task.agent ?? "parent", tokens: 1 }
      })
    expect(yield* f.engine.run(f.sessionID, run.info.id, driver, script)).toMatchObject({
      status: "paused",
      agentsSpent: 2,
    })
    expect(agents.toSorted()).toEqual(["explore", "reviewer"])
    yield* f.store.resume(f.sessionID, run.info.id)
    expect(yield* f.engine.run(f.sessionID, run.info.id, driver, script)).toMatchObject({
      status: "completed",
      agentsSpent: 2,
    })
    expect(agents).toHaveLength(2)
    expect((yield* f.store.read(f.sessionID, run.info.id)).tasks.every((task) => task.status === "done")).toBe(true)
  }),
)

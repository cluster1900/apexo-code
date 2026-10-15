import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { afterEach, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Database } from "@apexo/core/database/database"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { SessionGoal } from "@apexo/core/session/goal"
import { GoalTable } from "@apexo/core/goal/sql"
import { eq } from "drizzle-orm"
import { Goal } from "@apexo/schema/goal"
import { Session } from "@/session/session"
import { BackgroundJob } from "@/background/job"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilderV1.build(LayerNode.group([Session.node, Database.node, BackgroundJob.node])),
    httpApiLayer,
  ),
)

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

it.instance("Session deletion cancels detached shell jobs identified by ownerSessionId", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const jobs = yield* BackgroundJob.Service
    const session = yield* sessions.create({ title: "Detached shell owner" })
    const owned = yield* jobs.start({
      type: "shell",
      metadata: { ownerSessionId: session.id, background: true },
      run: Effect.never,
    })
    const unrelated = yield* jobs.start({
      type: "shell",
      metadata: { ownerSessionId: "ses_unrelated", background: true },
      run: Effect.never,
    })
    yield* sessions.remove(session.id)
    expect((yield* jobs.get(owned.id))?.status).toBe("cancelled")
    expect((yield* jobs.get(unrelated.id))?.status).toBe("running")
  }),
)

it.instance("deleting a broken Session still succeeds when its Goal state cannot be decoded", () =>
  Effect.gen(function* () {
    const ctx = yield* TestInstance
    const sessions = yield* Session.Service
    const database = yield* Database.Service
    const session = yield* sessions.create({ title: "Broken Goal" })
    yield* SessionGoal.make(database.db).create(session.id, { id: Goal.ID.create(), objective: "Broken state" })
    yield* database.db.update(GoalTable).set({ data: {} }).where(eq(GoalTable.session_id, session.id)).run()
    const removed = yield* requestInDirectory(`/session/${session.id}`, ctx.directory, { method: "DELETE" })
    expect(removed.status).toBe(200)
    expect((yield* requestInDirectory(`/session/${session.id}`, ctx.directory)).status).toBe(404)
  }),
)

it.instance("goal HTTP lifecycle is durable, idempotent, and rejects stale control IDs", () =>
  Effect.gen(function* () {
    const timing = { started: Date.now(), previous: Date.now() }
    const trace = (stage: string) => {
      const now = Date.now()
      if (process.env.APEXO_TEST_GOAL_TIMING === "1")
        console.error("GOAL_HTTP_TIMING", { stage, total: now - timing.started, elapsed: now - timing.previous })
      timing.previous = now
    }
    trace("body started")
    const ctx = yield* TestInstance
    const session = yield* Session.use.create({ title: "Goal control" })
    trace("session created")
    const root = `/session/${session.id}/goal`
    const input = { id: Goal.ID.create(), objective: "Implement all requirements", tokenBudget: 1000 }
    const request = (suffix: string, method = "GET", body?: unknown) =>
      requestInDirectory(`${root}${suffix}`, ctx.directory, {
        method,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      }).pipe(Effect.tap(() => Effect.sync(() => trace(`${method} ${suffix || "/"}`))))
    expect(yield* (yield* request("")).json).toBeNull()
    const created = yield* request("", "POST", input)
    expect(created.status).toBe(200)
    const info = yield* created.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Goal.Info)))
    expect(info).toMatchObject({ ...input, status: "active", phase: "idle", tokensUsed: 0 })
    const retried = yield* request("", "POST", input)
    expect(retried.status).toBe(200)
    expect(yield* retried.json).toEqual(info)
    expect((yield* request("", "POST", { ...input, objective: "Changed scope" })).status).toBe(409)
    expect((yield* request(`/${input.id}/run`, "POST")).status).toBe(400)
    const paused = yield* request(`/${input.id}/pause`, "POST")
    expect(paused.status).toBe(200)
    expect(yield* paused.json).toMatchObject({ status: "user_paused" })
    expect((yield* request(`/${Goal.ID.create()}/pause`, "POST")).status).toBe(409)
    expect((yield* request(`/${Goal.ID.create()}`, "DELETE")).status).toBe(409)
    const cleared = yield* request(`/${input.id}`, "DELETE")
    expect(cleared.status).toBe(200)
    expect(yield* cleared.json).toBe(true)
    expect(yield* (yield* request("")).json).toBeNull()
  }),
)

it.instance("goal HTTP serializes concurrent creation and rejects invalid budgets", () =>
  Effect.gen(function* () {
    const ctx = yield* TestInstance
    const session = yield* Session.use.create({ title: "Concurrent goals" })
    const create = (tokenBudget: number) =>
      requestInDirectory(`/session/${session.id}/goal`, ctx.directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: Goal.ID.create(), objective: "One owner", tokenBudget }),
      })
    expect((yield* create(0)).status).toBe(400)
    const statuses = yield* Effect.all([create(100), create(100)], { concurrency: 2 }).pipe(
      Effect.map((responses) => responses.map((response) => response.status).sort()),
    )
    expect(statuses).toEqual([200, 409])
  }),
)

it.instance("goal HTTP reads stay passive and use the session's routed directory", () =>
  Effect.gen(function* () {
    const ctx = yield* TestInstance
    const session = yield* Session.use.create({ title: "Read-only goals" })
    const database = yield* Database.Service
    const goals = SessionGoal.make(database.db)
    const info = yield* goals.create(session.id, { id: Goal.ID.create(), objective: "Keep reads passive" })
    yield* goals.begin({ sessionID: session.id, goalID: info.id }, "planning")
    const before = yield* goals.get(session.id)
    if (!before) throw new Error("Expected the persisted goal")
    const root = `/session/${session.id}/goal`
    const response = yield* requestInDirectory(root, ctx.directory)
    expect(response.status).toBe(200)
    expect(yield* response.json).toEqual(before)
    expect(yield* goals.get(session.id)).toEqual(before)
    const other = yield* tmpdirScoped({ git: true })
    // Session routes deliberately resolve placement from the Session ID, ahead of directory hints.
    const routed = yield* requestInDirectory(root, other)
    expect(routed.status).toBe(200)
    expect(yield* routed.json).toEqual(before)
    expect(yield* goals.get(session.id)).toEqual(before)
  }),
)

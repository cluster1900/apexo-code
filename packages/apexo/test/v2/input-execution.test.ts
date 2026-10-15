import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { ConfigProvider, DateTime, Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { EventV2 } from "@apexo/core/event"
import { EventTable } from "@apexo/core/event/sql"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionEvent } from "@apexo/core/session/event"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionInput } from "@apexo/core/session/input"
import { SessionInputExecution } from "@apexo/core/session/input-execution"
import { SessionInputExecutionOwner } from "@apexo/core/session/input-execution-owner"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionInputTable } from "@apexo/core/session/sql"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const policy = { mode: "headless", permissions: "reject" } as const

it.live("headless canonical inputs preserve policy identity, withdrawal, supersession and passive outcomes", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    return yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const database = yield* Database.Service
      const events = yield* EventV2.Service
      const execution = yield* SessionInputExecution.Service
      const lifecycle = yield* SessionLifecycle.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
      const request = {
        sessionID: session.id,
        id: SessionMessage.ID.create(),
        prompt: { text: "first" },
        executionPolicy: policy,
        resume: false,
      }
      const first = yield* sessions.prompt(request)
      expect(first.executionPolicy).toEqual(policy)
      expect(yield* sessions.prompt(request)).toEqual(first)
      expect(
        (yield* sessions
          .prompt({ ...request, executionPolicy: { ...policy, permissions: "approve_once" } })
          .pipe(Effect.result))._tag,
      ).toBe("Failure")
      expect((yield* execution.wait({ sessionID: session.id, inputID: first.id }, 0)).timedOut).toBe(true)
      const cancelled = yield* execution.withdraw({ sessionID: session.id, inputID: first.id })
      expect(cancelled.reason).toBe("withdrawn")
      expect(yield* SessionInput.hasPending(database.db, session.id, "steer")).toBe(false)
      yield* SessionInput.promoteSteers(
        database.db,
        events,
        session.id,
        yield* EventV2.latestSequence(database.db, session.id),
      )
      expect(yield* sessions.messages({ sessionID: session.id, order: "asc" })).toEqual([])
      expect((yield* execution.wait({ sessionID: session.id, inputID: first.id }, 100)).timedOut).toBe(false)
      const race = yield* sessions.prompt({
        ...request,
        id: SessionMessage.ID.create(),
        prompt: { text: "withdraw after pending selection" },
      })
      const selected = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const gated: EventV2.Interface = {
        ...events,
        publish: (definition, data, options) =>
          (definition.type === SessionEvent.Prompted.type
            ? Deferred.succeed(selected, undefined).pipe(Effect.andThen(Deferred.await(release)))
            : Effect.void
          ).pipe(Effect.andThen(events.publish(definition, data, options))),
      }
      const racing = yield* SessionInput.promoteSteers(
        database.db,
        gated,
        session.id,
        yield* EventV2.latestSequence(database.db, session.id),
      ).pipe(Effect.forkChild)
      yield* Deferred.await(selected)
      yield* execution.withdraw({ sessionID: session.id, inputID: race.id })
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(racing)).toBe(0)
      expect(
        (yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, session.id))).filter((event) =>
          event.type.startsWith(SessionEvent.Prompted.type),
        ),
      ).toEqual([])
      expect(yield* sessions.messages({ sessionID: session.id, order: "asc" })).toEqual([])
      const second = yield* sessions.prompt({ ...request, id: SessionMessage.ID.create(), prompt: { text: "second" } })
      const third = yield* sessions.prompt({ ...request, id: SessionMessage.ID.create(), prompt: { text: "third" } })
      yield* SessionInput.promoteSteers(
        database.db,
        events,
        session.id,
        yield* EventV2.latestSequence(database.db, session.id),
      )
      const prior = yield* execution.get({ sessionID: session.id, inputID: second.id })
      const current = yield* execution.get({ sessionID: session.id, inputID: third.id })
      expect(prior.status).toBe("superseded")
      expect(prior.endedSeq).toBe(current.promotedSeq)
      expect(current.status).toBe("active")
      const target = { sessionID: session.id, inputID: third.id }
      const waiting = yield* execution.wait(target, 1000).pipe(Effect.forkChild)
      const result = yield* execution.settle({
        ...target,
        status: "completed",
        reason: "completed",
        finish: "stop",
        usageIncomplete: false,
      })
      expect(result.status).toBe("completed")
      expect((yield* Fiber.join(waiting)).timedOut).toBe(false)
      expect(
        yield* execution.settle({ ...target, status: "interrupted", reason: "interrupted", usageIncomplete: true }),
      ).toEqual(result)
      expect((yield* execution.wait(target, 0)).execution).toEqual(result)
      const replacedService = SessionInputExecution.make(database.db, events, lifecycle)
      expect(yield* replacedService.get(target)).toEqual(result)
      const ordinary = yield* sessions.prompt({ sessionID: session.id, prompt: { text: "ordinary" }, resume: false })
      expect(ordinary.executionPolicy).toBeUndefined()
      expect((yield* execution.get({ sessionID: session.id, inputID: ordinary.id }).pipe(Effect.result))._tag).toBe(
        "Failure",
      )
      const historical = yield* sessions.create({ location: session.location })
      const historicalID = SessionMessage.ID.create()
      yield* events.publish(SessionEvent.Prompted, {
        sessionID: historical.id,
        messageID: historicalID,
        prompt: { text: "historical ordinary" },
        delivery: "steer",
        timestamp: yield* DateTime.now,
      })
      const historicalRetry = yield* sessions.prompt({
        sessionID: historical.id,
        id: historicalID,
        prompt: { text: "historical ordinary" },
        resume: false,
      })
      expect(historicalRetry.executionPolicy).toBeUndefined()
      expect(historicalRetry.promotedSeq).toBeDefined()
      expect(
        (yield* sessions
          .prompt({
            sessionID: historical.id,
            id: historicalID,
            prompt: { text: "historical ordinary" },
            executionPolicy: policy,
            resume: false,
          })
          .pipe(Effect.result))._tag,
      ).toBe("Failure")
      const replayID = SessionMessage.ID.create()
      yield* events.publish(SessionEvent.Prompted, {
        sessionID: historical.id,
        messageID: replayID,
        prompt: { text: "historical headless" },
        delivery: "queue",
        executionPolicy: policy,
        timestamp: yield* DateTime.now,
      })
      expect((yield* execution.get({ sessionID: historical.id, inputID: replayID })).status).toBe("active")
      expect((yield* execution.current(historical.id).pipe(Effect.result))._tag).toBe("Failure")
      const serialized = yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, historical.id))
      yield* sessions.remove(historical.id)
      yield* events.replayAll(
        serialized.map((event) => ({
          id: event.id,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
      )
      const replayed = yield* sessions.prompt({
        sessionID: historical.id,
        id: replayID,
        prompt: { text: "historical headless" },
        delivery: "queue",
        executionPolicy: policy,
        resume: false,
      })
      expect(replayed.executionPolicy).toEqual(policy)
      expect(replayed.promotedSeq).toBeDefined()
      expect((yield* execution.get({ sessionID: historical.id, inputID: replayID })).status).toBe("active")
      expect((yield* execution.current(historical.id).pipe(Effect.result))._tag).toBe("Failure")
      expect(
        (yield* sessions.prompt({
          sessionID: historical.id,
          id: historicalID,
          prompt: { text: "historical ordinary" },
          resume: false,
        })).executionPolicy,
      ).toBeUndefined()
      const rejected = yield* sessions.prompt({
        ...request,
        id: SessionMessage.ID.create(),
        prompt: { text: "unavailable" },
      })
      yield* execution.settle({
        sessionID: session.id,
        inputID: rejected.id,
        status: "failed",
        reason: "unavailable",
        usageIncomplete: false,
      })
      expect(yield* SessionInput.hasPending(database.db, session.id, "steer")).toBe(true)
      const active = yield* sessions.prompt({
        ...request,
        id: SessionMessage.ID.create(),
        prompt: { text: "held active" },
      })
      yield* SessionInput.promoteSteers(
        database.db,
        events,
        session.id,
        yield* EventV2.latestSequence(database.db, session.id),
      )
      expect((yield* replacedService.get({ sessionID: session.id, inputID: active.id })).status).toBe("active")
      yield* database.db
        .update(SessionInputTable)
        .set({ execution_owner: JSON.stringify({ pid: process.pid, token: "another-live-owner" }) })
        .where(eq(SessionInputTable.id, active.id))
      expect((yield* replacedService.get({ sessionID: session.id, inputID: active.id })).status).toBe("active")
      expect((yield* replacedService.current(session.id).pipe(Effect.result))._tag).toBe("Failure")
      yield* database.db
        .update(SessionInputTable)
        .set({ execution_owner: SessionInputExecutionOwner.stamp })
        .where(eq(SessionInputTable.id, active.id))
      expect((yield* replacedService.current(session.id))?.inputID).toBe(active.id)
      const exited = yield* Effect.promise(async () => {
        const child = Bun.spawn(["/bin/sh", "-c", "exit 0"], { stdout: "ignore", stderr: "ignore" })
        await child.exited
        return child.pid
      })
      const deadOwner = JSON.stringify({ pid: exited, token: "owned-process-that-exited" })
      expect(SessionInputExecutionOwner.dead(deadOwner)).toBe(true)
      yield* database.db
        .update(SessionInputTable)
        .set({ execution_owner: deadOwner })
        .where(eq(SessionInputTable.id, active.id))
      expect((yield* replacedService.get({ sessionID: session.id, inputID: active.id })).reason).toBe("process_restart")
      expect((yield* replacedService.current(session.id).pipe(Effect.result))._tag).toBe("Failure")
      expect(
        (yield* database.db.select().from(SessionInputTable).where(eq(SessionInputTable.id, active.id)).get())
          ?.execution_status,
      ).toBe("active")
      yield* sessions.prompt({
        ...request,
        id: SessionMessage.ID.create(),
        prompt: { text: "explicit continuation after lost owner" },
      })
      yield* SessionInput.promoteSteers(
        database.db,
        events,
        session.id,
        yield* EventV2.latestSequence(database.db, session.id),
      )
      const superseded = yield* execution.get({ sessionID: session.id, inputID: active.id })
      expect(superseded.reason).toBe("superseded")
      const replayEvents = yield* database.db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, session.id))
        .orderBy(EventTable.seq)
      yield* sessions.remove(session.id)
      yield* events.replayAll(
        replayEvents.map((event) => ({
          id: event.id,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
      )
      expect((yield* execution.get({ sessionID: session.id, inputID: active.id })).reason).toBe(superseded.reason)
      yield* sessions.remove(session.id)
      yield* sessions.create({ id: session.id, location: session.location })
      expect((yield* execution.get(target).pipe(Effect.result))._tag).toBe("Failure")
      const reused = { sessionID: session.id, inputID: SessionMessage.ID.create() }
      yield* sessions.prompt({
        sessionID: session.id,
        id: reused.inputID,
        prompt: { text: "old lifetime" },
        executionPolicy: policy,
        resume: false,
      })
      const readEntered = yield* Deferred.make<void>()
      const releaseRead = yield* Deferred.make<void>()
      const oldRead = yield* lifecycle
        .read(
          session.id,
          Effect.gen(function* () {
            yield* Deferred.succeed(readEntered, undefined)
            yield* Deferred.await(releaseRead)
            return yield* execution.wait(reused, 0)
          }),
        )
        .pipe(Effect.result, Effect.forkChild)
      yield* Deferred.await(readEntered)
      yield* sessions.remove(session.id)
      yield* sessions.create({ id: session.id, location: session.location })
      yield* sessions.prompt({
        sessionID: session.id,
        id: reused.inputID,
        prompt: { text: "new lifetime" },
        executionPolicy: policy,
        resume: false,
      })
      yield* Deferred.succeed(releaseRead, undefined)
      expect((yield* Fiber.join(oldRead))._tag).toBe("Failure")
      expect((yield* sessions.waitInput(reused, 0)).execution.status).toBe("admitted")
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(
          LayerNode.group([
            SessionV2.node,
            Database.node,
            EventV2.node,
            SessionInputExecution.node,
            SessionLifecycle.node,
          ]),
          [
            [SessionExecution.node, SessionExecution.noopLayer],
            [Global.node, Global.layerWith({ home })],
            [
              ModelsDev.node,
              Layer.succeed(ModelsDev.Service, { get: () => Effect.succeed({}), refresh: () => Effect.void }),
            ],
          ],
        ).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
        ),
      ),
    )
  }),
)

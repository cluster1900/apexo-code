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
import { AgentV2 } from "@apexo/core/agent"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionEvent } from "@apexo/core/session/event"
import { SessionInput } from "@apexo/core/session/input"
import { Goal } from "@apexo/schema/goal"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionTaskMessage } from "@apexo/core/session/task-message"
import { SessionTaskRole } from "@apexo/core/session/task-role"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { SessionIncarnation } from "@apexo/core/session/incarnation"
import { SessionMessage } from "@apexo/core/session/message"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
it.live(
  "launch-bound messages preserve retry, ordering, close races, passive waits and canonical withdrawal replay",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      return yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const database = yield* Database.Service
        const events = yield* EventV2.Service
        const tasks = yield* SessionTaskStore.Service
        const messages = yield* SessionTaskMessage.Service
        const roles = yield* SessionTaskRole.Service
        const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const child = yield* sessions.create({ location: parent.location, parentID: parent.id })
        const other = yield* sessions.create({ location: parent.location })
        const record: SessionTaskStore.Record = {
          sessionID: child.id,
          parentID: parent.id,
          parentCreated: (yield* SessionIncarnation.created(database.db, parent.id))!,
          childCreated: (yield* SessionIncarnation.created(database.db, child.id))!,
          agent: AgentV2.ID.make("general"),
          authority: [],
          createdAt: Date.now(),
        }
        yield* tasks.create(record)
        yield* tasks.begin({
          id: "delivery-launch",
          sessionID: child.id,
          parentID: parent.id,
          request: { description: "delivery", prompt: "initial", agent: record.agent, activeMessages: true },
        })
        const initialID = SessionMessage.ID.create()
        yield* roles.attach(child.id, {
          launchID: "delivery-launch",
          inputID: initialID,
          record,
          attempt: undefined,
          observe: undefined,
          take: () => true,
        })
        const steer = { inputID: SessionMessage.ID.create(), text: "steer" }
        expect((yield* messages.send(parent.id, child.id, steer).pipe(Effect.result))._tag).toBe("Failure")
        yield* messages.open("delivery-launch")
        const capturedAgent = (yield* sessions.get(parent.id)).agent
        yield* sessions.switchAgent({ sessionID: parent.id, agent: AgentV2.ID.make("build") })
        const staleOperator = { inputID: SessionMessage.ID.create(), text: "stale operator" }
        expect(
          (yield* messages.send(parent.id, child.id, staleOperator, { agent: capturedAgent }).pipe(Effect.result))._tag,
        ).toBe("Failure")
        expect(yield* SessionInput.find(database.db, staleOperator.inputID)).toBeUndefined()
        const admitted = yield* messages.send(parent.id, child.id, steer)
        expect(admitted.status).toBe("admitted")
        expect(yield* messages.send(parent.id, child.id, steer)).toEqual(admitted)
        expect(
          (yield* messages.send(parent.id, child.id, { ...steer, text: "conflict" }).pipe(Effect.result))._tag,
        ).toBe("Failure")
        expect((yield* messages.send(other.id, child.id, steer).pipe(Effect.result))._tag).toBe("Failure")
        expect(
          (yield* messages
            .send(parent.id, child.id, { inputID: SessionMessage.ID.create(), text: "界".repeat(10923) })
            .pipe(Effect.result))._tag,
        ).toBe("Failure")
        const queue = { inputID: SessionMessage.ID.create(), text: "queue", delivery: "queue" as const }
        yield* messages.send(parent.id, child.id, queue)
        const started = yield* Deferred.make<void>()
        const joined = yield* Deferred.make<void>()
        const passive = yield* messages
          .interruptWait(
            child.id,
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(joined, undefined)),
            ),
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(started)
        const interject = { inputID: SessionMessage.ID.create(), text: "interject", delivery: "interject" as const }
        yield* messages.send(parent.id, child.id, interject)
        expect(yield* Fiber.join(passive)).toEqual({ interruptedByMessage: true })
        expect(yield* Deferred.isDone(joined)).toBe(true)
        expect(yield* SessionInput.hasPending(database.db, child.id, "steer")).toBe(false)
        expect(yield* SessionInput.promoteOwned(database.db, events, child.id, steer.inputID)).toBe(0)
        expect(
          yield* SessionInput.promoteSteers(
            database.db,
            events,
            child.id,
            yield* EventV2.latestSequence(database.db, child.id),
          ),
        ).toBe(0)
        expect(yield* SessionInput.promoteNextQueued(database.db, events, child.id)).toBe(false)
        expect(yield* messages.promote("delivery-launch", "steer")).toBe(2)
        expect((yield* sessions.messages({ sessionID: child.id, order: "asc" })).map((message) => message.id)).toEqual([
          interject.inputID,
          steer.inputID,
        ])
        expect((yield* messages.receipt(parent.id, child.id, queue.inputID)).status).toBe("admitted")
        expect(yield* messages.continueOrClose("delivery-launch")).toBe("queue")
        expect(yield* messages.promote("delivery-launch", "queue")).toBe(1)
        expect(yield* messages.continueOrClose("delivery-launch")).toBeUndefined()
        expect(
          (yield* messages
            .send(parent.id, child.id, { inputID: SessionMessage.ID.create(), text: "too late" })
            .pipe(Effect.result))._tag,
        ).toBe("Failure")
        expect((yield* messages.send(parent.id, child.id, steer)).status).toBe("promoted")
        expect((yield* messages.open("delivery-launch").pipe(Effect.result))._tag).toBe("Failure")

        const waking = yield* sessions.create({ location: parent.location, parentID: parent.id })
        const wakingRecord = {
          ...record,
          sessionID: waking.id,
          childCreated: (yield* SessionIncarnation.created(database.db, waking.id))!,
        }
        yield* tasks.create(wakingRecord)
        const wake = { inputID: SessionMessage.ID.create(), text: "wake queue", delivery: "queue" as const }
        yield* tasks.begin({
          id: "wake-launch",
          sessionID: waking.id,
          parentID: parent.id,
          request: { description: "wake", prompt: wake.text, agent: record.agent, activeMessages: true },
        })
        expect(
          (yield* messages
            .initial("wake-launch", wake, () =>
              Effect.die(new SessionTaskStore.Failure({ code: "stale", message: "Revoked sender" })),
            )
            .pipe(Effect.result))._tag,
        ).toBe("Failure")
        expect(yield* SessionInput.find(database.db, wake.inputID)).toBeUndefined()
        expect((yield* messages.receipt(parent.id, waking.id, wake.inputID).pipe(Effect.result))._tag).toBe("Failure")
        yield* messages.initial("wake-launch", wake, () => Effect.void)
        expect((yield* messages.receipt(parent.id, waking.id, wake.inputID)).status).toBe("admitted")
        expect(yield* SessionInput.hasPending(database.db, waking.id, "queue")).toBe(false)
        expect(yield* SessionInput.promoteNextQueued(database.db, events, waking.id)).toBe(false)
        yield* roles.attach(waking.id, {
          launchID: "wake-launch",
          inputID: wake.inputID,
          record: wakingRecord,
          attempt: undefined,
          observe: undefined,
          take: () => true,
        })
        yield* messages.open("wake-launch")
        expect(yield* messages.promote("wake-launch", "queue")).toBe(1)
        yield* messages.close("wake-launch", "interrupted")
        yield* tasks.finish({ id: "wake-launch", sessionID: waking.id, parentID: parent.id, status: "completed" })
        yield* tasks.begin({
          id: "later-wake-launch",
          sessionID: waking.id,
          parentID: parent.id,
          request: { description: "later", prompt: "unrelated follow-up", agent: record.agent, activeMessages: true },
        })
        expect((yield* messages.retry(parent.id, waking.id, wake))?.status).toBe("promoted")
        expect((yield* messages.send(parent.id, waking.id, wake)).status).toBe("promoted")
        expect((yield* tasks.latest(parent.id, waking.id))?.id).toBe("later-wake-launch")
        expect(
          (yield* messages.retry(parent.id, waking.id, { ...wake, delivery: "steer" }).pipe(Effect.result))._tag,
        ).toBe("Failure")

        const bounded = yield* sessions.create({ location: parent.location, parentID: parent.id })
        const boundedRecord = {
          ...record,
          sessionID: bounded.id,
          childCreated: (yield* SessionIncarnation.created(database.db, bounded.id))!,
        }
        yield* tasks.create(boundedRecord)
        yield* tasks.begin({
          id: "bounded-launch",
          sessionID: bounded.id,
          parentID: parent.id,
          request: { description: "bounded", prompt: "initial", agent: record.agent, activeMessages: true },
        })
        yield* roles.attach(bounded.id, {
          launchID: "bounded-launch",
          inputID: SessionMessage.ID.create(),
          record: boundedRecord,
          attempt: undefined,
          observe: undefined,
          take: () => true,
        })
        yield* messages.open("bounded-launch")
        const retry = { inputID: SessionMessage.ID.create(), text: "exact concurrent retry" }
        const retries = yield* Effect.all(
          [messages.send(parent.id, bounded.id, retry), messages.send(parent.id, bounded.id, retry)],
          { concurrency: 2 },
        )
        expect(retries[0]).toEqual(retries[1])
        const requests = [
          retry,
          ...Array.from({ length: 31 }, () => ({ inputID: SessionMessage.ID.create(), text: "bounded pending" })),
        ]
        yield* Effect.forEach(requests.slice(1), (request) => messages.send(parent.id, bounded.id, request))
        const overflow = { inputID: SessionMessage.ID.create(), text: "must not persist" }
        expect((yield* messages.send(parent.id, bounded.id, overflow).pipe(Effect.result))._tag).toBe("Failure")
        expect(yield* SessionInput.find(database.db, overflow.inputID)).toBeUndefined()
        expect((yield* messages.send(parent.id, bounded.id, retry)).status).toBe("admitted")
        yield* Effect.all(
          [messages.close("bounded-launch", "cancelled"), messages.close("bounded-launch", "interrupted")],
          { concurrency: 2 },
        )
        const cancelled = yield* messages.receipt(parent.id, bounded.id, retry.inputID)
        expect(["cancelled", "interrupted"]).toContain(cancelled.status)
        expect((yield* SessionInput.find(database.db, retry.inputID))?.withdrawnSeq).toBeDefined()
        expect(yield* SessionInput.hasPending(database.db, bounded.id, "steer")).toBe(false)
        expect(yield* SessionInput.promoteOwned(database.db, events, bounded.id, retry.inputID)).toBe(0)
        expect((yield* messages.open("bounded-launch").pipe(Effect.result))._tag).toBe("Failure")

        const racingChild = yield* sessions.create({ location: parent.location, parentID: parent.id })
        const racingRecord = {
          ...record,
          sessionID: racingChild.id,
          childCreated: (yield* SessionIncarnation.created(database.db, racingChild.id))!,
        }
        yield* tasks.create(racingRecord)
        yield* tasks.begin({
          id: "idle-race",
          sessionID: racingChild.id,
          parentID: parent.id,
          request: { description: "idle race", prompt: "initial", agent: record.agent, activeMessages: true },
        })
        yield* roles.attach(racingChild.id, {
          launchID: "idle-race",
          inputID: SessionMessage.ID.create(),
          record: racingRecord,
          attempt: undefined,
          observe: undefined,
          take: () => true,
        })
        yield* messages.open("idle-race")
        const racingInput = { inputID: SessionMessage.ID.create(), text: "race idle close" }
        const raced = yield* Effect.all(
          [
            messages.send(parent.id, racingChild.id, racingInput).pipe(Effect.result),
            messages.continueOrClose("idle-race"),
          ],
          { concurrency: 2 },
        )
        if (raced[0]._tag === "Success") {
          expect(raced[1]).toBe("steer")
          expect(yield* messages.promote("idle-race", "steer")).toBe(1)
          expect(yield* messages.continueOrClose("idle-race")).toBeUndefined()
        }
        if (raced[0]._tag === "Failure") {
          expect(raced[1]).toBeUndefined()
          expect(yield* SessionInput.find(database.db, racingInput.inputID)).toBeUndefined()
        }

        const ordinary = yield* sessions.prompt({ sessionID: other.id, prompt: { text: "withdrawn" }, resume: false })
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
          other.id,
          yield* EventV2.latestSequence(database.db, other.id),
        ).pipe(Effect.forkChild)
        yield* Deferred.await(selected)
        yield* SessionInput.withdraw(database.db, events, other.id, ordinary.id)
        yield* Deferred.succeed(release, undefined)
        expect(yield* Fiber.join(racing)).toBe(0)
        expect(yield* SessionInput.hasPending(database.db, other.id, "steer")).toBe(false)
        expect(yield* SessionInput.promoteOwned(database.db, events, other.id, ordinary.id)).toBe(0)
        expect(yield* SessionInput.promoteNextQueued(database.db, events, other.id)).toBe(false)
        expect(yield* sessions.messages({ sessionID: other.id, order: "asc" })).toEqual([])
        const goals = yield* SessionGoal.Service
        for (const outcome of ["pause", "budget"] as const) {
          const goalParent = yield* sessions.create({ location: parent.location })
          const goalChild = yield* sessions.create({ location: parent.location, parentID: goalParent.id })
          const goal = yield* goals.create(goalParent.id, {
            id: Goal.ID.create(),
            objective: "Delivery boundary",
            tokenBudget: 10,
          })
          const target = { sessionID: goalParent.id, goalID: goal.id }
          const attempt = yield* goals.begin(target, "executing")
          const goalRecord = {
            ...record,
            sessionID: goalChild.id,
            parentID: goalParent.id,
            parentCreated: (yield* SessionIncarnation.created(database.db, goalParent.id))!,
            childCreated: (yield* SessionIncarnation.created(database.db, goalChild.id))!,
          }
          yield* tasks.create(goalRecord)
          const launchID = `goal-delivery-${outcome}`
          yield* tasks.begin({
            id: launchID,
            sessionID: goalChild.id,
            parentID: goalParent.id,
            request: { description: "goal", prompt: "initial", agent: record.agent, activeMessages: true },
          })
          yield* roles.attach(goalChild.id, {
            launchID,
            inputID: SessionMessage.ID.create(),
            record: goalRecord,
            attempt,
            observe: undefined,
            take: () => true,
          })
          yield* messages.open(launchID)
          const accepted = { inputID: SessionMessage.ID.create(), text: "accepted correction" }
          expect((yield* messages.send(goalParent.id, goalChild.id, accepted)).status).toBe("admitted")
          expect(yield* messages.promote(launchID, "steer")).toBe(1)
          yield* goals.usage(attempt, "correction-provider", 3)
          expect((yield* goals.get(goalParent.id))?.tokensUsed).toBe(3)
          if (outcome === "pause") yield* goals.pause(target, "user_paused")
          if (outcome === "budget") yield* goals.usage(attempt, "budget-provider", 7)
          const rejected = { inputID: SessionMessage.ID.create(), text: "late correction" }
          expect((yield* messages.send(goalParent.id, goalChild.id, rejected).pipe(Effect.result))._tag).toBe("Failure")
          expect(yield* SessionInput.find(database.db, rejected.inputID)).toBeUndefined()
          expect((yield* tasks.launch(launchID))?.status).toBe("running")
          expect((yield* messages.receipt(goalParent.id, goalChild.id, accepted.inputID)).status).toBe("promoted")
          yield* messages.close(launchID, "interrupted")
        }
        const serialized = yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, other.id))
        expect(serialized.some((event) => event.type.startsWith(SessionEvent.Prompted.type))).toBe(false)
        yield* sessions.remove(other.id)
        yield* events.replayAll(
          serialized.map((event) => ({
            id: event.id,
            aggregateID: event.aggregate_id,
            seq: event.seq,
            type: event.type,
            data: event.data,
          })),
        )
        expect((yield* SessionInput.find(database.db, ordinary.id))?.withdrawnSeq).toBeDefined()
        expect(yield* SessionInput.hasPending(database.db, other.id, "steer")).toBe(false)
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([
              SessionV2.node,
              SessionGoal.node,
              Database.node,
              EventV2.node,
              SessionTaskStore.node,
              SessionTaskMessage.node,
              SessionTaskRole.node,
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

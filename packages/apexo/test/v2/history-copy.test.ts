import { expect } from "bun:test"
import { asc, eq } from "drizzle-orm"
import { ConfigProvider, DateTime, Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { EventV2 } from "@apexo/core/event"
import { EventTable } from "@apexo/core/event/sql"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AbsolutePath } from "@apexo/core/schema"
import { AgentV2 } from "@apexo/core/agent"
import { Model } from "@apexo/schema/model"
import { Provider } from "@apexo/schema/provider"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionEvent } from "@apexo/core/session/event"
import { SessionHistoryCopy } from "@apexo/core/session/history-copy"
import { SessionHistory } from "@apexo/core/session/history"
import { SessionContextEpoch } from "@apexo/core/session/context-epoch"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionInputTable, TodoTable } from "@apexo/core/session/sql"
import { SystemContext } from "@apexo/core/system-context"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
it.live("history copies replay full context without billing or admitting imported work", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const database = yield* Database.Service
      const events = yield* EventV2.Service
      const source = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
      const target = yield* sessions.create({ location: source.location, agent: AgentV2.ID.make("build") })
      const timestamp = yield* DateTime.now
      const base = { sessionID: source.id, timestamp }
      const assistantMessageID = SessionMessage.ID.create()
      const model = Model.Ref.make({
        providerID: Provider.ID.make("fixture"),
        id: Model.ID.make("saved"),
        variant: Model.VariantID.make("default"),
      })
      yield* events.publish(SessionEvent.Prompted, {
        ...base,
        messageID: SessionMessage.ID.create(),
        prompt: {
          text: "original prompt",
          files: [{ mime: "text/plain", name: "fact.txt", uri: "data:text/plain;base64,ZmFjdA==" }],
        },
        delivery: "steer",
      })
      yield* events.publish(SessionEvent.ContextUpdated, {
        ...base,
        messageID: SessionMessage.ID.create(),
        text: "old privileged policy",
      })
      yield* events.publish(SessionEvent.Step.Started, {
        ...base,
        assistantMessageID,
        agent: "historical-agent",
        model,
      })
      const tool = { ...base, assistantMessageID, callID: "historical-tool" }
      yield* events.publish(SessionEvent.Tool.Input.Started, { ...tool, name: "read" })
      yield* events.publish(SessionEvent.Tool.Called, {
        ...tool,
        tool: "read",
        input: { filePath: "fact.txt" },
        provider: { executed: false, metadata: { fixture: { request: "original" } } },
      })
      yield* events.publish(SessionEvent.Tool.Success, {
        ...tool,
        structured: { fact: 42 },
        content: [{ type: "text", text: "full tool result" }],
        outputPaths: ["/historical/output"],
        result: { fact: 42 },
        provider: { executed: false },
      })
      yield* events.publish(SessionEvent.Step.Ended, {
        ...base,
        assistantMessageID,
        finish: "stop",
        cost: 3,
        tokens: { input: 11, output: 7, reasoning: 2, cache: { read: 5, write: 1 } },
      })
      yield* events.publish(SessionEvent.Synthetic, {
        ...base,
        messageID: SessionMessage.ID.create(),
        text: "synthetic history",
      })
      yield* database.db.insert(TodoTable).values({
        session_id: source.id,
        position: 0,
        content: "persisted tool state",
        status: "in_progress",
        priority: "high",
      })
      const snapshot = yield* SessionHistoryCopy.capture(database.db, source.id)
      expect(
        (yield* SessionHistoryCopy.assertReady(database.db, target.id, snapshot.source).pipe(Effect.result))._tag,
      ).toBe("Failure")
      const emitted: string[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          emitted.push(event.type)
        }),
      )
      yield* SessionHistoryCopy.copy(database.db, events, snapshot, target.id)
      yield* unsubscribe
      yield* SessionHistoryCopy.assertReady(database.db, target.id, snapshot.source)
      const copied = yield* sessions.messages({ sessionID: target.id, order: "asc" })
      expect(copied).toHaveLength(snapshot.messages.length)
      expect(copied.every((message) => !snapshot.messages.some((original) => original.id === message.id))).toBe(true)
      expect(copied.map((message) => message.type)).toEqual(snapshot.messages.map((message) => message.type))
      expect(copied.find((message) => message.type === "assistant")).toEqual({
        ...snapshot.messages.find((message) => message.type === "assistant")!,
        id: copied.find((message) => message.type === "assistant")!.id,
      })
      expect(copied.find((message) => message.type === "synthetic")?.sessionID).toBe(target.id)
      expect(copied.find((message) => message.type === "user")?.files).toEqual(
        snapshot.messages.find((message) => message.type === "user")?.files,
      )
      expect(
        emitted.filter((type) => type === SessionEvent.Prompted.type || type === SessionEvent.Step.Ended.type),
      ).toEqual([])
      expect(
        yield* database.db.select().from(SessionInputTable).where(eq(SessionInputTable.session_id, target.id)),
      ).toEqual([])
      expect((yield* sessions.get(target.id)).agent).toBe(AgentV2.ID.make("build"))
      expect((yield* sessions.get(target.id)).cost).toBe(0)
      expect((yield* sessions.get(target.id)).tokens).toEqual({
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      })
      const revision = yield* EventV2.latestSequence(database.db, target.id)
      yield* SessionHistoryCopy.copy(database.db, events, snapshot, target.id)
      expect(yield* EventV2.latestSequence(database.db, target.id)).toBe(revision)
      expect(yield* sessions.messages({ sessionID: source.id, order: "asc" })).toEqual(snapshot.messages)
      const partial = yield* sessions.create({ location: source.location })
      const release = yield* events.listen((event) =>
        Effect.gen(function* () {
          if (event.type !== SessionEvent.HistoryCopy.Message.type) return
          const data = yield* Schema.decodeUnknownEffect(Schema.toType(SessionEvent.HistoryCopy.Message.data))(
            event.data,
          ).pipe(Effect.orDie)
          if (data.sessionID !== partial.id) return
          yield* events.publish(SessionEvent.Synthetic, {
            ...base,
            messageID: SessionMessage.ID.create(),
            text: "source changed during copy",
          })
        }),
      )
      expect((yield* SessionHistoryCopy.copy(database.db, events, snapshot, partial.id).pipe(Effect.result))._tag).toBe(
        "Failure",
      )
      yield* release
      expect((yield* sessions.messages({ sessionID: partial.id, order: "asc" })).length).toBe(1)
      expect((yield* SessionHistoryCopy.assertReady(database.db, partial.id).pipe(Effect.result))._tag).toBe("Failure")
      const partialEvents = yield* database.db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, partial.id))
        .orderBy(asc(EventTable.seq))
      yield* sessions.remove(partial.id)
      yield* events.replayAll(
        partialEvents.map((event) => ({
          id: event.id,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
      )
      expect((yield* SessionHistoryCopy.assertReady(database.db, partial.id).pipe(Effect.result))._tag).toBe("Failure")
      expect((yield* SessionHistoryCopy.capture(database.db, partial.id).pipe(Effect.result))._tag).toBe("Failure")
      const recaptured = yield* SessionHistoryCopy.capture(database.db, source.id)
      const todoTarget = yield* sessions.create({ location: source.location })
      yield* database.db
        .update(TodoTable)
        .set({ content: "changed without a Session event" })
        .where(eq(TodoTable.session_id, source.id))
      expect(
        (yield* SessionHistoryCopy.copy(database.db, events, recaptured, todoTarget.id).pipe(Effect.result))._tag,
      ).toBe("Failure")
      expect(yield* sessions.messages({ sessionID: todoTarget.id, order: "asc" })).toEqual([])
      const retired = yield* SessionHistoryCopy.capture(database.db, source.id)
      yield* sessions.remove(source.id)
      yield* sessions.create({ id: source.id, location: source.location })
      expect(
        (yield* SessionHistoryCopy.copy(database.db, events, retired, todoTarget.id).pipe(Effect.result))._tag,
      ).toBe("Failure")
      const context = SystemContext.make({
        key: SystemContext.Key.make("test/current"),
        codec: Schema.String,
        load: Effect.succeed("current policy"),
        baseline: (value) => value,
        update: (_, value) => value,
      })
      const epoch = yield* SessionContextEpoch.initialize(database.db, Effect.succeed(context), target.id)
      expect(epoch?.baseline).toBe("current policy")
      expect((yield* SessionHistory.load(database.db, target.id)).some((message) => message.type === "system")).toBe(
        false,
      )
      expect(
        (yield* sessions.messages({ sessionID: target.id, order: "asc" })).some((message) => message.type === "system"),
      ).toBe(true)
      const serialized = yield* database.db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, target.id))
        .orderBy(asc(EventTable.seq))
      yield* sessions.remove(target.id)
      yield* events.replayAll(
        serialized.map((event) => ({
          id: event.id,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
      )
      yield* SessionHistoryCopy.assertReady(database.db, target.id, snapshot.source)
      expect(yield* sessions.messages({ sessionID: target.id, order: "asc" })).toEqual(copied)
      expect(
        yield* database.db
          .select({ content: TodoTable.content, status: TodoTable.status, priority: TodoTable.priority })
          .from(TodoTable)
          .where(eq(TodoTable.session_id, target.id)),
      ).toEqual(snapshot.todos)
      expect((yield* sessions.get(target.id)).cost).toBe(0)
      expect(
        yield* database.db.select().from(SessionInputTable).where(eq(SessionInputTable.session_id, target.id)),
      ).toEqual([])
      const restarted = yield* SessionContextEpoch.initialize(database.db, Effect.succeed(context), target.id)
      expect(restarted?.baseline).toBe("current policy")
      expect((yield* SessionHistory.load(database.db, target.id)).some((message) => message.type === "system")).toBe(
        false,
      )
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(LayerNode.group([SessionV2.node, Database.node, EventV2.node]), [
          [SessionExecution.node, SessionExecution.noopLayer],
          [Global.node, Global.layerWith({ home })],
          [
            ModelsDev.node,
            Layer.succeed(ModelsDev.Service, { get: () => Effect.succeed({}), refresh: () => Effect.void }),
          ],
        ]).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
        ),
      ),
    )
  }),
)

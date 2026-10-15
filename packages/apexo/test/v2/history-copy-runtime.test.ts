import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, DateTime, Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { EventV2 } from "@apexo/core/event"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionEvent } from "@apexo/core/session/event"
import { SessionHistoryCopy } from "@apexo/core/session/history-copy"
import { SessionInput } from "@apexo/core/session/input"
import { SessionMessage } from "@apexo/core/session/message"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
it.live(
  "native runner consumes copied failed history but never executes an incomplete copy",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      const llm = yield* TestLLMServer
      yield* Effect.promise(() =>
        Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            agents: { helper: { system: "CURRENT_HELPER_POLICY" } },
            providers: {
              fixture: {
                api: {
                  type: "aisdk",
                  package: "@ai-sdk/openai-compatible",
                  url: llm.url,
                  settings: { apiKey: "test" },
                },
                models: {
                  model: {
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 100000, output: 4096 },
                  },
                },
              },
            },
          }),
        ),
      )
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const database = yield* Database.Service
        const events = yield* EventV2.Service
        const execution = yield* SessionExecution.Service
        const model = { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") }
        const source = yield* sessions.create({
          location: { directory: AbsolutePath.make(directory) },
          agent: AgentV2.ID.make("helper"),
          model,
        })
        const target = yield* sessions.create({ location: source.location, agent: AgentV2.ID.make("helper"), model })
        const timestamp = yield* DateTime.now
        const base = { sessionID: source.id, timestamp }
        yield* events.publish(SessionEvent.Prompted, {
          ...base,
          messageID: SessionMessage.ID.create(),
          prompt: { text: "ORIGINAL_USER_HISTORY" },
          delivery: "steer",
        })
        yield* events.publish(SessionEvent.ContextUpdated, {
          ...base,
          messageID: SessionMessage.ID.create(),
          text: "OLD_SYSTEM_POLICY_MUST_NOT_SURVIVE",
        })
        const assistantMessageID = SessionMessage.ID.create()
        yield* events.publish(SessionEvent.Step.Started, { ...base, assistantMessageID, agent: "helper", model })
        const tool = { ...base, assistantMessageID, callID: "unfinished-historical-tool" }
        yield* events.publish(SessionEvent.Tool.Input.Started, { ...tool, name: "bash" })
        yield* events.publish(SessionEvent.Tool.Called, {
          ...tool,
          tool: "bash",
          input: { command: "echo MUST_NOT_EXECUTE" },
          provider: { executed: false },
        })
        yield* events.publish(SessionEvent.Step.Failed, {
          ...base,
          assistantMessageID,
          error: { type: "unknown", message: "Historical cancellation" },
        })
        const snapshot = yield* SessionHistoryCopy.capture(database.db, source.id)
        yield* SessionHistoryCopy.copy(database.db, events, snapshot, target.id)
        const requests: Record<string, unknown>[] = []
        yield* llm.respond((hit) => {
          requests.push(hit.body)
          return reply().text("CONTINUED_HISTORY").stop().item()
        })
        yield* sessions.prompt({ sessionID: target.id, prompt: { text: "CONTINUE_WITH_NEW_INPUT" } })
        yield* sessions.wait(target.id)
        expect(yield* llm.calls).toBe(1)
        expect(requests).toHaveLength(1)
        const messages = requests[0].messages as { role: string; content: unknown }[]
        expect(JSON.stringify(messages.filter((message) => message.role === "system"))).toContain(
          "CURRENT_HELPER_POLICY",
        )
        expect(JSON.stringify(messages)).not.toContain("OLD_SYSTEM_POLICY_MUST_NOT_SURVIVE")
        expect(JSON.stringify(messages.filter((message) => message.role === "user"))).toContain("ORIGINAL_USER_HISTORY")
        expect(JSON.stringify(messages.filter((message) => message.role === "user"))).toContain(
          "CONTINUE_WITH_NEW_INPUT",
        )
        expect(JSON.stringify(messages.filter((message) => message.role === "tool"))).toContain(
          "Tool execution interrupted",
        )
        expect(yield* sessions.messages({ sessionID: source.id, order: "asc" })).toEqual(snapshot.messages)
        const partial = yield* sessions.create({ location: source.location, agent: AgentV2.ID.make("helper"), model })
        const unsubscribe = yield* events.listen((event) =>
          Effect.gen(function* () {
            if (event.type !== SessionEvent.HistoryCopy.Message.type) return
            const data = yield* Schema.decodeUnknownEffect(Schema.toType(SessionEvent.HistoryCopy.Message.data))(
              event.data,
            ).pipe(Effect.orDie)
            if (data.sessionID !== partial.id) return
            yield* events.publish(SessionEvent.Synthetic, {
              ...base,
              messageID: SessionMessage.ID.create(),
              text: "source changed at import boundary",
            })
          }),
        )
        expect(
          (yield* SessionHistoryCopy.copy(database.db, events, snapshot, partial.id).pipe(Effect.result))._tag,
        ).toBe("Failure")
        yield* unsubscribe
        const pending = yield* sessions.prompt({
          sessionID: partial.id,
          prompt: { text: "MUST_NOT_RUN_PARTIAL_HISTORY" },
          resume: false,
        })
        const rejected = yield* execution.resume(partial.id).pipe(Effect.result)
        expect(rejected._tag).toBe("Failure")
        if (rejected._tag === "Failure") expect(rejected.failure).toBeInstanceOf(SessionHistoryCopy.Conflict)
        expect(yield* llm.calls).toBe(1)
        expect((yield* SessionInput.find(database.db, pending.id))?.promotedSeq).toBeUndefined()
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([SessionV2.node, SessionExecutionLocal.node, EventV2.node, Database.node]),
            [
              [SessionExecution.node, SessionExecutionLocal.node],
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
  30000,
)

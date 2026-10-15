import { LocationServiceMap } from "@apexo/core/location-service-map"
import { WorkflowStore } from "@apexo/core/workflow/store"
import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Deferred, Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
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
import { SessionSchema } from "@apexo/core/session/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
it.live(
  "selected Workflow child rechecks revoked delegation after Created notification",
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
            agents: { helper: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] } },
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
        const events = yield* EventV2.Service
        const locations = yield* LocationServiceMap.Service
        const workflows = yield* WorkflowStore.Service
        const parent = yield* sessions.create({
          location: { directory: AbsolutePath.make(directory) },
          agent: AgentV2.ID.make("build"),
          model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
        })
        const observed = Deferred.makeUnsafe<SessionSchema.ID>()
        const release = Deferred.makeUnsafe<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
        const unsubscribe = yield* events.listen((event) =>
          Effect.gen(function* () {
            if (event.type !== "session.created") return
            const data = yield* Schema.decodeUnknownEffect(
              Schema.Struct({
                sessionID: SessionSchema.ID,
                info: Schema.Struct({ parentID: Schema.optional(SessionSchema.ID) }),
              }),
            )(event.data).pipe(Effect.orDie)
            if (data.info.parentID !== parent.id) return
            yield* Deferred.succeed(observed, data.sessionID)
            yield* Deferred.await(release)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        yield* llm.respond(() =>
          reply()
            .tool("workflow", {
              source: {
                type: "script",
                name: "revoked-selection",
                script: 'complete(agent("CHILD_REVOCATION",#{agent_type:"helper"}));',
              },
              agentBudget: 1,
            })
            .item(),
        )
        const childCalls: unknown[] = []
        for (const _ of [0, 1])
          yield* llm.respond((hit) => {
            const current = (hit.body.messages as { role: string; content: unknown }[])
              .filter((message) => message.role === "user")
              .at(-1)
            if (JSON.stringify(current?.content).includes("CHILD_REVOCATION")) childCalls.push(hit.body.model)
            return reply().text("SETTLED").stop().item()
          })
        yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Run the workflow" } })
        yield* Deferred.await(observed).pipe(Effect.timeout("10 seconds"))
        yield* Effect.gen(function* () {
          const agents = yield* AgentV2.Service
          yield* agents.transform((draft) =>
            draft.update(AgentV2.ID.make("build"), (agent) => {
              agent.permissions = [
                { action: "*", resource: "*", effect: "allow" },
                { action: "task", resource: "helper", effect: "deny" },
              ]
            }),
          )
        }).pipe(Effect.provide(locations.get(parent.location)))
        yield* Deferred.succeed(release, undefined)
        yield* sessions.wait(parent.id)
        expect(childCalls).toEqual([])
        expect(yield* llm.calls).toBe(2)
        const runs = yield* workflows.list(parent.id)
        expect(runs).toHaveLength(1)
        expect(runs[0]?.status).toBe("failed")
        expect(runs[0]?.message).toContain("permission changed")
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([
              SessionV2.node,
              SessionExecutionLocal.node,
              EventV2.node,
              LocationServiceMap.node,
              WorkflowStore.node,
            ]),
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

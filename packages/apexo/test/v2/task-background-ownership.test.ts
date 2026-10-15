import { expect } from "bun:test"
import { Goal } from "@apexo/schema/goal"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionTaskControl } from "@apexo/core/session/task-control"
import { Task } from "@apexo/schema/task"
import { ToolRegistry } from "@apexo/core/tool/registry"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { SessionRunner } from "@apexo/core/session/runner"
import { SessionMessage } from "@apexo/core/session/message"
import path from "node:path"
import { ConfigProvider, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { EventV2 } from "@apexo/core/event"
import { SessionCommandSandbox } from "@apexo/core/session/command-sandbox"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
it.live(
  "background Task Goal admission creates no child or provider work",
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
                    name: "Fixture",
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
        const goals = yield* SessionGoal.Service
        const tasks = yield* SessionTaskStore.Service
        const execution = yield* SessionExecution.Service
        const locations = yield* LocationServiceMap.Service
        const parent = yield* sessions.create({
          location: { directory: AbsolutePath.make(directory) },
          agent: AgentV2.ID.make("build"),
          model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
        })
        yield* goals.create(parent.id, { id: Goal.ID.create(), objective: "An active Goal owns its accounting" })
        const outcome = yield* Effect.gen(function* () {
          const tools = yield* ToolRegistry.Service
          const registry = yield* tools.materialize()
          return yield* registry.settle({
            sessionID: parent.id,
            agent: AgentV2.ID.make("build"),
            assistantMessageID: SessionMessage.ID.create(),
            call: {
              type: "tool-call",
              id: "deny-background-goal",
              name: "task",
              input: { description: "Must reject", prompt: "DO_NOT_RUN", subagent_type: "helper", background: true },
            },
          })
        }).pipe(
          Effect.provide(locations.get(parent.location)),
          Effect.provideService(SessionRunner.CurrentChildren, {
            run: execution.resume,
            interrupt: execution.interrupt,
            notify: () => Effect.void,
          }),
        )
        expect(JSON.stringify(outcome)).toContain("Background Tasks are unavailable during Goal execution")
        expect(yield* tasks.list(parent.id)).toEqual([])
        expect((yield* sessions.list()).filter((session) => session.parentID === parent.id)).toEqual([])
        expect(yield* llm.calls).toBe(0)
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([
              SessionV2.node,
              SessionGoal.node,
              SessionTaskControl.node,
              SessionExecutionLocal.node,
              EventV2.node,
              Database.node,
              SessionTaskStore.node,
              SessionCommandSandbox.node,
              LocationServiceMap.node,
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

it.live(
  "application scope closure joins background child and retains its terminal receipt",
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
                    name: "Fixture",
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 100000, output: 4096 },
                  },
                },
              },
            },
          }),
        ),
      )

      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
      const databasePath = path.join(home, "scope-test.sqlite")
      const owned = yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const control = yield* SessionTaskControl.Service
        const parent = yield* sessions.create({
          location: { directory: AbsolutePath.make(directory) },
          agent: AgentV2.ID.make("build"),
          model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
        })
        const isParent = (hit: { body: Record<string, unknown> }) => JSON.stringify(hit.body.tools).includes('"task"')
        yield* llm.respond(
          () =>
            reply()
              .tool("task", {
                description: "Scope child",
                prompt: "SCOPE_CHILD",
                subagent_type: "helper",
                background: true,
              })
              .item(),
          isParent,
        )
        yield* llm.respond(
          () => reply().text("LATE_SCOPE_CHILD").wait(gate.promise).stop().item(),
          (hit) => !isParent(hit),
        )
        yield* llm.respond(() => reply().text("SCOPE_PARENT_IDLE").stop().item(), isParent)
        yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Start scoped independent work" } })
        yield* llm.wait(3).pipe(Effect.timeout("10 seconds"))
        yield* sessions.wait(parent.id)
        const task = (yield* control.list(parent.id))[0]
        expect(task.status).toBe("running")
        return { parent: parent.id, child: task.id }
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(LayerNode.group([SessionV2.node, SessionExecutionLocal.node, SessionTaskControl.node]), [
            [Database.node, Database.layerFromPath(databasePath)],
            [SessionExecution.node, SessionExecutionLocal.node],
            [Global.node, Global.layerWith({ home })],
            [
              ModelsDev.node,
              Layer.succeed(ModelsDev.Service, { get: () => Effect.succeed({}), refresh: () => Effect.void }),
            ],
          ]).pipe(
            Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
          ),
        ),
        Effect.timeout("15 seconds"),
      )
      // The provider gate is still held: closure must cancel and join, not wait for cooperative model output.
      const receipt = yield* SessionTaskStore.Service.use((tasks) => tasks.latest(owned.parent, owned.child)).pipe(
        Effect.provide(
          AppNodeBuilder.build(SessionTaskStore.node, [[Database.node, Database.layerFromPath(databasePath)]]),
        ),
      )
      expect(receipt?.status).toBe("cancelled")
      expect(receipt?.completedAt).toBeDefined()
      expect(receipt?.request.background).toBe(true)
      gate.resolve()
      expect(yield* llm.calls).toBe(3)
    }),
  30000,
)

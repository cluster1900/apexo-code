import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { AbsolutePath } from "@apexo/schema/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionScheduleStore } from "@apexo/core/session/schedule-store"
import { SessionScheduleOwner } from "@apexo/core/session/schedule-owner"
import { SessionScheduleRuntime } from "@apexo/core/session/schedule"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionMessage } from "@apexo/core/session/message"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { PermissionV2 } from "@apexo/core/permission"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
for (const policy of ["allow", "ask", "deny"] as const)
  it.live(
    `Explicit Session restore obeys ${policy} without provider work or implicit consent`,
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
              permissions: [
                { action: "*", resource: "*", effect: "allow" },
                { action: "task", resource: "*", effect: policy },
              ],
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
          const execution = yield* SessionExecution.Service
          const schedules = yield* SessionScheduleStore.Service
          const locations = yield* LocationServiceMap.Service
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(directory) },
            agent: AgentV2.ID.make("build"),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          expect((yield* sessions.restore(parent.id)).schedules).toEqual([])
          const misplaced = yield* execution
            .control(
              parent.id,
              SessionScheduleRuntime.Service.use((runtime) => runtime.restore(parent.id)).pipe(
                Effect.provide(locations.get({ directory: AbsolutePath.make(home) })),
              ),
            )
            .pipe(Effect.result)
          expect(misplaced._tag).toBe("Failure")
          if (misplaced._tag !== "Failure") throw new Error("Wrong Location must not restore even an empty Session")
          expect(misplaced.failure).toMatchObject({ code: "missing" })
          const make = (callID: string) =>
            schedules.create({
              sessionID: parent.id,
              messageID: SessionMessage.ID.create(),
              callID,
              request: {
                prompt: "Inspect at a future cadence",
                intervalSeconds: 60,
                durable: false,
                fireImmediately: false,
              },
              authority: {
                parentAgent: AgentV2.ID.make("build"),
                agent: AgentV2.ID.make("helper"),
                model: parent.model!,
                authority: [],
              },
            })
          const future = (yield* make("future")).record
          const manual = (yield* make("manual")).record
          yield* schedules.pause(parent.id, manual.id)
          const stopped = (yield* make("stopped")).record
          yield* schedules.pause(parent.id, stopped.id, "stopped")
          yield* execution.control(
            parent.id,
            SessionScheduleRuntime.Service.use((runtime) => runtime.bind(parent.id)).pipe(
              Effect.provide(locations.get(parent.location)),
            ),
          )
          // This is the real joined Location-retirement path, not a synthetic store rewrite.
          yield* locations.invalidate(parent.location)
          expect((yield* schedules.owned(parent.id, future.id)).blockedReason).toBe("restart_required")
          expect(yield* llm.calls).toBe(0)
          const restored = yield* sessions.restore(parent.id)
          expect(restored.schedules.find((item) => item.id === future.id)?.reason).toBe(
            policy === "allow" ? "restored" : policy === "ask" ? "permission_required" : "denied",
          )
          expect(restored.schedules.find((item) => item.id === manual.id)?.reason).toBe("paused")
          expect(restored.schedules.find((item) => item.id === stopped.id)?.reason).toBe("stopped")
          expect((yield* schedules.owned(parent.id, future.id)).nextFireAt).toBe(future.nextFireAt)
          expect(
            yield* PermissionV2.Service.use((permission) => permission.forSession(parent.id)).pipe(
              Effect.provide(locations.get(parent.location)),
            ),
          ).toEqual([])
          expect(yield* sessions.messages({ sessionID: parent.id, order: "asc" })).toEqual([])
          expect(yield* llm.calls).toBe(0)
          if (policy === "allow") {
            expect((yield* sessions.restore(parent.id)).schedules.find((item) => item.id === future.id)?.reason).toBe(
              "already_active",
            )
            expect((yield* schedules.owned(parent.id, future.id)).nextFireAt).toBe(future.nextFireAt)
          }
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([
                SessionV2.node,
                SessionExecutionLocal.node,
                SessionScheduleStore.node,
                SessionScheduleOwner.node,
                SessionLifecycle.node,
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
    30_000,
  )

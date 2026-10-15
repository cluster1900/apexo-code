import { expect } from "bun:test"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { ModelsDev } from "@apexo/core/models-dev"
import { ModelV2 } from "@apexo/core/model"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionRunnerModel } from "@apexo/core/session/runner/model"
import { AgentV2 } from "@apexo/core/agent"
import { AbsolutePath } from "@apexo/core/schema"
import { ProviderV2 } from "@apexo/core/provider"
import { Effect, Layer, Schema } from "effect"
import path from "node:path"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Config } from "@apexo/core/config"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

it.live("a cold Location publishes configured models and agents only after plugin boot", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, "apexo.json"),
        JSON.stringify(
          Schema.decodeUnknownSync(Config.Info)({
            agents: { researcher: { permissions: [{ action: "edit", resource: "*", effect: "deny" }] } },
            providers: {
              "cold-provider": {
                api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "http://127.0.0.1:1" },
                models: { "cold-model": { capabilities: { tools: true, input: ["text"], output: ["text"] } } },
              },
            },
          }),
        ),
      ),
    )
    return yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const locations = yield* LocationServiceMap.Service
      const session = yield* sessions.create({
        location: { directory: AbsolutePath.make(directory) },
        agent: AgentV2.ID.make("researcher"),
        model: { providerID: ProviderV2.ID.make("cold-provider"), id: ModelV2.ID.make("cold-model") },
      })
      yield* Effect.gen(function* () {
        const models = yield* SessionRunnerModel.Service
        const agents = yield* AgentV2.Service
        expect(String((yield* models.resolve(session)).id)).toBe("cold-model")
        expect((yield* agents.select(session.agent)).info?.permissions).toContainEqual({
          action: "edit",
          resource: "*",
          effect: "deny",
        })
      }).pipe(Effect.provide(locations.get(session.location)))
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(LayerNode.group([SessionV2.node, LocationServiceMap.node]), [
          [SessionExecution.node, SessionExecution.noopLayer],
          [
            ModelsDev.node,
            Layer.succeed(ModelsDev.Service, {
              // Simulate catalog I/O latency, not a wait for a forked test fiber.
              // Configuration transforms join the same real plugin boot batch.
              get: () => Effect.sleep("200 millis").pipe(Effect.as({})),
              refresh: () => Effect.void,
            }),
          ],
        ]),
      ),
    )
  }),
)

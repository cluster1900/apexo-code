import { expect } from "bun:test"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { SessionSchedule } from "@apexo/schema/session-schedule"
import { SessionID } from "@apexo/schema/session-id"
import { AbsolutePath } from "@apexo/schema/schema"
import { createRoutes } from "@apexo/server/routes"
import { TestInstance } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { testEffect } from "../lib/effect"

const host = HttpRouter.serve(createRoutes(), { disableListenLog: true, disableLogger: true }).pipe(
  Layer.provide(HttpServer.layerServices),
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
)

testEffect(Layer.mergeAll(host, TestLLMServer.layer)).instance(
  "Cold native host restores an existing Session without provider work and rejects missing identity",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      const created = yield* HttpClientRequest.post("/api/session").pipe(
        HttpClientRequest.bodyJson({ location: { directory: instance.directory } }),
        Effect.flatMap(HttpClient.execute),
      )
      expect(created.status).toBe(200)
      const session = yield* created.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.Struct({ id: SessionID }) }))),
      )
      const root = `/api/session/${session.data.id}`
      expect((yield* HttpClient.get(root)).status).toBe(200)
      expect(yield* llm.calls).toBe(0)
      const response = yield* HttpClient.post(`${root}/restore`)
      expect(response.status).toBe(200)
      const restored = yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(SessionSchedule.Restoration)),
      )
      expect(restored.sessionID).toBe(session.data.id)
      expect(restored.schedules).toEqual([])
      expect(yield* llm.calls).toBe(0)
      // Create a real historically quarantined child only after the cold host has already served restoration.
      const { AppNodeBuilder } = yield* Effect.promise(() => import("@apexo/core/effect/app-node-builder"))
      const { LayerNode } = yield* Effect.promise(() => import("@apexo/core/effect/layer-node"))
      const { SessionV2 } = yield* Effect.promise(() => import("@apexo/core/session"))
      const { SessionManagedChild } = yield* Effect.promise(() => import("@apexo/core/session/managed-child"))
      const { SessionExecution } = yield* Effect.promise(() => import("@apexo/core/session/execution"))
      const { SessionExecutionLocal } = yield* Effect.promise(() => import("@apexo/core/session/execution/local"))
      const child = yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const managed = yield* SessionManagedChild.Service
        const child = yield* sessions.create({
          parentID: session.data.id,
          location: { directory: AbsolutePath.make(instance.directory) },
          metadata: { workflowChild: "historical empty fixture" },
        })
        expect(yield* managed.managed(child.id)).toBe(true)
        return child
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(LayerNode.group([SessionV2.node, SessionManagedChild.node]), [
            [SessionExecution.node, SessionExecutionLocal.node],
          ]),
        ),
      )
      const childResponse = yield* HttpClient.post(`/api/session/${child.id}/restore`)
      expect(childResponse.status).toBe(200)
      const childRestored = yield* childResponse.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(SessionSchedule.Restoration)),
      )
      expect(childRestored.sessionID).toBe(child.id)
      expect(childRestored.schedules).toEqual([])
      expect(yield* llm.calls).toBe(0)
      expect((yield* HttpClient.del(root)).status).toBe(204)
      expect((yield* HttpClient.post(`${root}/restore`)).status).toBe(404)
      expect(yield* llm.calls).toBe(0)
    }),
  30000,
)

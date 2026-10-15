import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { Session } from "@apexo/schema/session"
import { createRoutes } from "@apexo/server/routes"
import { TestInstance } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    HttpRouter.serve(createRoutes(), { disableListenLog: true, disableLogger: true }).pipe(
      Layer.provide(HttpServer.layerServices),
      Layer.provide(layerWebSocketConstructorGlobal),
      Layer.provideMerge(NodeHttpServer.layerTest),
      Layer.provideMerge(NodeServices.layer),
    ),
    TestLLMServer.layer,
  ),
)

describe("Native Session deletion HTTP", () => {
  it.instance("deletes and reuses an accepted custom Session ID without Goal reports", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      const id = Session.ID.make("ses_media_reused")
      for (const attempt of [0, 1]) {
        const created = yield* HttpClientRequest.post("/api/session").pipe(
          HttpClientRequest.bodyJson({ id, location: { directory: instance.directory } }),
          Effect.flatMap(HttpClient.execute),
        )
        expect(created.status).toBe(200)
        const owner = yield* Schema.decodeUnknownEffect(Schema.Struct({ data: Session.Info }))(yield* created.json)
        expect(owner.data.id).toBe(id)
        const deleted = yield* HttpClient.del(`/api/session/${encodeURIComponent(id)}`)
        expect({ attempt, status: deleted.status, body: yield* deleted.text }).toEqual({
          attempt,
          status: 204,
          body: "",
        })
      }
      expect(yield* llm.calls).toBe(0)
    }),
  )
  it.instance("uses stored ownership, removes queued state and tolerates repeated or missing deletion", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      const created = yield* HttpClientRequest.post("/api/session").pipe(
        HttpClientRequest.bodyJson({ location: { directory: instance.directory } }),
        Effect.flatMap(HttpClient.execute),
      )
      expect(created.status).toBe(200)
      const owner = yield* Schema.decodeUnknownEffect(Schema.Struct({ data: Session.Info }))(yield* created.json)
      const route = `/api/session/${owner.data.id}`
      const queued = yield* HttpClientRequest.post(`${route}/prompt`).pipe(
        HttpClientRequest.bodyJson({
          id: "msg_native_delete_pending",
          prompt: { text: "Never execute deleted input" },
          resume: false,
        }),
        Effect.flatMap(HttpClient.execute),
      )
      expect(queued.status).toBe(200)
      yield* queued.text
      const deleted = yield* HttpClient.del(`${route}?directory=${encodeURIComponent("/wrong-caller-location")}`)
      expect(deleted.status).toBe(204)
      expect(yield* deleted.text).toBe("")
      const removed = yield* HttpClient.get(route)
      expect(removed.status).toBe(404)
      yield* removed.text
      const repeated = yield* HttpClient.del(route)
      expect(repeated.status).toBe(204)
      yield* repeated.text
      const missing = yield* HttpClient.del("/api/session/ses_native_delete_missing")
      expect(missing.status).toBe(204)
      yield* missing.text
      const recreated = yield* HttpClientRequest.post("/api/session").pipe(
        HttpClientRequest.bodyJson({ id: owner.data.id, location: { directory: instance.directory } }),
        Effect.flatMap(HttpClient.execute),
      )
      expect(recreated.status).toBe(200)
      yield* recreated.text
      const history = yield* HttpClient.get(`${route}/message`)
      expect(history.status).toBe(200)
      expect(yield* history.json).toEqual({ data: [], cursor: { next: null, previous: null } })
      expect(yield* llm.calls).toBe(0)
    }),
  )
})

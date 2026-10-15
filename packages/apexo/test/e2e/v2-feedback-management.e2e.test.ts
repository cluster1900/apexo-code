import { expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { Feedback } from "@apexo/schema/feedback"
import { createRoutes } from "@apexo/server/routes"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  HttpRouter.serve(createRoutes(), { disableListenLog: true, disableLogger: true }).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provide(layerWebSocketConstructorGlobal),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(NodeServices.layer),
  ),
)
const post = (url: string, body: unknown) =>
  HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))
const SessionResponse = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })

it.instance(
  "native-only feedback management preserves revision and Session ownership without executing a prompt",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const create = () =>
        post("/api/session", { location: { directory: instance.directory } }).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(SessionResponse)),
        )
      const owner = (yield* create()).data.id
      const other = (yield* create()).data.id
      const root = `/api/session/${owner}/feedback`
      expect((yield* HttpClient.get(`/session/${owner}/feedback`)).status).toBe(404)
      expect(yield* (yield* HttpClient.get(root)).json).toEqual([])
      const saved = yield* post(root, { title: "Native feedback", details: "A local draft", type: "bug" })
      expect(saved.status).toBe(200)
      const draft = yield* Schema.decodeUnknownEffect(Feedback.Draft)(yield* saved.json)
      expect(draft).toMatchObject({ sessionID: owner, revision: 1 })
      expect((yield* post(`/api/session/${other}/feedback/${draft.id}/review`, { revision: 1 })).status).toBe(404)
      const updated = yield* post(root, {
        title: "Revised feedback",
        details: "Updated draft",
        type: "bug",
        draft_id: draft.id,
        revision: 1,
      })
      expect(updated.status).toBe(200)
      expect((yield* post(`${root}/${draft.id}/review`, { revision: 1 })).status).toBe(409)
      const reviewed = yield* post(`${root}/${draft.id}/review`, { revision: 2 })
      expect(reviewed.status).toBe(200)
      const issue = yield* Schema.decodeUnknownEffect(Feedback.Issue)(yield* reviewed.json)
      expect(issue.url).toStartWith("https://github.com/cluster1900/apexo-grok/issues/new?")
      expect(issue.body).not.toContain(owner)
      expect(issue.body).not.toContain(draft.id)
      const remove = (revision: number) =>
        HttpClientRequest.delete(`${root}/${draft.id}`).pipe(
          HttpClientRequest.bodyJson({ revision }),
          Effect.flatMap(HttpClient.execute),
        )
      expect((yield* remove(1)).status).toBe(409)
      expect(yield* (yield* remove(2)).json).toBe(true)
      expect((yield* post(`${root}/${draft.id}/review`, { revision: 2 })).status).toBe(404)
      expect((yield* post(root, { title: " ", details: "Invalid blank title", type: "bug" })).status).toBe(400)
      expect(yield* (yield* HttpClient.get(root)).json).toEqual([])
      expect(yield* (yield* HttpClient.get(`/api/session/${owner}/message`)).json).toEqual({
        data: [],
        cursor: { next: null, previous: null },
      })
      expect(yield* (yield* HttpClient.get("/api/session/active")).json).toEqual({ data: {} })
      expect((yield* HttpClient.get("/api/session/ses_missing_feedback/feedback")).status).toBe(404)
    }),
  { git: true },
  30000,
)

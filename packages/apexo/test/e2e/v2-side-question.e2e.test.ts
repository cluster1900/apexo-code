import { describe, expect } from "bun:test"
import { Config, Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { SideQuestion } from "@apexo/schema/side-question"
import { SessionMessage } from "@apexo/core/session/message"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { TestInstance } from "../fixture/fixture"
import { reply, TestLLMServer } from "../lib/llm-server"
import { pollWithTimeout, testEffect } from "../lib/effect"
import path from "path"

const served: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(HttpApiApp.routes, {
  disableListenLog: true,
  disableLogger: true,
})
const it = testEffect(
  Layer.mergeAll(
    served.pipe(
      Layer.provide(layerWebSocketConstructorGlobal),
      Layer.provideMerge(NodeHttpServer.layerTest),
      Layer.provideMerge(NodeServices.layer),
    ),
    TestLLMServer.layer,
  ),
)
const SessionResponse = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })
const MessagesResponse = Schema.Struct({ data: Schema.Array(SessionMessage.Message) })
const post = (url: string, body: unknown) =>
  HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))

describe("Native V2 side questions", () => {
  it.instance(
    "answers from a native snapshot and cancels separately from the main Session",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const llm = yield* TestLLMServer
        yield* Effect.promise(() =>
          Bun.write(
            path.join(instance.directory, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              permissions: [{ action: "*", resource: "*", effect: "deny" }],
              providers: {
                "v2-test": {
                  name: "Side question provider",
                  api: {
                    type: "aisdk",
                    package: "@ai-sdk/openai-compatible",
                    url: llm.url,
                    settings: { apiKey: "test" },
                  },
                  models: {
                    "test-model": {
                      name: "Test",
                      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
                      limit: { context: 100000, output: 4096 },
                    },
                  },
                },
              },
            }),
          ),
        )
        const created = yield* post("/api/session", {
          location: { directory: instance.directory },
          model: { providerID: "v2-test", id: "test-model" },
          agent: "build",
        })
        expect(created.status).toBe(200)
        const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
        const root = `/api/session/${session.id}`
        yield* llm.text("MAIN_COMPLETE")
        expect(
          (yield* post(`${root}/prompt`, {
            id: "msg_side_seed",
            prompt: { text: "The fruit is apricot" },
            resume: true,
          })).status,
        ).toBe(200)
        const messages = HttpClient.get(`${root}/message`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
          Effect.map((response) => response.data),
        )
        const before = yield* pollWithTimeout(
          messages.pipe(
            Effect.map((items) =>
              items.some((message) => message.type === "assistant" && message.time.completed) ? items : undefined,
            ),
          ),
          "Native seed incomplete",
          "15 seconds",
        )
        yield* llm.text("APRICOT_SIDE_ANSWER")
        const asked = yield* post(`${root}/side-question`, {
          question: "Which fruit?",
          images: [
            {
              mediaType: "image/png",
              data: "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==",
            },
          ],
        })
        expect(asked.status).toBe(200)
        const entry = yield* Schema.decodeUnknownEffect(SideQuestion.Entry)(yield* asked.json)
        const list = HttpClient.get(`${root}/side-question`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SideQuestion.Entry))),
        )
        const done = yield* pollWithTimeout(
          list.pipe(Effect.map((items) => items.find((item) => item.id === entry.id && item.status === "completed"))),
          "Native side incomplete",
          "15 seconds",
        )
        expect(done.answer).toBe("APRICOT_SIDE_ANSWER")
        expect(done.imageCount).toBe(1)
        expect(yield* messages).toEqual(before)
        const hit = (yield* llm.hits).at(-1)!
        expect(JSON.stringify(hit.body)).toContain("apricot")
        expect(JSON.stringify(hit.body)).toContain("image/png")
        expect(hit.body.tools ?? []).toEqual([])
        const gate = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
        yield* llm.hold("CANCELLED_ANSWER", gate.promise)
        const heldResponse = yield* post(`${root}/side-question`, { question: "Wait for cancellation" })
        const held = yield* Schema.decodeUnknownEffect(SideQuestion.Entry)(yield* heldResponse.json)
        yield* llm.wait(3)
        const cancelledResponse = yield* HttpClient.execute(
          HttpClientRequest.post(`${root}/side-question/${held.id}/cancel`),
        )
        expect(cancelledResponse.status).toBe(200)
        expect((yield* Schema.decodeUnknownEffect(SideQuestion.Entry)(yield* cancelledResponse.json)).status).toBe(
          "cancelled",
        )
        expect(yield* messages).toEqual(before)
        expect((yield* list).find((item) => item.id === entry.id)?.status).toBe("completed")
        gate.resolve()
      }),
    { git: true },
    30000,
  )
})

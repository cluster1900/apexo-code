import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { Feedback } from "@apexo/schema/feedback"
import { SessionMessage } from "@apexo/core/session/message"
import { createRoutes } from "@apexo/server/routes"
import { TestInstance } from "../fixture/fixture"
import { reply, TestLLMServer } from "../lib/llm-server"
import { pollWithTimeout, testEffect } from "../lib/effect"
import path from "path"

const served = HttpRouter.serve(createRoutes(), {
  disableListenLog: true,
  disableLogger: true,
})
const it = testEffect(
  Layer.mergeAll(
    served.pipe(
      Layer.provide(HttpServer.layerServices),
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

describe("Native V2 feedback execution", () => {
  ;(["allow", "deny"] as const).forEach((permission) => {
    it.instance(
      `settles local feedback with ${permission} permission through the native runner`,
      () =>
        Effect.gen(function* () {
          const instance = yield* TestInstance
          const llm = yield* TestLLMServer
          yield* Effect.promise(() =>
            Bun.write(
              path.join(instance.directory, "apexo.json"),
              JSON.stringify({
                snapshots: false,
                permissions: [{ action: "send_feedback", resource: "*", effect: permission }],
                providers: {
                  "v2-test": {
                    name: "V2 local provider",
                    api: {
                      type: "aisdk",
                      package: "@ai-sdk/openai-compatible",
                      url: llm.url,
                      settings: { apiKey: "test" },
                    },
                    models: {
                      "test-model": {
                        name: "Test model",
                        capabilities: { tools: true, input: ["text"], output: ["text"] },
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
          yield* llm.respond(() =>
            reply()
              .tool("send_feedback", {
                title: "Native feedback",
                details: "What happened: a local draft.",
                type: "bug",
              })
              .item(),
          )
          if (permission === "allow") {
            yield* llm.respond(() =>
              reply()
                .tool("send_feedback", {
                  title: "Missing update",
                  details: "Do not append.",
                  type: "bug",
                  draft_id: "feedback_missing",
                })
                .item(),
            )
          }
          yield* llm.text("Feedback turn completed without sending anything.")
          expect(
            (yield* post(`${root}/prompt`, {
              id: `msg_feedback_${permission}`,
              prompt: { text: "Save local feedback" },
              resume: true,
            })).status,
          ).toBe(200)
          const messages = yield* pollWithTimeout(
            HttpClient.get(`${root}/message`).pipe(
              Effect.flatMap((response) => response.json),
              Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
              Effect.map((response) =>
                response.data.some(
                  (message) =>
                    message.type === "assistant" &&
                    message.time.completed &&
                    message.content.some(
                      (part) =>
                        part.type === "text" && part.text === "Feedback turn completed without sending anything.",
                    ),
                )
                  ? response.data
                  : undefined,
              ),
            ),
            "Native feedback turn did not complete",
            "15 seconds",
          )
          const drafts = yield* HttpClient.get(`${root}/feedback`).pipe(
            Effect.flatMap((response) => response.json),
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Feedback.Draft))),
          )
          expect(drafts).toHaveLength(permission === "allow" ? 1 : 0)
          expect(yield* llm.calls).toBe(permission === "allow" ? 3 : 2)
          const tools = messages.flatMap((message) =>
            message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
          )
          expect(tools.filter((tool) => tool.state.status === "completed")).toHaveLength(permission === "allow" ? 1 : 0)
          expect(tools.filter((tool) => tool.state.status === "error")).toHaveLength(1)
          const advertised = JSON.stringify((yield* llm.hits)[0].body.tools)
          expect(advertised.includes('"send_feedback"')).toBe(permission === "allow")
          if (permission === "deny") return
          expect(drafts[0]).toMatchObject({ title: "Native feedback", sessionID: session.id, revision: 1 })
          const issue = yield* post(`${root}/feedback/${drafts[0].id}/review`, { revision: 1 })
          expect(issue.status).toBe(200)
          const reviewed = yield* Schema.decodeUnknownEffect(Feedback.Issue)(yield* issue.json)
          expect(reviewed.url).toStartWith("https://github.com/cluster1900/apexo-grok/issues/new?")
          expect(reviewed.body).not.toContain(session.id)
          expect(reviewed.body).not.toContain(drafts[0].id)
        }),
      { git: true },
      30000,
    )
  })
})

it.instance(
  "native feedback snapshots operator images without executing a provider turn",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      const created = yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "v2-test", id: "test-model" },
        agent: "build",
      })
      expect(created.status).toBe(200)
      const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
      const root = `/api/session/${session.id}/feedback`
      const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"
      const saved = yield* post(root, {
        title: "Image only",
        details: "",
        type: "idea",
        images: [{ data, mimeType: "image/png", fileName: "native.png" }],
      })
      expect(saved.status).toBe(200)
      const draft = yield* Schema.decodeUnknownEffect(Feedback.Draft)(yield* saved.json)
      const image = draft.images![0]!
      const downloaded = yield* post(`${root}/${draft.id}/image/${image.id}`, { revision: 1 })
      expect(downloaded.status).toBe(200)
      expect(yield* downloaded.json).toEqual({ ...image, data })
      const review = yield* post(`${root}/${draft.id}/review`, { revision: 1 })
      const issue = yield* Schema.decodeUnknownEffect(Feedback.Issue)(yield* review.json)
      expect(issue.url).not.toContain(data)
      expect(issue.url).not.toContain(image.fileName)
      expect(
        (yield* post(root, {
          title: "Removed",
          details: "Text remains",
          type: "idea",
          draft_id: draft.id,
          revision: 1,
          images: [],
        })).status,
      ).toBe(200)
      expect((yield* post(`${root}/${draft.id}/image/${image.id}`, { revision: 1 })).status).toBe(409)
      expect((yield* post(`${root}/${draft.id}/image/${image.id}`, { revision: 2 })).status).toBe(404)
      expect(yield* llm.calls).toBe(0)
    }),
  { git: true },
  30000,
)

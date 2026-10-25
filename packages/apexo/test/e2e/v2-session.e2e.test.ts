import { describe, expect } from "bun:test"
import { Config, Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { SessionMessage } from "@apexo/core/session/message"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { TestInstance } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
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

// All session operations use the native /api/session contract. In particular,
// no legacy Session service or SessionPrompt loop is used to seed or run turns.
describe("V2 HTTP end-to-end session execution", () => {
  it.instance(
    "admits once, rejects conflicting retries, then promotes and executes through the V2 runner",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const llm = yield* TestLLMServer
        yield* Effect.promise(() =>
          Bun.write(
            path.join(instance.directory, "apexo.json"),
            JSON.stringify({
              providers: {
                "v2-test": {
                  name: "V2 local HTTP provider",
                  api: {
                    type: "aisdk",
                    package: "@ai-sdk/openai-compatible",
                    url: llm.url,
                    settings: { apiKey: "test-key" },
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
        })
        expect(created.status).toBe(200)
        const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
        const route = `/api/session/${session.id}`
        const input = { id: "msg_v2_admitted", prompt: { text: "Remember the V2-only request" }, resume: false }
        const first = yield* post(`${route}/prompt`, input)
        expect(first.status).toBe(200)
        const admitted = yield* first.json
        const retry = yield* post(`${route}/prompt`, input)
        expect(retry.status).toBe(200)
        expect(yield* retry.json).toEqual(admitted)
        expect(admitted).toMatchObject({ data: { id: input.id, delivery: "steer", prompt: input.prompt } })
        expect(yield* llm.calls).toBe(0)
        const messages = () =>
          HttpClient.get(`${route}/message`).pipe(
            Effect.flatMap((response) => response.json),
            Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
            Effect.map((response) => response.data),
          )
        expect(yield* messages()).toEqual([])
        const changedText = yield* post(`${route}/prompt`, { ...input, prompt: { text: "conflict" } })
        expect(changedText.status).toBe(409)
        const changedDelivery = yield* post(`${route}/prompt`, { ...input, delivery: "queue" })
        expect(changedDelivery.status).toBe(409)
        const otherCreated = yield* post("/api/session", { location: { directory: instance.directory } })
        expect(otherCreated.status).toBe(200)
        const other = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* otherCreated.json)).data
        const changedSession = yield* post(`/api/session/${other.id}/prompt`, input)
        expect(changedSession.status).toBe(409)

        yield* llm.text("V2 execution completed.")
        const wake = yield* post(`${route}/prompt`, { ...input, resume: true })
        expect(wake.status).toBe(200)
        const completed = yield* pollWithTimeout(
          messages().pipe(
            Effect.map((items) =>
              items.some((message) => message.type === "assistant" && message.time.completed) ? items : undefined,
            ),
          ),
          "V2 runner did not complete",
          "15 seconds",
        )
        expect(completed.filter((message) => message.type === "user")).toHaveLength(1)
        expect(completed).toContainEqual(
          expect.objectContaining({ id: input.id, type: "user", text: input.prompt.text }),
        )
        expect(
          completed.some(
            (message) =>
              message.type === "assistant" &&
              message.content.some((part) => part.type === "text" && part.text === "V2 execution completed."),
          ),
        ).toBe(true)
        expect(yield* llm.calls).toBe(1)
        expect(JSON.stringify((yield* llm.hits)[0].body)).toContain(input.prompt.text)
        const replay = yield* post(`${route}/prompt`, input)
        expect(replay.status).toBe(200)
        expect((yield* messages()).filter((message) => message.type === "user")).toHaveLength(1)
        expect(yield* llm.calls).toBe(1)

        const queued = {
          id: "msg_v2_queue",
          prompt: { text: "Run this queued request when the session is idle" },
          delivery: "queue" as const,
          resume: false,
        }
        const queuedAdmission = yield* post(`${route}/prompt`, queued)
        expect(queuedAdmission.status).toBe(200)
        expect(yield* queuedAdmission.json).toMatchObject({ data: { id: queued.id, delivery: "queue" } })
        expect((yield* messages()).filter((message) => message.type === "user")).toHaveLength(1)
        yield* llm.text("Queued V2 execution completed.")
        const queuedWake = yield* post(`${route}/prompt`, { ...queued, resume: true })
        expect(queuedWake.status).toBe(200)
        const queuedMessages = yield* pollWithTimeout(
          messages().pipe(
            Effect.map((items) =>
              items.some(
                (message) =>
                  message.type === "assistant" &&
                  message.content.some(
                    (part) => part.type === "text" && part.text === "Queued V2 execution completed.",
                  ),
              )
                ? items
                : undefined,
            ),
          ),
          "queued V2 prompt was not promoted and executed",
          "15 seconds",
        )
        expect(queuedMessages.filter((message) => message.type === "user")).toHaveLength(2)
        expect(yield* llm.calls).toBe(2)
        // Interrupt takes no payload, so send it without a body like the real clients do.
        // See docs/known-issues.md for why an unread body hangs shutdown on Bun 1.3.14.
        const interrupt = yield* HttpClient.execute(HttpClientRequest.post(`${route}/interrupt`))
        expect(interrupt.status).toBe(204)

        const invalidCreated = yield* post("/api/session", {
          location: { directory: instance.directory },
          model: { providerID: "v2-test", id: "grok-NOPE-9" },
        })
        expect(invalidCreated.status).toBe(200)
        const invalidSession = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* invalidCreated.json)).data
        const invalidRoute = `/api/session/${invalidSession.id}`
        const invalidPrompt = yield* post(`${invalidRoute}/prompt`, {
          id: "msg_v2_invalid_model",
          prompt: { text: "Reply OK" },
          delivery: "steer",
          resume: true,
        })
        expect(invalidPrompt.status).toBe(200)
        yield* Effect.sleep("50 millis")
        const invalidWait = yield* HttpClient.execute(HttpClientRequest.post(`${invalidRoute}/wait`))
        expect(invalidWait.status).toBe(503)
        expect(yield* invalidWait.text).toContain("Model unavailable: v2-test/grok-NOPE-9")
        const invalidMessages = yield* HttpClient.get(`${invalidRoute}/message`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
          Effect.map((response) => response.data),
        )
        expect(invalidMessages).toContainEqual(
          expect.objectContaining({
            type: "assistant",
            error: expect.objectContaining({ message: "Model unavailable: v2-test/grok-NOPE-9" }),
          }),
        )
      }),
    { git: true },
    30000,
  )
})

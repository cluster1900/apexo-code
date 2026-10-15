import { expect } from "bun:test"
import path from "node:path"
import { Config, ConfigProvider, Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientResponse, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { SessionMessage } from "@apexo/core/session/message"
import { NativeMemory } from "@apexo/schema/memory-native"
import { MemoryNote } from "@apexo/schema/memory-note"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { createRoutes } from "@apexo/server/routes"
import { TestInstance } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { pollWithTimeout, testEffect } from "../lib/effect"

const native = HttpRouter.serve(createRoutes(), { disableListenLog: true, disableLogger: true }).pipe(
  Layer.provide(HttpServer.layerServices),
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
)
const mixedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(HttpApiApp.routes, {
  disableListenLog: true,
  disableLogger: true,
})
const mixed = mixedRoutes.pipe(
  Layer.provide(HttpServer.layerServices),
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
)
const fixture = (compatibility: boolean) =>
  testEffect(Layer.mergeAll(compatibility ? mixed : native, TestLLMServer.layer))
const request = (method: "POST" | "PATCH" | "DELETE", url: string, body: unknown) =>
  HttpClientRequest.make(method)(url).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))
const response =
  <A, I>(schema: Schema.Codec<A, I>) =>
  (value: HttpClientResponse.HttpClientResponse) =>
    value.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema)))
const SessionResponse = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })
const MessagesResponse = Schema.Struct({ data: Schema.Array(SessionMessage.Message) })
const Status = NativeMemory.Info
const Notes = Schema.Array(MemoryNote.Summary)

for (const compatibility of [false, true])
  fixture(compatibility).instance(
    `native Memory ${compatibility ? "mixed" : "pure"} HTTP management is passive and tools settle in the actual native transcript`,
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const llm = yield* TestLLMServer
        yield* Effect.promise(() =>
          Bun.write(
            path.join(instance.directory, "apexo.json"),
            JSON.stringify({
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
              providers: {
                "memory-language": {
                  name: "Memory fixture",
                  api: {
                    type: "aisdk",
                    package: "@ai-sdk/openai-compatible",
                    url: llm.url,
                    settings: { apiKey: "fixture" },
                  },
                  models: {
                    model: {
                      name: "Model",
                      capabilities: { tools: true, input: ["text"], output: ["text"] },
                      limit: { context: 100000, output: 4096 },
                    },
                  },
                },
              },
            }),
          ),
        )
        const created = yield* request("POST", "/api/session", {
          location: { directory: instance.directory },
          model: { providerID: "memory-language", id: "model" },
        })
        expect(created.status).toBe(200)
        const id = (yield* response(SessionResponse)(created)).data.id
        const root = `/api/session/${id}`
        const statusResponse = yield* HttpClient.get(`${root}/memory`)
        if (statusResponse.status !== 200)
          throw new Error(`Memory status ${statusResponse.status}: ${yield* statusResponse.text}`)
        expect(statusResponse.status).toBe(200)
        expect(yield* response(Status)(statusResponse)).toMatchObject({ enabled: false, backend: "legacy" })
        expect((yield* HttpClient.get(`${root}/memory/notes`)).status).toBe(403)
        expect((yield* request("PATCH", `${root}/memory`, { enabled: true })).status).toBe(200)
        expect(yield* response(Notes)(yield* HttpClient.get(`${root}/memory/notes`))).toEqual([])
        expect(yield* llm.calls).toBe(0)
        yield* llm.tool("memory", { operation: "remember", content: "NATIVE_HTTP_MEMORY_FACT" })
        yield* llm.tool("memory_search", { query: "NATIVE_HTTP_MEMORY_FACT", min_score: 0 })
        yield* llm.text("MEMORY_FINISHED")
        expect(
          (yield* request("POST", `${root}/prompt`, { prompt: { text: "Remember the durable fact then retrieve it" } }))
            .status,
        ).toBe(200)
        const messages = yield* pollWithTimeout(
          HttpClient.get(`${root}/message?order=asc`).pipe(
            Effect.flatMap(response(MessagesResponse)),
            Effect.map(({ data }) =>
              data.some(
                (message) =>
                  message.type === "assistant" &&
                  message.content.some((part) => part.type === "text" && part.text === "MEMORY_FINISHED"),
              )
                ? data
                : undefined,
            ),
          ),
          "Memory provider continuation did not finish",
          "15 seconds",
        )
        const parts = messages
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .filter((part) => part.type === "tool")
        expect(parts.map((part) => part.name)).toEqual(["memory", "memory_search"])
        expect(parts.every((part) => part.state.status === "completed")).toBe(true)
        expect(JSON.stringify(parts)).toContain("NATIVE_HTTP_MEMORY_FACT")
        expect(yield* llm.calls).toBe(3)
        const notes = yield* response(Notes)(yield* HttpClient.get(`${root}/memory/notes`))
        expect(notes).toHaveLength(1)
        const note = yield* response(MemoryNote.Detail)(
          yield* HttpClient.get(`${root}/memory/note?path=${encodeURIComponent(notes[0]!.path)}`),
        )
        expect(note.content).toContain("NATIVE_HTTP_MEMORY_FACT")
        expect(
          (yield* HttpClient.get(
            `${root}/memory/note?path=${encodeURIComponent(path.join(instance.directory, "apexo.json"))}`,
          )).status,
        ).toBe(403)
        expect(
          (yield* request("DELETE", `${root}/memory/note`, { path: note.path, hash: "0".repeat(64) })).status,
        ).toBe(409)
        expect((yield* request("DELETE", `${root}/memory/note`, { path: note.path, hash: note.hash })).status).toBe(200)
        expect(yield* llm.calls).toBe(3)
      }),
    30000,
  )

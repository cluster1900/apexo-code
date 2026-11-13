import { expect } from "bun:test"
import path from "node:path"
import { Config, ConfigProvider, Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { Session } from "@apexo/schema/session"
import { SessionMessage } from "@apexo/schema/session-message"
import { McpTools } from "@apexo/core/mcp-tools"
import { createRoutes } from "@apexo/server/routes"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { Apexo } from "../../../client/src/effect"
import { TestInstance } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { pollWithTimeout, testEffect } from "../lib/effect"

const post = (url: string, body: unknown) =>
  HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))
const sessionResponse = Schema.Struct({ data: Session.Info })
const messagesResponse = Schema.Struct({ data: Schema.Array(SessionMessage.Message) })
const native = HttpRouter.serve(createRoutes(), { disableListenLog: true, disableLogger: true })
const compatibility: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  {
    disableListenLog: true,
    disableLogger: true,
  },
)

for (const mixed of [false, true]) {
  const host = (mixed ? compatibility : native).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provide(layerWebSocketConstructorGlobal),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
  )
  testEffect(Layer.mergeAll(host, TestLLMServer.layer)).instance(
    `${mixed ? "mixed" : "native"} HTTP discovers nested forms without frontend child metadata and replies only to the owner`,
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const llm = yield* TestLLMServer
        yield* Effect.promise(() =>
          Bun.write(
            path.join(instance.directory, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              task: { maxDepth: 2 },
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
              agents: { worker: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] } },
              mcp: {
                servers: {
                  forms: {
                    type: "local",
                    defer_tools: false,
                    command: [process.execPath, path.join(import.meta.dir, "../fixture/mcp-forms-stdio.ts")],
                  },
                },
              },
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
        const create = () =>
          post("/api/session", {
            location: { directory: instance.directory },
            model: { providerID: "fixture", id: "model" },
            agent: "build",
          }).pipe(
            Effect.flatMap((response) => response.json),
            Effect.flatMap(Schema.decodeUnknownEffect(sessionResponse)),
            Effect.map((response) => response.data),
          )
        const root = yield* create()
        const other = yield* create()
        const connected = yield* HttpClient.post(
          `/api/mcp/forms/connect?location[directory]=${encodeURIComponent(instance.directory)}`,
        )
        expect(connected.status).toBe(200)
        yield* llm.tool("task", { description: "Child", prompt: "FORM_CHILD", subagent_type: "worker" })
        yield* llm.tool("task", { description: "Grandchild", prompt: "FORM_LEAF", subagent_type: "worker" })
        yield* llm.tool(McpTools.name("forms", "collect"), { mode: "form" })
        yield* llm.text("LEAF_DONE")
        yield* llm.text("CHILD_DONE")
        yield* llm.text("ROOT_DONE")
        expect((yield* post(`/api/session/${root.id}/prompt`, { prompt: { text: "Delegate choices" } })).status).toBe(
          200,
        )
        const client = yield* Apexo.make()
        const forms = client["server.mcpElicitation"]
        const request = yield* pollWithTimeout(
          forms.list({ sessionID: root.id, includeDescendants: "true" }).pipe(Effect.map((items) => items[0])),
          "nested live form over HTTP",
          "10 seconds",
        )
        expect(request.sessionID).not.toBe(root.id)
        expect(yield* forms.list({ sessionID: root.id })).toEqual([])
        expect(yield* forms.list({ sessionID: other.id, includeDescendants: "true" })).toEqual([])
        expect((yield* forms.list({ sessionID: root.id, includeDescendants: "true" })).map((item) => item.id)).toEqual([
          request.id,
        ])
        const wrong = yield* post(`/api/session/${root.id}/mcp/elicitation/${request.id}/reply`, { action: "decline" })
        expect(wrong.status).toBe(404)
        const content = {
          name: "nested",
          quantity: 3,
          ratio: 0.75,
          confirm: false,
          environment: "prod",
          regions: ["a", "b"],
        }
        yield* forms.reply({ sessionID: request.sessionID, requestID: request.id, action: "accept", content })
        const completed = yield* pollWithTimeout(
          HttpClient.get(`/api/session/${request.sessionID}/message?order=asc`).pipe(
            Effect.flatMap((response) => response.json),
            Effect.flatMap(Schema.decodeUnknownEffect(messagesResponse)),
            Effect.map(
              (response) =>
                response.data.flatMap((message) =>
                  message.type === "assistant"
                    ? message.content
                        .filter((part) => part.type === "tool")
                        .filter((part) => part.id === request.toolCallID && part.state.status === "completed")
                    : [],
                )[0],
            ),
          ),
          "nested typed tool completion",
        )
        expect(yield* forms.list({ sessionID: root.id, includeDescendants: "true" })).toEqual([])
        if (completed.state.status !== "completed") throw new Error("Expected completed MCP tool")
        const text = completed.state.content.find((part) => part.type === "text")
        expect(text && "text" in text ? JSON.parse(text.text) : undefined).toMatchObject({
          replies: [{ action: "accept", content }],
        })
        expect((yield* HttpClient.post(`/api/session/${root.id}/wait`)).status).toBe(204)
      }),
    { git: false },
    30000,
  )
}

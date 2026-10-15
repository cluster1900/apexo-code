import { Workflow } from "@apexo/schema/workflow"
import { describe, expect } from "bun:test"
import { Config, Effect, Fiber, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
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

const terminal = (root: string) =>
  pollWithTimeout(
    HttpClient.get(root).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Workflow.Info)),
      Effect.map((info) => (["pending", "running"].includes(info.status) ? undefined : info)),
    ),
    "Workflow did not settle",
    "20 seconds",
  )

it.instance("Workflow child models use native resolution and reject missing selections before creation", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    yield* Effect.promise(() =>
      Bun.write(
        path.join(instance.directory, "apexo.json"),
        JSON.stringify({
          providers: {
            "model-fixture": {
              api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url, settings: { apiKey: "test" } },
              models: Object.fromEntries(
                ["parent", "alternate"].map((id) => [
                  id,
                  {
                    name: id,
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 100000, output: 4096 },
                  },
                ]),
              ),
            },
          },
        }),
      ),
    )
    const response = yield* post("/api/session", {
      location: { directory: instance.directory },
      model: { providerID: "model-fixture", id: "parent" },
      agent: "build",
    })
    const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* response.json)).data
    const root = `/api/session/${parent.id}/workflow`
    const seen: unknown[] = []
    for (let index = 0; index < 2; index++) {
      yield* llm.respond((hit) => {
        seen.push(hit.body.model)
        const names = (hit.body.tools as { function: { name: string } }[]).map((tool) => tool.function.name)
        expect(names).not.toContain("write")
        expect(names).not.toContain("workflow")
        return reply().text("MODEL_OK").usage({ input: 2, output: 3 }).stop().item()
      })
    }
    const started = yield* post(root, {
      source: {
        type: "script",
        name: "mixed",
        script:
          'complete(parallel([#{prompt:"inherit",capability_mode:"read-only"},#{prompt:"explicit",model:"model-fixture/alternate",capability_mode:"read-only"}]));',
      },
      agentBudget: 2,
    })
    const pending = yield* Schema.decodeUnknownEffect(Workflow.Info)(yield* started.json)
    const done = yield* terminal(`${root}/${pending.id}`)
    expect(done).toMatchObject({ status: "completed", agentsSpent: 2, tokens: 10 })
    expect(done.children).toHaveLength(2)
    expect(seen.toSorted()).toEqual(["alternate", "parent"])
    const invalidResponse = yield* post(root, {
      source: {
        type: "definition",
        definition: {
          name: "missing",
          description: "Reject missing child model",
          stages: [{ name: "child", prompt: "unavailable", model: { providerID: "model-fixture", id: "absent" } }],
        },
      },
    })
    const invalid = yield* Schema.decodeUnknownEffect(Workflow.Info)(yield* invalidResponse.json)
    const failed = yield* terminal(`${root}/${invalid.id}`)
    expect(failed.status).toBe("failed")
    expect(failed.message).toContain("Model unavailable")
    expect(failed.children).toEqual([])
    expect(seen).toHaveLength(2)
  }),
)

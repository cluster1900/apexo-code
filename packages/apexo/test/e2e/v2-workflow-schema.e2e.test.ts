import { Workflow } from "@apexo/schema/workflow"
import { expect } from "bun:test"
import { Config, Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
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

it.instance("schema correction stays in one native child and completed receipts replay without another drain", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    yield* Effect.promise(() =>
      Bun.write(
        path.join(instance.directory, "apexo.json"),
        JSON.stringify({
          providers: {
            "schema-fixture": {
              api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url, settings: { apiKey: "test" } },
              models: {
                parent: {
                  name: "parent",
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  limit: { context: 100000, output: 4096 },
                },
              },
            },
          },
        }),
      ),
    )
    const response = yield* post("/api/session", {
      location: { directory: instance.directory },
      model: { providerID: "schema-fixture", id: "parent" },
      agent: "build",
    })
    const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* response.json)).data
    const root = `/api/session/${parent.id}/workflow`
    const requests: unknown[] = []
    for (const text of ['{"wrong":true}', '{"ok":true}', '{"ok":true}']) {
      yield* llm.respond((hit) => {
        requests.push(hit.body)
        expect(hit.body.model).toBe("parent")
        const names = (hit.body.tools as { function: { name: string } }[]).map((tool) => tool.function.name)
        expect(names).not.toContain("write")
        expect(names).not.toContain("workflow")
        return reply().text(text).usage({ input: 2, output: 3 }).stop().item()
      })
    }
    const schema = {
      type: "object",
      required: ["ok"],
      properties: { ok: { type: "boolean" } },
      additionalProperties: false,
    }
    const started = yield* post(root, {
      source: {
        type: "definition",
        definition: {
          name: "correction-budget",
          description: "One correction per logical child",
          stages: [
            { name: "correct", prompt: "FIRST_SCHEMA_CHILD", readOnly: true, outputSchema: schema },
            { name: "next", prompt: "SECOND_SCHEMA_CHILD", readOnly: true, outputSchema: schema },
          ],
        },
      },
      agentBudget: 1,
    })
    const pending = yield* Schema.decodeUnknownEffect(Workflow.Info)(yield* started.json)
    const target = `${root}/${pending.id}`
    const limited = yield* terminal(target)
    expect(limited).toMatchObject({ status: "budget_limited", agentsSpent: 1, tokens: 10, usageIncomplete: false })
    expect(limited.children).toHaveLength(1)
    expect(requests).toHaveLength(2)
    const resumed = yield* post(`${target}/resume`, { agentBudget: 2 })
    expect(resumed.status).toBe(200)
    const completed = yield* terminal(target)
    expect(completed).toMatchObject({
      status: "completed",
      agentsSpent: 2,
      tokens: 15,
      usageIncomplete: false,
      result: { ok: true },
    })
    expect(completed.children).toHaveLength(2)
    expect(completed.children[0]).toBe(limited.children[0])
    expect(requests).toHaveLength(3)
    const invalid = yield* post(root, {
      source: {
        type: "definition",
        definition: {
          name: "async-rejected",
          description: "Reject unsupported validator before any child",
          stages: [{ name: "invalid", prompt: "NO_PROVIDER", outputSchema: { $async: true, type: "object" } }],
        },
      },
    })
    const rejected = yield* Schema.decodeUnknownEffect(Workflow.Info)(yield* invalid.json)
    const failed = yield* terminal(`${root}/${rejected.id}`)
    expect(failed.status).toBe("failed")
    expect(failed.message).toContain("Asynchronous")
    expect(failed.children).toEqual([])
    expect(requests).toHaveLength(3)
  }),
)

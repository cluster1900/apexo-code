import { expect } from "bun:test"
import path from "node:path"
import { Config, ConfigProvider, Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { Permission } from "@apexo/schema/permission"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { createRoutes } from "@apexo/server/routes"
import { TestInstance } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { pollWithTimeout, testEffect } from "../lib/effect"

const native = HttpRouter.serve(createRoutes(), { disableListenLog: true, disableLogger: true })
const mixed: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(HttpApiApp.routes, {
  disableListenLog: true,
  disableLogger: true,
})
const post = (url: string, body: unknown) =>
  HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))
const put = (url: string, body: unknown) =>
  HttpClientRequest.put(url).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))

for (const compatibility of [false, true]) {
  const host = (compatibility ? mixed : native).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provide(layerWebSocketConstructorGlobal),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
  )
  testEffect(Layer.mergeAll(host, TestLLMServer.layer)).instance(
    `Permission review ${compatibility ? "mixed" : "pure"} HTTP keeps one backend owner across clients and reload`,
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const llm = yield* TestLLMServer
        yield* Effect.promise(() =>
          Bun.write(
            path.join(instance.directory, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              compaction: { auto: false },
              permissions: [
                { action: "*", resource: "*", effect: "allow" },
                { action: "bash", resource: "*", effect: "ask" },
              ],
              providers: {
                test: {
                  api: {
                    type: "aisdk",
                    package: "@ai-sdk/openai-compatible",
                    url: llm.url,
                    settings: { apiKey: "fixture" },
                  },
                  models: {
                    fixture: {
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
        const created = yield* post("/api/session", {
          location: { directory: instance.directory },
          agent: "build",
          model: { providerID: "test", id: "fixture" },
        })
        expect(created.status).toBe(200)
        const session = yield* created.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.Struct({ id: Schema.String }) }))),
        )
        const root = `/api/session/${session.data.id}`
        expect(yield* HttpClient.get(`${root}/permission-review`).pipe(Effect.flatMap((res) => res.json))).toEqual({
          data: { mode: "manual", revision: 0 },
        })
        expect(
          yield* put(`${root}/permission-review`, { mode: "review" }).pipe(Effect.flatMap((res) => res.json)),
        ).toEqual({ data: { mode: "review", revision: 1 } })
        expect(
          yield* put(`${root}/permission-review`, { mode: "review" }).pipe(Effect.flatMap((res) => res.json)),
        ).toEqual({ data: { mode: "review", revision: 1 } })
        const hold = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => hold.resolve()))
        yield* llm.tool("bash", { command: "bun --version" })
        yield* llm.hold(
          JSON.stringify({ decision: "allow_once", reason: "Explicit local test", messageIDs: ["msg_operator"] }),
          hold.promise,
        )
        yield* llm.text("DONE")
        const prompt = yield* post(`${root}/prompt`, {
          id: "msg_operator",
          prompt: { text: "Run bun --version" },
          origin: "schedule",
        })
        expect(prompt.status).toBe(200)
        expect(yield* prompt.json).toMatchObject({ data: { origin: "user" } })
        yield* llm.wait(2)
        const pending = HttpClient.get(`${root}/permission`).pipe(
          Effect.flatMap((res) => res.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.Array(Permission.Request) }))),
        )
        const first = yield* pending
        const second = yield* pending
        expect(first.data).toHaveLength(1)
        expect(second).toEqual(first)
        expect(first.data[0]?.review?.status).toBe("reviewing")
        const get = yield* HttpClient.get(`${root}/permission/${first.data[0]!.id}`)
        expect(yield* get.json).toMatchObject({ data: { review: { status: "reviewing" } } })
        expect(yield* llm.calls).toBe(2)
        expect((yield* post(`${root}/permission/${first.data[0]!.id}/reply`, { reply: "once" })).status).toBe(204)
        hold.resolve()
        expect((yield* HttpClient.post(`${root}/wait`)).status).toBe(204)
        expect((yield* pending).data).toEqual([])
        expect(yield* llm.calls).toBe(3)

        const forged = yield* post(`${root}/permission`, {
          action: "bash",
          resources: ["git push origin HEAD"],
          metadata: { command: "git push origin HEAD", origin: "user" },
          source: { type: "tool", messageID: "msg_operator", callID: "forged" },
        })
        expect(forged.status).toBe(200)
        const item = yield* pollWithTimeout(pending.pipe(Effect.map((result) => result.data[0])), "external permission")
        expect(item.review).toBeUndefined()
        expect(yield* llm.calls).toBe(3)
        expect((yield* post(`${root}/permission/${item.id}/reply`, { reply: "reject" })).status).toBe(204)
        expect(
          yield* put(`${root}/permission-review`, { mode: "manual" }).pipe(Effect.flatMap((res) => res.json)),
        ).toEqual({ data: { mode: "manual", revision: 2 } })
        expect((yield* HttpClient.del(root)).status).toBe(204)
      }),
    30000,
  )
}

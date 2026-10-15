import { expect } from "bun:test"
import path from "node:path"
import { Config, ConfigProvider, Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientResponse, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionInput } from "@apexo/schema/session-input"
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
const AdmittedResponse = Schema.Struct({ data: SessionInput.Admitted })
const Outcome = Schema.Struct({ data: SessionInput.Execution })
const Waited = Schema.Struct({ data: SessionInput.ExecutionWait })
const policy = { mode: "headless", permissions: "reject" } as const

for (const compatibility of [false, true])
  fixture(compatibility).instance(
    `headless ${compatibility ? "mixed" : "pure"} HTTP preserves passive waits, exact retry, owned cancellation and deleted incarnation`,
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
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
              providers: {
                test: {
                  name: "Headless HTTP fixture",
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
        const create = { location: { directory: instance.directory }, model: { providerID: "test", id: "fixture" } }
        const created = yield* request("POST", "/api/session", create)
        expect(created.status).toBe(200)
        const id = (yield* response(SessionResponse)(created)).data.id
        const root = `/api/session/${id}`
        const inputID = SessionMessage.ID.create()
        const body = {
          id: inputID,
          prompt: { text: "admit without executing" },
          executionPolicy: policy,
          resume: false,
        }
        const admitted = yield* request("POST", `${root}/prompt`, body)
        expect(admitted.status).toBe(200)
        expect((yield* response(AdmittedResponse)(admitted)).data.executionPolicy).toEqual(policy)
        const input = `${root}/input/${inputID}/execution`
        const idle = yield* request("POST", `${input}/wait`, { timeoutMs: 0 })
        expect(idle.status).toBe(200)
        expect((yield* response(Waited)(idle)).data).toMatchObject({
          timedOut: true,
          execution: { status: "admitted" },
        })
        expect(yield* llm.calls).toBe(0)
        const withdrawn = yield* HttpClient.post(`${input}/interrupt`)
        expect(withdrawn.status).toBe(200)
        expect((yield* response(Outcome)(withdrawn)).data.reason).toBe("withdrawn")
        expect((yield* request("POST", `${root}/prompt`, body)).status).toBe(200)
        expect(
          (yield* request("POST", `${root}/prompt`, {
            ...body,
            executionPolicy: { ...policy, permissions: "approve_once" },
          })).status,
        ).toBe(409)
        expect((yield* HttpClient.get(`${root}/input/${SessionMessage.ID.create()}/execution`)).status).toBe(404)
        expect((yield* request("POST", `${input}/wait`, { timeoutMs: 30001 })).status).toBe(400)
        expect(yield* llm.calls).toBe(0)

        yield* llm.text("HTTP_HEADLESS_DONE", { usage: { input: 3, output: 2 } })
        const runningID = SessionMessage.ID.create()
        expect(
          (yield* request("POST", `${root}/prompt`, {
            id: runningID,
            prompt: { text: "finish" },
            executionPolicy: policy,
          })).status,
        ).toBe(200)
        const running = `${root}/input/${runningID}/execution`
        const finished = yield* request("POST", `${running}/wait`, { timeoutMs: 10000 })
        expect(finished.status).toBe(200)
        expect((yield* response(Waited)(finished)).data).toMatchObject({
          timedOut: false,
          execution: { status: "completed", usageIncomplete: false },
        })
        expect((yield* response(Outcome)(yield* HttpClient.get(running))).data.status).toBe("completed")
        expect((yield* response(Outcome)(yield* HttpClient.post(`${running}/interrupt`))).data.status).toBe("completed")
        expect(yield* llm.calls).toBe(1)

        yield* llm.hang
        const heldID = SessionMessage.ID.create()
        expect(
          (yield* request("POST", `${root}/prompt`, { id: heldID, prompt: { text: "held" }, executionPolicy: policy }))
            .status,
        ).toBe(200)
        yield* llm.wait(2)
        const held = `${root}/input/${heldID}/execution`
        expect((yield* response(Outcome)(yield* HttpClient.post(`${held}/interrupt`))).data).toMatchObject({
          status: "interrupted",
          usageIncomplete: true,
        })
        expect((yield* response(Waited)(yield* request("POST", `${held}/wait`, {}))).data.timedOut).toBe(false)
        expect(yield* llm.calls).toBe(2)

        const oldID = SessionMessage.ID.create()
        expect(
          (yield* request("POST", `${root}/prompt`, {
            id: oldID,
            prompt: { text: "old pending" },
            executionPolicy: policy,
            resume: false,
          })).status,
        ).toBe(200)
        const old = `${root}/input/${oldID}/execution`
        expect((yield* HttpClient.del(root)).status).toBe(204)
        expect((yield* request("POST", "/api/session", { ...create, id })).status).toBe(200)
        expect(
          (yield* request("POST", `${root}/prompt`, {
            id: oldID,
            prompt: { text: "new pending" },
            executionPolicy: policy,
            resume: false,
          })).status,
        ).toBe(200)
        expect((yield* response(Outcome)(yield* HttpClient.get(old))).data.status).toBe("admitted")
        expect((yield* HttpClient.post(`${old}/interrupt`)).status).toBe(200)
        expect(yield* llm.calls).toBe(2)
        expect((yield* HttpClient.del(root)).status).toBe(204)
      }),
    30000,
  )

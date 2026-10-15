import { expect } from "bun:test"
import path from "node:path"
import { Config, ConfigProvider, Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { MemoryOperation } from "@apexo/schema/memory-operation"
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
const sessionResponse = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })
const request = (url: string, body: unknown) =>
  HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))

for (const compatibility of [false, true]) {
  const host = (compatibility ? mixed : native).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provide(layerWebSocketConstructorGlobal),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
  )
  testEffect(Layer.mergeAll(host, TestLLMServer.layer)).instance(
    `Memory operations ${compatibility ? "mixed" : "pure"} HTTP rejects V2 recovery on legacy and settles empty flush without inference`,
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const llm = yield* TestLLMServer
        yield* Effect.promise(() =>
          Bun.write(
            path.join(instance.directory, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              memory: { enabled: true },
              memory_v2: { enabled: false },
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
            }),
          ),
        )
        const created = yield* request("/api/session", { location: { directory: instance.directory } })
        expect(created.status).toBe(200)
        const session = yield* created.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(sessionResponse)))
        const root = `/api/session/${session.data.id}/memory`
        const state = yield* HttpClient.get(root)
        expect(state.status).toBe(200)
        expect(yield* state.json).toMatchObject({ backend: "legacy", enabled: true })
        const before = yield* HttpClient.get(`${root}/operation`)
        expect(before.status).toBe(200)
        expect(yield* before.json).toEqual([])
        const id = MemoryOperation.ID.create()
        const rejected = yield* HttpClient.get(`${root}/recovery?action=discard&scope=workspace`)
        expect(rejected.status).toBe(403)
        expect(yield* rejected.json).toMatchObject({ _tag: "MemoryForbiddenError" })
        const after = yield* HttpClient.get(`${root}/operation`)
        expect(yield* after.json).toEqual([])
        expect((yield* HttpClient.get(`${root}/operation/${id}`)).status).toBe(404)
        expect((yield* HttpClient.post(`${root}/operation/${id}/cancel`)).status).toBe(404)
        const flushID = MemoryOperation.ID.create()
        const accepted = yield* request(`${root}/flush`, { id: flushID })
        expect(accepted.status).toBe(200)
        expect(yield* accepted.json).toMatchObject({ id: flushID, backend: "legacy", kind: "flush" })
        const settled = yield* pollWithTimeout(
          HttpClient.get(`${root}/operation/${flushID}`).pipe(
            Effect.flatMap((response) => response.json),
            Effect.flatMap(Schema.decodeUnknownEffect(MemoryOperation.Info)),
            Effect.map((receipt) => (receipt.state === "finished" ? receipt : undefined)),
          ),
          "Empty legacy flush did not settle",
        )
        expect(settled.result).toEqual({ status: "no_work", processed: 0 })
        const retry = yield* request(`${root}/flush`, { id: flushID })
        expect(retry.status).toBe(200)
        expect(yield* retry.json).toEqual(settled)
        const receipts = yield* HttpClient.get(`${root}/operation`).pipe(Effect.flatMap((response) => response.json))
        expect(receipts).toEqual([settled])
        expect(yield* llm.calls).toBe(0)
      }),
    20000,
  )
}

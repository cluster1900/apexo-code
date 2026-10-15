import { expect } from "bun:test"
import path from "node:path"
import { Config, ConfigProvider, Effect, Fiber, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { Permission } from "@apexo/schema/permission"
import { SessionSchedule } from "@apexo/schema/session-schedule"
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
    `Scheduler ${compatibility ? "mixed" : "pure"} HTTP resume preserves paused intent on permission refusal`,
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
                { action: "task", resource: "*", effect: "ask" },
              ],
              providers: {
                test: {
                  name: "Schedule permission fixture",
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
        const created = yield* request("/api/session", {
          location: { directory: instance.directory },
          agent: "build",
          model: { providerID: "test", id: "fixture" },
        })
        expect(created.status).toBe(200)
        const session = yield* created.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(sessionResponse)))
        const root = `/api/session/${session.data.id}`
        const permissions = HttpClient.get(`${root}/permission`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.Array(Permission.Request) }))),
          Effect.map((response) => response.data),
        )
        const pending = pollWithTimeout(
          permissions.pipe(Effect.map((items) => items.find((item) => item.action === "task"))),
          "Schedule task permission",
          "10 seconds",
        )
        yield* llm.tool("scheduler_create", { prompt: "Check later", interval: "1h", fire_immediately: false })
        yield* llm.text("SCHEDULE_CREATED")
        expect((yield* request(`${root}/prompt`, { prompt: { text: "Create a schedule" } })).status).toBe(200)
        const createPermission = yield* pending
        expect(yield* llm.calls).toBe(1)
        expect((yield* request(`${root}/permission/${createPermission.id}/reply`, { reply: "once" })).status).toBe(204)
        expect((yield* HttpClient.post(`${root}/wait`)).status).toBe(204)
        expect(yield* llm.calls).toBe(2)
        const listed = yield* HttpClient.get(`${root}/schedule`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SessionSchedule.Summary))),
        )
        expect(listed).toHaveLength(1)
        const schedule = `${root}/schedule/${listed[0]!.id}`
        const paused = yield* HttpClient.post(`${schedule}/pause`)
        expect(paused.status).toBe(200)
        expect(yield* paused.json).toMatchObject({ status: "paused" })

        for (const reply of ["reject", "once"] as const) {
          const resumed = yield* HttpClient.post(`${schedule}/resume`).pipe(Effect.forkChild)
          const permission = yield* pending
          expect(permission.resources).toEqual(["general"])
          expect(yield* llm.calls).toBe(2)
          expect((yield* request(`${root}/permission/${permission.id}/reply`, { reply })).status).toBe(204)
          const outcome = yield* Fiber.join(resumed)
          expect(outcome.status).toBe(reply === "reject" ? 400 : 200)
          expect(yield* outcome.json).toMatchObject(
            reply === "reject" ? { _tag: "InvalidRequestError" } : { status: "active" },
          )
          const detail = yield* HttpClient.get(schedule)
          expect(yield* detail.json).toMatchObject({ status: reply === "reject" ? "paused" : "active" })
          expect(yield* permissions).toEqual([])
          expect(yield* llm.calls).toBe(2)
        }
        expect((yield* HttpClient.del(root)).status).toBe(204)
      }),
    30000,
  )
}

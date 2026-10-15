import { expect } from "bun:test"
import path from "node:path"
import { request } from "node:http"
import { Config, ConfigProvider, Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { McpAttachmentOperation } from "@apexo/schema/mcp-attachment-operation"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { createRoutes } from "@apexo/server/routes"
import { TestInstance } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { testEffect } from "../lib/effect"

const native = HttpRouter.serve(createRoutes(), { disableListenLog: true, disableLogger: true })
const mixed: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(HttpApiApp.routes, {
  disableListenLog: true,
  disableLogger: true,
})
const sessionResponse = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })
const post = (url: string, body: unknown) =>
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
    `MCP attachments ${compatibility ? "mixed" : "pure"} HTTP snapshots bytes and explicitly cancels the owned operation without provider work`,
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const llm = yield* TestLLMServer
        yield* Effect.promise(() =>
          Bun.write(
            path.join(instance.directory, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
              mcp: {
                servers: {
                  local: {
                    type: "local",
                    command: [process.execPath, path.join(import.meta.dir, "../fixture/mcp-attachment-stdio.ts")],
                    environment: { MCP_RESOURCE_TRACE: path.join(instance.directory, "mcp-trace") },
                  },
                },
              },
            }),
          ),
        )
        const created = yield* post("/api/session", { location: { directory: instance.directory } })
        expect(created.status).toBe(200)
        if (!created.headers["content-type"]?.includes("application/json"))
          throw new Error(
            `Unexpected Session response content type ${created.headers["content-type"]}: ${(yield* created.text).slice(0, 300)}`,
          )
        const session = yield* created.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(sessionResponse)))
        const root = `/api/session/${session.data.id}/mcp/operations`
        const reserve = (request: McpAttachmentOperation.Request) =>
          Effect.gen(function* () {
            const response = yield* post(root, { request })
            expect(response.status).toBe(200)
            return yield* response.json.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(McpAttachmentOperation.Operation)),
            )
          })
        const execute = (request: McpAttachmentOperation.Request) =>
          Effect.gen(function* () {
            const reserved = yield* reserve(request)
            const response = yield* post(`${root}/${reserved.id}/execute`, { request })
            expect(response.status).toBe(200)
            return yield* response.json.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(McpAttachmentOperation.Operation)),
            )
          })
        const catalog = yield* execute({ kind: "catalog", input: {} })
        expect(catalog.status).toBe("completed")
        expect(catalog.catalog?.resources).toHaveLength(2)
        expect(catalog.catalog?.templates).toHaveLength(2)
        const prepared = yield* execute({
          kind: "prepare",
          input: { kind: "resource", server: "local", uri: "fixture://http" },
        })
        expect(prepared.status).toBe("completed")
        expect(Buffer.from(prepared.prepared!.files[0].uri.split(",")[1], "base64").toString()).toBe(
          "UNICODE:雪:fixture://http",
        )
        const unsupported = yield* execute({
          kind: "prepare",
          input: { kind: "resource", server: "local", uri: "fixture://unsupported" },
        })
        expect(unsupported.status).toBe("failed")
        expect(unsupported.error?.code).toBe("unsupported")
        const media = yield* execute({
          kind: "prepare",
          input: { kind: "resource", server: "local", uri: "fixture://media" },
        })
        expect(media.prepared?.files.map((file) => file.mimeType)).toEqual(["image/png", "application/pdf"])
        const held = { kind: "prepare", input: { kind: "resource", server: "local", uri: "fixture://wait" } } as const
        const reservation = yield* reserve(held)
        const address = yield* HttpServer.addressFormattedWith(Effect.succeed)
        const pending = yield* Effect.sync(() => {
          const pending = request(address + `${root}/${reservation.id}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json" },
          })
          pending.on("error", () => {})
          pending.end(JSON.stringify({ request: held }))
          return pending
        })
        const events = () =>
          Effect.promise(async () =>
            (
              await Bun.file(path.join(instance.directory, "mcp-trace"))
                .text()
                .catch(() => "")
            )
              .split("\n")
              .filter(Boolean)
              .map((line): { event: string; params?: { uri?: string } } => JSON.parse(line)),
          )
        yield* Effect.gen(function* () {
          for (let count = 0; count < 200; count++) {
            if ((yield* events()).some((row) => row.event === "read" && row.params?.uri === "fixture://wait")) return
            yield* Effect.sleep("20 millis")
          }
          throw new Error("HTTP resource read did not start")
        })
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              pending.once("close", resolve)
              pending.destroy()
            }),
        )
        // The explicit endpoint joins the local owner even where Bun does not notify POST disconnect.
        const cancelled = yield* HttpClient.post(`${root}/${reservation.id}/cancel`)
        expect(cancelled.status).toBe(200)
        expect(yield* cancelled.json).toMatchObject({ id: reservation.id, status: "cancelled" })
        yield* Effect.gen(function* () {
          for (let count = 0; count < 200; count++) {
            if ((yield* events()).some((row) => row.event === "read-cleanup")) return
            yield* Effect.sleep("20 millis")
          }
          throw new Error("HTTP cancellation did not reach cooperative MCP cleanup")
        })
        expect((yield* events()).filter((row) => row.event === "cancel")).toHaveLength(1)
        expect(yield* llm.calls).toBe(0)
      }),
    20000,
  )
}

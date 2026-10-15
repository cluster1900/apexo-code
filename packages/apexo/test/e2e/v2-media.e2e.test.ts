import { expect } from "bun:test"
import { Config, Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { Session } from "@apexo/schema/session"
import { SessionMessage } from "@apexo/core/session/message"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { TestInstance, tmpdirScoped } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { pollWithTimeout, testEffect } from "../lib/effect"
import path from "node:path"
import { existsSync } from "node:fs"

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
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypisom00000000")])
const configure = (
  directory: string,
  llm: string,
  media: string,
  denied?: string,
  key = "media-secret",
  resource = "*",
) =>
  Effect.promise(() =>
    Bun.write(
      path.join(directory, "apexo.json"),
      JSON.stringify({
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          ...(denied ? [{ action: denied, resource, effect: "deny" }] : []),
        ],
        providers: {
          "media-language": {
            name: "Language fixture",
            api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm, settings: { apiKey: "fixture" } },
            models: {
              model: {
                name: "Model",
                capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
                limit: { context: 100000, output: 4096 },
              },
            },
          },
          xai: {
            name: "Media fixture",
            api: { type: "native", url: media, settings: {} },
            request: { body: { apiKey: key }, headers: { "x-provider-private": "provider-only" } },
          },
        },
      }),
    ),
  )
const messages = (id: string) =>
  HttpClient.get(`/api/session/${id}/message?order=asc`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
    Effect.map((response) => response.data),
  )
const finished = (id: string, text: string) =>
  pollWithTimeout(
    messages(id).pipe(
      Effect.map((items) =>
        items.some(
          (message) =>
            message.type === "assistant" && message.content.some((part) => part.type === "text" && part.text === text),
        )
          ? items
          : undefined,
      ),
    ),
    "Native media turn did not finish",
    "15 seconds",
  )

it.instance(
  "native media tools execute all four capabilities and preserve ordinary continuation",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      const hits: Array<{ path: string; authorization: string | null; privateHeader: string | null; body: unknown }> =
        []
      const media = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            async fetch(request) {
              const url = new URL(request.url)
              hits.push({
                path: url.pathname,
                authorization: request.headers.get("authorization"),
                privateHeader: request.headers.get("x-provider-private"),
                body: request.method === "POST" ? await request.json() : undefined,
              })
              if (url.pathname === "/file.mp4") return new Response(mp4)
              if (url.pathname === "/v1/videos/generations") return Response.json({ request_id: "test-video" })
              if (url.pathname === "/v1/videos/test-video")
                return Response.json({ status: "done", video: { url: new URL("/file.mp4", request.url).toString() } })
              return Response.json({ data: [{ b64_json: png }] })
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      yield* configure(instance.directory, llm.url, new URL("/v1", media.url).toString())
      const created = yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "media-language", id: "model" },
      })
      expect(created.status).toBe(200)
      const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
      const cases = [
        { name: "image_gen", input: { prompt: "blue square" } },
        { name: "image_edit", input: { prompt: "make red", image: ["[Image #1]"] } },
        { name: "image_to_video", input: { image: `data:image/png;base64,${png}`, duration: 6 } },
        {
          name: "reference_to_video",
          input: {
            prompt: "wave",
            first_frame: `data:image/png;base64,${png}`,
            keyframes: [{ image: `data:image/png;base64,${png}`, timestamp_s: 2.1 }],
            voices: ["eve"],
            aspect_ratio: "16:9",
            duration: 6,
          },
        },
      ]
      for (const item of cases) {
        yield* llm.tool(item.name, item.input)
        yield* llm.text(`FINISHED_${item.name}`)
        const admitted = yield* post(`/api/session/${session.id}/prompt`, {
          prompt: { text: `RUN_${item.name}`, files: [{ mime: "image/png", uri: `data:image/png;base64,${png}` }] },
        })
        expect(admitted.status).toBe(200)
        const result = yield* finished(session.id, `FINISHED_${item.name}`)
        const tool = result
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .find((part) => part.type === "tool" && part.name === item.name)
        expect(tool?.type).toBe("tool")
        if (tool?.type !== "tool" || tool.state.status !== "completed") throw new Error(JSON.stringify(tool))
        expect(tool.state.structured.path).toBeString()
        const file = Bun.file(String(tool.state.structured.path))
        expect(yield* Effect.promise(() => file.exists())).toBe(true)
        const video = item.name.endsWith("video")
        expect(tool.state.structured.mime).toBe(video ? "video/mp4" : "image/png")
        expect(tool.state.content.some((part) => part.type === "file")).toBe(!video)
        expect(Buffer.from(yield* Effect.promise(() => file.arrayBuffer()))).toEqual(
          video ? mp4 : Buffer.from(png, "base64"),
        )
      }
      expect(yield* llm.calls).toBe(8)
      expect(hits.filter((hit) => hit.path.endsWith("generations"))).toHaveLength(3)
      expect(hits.filter((hit) => hit.path === "/v1/images/edits")).toHaveLength(1)
      expect(hits.filter((hit) => hit.path === "/file.mp4")).toHaveLength(2)
      expect(
        hits
          .filter((hit) => hit.path === "/file.mp4")
          .every((hit) => hit.authorization === null && hit.privateHeader === null),
      ).toBe(true)
      expect(
        hits.filter((hit) => hit.path.startsWith("/v1/")).every((hit) => hit.authorization === "Bearer media-secret"),
      ).toBe(true)
      expect(hits.find((hit) => hit.path === "/v1/images/edits")?.body).toMatchObject({
        image: { url: `data:image/png;base64,${png}` },
      })
    }),
  30000,
)

for (const denied of ["edit", "read"]) {
  it.instance(`native media ${denied} denial precedes upload and output writes`, () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      const state = { calls: 0 }
      const media = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            fetch() {
              state.calls++
              return Response.json({ data: [{ b64_json: png }] })
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      yield* configure(instance.directory, llm.url, new URL("/v1", media.url).toString(), denied)
      yield* Effect.promise(() => Bun.write(path.join(instance.directory, "reference.png"), Buffer.from(png, "base64")))
      const created = yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "media-language", id: "model" },
      })
      const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
      yield* llm.tool("image_edit", { prompt: "blue", image: ["reference.png"] })
      yield* llm.text("DENIED_MEDIA_COMPLETE")
      yield* post(`/api/session/${session.id}/prompt`, { prompt: { text: "Edit the image" } })
      const result = yield* finished(session.id, "DENIED_MEDIA_COMPLETE")
      expect(state.calls).toBe(0)
      expect(yield* llm.calls).toBe(2)
      expect(
        result
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .some((part) => part.type === "tool" && part.state.status === "error"),
      ).toBe(true)
      expect(
        yield* Effect.sync(() => existsSync(path.join(instance.directory, `.grok/sessions/${session.id}/images`))),
      ).toBe(false)
    }),
    20000,
  )
}

it.instance(
  "deleting held native media joins cancellation and prevents late writes after Session ID reuse",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      const state = { calls: 0, entered: false, release: () => {} }
      const held = new Promise<void>((resolve) => {
        state.release = resolve
      })
      const media = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            async fetch() {
              state.calls++
              if (state.calls === 1) {
                state.entered = true
                await held
              }
              return Response.json({ data: [{ b64_json: png }] })
            },
          }),
        ),
        (server) =>
          Effect.sync(() => {
            state.release()
            server.stop(true)
          }),
      )
      yield* configure(instance.directory, llm.url, new URL("/v1", media.url).toString())
      const create = {
        id: Session.ID.create(),
        location: { directory: instance.directory },
        model: { providerID: "media-language", id: "model" },
      }
      const created = yield* post("/api/session", create)
      expect(created.status).toBe(200)
      const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
      yield* llm.tool("image_gen", { prompt: "old output" })
      yield* post(`/api/session/${session.id}/prompt`, { prompt: { text: "Hold image" } })
      yield* pollWithTimeout(
        Effect.sync(() => (state.entered ? true : undefined)),
        "Media request never entered",
      )
      const deleted = yield* HttpClient.del(`/api/session/${session.id}`)
      expect({ status: deleted.status, body: yield* deleted.text }).toEqual({ status: 204, body: "" })
      expect(yield* llm.calls).toBe(1)
      const recreated = yield* post("/api/session", create)
      expect(recreated.status).toBe(200)
      yield* Effect.sync(state.release)
      expect(yield* messages(session.id)).toEqual([])
      expect(
        yield* Effect.sync(() => existsSync(path.join(instance.directory, `.grok/sessions/${session.id}/images`))),
      ).toBe(false)
      yield* llm.tool("image_gen", { prompt: "new output" })
      yield* llm.text("REUSED_MEDIA_COMPLETE")
      yield* post(`/api/session/${session.id}/prompt`, { prompt: { text: "Fresh image" } })
      const result = yield* finished(session.id, "REUSED_MEDIA_COMPLETE")
      expect(state.calls).toBe(2)
      expect(yield* llm.calls).toBe(3)
      const completed = result
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .filter((part) => part.type === "tool" && part.state.status === "completed")
      expect(completed).toHaveLength(1)
      expect(JSON.stringify(result)).not.toContain("old output")
    }),
  20000,
)

for (const mode of ["api-redirect", "download-redirect", "oversize", "invalid-image"] as const) {
  it.instance(
    `native media ${mode} fails safely without output`,
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const llm = yield* TestLLMServer
        const state = { api: 0, forbidden: 0 }
        const media = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              fetch(request) {
                const url = new URL(request.url)
                if (url.pathname === "/forbidden") {
                  state.forbidden++
                  return Response.json({ data: [{ b64_json: png }] })
                }
                if (url.pathname === "/redirect")
                  return new Response(null, {
                    status: 302,
                    headers: { location: new URL("/forbidden", url).toString() },
                  })
                state.api++
                if (mode === "api-redirect")
                  return new Response(null, {
                    status: 302,
                    headers: { location: new URL("/forbidden", url).toString() },
                  })
                if (mode === "download-redirect")
                  return Response.json({ data: [{ url: new URL("/redirect", url).toString() }] })
                if (mode === "oversize")
                  return new Response("{}", {
                    headers: { "content-type": "application/json", "content-length": "100000000" },
                  })
                return Response.json({ data: [{ b64_json: Buffer.from("not image data").toString("base64") }] })
              },
            }),
          ),
          (server) => Effect.sync(() => server.stop(true)),
        )
        yield* configure(instance.directory, llm.url, new URL("/v1", media.url).toString())
        const created = yield* post("/api/session", {
          location: { directory: instance.directory },
          model: { providerID: "media-language", id: "model" },
        })
        const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
        yield* llm.tool("image_gen", { prompt: "test safe failure" })
        yield* llm.text("MEDIA_FAILURE_SETTLED")
        yield* post(`/api/session/${session.id}/prompt`, { prompt: { text: "Generate" } })
        const result = yield* finished(session.id, "MEDIA_FAILURE_SETTLED")
        expect(state.api).toBe(1)
        expect(state.forbidden).toBe(0)
        expect(yield* llm.calls).toBe(2)
        expect(
          result
            .flatMap((message) => (message.type === "assistant" ? message.content : []))
            .some((part) => part.type === "tool" && part.state.status === "error"),
        ).toBe(true)
        expect(JSON.stringify(result)).not.toContain("media-secret")
        expect(existsSync(path.join(instance.directory, `.grok/sessions/${session.id}/images`))).toBe(false)
      }),
    20000,
  )
}

for (const mode of [
  "tool-denied",
  "external-denied",
  "missing-key",
  "extension-denied",
  "reference-oversize",
] as const) {
  it.instance(
    `native media ${mode} admits no outbound request`,
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const external = yield* tmpdirScoped()
        const llm = yield* TestLLMServer
        const state = { calls: 0 }
        const media = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              fetch() {
                state.calls++
                return Response.json({ data: [{ b64_json: png }] })
              },
            }),
          ),
          (server) => Effect.sync(() => server.stop(true)),
        )
        yield* configure(
          instance.directory,
          llm.url,
          new URL("/v1", media.url).toString(),
          mode === "external-denied"
            ? "external_directory"
            : mode === "tool-denied"
              ? "image_gen"
              : mode === "extension-denied"
                ? "edit"
                : undefined,
          mode === "missing-key" ? "" : "media-secret",
          mode === "extension-denied" ? "*.png" : "*",
        )
        const reference = path.join(external, "image.png")
        yield* Effect.promise(() =>
          Bun.write(
            reference,
            mode === "reference-oversize"
              ? Buffer.concat([Buffer.from(png, "base64"), Buffer.alloc(20 * 1024 * 1024)])
              : Buffer.from(png, "base64"),
          ),
        )
        const created = yield* post("/api/session", {
          location: { directory: instance.directory },
          model: { providerID: "media-language", id: "model" },
        })
        const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
        yield* llm.tool(
          ["external-denied", "reference-oversize"].includes(mode) ? "image_edit" : "image_gen",
          ["external-denied", "reference-oversize"].includes(mode)
            ? { prompt: "edit", image: [reference] }
            : { prompt: "generate" },
        )
        yield* llm.text("NO_OUTBOUND_MEDIA")
        yield* post(`/api/session/${session.id}/prompt`, { prompt: { text: "Try requested media operation" } })
        const result = yield* finished(session.id, "NO_OUTBOUND_MEDIA")
        expect(state.calls).toBe(0)
        expect(yield* llm.calls).toBe(2)
        expect(
          result
            .flatMap((message) => (message.type === "assistant" ? message.content : []))
            .some((part) => part.type === "tool" && part.state.status === "error"),
        ).toBe(true)
        expect(existsSync(path.join(instance.directory, `.grok/sessions/${session.id}/images`))).toBe(false)
      }),
    20000,
  )
}

it.instance(
  "native image generation preserves WebP MIME and original bytes",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      const webp = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA"
      const calls = { count: 0 }
      const media = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            fetch() {
              calls.count++
              return Response.json({ data: [{ b64_json: webp }] })
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      yield* configure(instance.directory, llm.url, new URL("/v1", media.url).toString())
      const created = yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "media-language", id: "model" },
      })
      const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
      yield* llm.tool("image_gen", { prompt: "WebP output" })
      yield* llm.text("WEBP_DONE")
      yield* post(`/api/session/${session.id}/prompt`, { prompt: { text: "Generate image" } })
      const result = yield* finished(session.id, "WEBP_DONE")
      const tool = result
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((part) => part.type === "tool" && part.name === "image_gen")
      expect(calls.count).toBe(1)
      expect(yield* llm.calls).toBe(2)
      expect(tool?.type === "tool" && tool.state.status).toBe("completed")
      if (tool?.type !== "tool" || tool.state.status !== "completed") throw new Error("Missing completed image")
      expect(tool.state.structured.mime).toBe("image/webp")
      const saved = String(tool.state.structured.path)
      expect(saved.endsWith(".webp")).toBe(true)
      expect(Buffer.from(yield* Effect.promise(() => Bun.file(saved).arrayBuffer()))).toEqual(
        Buffer.from(webp, "base64"),
      )
    }),
  20000,
)

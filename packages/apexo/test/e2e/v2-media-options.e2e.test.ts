import { ConfigMedia } from "@apexo/core/config/media"
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
  options?: ConfigMedia.Info,
) =>
  Effect.promise(() =>
    Bun.write(
      path.join(directory, "apexo.json"),
      JSON.stringify({
        media: options,
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
const ActiveResponse = Schema.Struct({ data: Schema.Record(Schema.String, Schema.Unknown) })
const active = HttpClient.get("/api/session/active").pipe(
  Effect.flatMap((response) => response.json),
  Effect.flatMap(Schema.decodeUnknownEffect(ActiveResponse)),
  Effect.map((response) => response.data),
)
const messages = (id: string) =>
  HttpClient.get(`/api/session/${id}/message?order=asc`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
    Effect.map((response) => response.data),
  )
const finished = (id: string, text: string) =>
  pollWithTimeout(
    Effect.all({ items: messages(id), running: active }).pipe(
      Effect.map(({ items, running }) =>
        !(id in running) &&
        items.some(
          (message) =>
            message.type === "assistant" &&
            Boolean(message.time.completed) &&
            message.content.some((part) => part.type === "text" && part.text === text),
        )
          ? items
          : undefined,
      ),
    ),
    "Native media turn did not finish",
    "15 seconds",
  )

const secrets = {
  APEXO_MEDIA_OPTIONS_RW_ID: "writer",
  APEXO_MEDIA_OPTIONS_RW_SECRET: "writer-secret",
  APEXO_MEDIA_OPTIONS_RO_ID: "reader",
  APEXO_MEDIA_OPTIONS_RO_SECRET: "reader-secret",
}
const credentials = Effect.acquireRelease(
  Effect.sync(() => {
    const original = Object.fromEntries(Object.keys(secrets).map((key) => [key, process.env[key]]))
    Object.assign(process.env, secrets)
    return original
  }),
  (original) =>
    Effect.sync(() => {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }),
)
const options = (endpoint: string): ConfigMedia.Info => ({
  image_gen_model_override: "generation-option",
  image_edit_model_override: "edit-option",
  video_output: {
    type: "s3",
    endpoint,
    bucket: "videos",
    region: "us-east-1",
    key_prefix: "session clips",
    read_write: {
      access_key_id_env: "APEXO_MEDIA_OPTIONS_RW_ID",
      secret_access_key_env: "APEXO_MEDIA_OPTIONS_RW_SECRET",
    },
    read_only: {
      access_key_id_env: "APEXO_MEDIA_OPTIONS_RO_ID",
      secret_access_key_env: "APEXO_MEDIA_OPTIONS_RO_SECRET",
    },
  },
})
const Payload = Schema.Struct({
  model: Schema.String,
  output: Schema.optional(Schema.Struct({ upload_url: Schema.String })),
})

it.instance(
  "native overrides and S3 upload/download use independent credentials and preserve local media",
  () =>
    Effect.gen(function* () {
      yield* credentials
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      const objects = new Map<string, ArrayBuffer>()
      const reads: Array<{ url: string; authorization: string | null; custom: string | null }> = []
      const puts: string[] = []
      const storage = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            async fetch(request) {
              const url = new URL(request.url)
              if (request.method === "PUT") {
                puts.push(request.url)
                objects.set(url.pathname, await request.arrayBuffer())
                return new Response(null, { status: 200 })
              }
              reads.push({
                url: request.url,
                authorization: request.headers.get("authorization"),
                custom: request.headers.get("x-provider-private"),
              })
              process.env.APEXO_MEDIA_OPTIONS_RO_ID = secrets.APEXO_MEDIA_OPTIONS_RO_ID
              process.env.APEXO_MEDIA_OPTIONS_RO_SECRET = secrets.APEXO_MEDIA_OPTIONS_RO_SECRET
              return new Response(objects.get(url.pathname), { headers: { "content-type": "video/mp4" } })
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const payloads: Array<typeof Payload.Type> = []
      const media = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            async fetch(request) {
              if (request.method === "GET")
                return Response.json({ status: "done", video: { url: "https://unused.invalid/never-read" } })
              const payload = Schema.decodeUnknownSync(Payload)(await request.json())
              payloads.push(payload)
              if (new URL(request.url).pathname.includes("/images/"))
                return Response.json({ data: [{ b64_json: png }] })
              if (!payload.output) return new Response("missing upload capability", { status: 400 })
              const uploaded = await fetch(payload.output.upload_url, {
                method: "PUT",
                body: mp4,
                headers: { "content-type": "video/mp4" },
                redirect: "error",
              })
              if (!uploaded.ok) return new Response(null, { status: 502 })
              process.env.APEXO_MEDIA_OPTIONS_RO_ID = "changed-after-admission"
              process.env.APEXO_MEDIA_OPTIONS_RO_SECRET = "changed-after-admission"
              return Response.json({ request_id: "stored-video" })
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      yield* configure(
        instance.directory,
        llm.url,
        new URL("/v1", media.url).toString(),
        undefined,
        "media-secret",
        "*",
        options(storage.url.origin),
      )
      const created = yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "media-language", id: "model" },
      })
      const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
      const cases = [
        { name: "image_gen", input: { prompt: "blue" } },
        { name: "image_edit", input: { prompt: "red", image: [`data:image/png;base64,${png}`] } },
        { name: "image_to_video", input: { image: `data:image/png;base64,${png}` } },
        {
          name: "reference_to_video",
          input: { prompt: "wave", first_frame: `data:image/png;base64,${png}`, aspect_ratio: "16:9" },
        },
      ]
      for (const item of cases) {
        yield* llm.tool(item.name, item.input)
        yield* llm.text(`DONE_${item.name}`)
        expect((yield* post(`/api/session/${session.id}/prompt`, { prompt: { text: item.name } })).status).toBe(200)
        const result = yield* finished(session.id, `DONE_${item.name}`)
        const tool = result
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .find((part) => part.type === "tool" && part.name === item.name)
        if (tool?.type !== "tool" || tool.state.status !== "completed") throw new Error("Media tool did not complete")
        const savedPath = String(tool.state.structured.path)
        expect(tool.state.structured.mime).toBe(item.name.endsWith("video") ? "video/mp4" : "image/png")
        expect(encodedBytes(yield* Effect.promise(() => Bun.file(savedPath).bytes()))).toEqual(
          encodedBytes(item.name.endsWith("video") ? mp4 : Buffer.from(png, "base64")),
        )
        expect(JSON.stringify(tool.state)).not.toContain("X-Amz-")
        expect(JSON.stringify(tool.state)).not.toContain("writer-secret")
        expect(tool.state.content.some((part) => part.type === "file")).toBe(!item.name.endsWith("video"))
      }
      expect(payloads.map((item) => item.model)).toEqual([
        "generation-option",
        "edit-option",
        "grok-imagine-video-1.5",
        "grok-imagine-video-1.5",
      ])
      expect(puts).toHaveLength(2)
      expect(reads).toHaveLength(2)
      expect(puts.every((url) => new URL(url).searchParams.get("X-Amz-Credential")?.startsWith("writer/"))).toBe(true)
      expect(reads.every((read) => new URL(read.url).searchParams.get("X-Amz-Credential")?.startsWith("reader/"))).toBe(
        true,
      )
      expect(reads.every((read) => read.authorization === null && read.custom === null)).toBe(true)
      expect([...objects.keys()].every((key) => key.startsWith("/videos/session%20clips/"))).toBe(true)
      expect(yield* llm.calls).toBe(8)
    }),
  30000,
)

function encodedBytes(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64")
}

for (const scenario of ["upload-denied", "credentials-missing", "download-failed", "download-redirect"] as const) {
  it.instance(
    `native S3 ${scenario} fails without fabricated local or remote success`,
    () =>
      Effect.gen(function* () {
        yield* credentials
        const instance = yield* TestInstance
        const llm = yield* TestLLMServer
        const state = { api: 0, storage: 0 }
        const storage = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              hostname: "127.0.0.1",
              fetch(request) {
                state.storage++
                return scenario === "download-redirect"
                  ? Response.redirect(new URL("/must-not-follow", request.url), 302)
                  : new Response("private storage diagnostic", { status: 403 })
              },
            }),
          ),
          (server) => Effect.sync(() => server.stop(true)),
        )
        const media = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              hostname: "127.0.0.1",
              fetch(request) {
                state.api++
                return Response.json(request.method === "POST" ? { request_id: "test" } : { status: "done" })
              },
            }),
          ),
          (server) => Effect.sync(() => server.stop(true)),
        )
        const settings = options(storage.url.origin)
        if (scenario === "credentials-missing") delete process.env.APEXO_MEDIA_OPTIONS_RW_SECRET
        yield* configure(
          instance.directory,
          llm.url,
          new URL("/v1", media.url).toString(),
          scenario === "upload-denied" ? "media_upload" : undefined,
          "media-secret",
          "s3://videos/*",
          settings,
        )
        const created = yield* post("/api/session", {
          location: { directory: instance.directory },
          model: { providerID: "media-language", id: "model" },
        })
        const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
        yield* llm.tool("image_to_video", { image: `data:image/png;base64,${png}` })
        yield* llm.text("FINISHED_ERROR")
        yield* post(`/api/session/${session.id}/prompt`, { prompt: { text: "video" } })
        const result = yield* finished(session.id, "FINISHED_ERROR")
        expect(
          result
            .flatMap((message) => (message.type === "assistant" ? message.content : []))
            .some((part) => part.type === "tool" && part.state.status === "error"),
        ).toBe(true)
        expect(state.api).toBe(scenario.startsWith("download-") ? 2 : 0)
        expect(state.storage).toBe(scenario.startsWith("download-") ? 1 : 0)
        expect(existsSync(path.join(instance.directory, `.grok/sessions/${session.id}/videos`))).toBe(false)
        expect(JSON.stringify(result)).not.toContain("private storage diagnostic")
        expect(JSON.stringify(result)).not.toContain("X-Amz-")
        expect(yield* llm.calls).toBe(2)
      }),
    20000,
  )
}

it.instance(
  "deleting an S3 download joins ownership and cannot publish into a reused Session",
  () =>
    Effect.gen(function* () {
      yield* credentials
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      const state = { entered: false, release: () => {}, gets: 0 }
      const held = new Promise<void>((resolve) => {
        state.release = resolve
      })
      const storage = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            async fetch() {
              state.gets++
              if (state.gets === 1) {
                state.entered = true
                await held
              }
              return new Response(mp4)
            },
          }),
        ),
        (server) =>
          Effect.sync(() => {
            state.release()
            server.stop(true)
          }),
      )
      const media = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch(request) {
              return Response.json(request.method === "POST" ? { request_id: "held" } : { status: "done" })
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      yield* configure(
        instance.directory,
        llm.url,
        new URL("/v1", media.url).toString(),
        undefined,
        "media-secret",
        "*",
        options(storage.url.origin),
      )
      const create = {
        id: Session.ID.create(),
        location: { directory: instance.directory },
        model: { providerID: "media-language", id: "model" },
      }
      const created = yield* post("/api/session", create)
      const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
      yield* llm.tool("image_to_video", { image: `data:image/png;base64,${png}` })
      yield* post(`/api/session/${session.id}/prompt`, { prompt: { text: "OLD_DOWNLOAD" } })
      yield* pollWithTimeout(
        Effect.sync(() => (state.entered ? true : undefined)),
        "Storage GET never entered",
      )
      const deleted = yield* HttpClient.del(`/api/session/${session.id}`)
      expect({ status: deleted.status, body: yield* deleted.text }).toEqual({ status: 204, body: "" })
      expect((yield* post("/api/session", create)).status).toBe(200)
      yield* Effect.sync(state.release)
      expect(yield* messages(session.id)).toEqual([])
      expect(existsSync(path.join(instance.directory, `.grok/sessions/${session.id}/videos`))).toBe(false)
      yield* llm.tool("image_to_video", { image: `data:image/png;base64,${png}` })
      yield* llm.text("FRESH_STORAGE_DONE")
      yield* post(`/api/session/${session.id}/prompt`, { prompt: { text: "FRESH_DOWNLOAD" } })
      const result = yield* finished(session.id, "FRESH_STORAGE_DONE")
      const completed = result
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .filter((part) => part.type === "tool" && part.state.status === "completed")
      expect(completed).toHaveLength(1)
      expect(JSON.stringify(result)).not.toContain("OLD_DOWNLOAD")
      expect(state.gets).toBe(2)
      expect(yield* llm.calls).toBe(3)
    }),
  20000,
)

for (const variant of [
  "native",
  "legacy",
  "other-fields-invalid",
  "env-model-cannot-bypass",
  "valid-higher-selection",
] as const) {
  it.instance(
    `explicit media document validation preserves authority: ${variant}`,
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const llm = yield* TestLLMServer
        if (variant === "env-model-cannot-bypass")
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const previous = process.env.GROK_IMAGE_GEN_MODEL_OVERRIDE
              process.env.GROK_IMAGE_GEN_MODEL_OVERRIDE = "valid-environment-model"
              return previous
            }),
            (previous) =>
              Effect.sync(() => {
                if (previous === undefined) delete process.env.GROK_IMAGE_GEN_MODEL_OVERRIDE
                else process.env.GROK_IMAGE_GEN_MODEL_OVERRIDE = previous
              }),
          )
        const state = { calls: 0 }
        const media = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              hostname: "127.0.0.1",
              fetch(request) {
                state.calls++
                if (new URL(request.url).pathname === "/clip.mp4") return new Response(mp4)
                return Response.json(
                  request.method === "POST"
                    ? { request_id: "provider" }
                    : { status: "done", video: { url: new URL("/clip.mp4", request.url).toString() } },
                )
              },
            }),
          ),
          (server) => Effect.sync(() => server.stop(true)),
        )
        yield* configure(
          instance.directory,
          llm.url,
          new URL("/v1", media.url).toString(),
          undefined,
          "media-secret",
          "*",
          { video_output: { type: "provider" } },
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(instance.directory, ".apexo", "apexo.json"),
            JSON.stringify({
              media: { video_output: { type: "s3", bucket: "incomplete" } },
              ...(variant === "legacy" ? { provider: {} } : {}),
              ...(variant === "other-fields-invalid" ? { permissions: "invalid", providers: { injected: false } } : {}),
            }),
          ),
        )
        if (variant === "valid-higher-selection")
          yield* Effect.promise(() =>
            Bun.write(
              path.join(instance.directory, ".apexo", "apexo.jsonc"),
              JSON.stringify({ media: { video_output: { type: "provider" } } }),
            ),
          )
        const created = yield* post("/api/session", {
          location: { directory: instance.directory },
          model: { providerID: "media-language", id: "model" },
        })
        expect(created.status).toBe(200)
        const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
        yield* llm.tool(
          variant === "env-model-cannot-bypass" ? "image_gen" : "image_to_video",
          variant === "env-model-cannot-bypass" ? { prompt: "image" } : { image: `data:image/png;base64,${png}` },
        )
        yield* llm.text("MALFORMED_DONE")
        yield* post(`/api/session/${session.id}/prompt`, { prompt: { text: "explicit output selection" } })
        const result = yield* finished(session.id, "MALFORMED_DONE")
        const tool = result
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .find((part) => part.type === "tool")
        expect(tool?.type === "tool" ? tool.state.status : undefined).toBe(
          variant === "valid-higher-selection" ? "completed" : "error",
        )
        expect(state.calls).toBe(variant === "valid-higher-selection" ? 3 : 0)
        expect(yield* llm.calls).toBe(2)
      }),
    20000,
  )
}

it.instance(
  "public config API rejects malformed media without writing or exposing environment values",
  () =>
    Effect.gen(function* () {
      yield* credentials
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url, "https://unused.invalid")
      const file = Bun.file(path.join(instance.directory, "apexo.json"))
      const original = yield* Effect.promise(() => file.text())
      const response = yield* HttpClientRequest.patch(
        `/config?directory=${encodeURIComponent(instance.directory)}`,
      ).pipe(
        HttpClientRequest.bodyJson({ media: { video_output: { type: "s3", bucket: "incomplete" } } }),
        Effect.flatMap(HttpClient.execute),
      )
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => file.text())).toBe(original)
      expect(yield* response.text).not.toContain(secrets.APEXO_MEDIA_OPTIONS_RW_SECRET)
    }),
  20000,
)

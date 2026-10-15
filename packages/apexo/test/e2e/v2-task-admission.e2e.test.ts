import { expect } from "bun:test"
import { Config, Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { SessionMessage } from "@apexo/core/session/message"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { Database } from "@apexo/core/database/database"
import { SessionInputTable } from "@apexo/core/session/sql"
import { SessionID } from "@apexo/schema/session-id"
import { eq } from "drizzle-orm"
import { TestInstance } from "../fixture/fixture"
import { reply, TestLLMServer } from "../lib/llm-server"
import { pollWithTimeout, testEffect } from "../lib/effect"
import path from "node:path"

const served: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(HttpApiApp.routes, {
  disableListenLog: true,
  disableLogger: true,
})
const it = testEffect(
  Layer.mergeAll(
    served.pipe(
      Layer.provide(HttpServer.layerServices),
      Layer.provide(layerWebSocketConstructorGlobal),
      Layer.provideMerge(NodeHttpServer.layerTest),
      Layer.provideMerge(NodeServices.layer),
    ),
    TestLLMServer.layer,
    AppNodeBuilder.build(Database.node),
  ),
)
const SessionResponse = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })
const MessagesResponse = Schema.Struct({ data: Schema.Array(SessionMessage.Message) })
const post = (url: string, body: unknown) =>
  HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))

const configure = (directory: string, url: string) =>
  Effect.promise(() =>
    Bun.write(
      path.join(directory, "apexo.json"),
      JSON.stringify({
        snapshots: false,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
        agents: { helper: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] } },
        providers: {
          "task-fixture": {
            api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: url, settings: { apiKey: "test" } },
            models: {
              model: {
                name: "Task model",
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 100000, output: 4096 },
              },
            },
          },
        },
      }),
    ),
  )

it.instance(
  "private Task ownership rejects native and compatibility execution before durable admission",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      const database = yield* Database.Service
      yield* configure(instance.directory, llm.url)
      const created = yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "task-fixture", id: "model" },
        agent: "build",
      })
      expect(created.status).toBe(200)
      const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
      const child = { id: "" }
      yield* llm.respond(() =>
        reply().tool("task", { description: "Guarded child", prompt: "OWNED_CHILD", subagent_type: "helper" }).item(),
      )
      yield* llm.text("OWNED_CHILD_RESULT")
      yield* llm.respond((hit) => {
        child.id = JSON.stringify(hit.body.messages).match(/ses_[a-f0-9]{64}/)?.[0] ?? ""
        expect(child.id).not.toBe("")
        return reply().text("PARENT_READY").stop().item()
      })
      expect((yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Use Task" } })).status).toBe(200)
      const read = (id: string) =>
        HttpClient.get(`/api/session/${id}/message?order=asc`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
        )
      yield* pollWithTimeout(
        read(parent.id).pipe(
          Effect.map((result) => (JSON.stringify(result).includes("PARENT_READY") ? true : undefined)),
        ),
        "Task did not settle",
        "20 seconds",
      )
      const before = yield* read(child.id)
      const inbox = () =>
        database.db
          .select()
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, SessionID.make(child.id)))
      const admitted = yield* inbox()
      const directory = `?directory=${encodeURIComponent(instance.directory)}`
      const marker = path.join(instance.directory, "UNAUTHORIZED_SHELL")
      const probes: readonly [string, unknown, number][] = [
        [`/api/session/${child.id}/prompt`, { prompt: { text: "UNAUTHORIZED_NATIVE" } }, 409],
        [`/api/session/${child.id}/side-question`, { question: "UNAUTHORIZED_BTW" }, 400],
        [`/api/session/${child.id}/goal`, { id: "goal_taskguard", objective: "UNAUTHORIZED_GOAL" }, 409],
        [`/api/session/${child.id}/workflow/launch`, { source: { type: "builtin", name: "deep-research" } }, 400],
        [`/session/${child.id}/message${directory}`, { parts: [{ type: "text", text: "UNAUTHORIZED_LEGACY" }] }, 400],
        [
          `/session/${child.id}/prompt_async${directory}`,
          { parts: [{ type: "text", text: "UNAUTHORIZED_ASYNC" }] },
          400,
        ],
        [`/session/${child.id}/command${directory}`, { command: "init", arguments: "" }, 400],
        [`/session/${child.id}/shell${directory}`, { agent: "build", command: `touch '${marker}'` }, 400],
        [`/session/${child.id}/summarize${directory}`, { providerID: "task-fixture", modelID: "model" }, 400],
        [`/session/${child.id}/side-question${directory}`, { question: "UNAUTHORIZED_LEGACY_BTW" }, 400],
      ]
      for (const [url, body, status] of probes) {
        const response = yield* post(url, body)
        const bodyText = yield* response.text
        expect({ url, status: response.status, failure: response.status !== status ? bodyText : undefined }).toEqual({
          url,
          status,
          failure: undefined,
        })
        if (url.includes("/workflow/launch"))
          expect(bodyText).toContain("Managed children cannot launch workflows")
      }
      expect((yield* HttpClient.post(`/api/session/${child.id}/compact`)).status).toBe(503)
      expect(yield* inbox()).toEqual(admitted)
      expect(yield* read(child.id)).toEqual(before)
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
      expect(yield* llm.calls).toBe(3)
      expect(
        yield* HttpClient.get(`/api/session/${child.id}/side-question`).pipe(
          Effect.flatMap((response) => response.json),
        ),
      ).toEqual([])
      expect(
        yield* HttpClient.get(`/api/session/${child.id}/goal`).pipe(Effect.flatMap((response) => response.json)),
      ).toBeNull()
      expect(
        yield* HttpClient.get(`/api/session/${child.id}/workflow`).pipe(Effect.flatMap((response) => response.json)),
      ).toEqual([])
      // An ordinary Session remains executable after every rejected compatibility request.
      yield* llm.text("ORDINARY_STILL_WORKS")
      expect(
        (yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Ordinary continuation" } })).status,
      ).toBe(200)
      yield* pollWithTimeout(
        read(parent.id).pipe(
          Effect.map((result) => (JSON.stringify(result).includes("ORDINARY_STILL_WORKS") ? true : undefined)),
        ),
        "Parent did not continue",
        "20 seconds",
      )
      expect(yield* llm.calls).toBe(4)
    }),
  30000,
)

it.instance(
  "Task execution restores private parent authority after public child metadata and grant edits",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      const secret = path.join(instance.directory, "secret.txt")
      const publicFile = path.join(instance.directory, "public.txt")
      yield* Effect.promise(async () => {
        const file = path.join(instance.directory, "apexo.json")
        const config = await Bun.file(file).json()
        config.agents.restricted = {
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "read", resource: "*", effect: "deny" },
            { action: "read", resource: publicFile, effect: "allow" },
          ],
        }
        await Bun.write(file, JSON.stringify(config))
        await Bun.write(secret, "PRIVATE_TASK_SECRET")
        await Bun.write(publicFile, "PUBLIC_TASK_VALUE")
      })
      const created = yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "task-fixture", id: "model" },
        agent: "restricted",
      })
      const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
      const child = { id: "" }
      const grant = (id: string) =>
        HttpClientRequest.patch(`/session/${id}?directory=${encodeURIComponent(instance.directory)}`).pipe(
          HttpClientRequest.bodyJson({
            metadata: { taskAuthority: "allow-all" },
            permission: [{ permission: "read", pattern: "*", action: "allow" }],
          }),
          Effect.flatMap(HttpClient.execute),
        )
      expect((yield* grant(parent.id)).status).toBe(200)
      for (const turn of ["first", "followup"]) {
        yield* llm.respond(() =>
          reply()
            .tool("task", {
              description: "Restricted child",
              prompt: `READ_${turn}`,
              subagent_type: "helper",
              ...(child.id ? { task_id: child.id } : {}),
            })
            .item(),
        )
        yield* llm.respond(() => reply().tool("read", { path: secret }).item())
        yield* llm.respond((hit) => {
          expect(JSON.stringify(hit.body.messages)).not.toContain("PRIVATE_TASK_SECRET")
          expect(JSON.stringify(hit.body.messages)).toContain("Unable to read")
          return reply().tool("read", { path: publicFile }).item()
        })
        yield* llm.respond((hit) => {
          expect(JSON.stringify(hit.body.messages)).toContain("PUBLIC_TASK_VALUE")
          return reply().text(`CHILD_ALLOWED_${turn}`).stop().item()
        })
        yield* llm.text(`PARENT_AUTHORITY_${turn}`)
        expect((yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: `Delegate ${turn}` } })).status).toBe(
          200,
        )
        expect((yield* HttpClient.post(`/api/session/${parent.id}/wait`)).status).toBe(204)
        const listed = yield* HttpClient.get(`/api/session/${parent.id}/task`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(
            Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: Schema.String, status: Schema.String }))),
          ),
        )
        expect(listed).toHaveLength(1)
        expect(listed[0].status).toBe("completed")
        if (child.id) expect(listed[0].id).toBe(child.id)
        child.id = listed[0].id
        expect((yield* grant(child.id)).status).toBe(200)
      }
      expect(yield* llm.calls).toBe(10)
    }),
  30000,
)

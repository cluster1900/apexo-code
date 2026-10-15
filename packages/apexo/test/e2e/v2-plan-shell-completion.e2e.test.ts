import { expect } from "bun:test"
import { SessionProcess } from "@apexo/schema/session-process"
import { Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { SessionMessage } from "@apexo/core/session/message"
import { createRoutes } from "@apexo/server/routes"
import { TestInstance } from "../fixture/fixture"
import { reply, TestLLMServer } from "../lib/llm-server"
import { pollWithTimeout, testEffect } from "../lib/effect"
import path from "node:path"

const served = HttpRouter.serve(createRoutes(), { disableListenLog: true, disableLogger: true })
const it = testEffect(
  Layer.mergeAll(
    served.pipe(
      Layer.provide(HttpServer.layerServices),
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

const readMessages = (id: string) =>
  HttpClient.get(`/api/session/${id}/message?order=asc`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
  )
const finished = (id: string, text: string) =>
  pollWithTimeout(
    readMessages(id).pipe(
      Effect.map((response) =>
        response.data.some(
          (message) =>
            message.type === "assistant" &&
            message.time.completed &&
            message.content.some((part) => part.type === "text" && part.text === text),
        )
          ? response.data
          : undefined,
      ),
    ),
    "Task fixture did not settle",
    "20 seconds",
  )

const create = (directory: string) =>
  post("/api/session", {
    location: { directory },
    model: { providerID: "task-fixture", id: "model" },
    agent: "build",
  }).pipe(
    Effect.flatMap((response) =>
      response.status === 200
        ? response.json
        : response.text.pipe(
            Effect.flatMap((text) => Effect.fail(new Error(`Create Session returned ${response.status}: ${text}`))),
          ),
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(SessionResponse)),
    Effect.map((response) => response.data.id),
  )
const list = (parent: string) =>
  HttpClient.get(`/api/session/${parent}/process`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SessionProcess.Summary))),
  )
const detail = (parent: string, child: string) =>
  HttpClient.get(`/api/session/${parent}/process/${child}`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(SessionProcess.Detail)),
  )

it.instance(
  "background Shell completion waits for native Plan approval without a new user input",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      const release = path.join(instance.directory, "shell.release")
      yield* Effect.addFinalizer(() => Effect.promise(() => Bun.write(release, "release")).pipe(Effect.asVoid))
      const parent = yield* create(instance.directory)
      yield* llm.respond(() =>
        reply()
          .tool("bash", {
            command: "printf BEGIN; while [ ! -f shell.release ]; do sleep 0.02; done; printf BACKGROUND_PLAN_RESULT",
            description: "Independent Plan companion",
            background: true,
          })
          .item(),
      )
      yield* llm.respond(() => reply().tool("plan_enter", {}).item())
      yield* llm.respond(() => reply().tool("plan_exit", {}).item())
      yield* llm.respond(() => reply().text("PLAN_ACCEPTED").stop().item())
      yield* llm.respond((hit) => {
        const text = JSON.stringify(hit.body.messages)
        expect(text).toContain("Background shell completion data follows")
        expect(text).toContain("BACKGROUND_PLAN_RESULT")
        return reply().text("PLAN_SHELL_DELIVERED").stop().item()
      })
      expect(
        (yield* post(`/api/session/${parent}/prompt`, {
          prompt: { text: "Start a background shell, then request Plan approval" },
        })).status,
      ).toBe(200)
      const questions = HttpClient.get(`/api/session/${parent}/question`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.Struct({
              data: Schema.Array(Schema.Struct({ id: Schema.String })),
            }),
          ),
        ),
        Effect.map((response) => response.data),
      )
      const pending = yield* pollWithTimeout(
        questions.pipe(Effect.map((items) => items[0])),
        "Plan approval did not appear",
        "15 seconds",
      )
      expect(yield* llm.calls).toBe(3)
      const tasks = yield* list(parent)
      expect(tasks).toHaveLength(1)
      expect(tasks[0]).toMatchObject({ background: true, status: "running" })
      yield* Effect.promise(() => Bun.write(release, "release"))
      yield* pollWithTimeout(
        detail(parent, tasks[0].id).pipe(Effect.map((task) => (task.status === "completed" ? task : undefined))),
        "Background Plan child did not settle",
        "10 seconds",
      )
      expect(yield* questions).toEqual([pending])
      expect(yield* llm.calls).toBe(3)
      expect(
        (yield* post(`/api/session/${parent}/question/${pending.id}/reply`, {
          answers: [["Approve"]],
        })).status,
      ).toBe(204)
      const history = yield* finished(parent, "PLAN_SHELL_DELIVERED")
      expect((yield* HttpClient.post(`/api/session/${parent}/wait`)).status).toBe(204)
      expect(yield* llm.calls).toBe(5)
      expect(yield* questions).toEqual([])
      expect(history.filter((message) => message.type === "user").map((message) => message.text)).toEqual([
        "Start a background shell, then request Plan approval",
      ])
      expect((yield* detail(parent, tasks[0].id)).output).toBe("BEGINBACKGROUND_PLAN_RESULT")
      expect((yield* HttpClient.post(`/api/session/${parent}/wait`)).status).toBe(204)
      expect(yield* llm.calls).toBe(5)
    }),
  30000,
)

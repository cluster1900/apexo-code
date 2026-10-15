import { expect } from "bun:test"
import { Task } from "@apexo/schema/task"
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
  "live Monitor events wait for native Plan approval without bypassing the pending question",
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
          .tool("monitor", {
            command:
              "while [ ! -f shell.release ]; do sleep 0.02; done; printf 'MONITOR_PLAN_EVENT\\n'; while [ ! -f monitor.finish ]; do sleep 0.02; done; printf MONITOR_PLAN_END",
            description: "Independent Plan companion",
            persistent: true,
          })
          .item(),
      )
      yield* llm.respond(() => reply().tool("plan_enter", {}).item())
      yield* llm.respond(() => reply().tool("plan_exit", {}).item())
      yield* llm.respond((hit) => {
        const updates = JSON.stringify(
          Schema.decodeUnknownSync(
            Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.optional(Schema.Unknown) })),
          )(hit.body.messages).filter(
            (message) =>
              message.role === "user" &&
              typeof message.content === "string" &&
              message.content.startsWith("<system-update>"),
          ),
        )
        expect(updates).toContain("Live Monitor data follows")
        expect(updates).toContain("MONITOR_PLAN_EVENT")
        return reply().text("PLAN_ACCEPTED").stop().item()
      })
      yield* llm.respond((hit) => {
        const text = JSON.stringify(hit.body.messages)
        expect(text).toContain("Background shell completion data follows")
        expect(text).toContain("MONITOR_PLAN_END")
        return reply().text("PLAN_MONITOR_COMPLETED").stop().item()
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
      expect(tasks[0]).toMatchObject({
        background: true,
        status: "running",
        kind: "monitor",
        monitor: { persistent: true },
      })
      yield* Effect.promise(() => Bun.write(release, "release"))
      yield* pollWithTimeout(
        detail(parent, tasks[0].id).pipe(Effect.map((task) => (task.monitor?.accepted ? task : undefined))),
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
      yield* finished(parent, "PLAN_ACCEPTED")
      expect(yield* llm.calls).toBe(4)
      expect((yield* detail(parent, tasks[0].id)).status).toBe("running")
      yield* Effect.promise(() => Bun.write(path.join(instance.directory, "monitor.finish"), "finish"))
      const history = yield* finished(parent, "PLAN_MONITOR_COMPLETED")
      expect((yield* HttpClient.post(`/api/session/${parent}/wait`)).status).toBe(204)
      expect(yield* llm.calls).toBe(5)
      expect(yield* questions).toEqual([])
      expect(history.filter((message) => message.type === "user").map((message) => message.text)).toEqual([
        "Start a background shell, then request Plan approval",
      ])
      expect((yield* detail(parent, tasks[0].id)).output).toBe("MONITOR_PLAN_EVENT\nMONITOR_PLAN_END")
      expect((yield* HttpClient.post(`/api/session/${parent}/wait`)).status).toBe(204)
      expect(yield* llm.calls).toBe(5)
    }),
  30000,
)

it.instance(
  "managed Task child cannot start a native Monitor or publish a process receipt",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      const parent = yield* create(instance.directory)
      yield* llm.respond(() =>
        reply()
          .tool("task", {
            description: "Attempt nested monitor",
            prompt: "CHILD_MONITOR_DENIED",
            subagent_type: "helper",
          })
          .item(),
      )
      yield* llm.respond(() =>
        reply()
          .tool("monitor", {
            description: "Must not spawn",
            command: "printf ESCAPED > monitor-escape",
            persistent: true,
          })
          .item(),
      )
      yield* llm.respond((hit) => {
        expect(JSON.stringify(hit.body.messages)).toContain(
          "Background shell is unavailable to managed children and active Goals",
        )
        return reply().text("CHILD_DENIED").stop().item()
      })
      yield* llm.respond(() => reply().text("PARENT_DENIED_DONE").stop().item())
      expect(
        (yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Ask a child to attempt Monitor" } })).status,
      ).toBe(200)
      yield* finished(parent, "PARENT_DENIED_DONE")
      expect((yield* HttpClient.post(`/api/session/${parent}/wait`)).status).toBe(204)
      const tasks = yield* HttpClient.get(`/api/session/${parent}/task`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
      )
      expect(tasks).toHaveLength(1)
      expect(yield* list(parent)).toEqual([])
      expect(yield* list(tasks[0].id)).toEqual([])
      expect(yield* Effect.promise(() => Bun.file(path.join(instance.directory, "monitor-escape")).exists())).toBe(
        false,
      )
      expect(yield* llm.calls).toBe(4)
    }),
  30000,
)

import { expect } from "bun:test"
import { Task } from "@apexo/schema/task"
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
        goal: { summary_enabled: false },
        compaction: { auto: true, keep: { tokens: 0 }, buffer: 0 },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
        agents: {
          helper: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] },
          compacthelper: {
            mode: "subagent",
            model: "task-fixture/compact",
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
          },
        },
        providers: {
          "task-fixture": {
            api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: url, settings: { apiKey: "test" } },
            models: {
              compact: {
                name: "Compact Task model",
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 4000, output: 256 },
              },
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
  "Goal accounts native Task child and compaction receipts before further provider work",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      for (const scenario of [
        { agent: "helper", total: 11 },
        { agent: "compacthelper", total: 13 },
      ]) {
        const before = yield* llm.calls
        const created = yield* post("/api/session", {
          location: { directory: instance.directory },
          model: { providerID: "task-fixture", id: "model" },
          agent: "build",
        })
        expect(created.status).toBe(200)
        const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
        const root = `/api/session/${parent.id}`
        const goalID = `goal_${scenario.agent}`
        expect(
          (yield* post(`${root}/goal`, {
            id: goalID,
            objective: "Use a native Task to inspect the fixture",
            tokenBudget: 8,
          })).status,
        ).toBe(200)
        yield* llm.respond((hit) => {
          // Parse actual message text so report paths retain their exact escaping.
          const messages = hit.body.messages as { content: unknown }[]
          const text = messages
            .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
            .join("\n")
          const file = /PLAN_FILE=("[^"\n]+")/.exec(text)?.[1]
          if (!file) throw new Error("Missing actual Goal plan file")
          return reply()
            .tool("goal_report_write", {
              path: JSON.parse(file),
              content: "Delegate the bounded inspection and report evidence.",
            })
            .usage({ input: 1, output: 1 })
            .item()
        })
        yield* llm.text("Plan written", { usage: { input: 1, output: 1 } })
        yield* llm.respond(() =>
          reply()
            .tool("task", { description: "Budgeted child", prompt: "OWNED_GOAL_TASK", subagent_type: scenario.agent })
            .usage({ input: 1, output: 1 })
            .item(),
        )
        yield* llm.respond((hit) => {
          expect(JSON.stringify(hit.body.messages)).toContain("OWNED_GOAL_TASK")
          if (scenario.agent === "compacthelper") {
            expect(hit.body.tools ?? []).toEqual([])
            return reply()
              .text("## Objective\nContinue the bounded inspection.")
              .usage({ input: 3, output: 4 })
              .stop()
              .item()
          }
          return reply().text("CHILD_BUDGET_RECEIPT").usage({ input: 2, output: 3 }).stop().item()
        })
        expect(
          (yield* post(`${root}/goal/${goalID}/start`, {
            agent: "build",
            model: { providerID: "task-fixture", id: "model" },
          })).status,
        ).toBe(200)
        const goal = yield* pollWithTimeout(
          HttpClient.get(`${root}/goal`).pipe(
            Effect.flatMap((response) => response.json),
            Effect.flatMap(
              Schema.decodeUnknownEffect(Schema.Struct({ status: Schema.String, tokensUsed: Schema.Number })),
            ),
            Effect.map((goal) => (goal.status === "active" ? undefined : goal)),
          ),
          "Child usage did not stop the Goal",
          "20 seconds",
        )
        expect(goal).toEqual({ status: "budget_limited", tokensUsed: scenario.total })
        expect((yield* HttpClient.post(`${root}/wait`)).status).toBe(204)
        expect((yield* llm.calls) - before).toBe(4)
      }
    }),
  { git: true },
  30000,
)

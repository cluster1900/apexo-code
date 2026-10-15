import { expect } from "bun:test"
import { Task } from "@apexo/schema/task"
import { Goal } from "@apexo/schema/goal"
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
        task: { maxDepth: 2 },
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
  "Goal accounts nested Task descendants and compaction without duplicate receipts",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      for (const scenario of [
        { agent: "helper", total: 13 },
        { agent: "compacthelper", total: 15 },
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
            tokenBudget: 10,
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
            .tool("task", { description: "Budgeted child", prompt: "OWNED_GOAL_TASK", subagent_type: "helper" })
            .usage({ input: 1, output: 1 })
            .item(),
        )
        yield* llm.respond((hit) => {
          expect(JSON.stringify(hit.body.tools)).toContain('"task"')
          return reply()
            .tool("task", {
              description: "Nested budgeted child",
              prompt: "OWNED_GOAL_GRANDCHILD",
              subagent_type: scenario.agent,
            })
            .usage({ input: 1, output: 1 })
            .item()
        })
        yield* llm.respond((hit) => {
          expect(JSON.stringify(hit.body.messages)).toContain("OWNED_GOAL_GRANDCHILD")
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
              Schema.decodeUnknownEffect(Schema.Struct({ status: Goal.Status, tokensUsed: Schema.Number })),
            ),
            Effect.map((goal) => (goal.status === "active" ? undefined : goal)),
          ),
          "Child usage did not stop the Goal",
          "20 seconds",
        )
        expect(goal).toEqual({ status: "budget_limited", tokensUsed: scenario.total })
        expect((yield* HttpClient.post(`${root}/wait`)).status).toBe(204)
        expect((yield* llm.calls) - before).toBe(5)
      }
    }),
  { git: true },
  30000,
)

it.instance(
  "pausing a Goal joins nested foreground children and retains incomplete usage without late accounting",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
      const created = yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "task-fixture", id: "model" },
        agent: "build",
      })
      const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
      const root = `/api/session/${parent.id}`
      const goalID = "goal_nestedpause"
      expect(
        (yield* post(`${root}/goal`, { id: goalID, objective: "Pause nested work", tokenBudget: 100 })).status,
      ).toBe(200)
      yield* llm.respond((hit) => {
        const messages = hit.body.messages as { content: unknown }[]
        const text = messages
          .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
          .join("\n")
        const file = /PLAN_FILE=("[^"\n]+")/.exec(text)?.[1]
        if (!file) throw new Error("Missing actual Goal plan file")
        return reply()
          .tool("goal_report_write", { path: JSON.parse(file), content: "Delegate and stop safely." })
          .usage({ input: 1, output: 1 })
          .item()
      })
      yield* llm.text("Plan written", { usage: { input: 1, output: 1 } })
      yield* llm.respond(() =>
        reply()
          .tool("task", { description: "Child", prompt: "PAUSE_CHILD", subagent_type: "helper" })
          .usage({ input: 1, output: 1 })
          .item(),
      )
      yield* llm.respond(() =>
        reply()
          .tool("task", { description: "Grandchild", prompt: "PAUSE_GRANDCHILD", subagent_type: "helper" })
          .usage({ input: 1, output: 1 })
          .item(),
      )
      yield* llm.respond(() =>
        reply().text("LATE_GRANDCHILD").wait(gate.promise).usage({ input: 7, output: 8 }).stop().item(),
      )
      expect(
        (yield* post(`${root}/goal/${goalID}/start`, {
          agent: "build",
          model: { providerID: "task-fixture", id: "model" },
        })).status,
      ).toBe(200)
      yield* llm.wait(5)
      expect((yield* HttpClient.post(`${root}/goal/${goalID}/pause`)).status).toBe(200)
      expect((yield* HttpClient.post(`${root}/wait`)).status).toBe(204)
      const read = HttpClient.get(`${root}/goal`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.Struct({
              status: Goal.Status,
              tokensUsed: Schema.Number,
              usageIncomplete: Schema.optional(Schema.Boolean),
            }),
          ),
        ),
      )
      const paused = yield* read
      expect(paused).toEqual({ status: "user_paused", tokensUsed: 8, usageIncomplete: true })
      gate.resolve()
      expect(yield* read).toEqual(paused)
      expect(yield* llm.calls).toBe(5)
    }),
  { git: true },
  30_000,
)

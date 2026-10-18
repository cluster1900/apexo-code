import { expect } from "bun:test"
import { Config, Effect, Fiber, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { SessionMessage } from "@apexo/core/session/message"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { TestInstance } from "../fixture/fixture"
import { reply, TestLLMServer } from "../lib/llm-server"
import { pollWithTimeout, testEffect } from "../lib/effect"
import path from "path"

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
const post = (url: string, body?: unknown) =>
  body === undefined
    ? HttpClient.execute(HttpClientRequest.post(url))
    : HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))

it.instance(
  "manual compaction owns one summary stream, preserves pending input, requires finish, and cancels safely",
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
            compaction: { auto: false },
            providers: {
              "v2-test": {
                name: "Compaction provider",
                api: {
                  type: "aisdk",
                  package: "@ai-sdk/openai-compatible",
                  url: llm.url,
                  settings: { apiKey: "test" },
                },
                models: {
                  "test-model": {
                    name: "Test",
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 100000, output: 4096 },
                  },
                },
              },
            },
          }),
        ),
      )
      const created = yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "v2-test", id: "test-model" },
      })
      expect(created.status).toBe(200)
      const root = `/api/session/${(yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data.id}`
      const messages = HttpClient.get(`${root}/message`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
        Effect.map((response) => response.data),
      )
      expect((yield* post(`${root}/compact`)).status).toBe(204)
      expect(yield* llm.calls).toBe(0)
      const admitted = { id: "msg_compact_seed", prompt: { text: "Preserve the apricot decision" }, resume: false }
      expect((yield* post(`${root}/prompt`, admitted)).status).toBe(200)
      expect((yield* post(`${root}/compact`)).status).toBe(204)
      expect(yield* messages).toEqual([])
      expect(yield* llm.calls).toBe(0)
      yield* llm.text("The decision is apricot")
      expect((yield* post(`${root}/prompt`, { ...admitted, resume: true })).status).toBe(200)
      const waited = yield* post(`${root}/wait`)
      if (waited.status !== 204) console.error(yield* waited.text)
      expect(waited.status).toBe(204)
      const before = yield* messages
      expect(before.filter((message) => message.type === "user")).toHaveLength(1)
      expect(yield* llm.calls).toBe(1)
      expect(
        (yield* post(`${root}/prompt`, {
          id: "msg_compact_queue",
          prompt: { text: "PENDING_SECRET" },
          delivery: "queue",
          resume: false,
        })).status,
      ).toBe(200)
      yield* llm.text("## Objective\nPreserve apricot.")
      expect((yield* post(`${root}/compact`)).status).toBe(204)
      expect(yield* llm.calls).toBe(2)
      const compacted = yield* messages
      expect(compacted.filter((message) => message.type === "user")).toHaveLength(1)
      expect(compacted.filter((message) => message.type === "assistant")).toHaveLength(1)
      expect(compacted.find((message) => message.type === "compaction")).toMatchObject({
        reason: "manual",
        summary: "## Objective\nPreserve apricot.",
      })
      const request = (yield* llm.hits)[1].body
      expect(JSON.stringify(request)).toContain("apricot")
      expect(JSON.stringify(request)).not.toContain("PENDING_SECRET")
      expect(request.tools ?? []).toEqual([])

      yield* llm.push(reply().text("INCOMPLETE_SUMMARY").item())
      expect((yield* post(`${root}/compact`)).status).toBe(503)
      expect(yield* messages).toEqual(compacted)
      expect(yield* llm.calls).toBe(3)

      yield* llm.push(reply().text("REJECTED_SUMMARY").contentFilter().item())
      expect((yield* post(`${root}/compact`)).status).toBe(503)
      expect(yield* messages).toEqual(compacted)
      expect(yield* llm.calls).toBe(4)

      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
      yield* llm.hold("CANCELLED_SUMMARY", gate.promise)
      const compact = yield* post(`${root}/compact`).pipe(Effect.exit, Effect.forkChild)
      yield* llm.wait(5)
      expect((yield* post(`${root}/interrupt`)).status).toBe(204)
      gate.resolve()
      yield* Fiber.join(compact)
      expect((yield* post(`${root}/wait`)).status).toBe(204)
      expect(yield* messages).toEqual(compacted)
      expect(yield* llm.calls).toBe(5)

      expect(
        (yield* post(`${root}/goal`, { id: "goal_compactidle", objective: "Remain active until explicitly started" }))
          .status,
      ).toBe(200)
      expect((yield* post(`${root}/compact`)).status).toBe(503)
      expect(yield* llm.calls).toBe(5)
      expect(yield* messages).toEqual(compacted)

      const budgetCreated = yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "v2-test", id: "test-model" },
        agent: "build",
      })
      const budgetRoot = `/api/session/${(yield* Schema.decodeUnknownEffect(SessionResponse)(yield* budgetCreated.json)).data.id}`
      expect(
        (yield* post(`${budgetRoot}/goal`, {
          id: "goal_compactbudget",
          objective: "Verify the apricot decision",
          tokenBudget: 8,
        })).status,
      ).toBe(200)
      yield* llm.respond((hit) => {
        const messages = hit.body.messages as { content: unknown }[]
        const text = messages
          .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
          .join("\n")
        const file = /PLAN_FILE=("[^"\n]+")/.exec(text)?.[1]
        if (!file) throw new Error("Missing Goal plan file")
        return reply()
          .tool("goal_report_write", {
            path: JSON.parse(file),
            content: "Check the original decision and report the result.",
          })
          .usage({ input: 1, output: 1 })
          .item()
      })
      yield* llm.text("Plan written", { usage: { input: 1, output: 1 } })
      const workerGate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => workerGate.resolve()))
      yield* llm.push(
        reply()
          .text("The apricot decision is verified.")
          .usage({ input: 1, output: 1 })
          .wait(workerGate.promise)
          .stop(),
      )
      yield* llm.text("## Objective\nApricot decision verified.", { usage: { input: 3, output: 4 } })
      expect(
        (yield* post(`${budgetRoot}/goal/goal_compactbudget/start`, {
          agent: "build",
          model: { providerID: "v2-test", id: "test-model" },
        })).status,
      ).toBe(200)
      yield* llm.wait(8)
      const budgetCompact = yield* post(`${budgetRoot}/compact`).pipe(Effect.forkChild)
      // The compaction control must be queued before the held worker turn ends; otherwise the Goal's
      // completion evaluator runs first and adds an LLM call. The queue is not observable over HTTP,
      // and 30ms was not enough on loaded runners; the worker stays held, so waiting longer is safe.
      yield* Effect.sleep("1 second")
      workerGate.resolve()
      expect((yield* Fiber.join(budgetCompact)).status).toBe(204)
      const budget = yield* pollWithTimeout(
        HttpClient.get(`${budgetRoot}/goal`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(
            Schema.decodeUnknownEffect(Schema.Struct({ status: Schema.String, tokensUsed: Schema.Number })),
          ),
          Effect.map((goal) => (goal.status === "active" ? undefined : goal)),
        ),
        "Compaction usage did not stop the Goal",
        "10 seconds",
      )
      expect(budget).toEqual({ status: "budget_limited", tokensUsed: 13 })
      expect((yield* post(`${budgetRoot}/wait`)).status).toBe(204)
      expect(yield* llm.calls).toBe(9)
    }),
  { git: true },
  30000,
)

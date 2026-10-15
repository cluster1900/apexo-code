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
        task: { maxDepth: 2 },
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
  "native nested foreground uses direct-parent authority and stops at its captured depth",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      const created = yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "task-fixture", id: "model" },
        agent: "build",
      })
      expect(created.status).toBe(200)
      const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
      yield* llm.respond(() =>
        reply().tool("task", { description: "Child", prompt: "NESTED_CHILD", subagent_type: "helper" }).item(),
      )
      yield* llm.respond((hit) => {
        expect(JSON.stringify(hit.body.tools)).toContain('"task"')
        return reply()
          .tool("task", {
            description: "Forbidden background",
            prompt: "MUST_NOT_RUN_BACKGROUND",
            subagent_type: "helper",
            background: true,
          })
          .item()
      })
      yield* llm.respond((hit) => {
        const results = (hit.body.messages as { role: string; content: unknown }[]).filter(
          (message) => message.role === "tool",
        )
        expect(JSON.stringify(results)).toContain("foreground execution")
        return reply()
          .tool("task", { description: "Grandchild", prompt: "NESTED_GRANDCHILD", subagent_type: "helper" })
          .item()
      })
      yield* llm.respond((hit) => {
        expect(JSON.stringify(hit.body.tools)).not.toContain('"task"')
        return reply()
          .tool("task", { description: "Too deep", prompt: "MUST_NOT_RUN_DEEPER", subagent_type: "helper" })
          .item()
      })
      yield* llm.respond((hit) => {
        const results = (hit.body.messages as { role: string; content: unknown }[]).filter(
          (message) => message.role === "tool",
        )
        expect(JSON.stringify(results)).toContain("unavailable")
        return reply().text("GRANDCHILD_RESULT").stop().item()
      })
      yield* llm.respond((hit) => {
        const results = (hit.body.messages as { role: string; content: unknown }[]).filter(
          (message) => message.role === "tool",
        )
        expect(JSON.stringify(results)).toContain("GRANDCHILD_RESULT")
        return reply().text("CHILD_RESULT").stop().item()
      })
      yield* llm.text("NESTED_ROOT_DONE")
      expect(
        (yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Delegate nested work" } })).status,
      ).toBe(200)
      yield* pollWithTimeout(
        HttpClient.get(`/api/session/${parent.id}/message?order=asc`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
          Effect.map(
            (response) =>
              response.data.some(
                (message) =>
                  message.type === "assistant" &&
                  message.time.completed &&
                  message.content.some((part) => part.type === "text" && part.text === "NESTED_ROOT_DONE"),
              ) || undefined,
          ),
        ),
        "Nested root did not finish",
        "20 seconds",
      )
      const children = yield* HttpClient.get(`/api/session/${parent.id}/task`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
      )
      expect(children).toHaveLength(1)
      const child = children[0]!
      const grandchildren = yield* HttpClient.get(`/api/session/${child.id}/task`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
      )
      expect(grandchildren).toHaveLength(1)
      const grandchild = grandchildren[0]!
      expect((yield* HttpClient.get(`/api/session/${parent.id}/task/${grandchild.id}`)).status).toBe(404)
      expect((yield* post(`/api/session/${grandchild.id}/prompt`, { prompt: { text: "NOT_AUTHORIZED" } })).status).toBe(
        409,
      )
      expect(yield* llm.calls).toBe(7)
    }),
  { git: true },
  30_000,
)

it.instance(
  "deletion joins a held grandchild and prevents late writes after all IDs are reused",
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
      yield* llm.respond(() =>
        reply().tool("task", { description: "Child", prompt: "HELD_CHAIN_CHILD", subagent_type: "helper" }).item(),
      )
      yield* llm.respond(() =>
        reply()
          .tool("task", { description: "Grandchild", prompt: "HELD_CHAIN_GRANDCHILD", subagent_type: "helper" })
          .item(),
      )
      yield* llm.respond(() => reply().text("LATE_CHAIN_RESULT").wait(gate.promise).stop().item())
      yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Start nested chain" } })
      yield* llm.wait(3)
      const children = yield* HttpClient.get(`/api/session/${parent.id}/task`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
      )
      expect(children).toHaveLength(1)
      const grandchildren = yield* HttpClient.get(`/api/session/${children[0]!.id}/task`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
      )
      expect(grandchildren).toHaveLength(1)
      expect(
        (yield* post(`/api/session/${children[0]!.id}/task/${grandchildren[0]!.id}/wait`, { timeoutMs: 0 })).status,
      ).toBe(200)
      expect(yield* llm.calls).toBe(3)
      expect((yield* HttpClient.del(`/api/session/${parent.id}`)).status).toBe(204)
      for (const id of [parent.id, children[0]!.id, grandchildren[0]!.id]) {
        expect((yield* HttpClient.get(`/api/session/${id}`)).status).toBe(404)
        expect(
          (yield* post("/api/session", {
            id,
            location: { directory: instance.directory },
            model: { providerID: "task-fixture", id: "model" },
            agent: "build",
          })).status,
        ).toBe(200)
      }
      gate.resolve()
      yield* llm.text("NEW_ROOT_RESULT")
      yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "New root" } })
      yield* pollWithTimeout(
        HttpClient.get(`/api/session/${parent.id}/message?order=asc`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
          Effect.map(
            (response) =>
              response.data.some(
                (message) =>
                  message.type === "assistant" &&
                  message.time.completed &&
                  message.content.some((part) => part.type === "text" && part.text === "NEW_ROOT_RESULT"),
              ) || undefined,
          ),
        ),
        "New root did not finish",
        "20 seconds",
      )
      for (const id of [children[0]!.id, grandchildren[0]!.id]) {
        const history = yield* HttpClient.get(`/api/session/${id}/message?order=asc`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
        )
        expect(history.data).toEqual([])
      }
      expect(yield* llm.calls).toBe(4)
    }),
  { git: true },
  30_000,
)

it.instance(
  "nested foreground inherits headless consent and parent hard denies through both child levels",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      const configuration = yield* Effect.promise(() => Bun.file(path.join(instance.directory, "apexo.json")).json())
      yield* Effect.promise(() =>
        Bun.write(
          path.join(instance.directory, "apexo.json"),
          JSON.stringify({
            ...configuration,
            permissions: [
              { action: "*", resource: "*", effect: "allow" },
              { action: "bash", resource: "*", effect: "deny" },
            ],
          }),
        ),
      )
      const created = yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "task-fixture", id: "model" },
        agent: "build",
      })
      const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
      yield* llm.respond(() =>
        reply().tool("task", { description: "Child", prompt: "HEADLESS_CHILD", subagent_type: "helper" }).item(),
      )
      yield* llm.respond(() =>
        reply()
          .tool("task", { description: "Grandchild", prompt: "HEADLESS_GRANDCHILD", subagent_type: "helper" })
          .item(),
      )
      yield* llm.respond((hit) => {
        // Catalog visibility follows the selected agent; inherited authority is enforced by the Bash leaf.
        expect(JSON.stringify(hit.body.tools)).toContain('"bash"')
        return reply().tool("bash", { command: "touch nested-denied-marker", description: "Forbidden write" }).item()
      })
      yield* llm.respond((hit) => {
        const results = (hit.body.messages as { role: string; content: unknown }[]).filter(
          (message) => message.role === "tool",
        )
        expect(JSON.stringify(results)).toMatch(/denied|unavailable|not allowed/i)
        return reply().text("DENIED_GRANDCHILD_DONE").stop().item()
      })
      yield* llm.text("DENIED_CHILD_DONE")
      yield* llm.text("HEADLESS_NESTED_DONE")
      expect(
        (yield* post(`/api/session/${parent.id}/prompt`, {
          prompt: { text: "Respect hard denies" },
          executionPolicy: { mode: "headless", permissions: "approve_once" },
        })).status,
      ).toBe(200)
      yield* pollWithTimeout(
        HttpClient.get(`/api/session/${parent.id}/message?order=asc`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
          Effect.map(
            (response) =>
              response.data.some(
                (message) =>
                  message.type === "assistant" &&
                  message.time.completed &&
                  message.content.some((part) => part.type === "text" && part.text === "HEADLESS_NESTED_DONE"),
              ) || undefined,
          ),
        ),
        "Headless nested root did not finish",
        "20 seconds",
      )
      expect(
        yield* Effect.promise(() => Bun.file(path.join(instance.directory, "nested-denied-marker")).exists()),
      ).toBe(false)
      expect(yield* llm.calls).toBe(6)
    }),
  { git: true },
  30_000,
)

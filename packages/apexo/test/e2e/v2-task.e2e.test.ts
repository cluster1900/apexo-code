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

it.instance("canonical native Task follows up the same child and reads its durable receipt", () =>
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
    const child = { id: "" }
    yield* llm.respond((hit) => {
      expect(JSON.stringify(hit.body.tools)).toContain('"task"')
      return reply()
        .tool("task", { description: "First child", prompt: "CHILD_INITIAL", subagent_type: "helper" })
        .item()
    })
    yield* llm.respond((hit) => {
      expect(JSON.stringify(hit.body.messages)).toContain("CHILD_INITIAL")
      expect(JSON.stringify(hit.body.tools)).not.toContain('"task"')
      expect(JSON.stringify(hit.body.tools)).not.toContain('"workflow"')
      return reply().text("CHILD_FIRST_RESULT").usage({ input: 2, output: 3 }).stop().item()
    })
    yield* llm.respond((hit) => {
      const text = JSON.stringify(hit.body.messages)
      expect(text).toContain("CHILD_FIRST_RESULT")
      child.id = text.match(/ses_[a-f0-9]{64}/)?.[0] ?? ""
      expect(child.id).not.toBe("")
      return reply()
        .tool("task", {
          description: "Follow up",
          prompt: "CHILD_FOLLOWUP",
          subagent_type: "helper",
          task_id: child.id,
        })
        .item()
    })
    yield* llm.respond((hit) => {
      expect(JSON.stringify(hit.body.messages)).toContain("CHILD_FIRST_RESULT")
      expect(JSON.stringify(hit.body.messages)).toContain("CHILD_FOLLOWUP")
      return reply().text("CHILD_FINAL_RESULT").usage({ input: 4, output: 5 }).stop().item()
    })
    yield* llm.respond(() => reply().tool("task_output", { task_id: child.id }).item())
    yield* llm.respond((hit) => {
      expect(JSON.stringify(hit.body.messages)).toContain("CHILD_FINAL_RESULT")
      return reply().text("PARENT_TASK_DONE").stop().item()
    })
    expect(
      (yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Run child and follow up" }, resume: true }))
        .status,
    ).toBe(200)
    const messages = yield* pollWithTimeout(
      HttpClient.get(`/api/session/${parent.id}/message`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
        Effect.map((response) =>
          response.data.some(
            (message) =>
              message.type === "assistant" &&
              message.time.completed &&
              message.content.some((part) => part.type === "text" && part.text === "PARENT_TASK_DONE"),
          )
            ? response.data
            : undefined,
        ),
      ),
      "Task parent did not finish",
      "20 seconds",
    )
    const settled = messages.flatMap((message) =>
      message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
    )
    expect(settled.map((tool) => tool.state.status)).toEqual(["completed", "completed", "completed"])
    expect(yield* llm.calls).toBe(6)
    const history = yield* HttpClient.get(`/api/session/${child.id}/message?order=asc`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
    )
    expect(history.data.filter((message) => message.type === "user").map((message) => message.text)).toEqual([
      "CHILD_INITIAL",
      "CHILD_FOLLOWUP",
    ])
    expect(history.data.filter((message) => message.type === "assistant")).toHaveLength(2)
    expect(
      (yield* post(`/api/session/${child.id}/prompt`, {
        prompt: { text: "Direct input must be rejected" },
        resume: true,
      })).status,
    ).toBe(409)
    expect((yield* HttpClient.post(`/api/session/${child.id}/wait`)).status).toBe(204)
    expect(yield* llm.calls).toBe(6)
    expect((yield* readMessages(child.id)).data.filter((message) => message.type === "user")).toHaveLength(2)
    yield* llm.respond(() =>
      reply()
        .tool("task", {
          description: "After rejection",
          prompt: "VALID_AFTER_REJECTION",
          subagent_type: "helper",
          task_id: child.id,
        })
        .item(),
    )
    yield* llm.respond((hit) => {
      expect(JSON.stringify(hit.body.messages)).not.toContain("Direct input must be rejected")
      expect(JSON.stringify(hit.body.messages)).toContain("VALID_AFTER_REJECTION")
      return reply().text("CHILD_AFTER_REJECTION").stop().item()
    })
    yield* llm.text("FOLLOWUP_AFTER_REJECTION_DONE")
    yield* post(`/api/session/${parent.id}/prompt`, {
      prompt: { text: "Continue the same child after rejected direct input" },
    })
    yield* finished(parent.id, "FOLLOWUP_AFTER_REJECTION_DONE")
    expect(
      (yield* readMessages(child.id)).data.filter((message) => message.type === "user").map((message) => message.text),
    ).toEqual(["CHILD_INITIAL", "CHILD_FOLLOWUP", "VALID_AFTER_REJECTION"])
    expect(yield* llm.calls).toBe(9)
  }),
)

const SessionsResponse = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String, parentID: Schema.optional(Schema.String) })),
})
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

it.instance("native Task invalid agent creates no child or child provider work", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    yield* configure(instance.directory, llm.url)
    for (const input of [{ description: "Invalid", prompt: "Do not execute", subagent_type: "missing" }]) {
      const created = yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "task-fixture", id: "model" },
        agent: "build",
      })
      const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
      yield* llm.respond(() => reply().tool("task", input).item())
      yield* llm.respond((hit) => {
        expect(JSON.stringify(hit.body.messages)).toContain("Requested subagent is unavailable")
        return reply().text("EXPECTED_TASK_REJECTION").stop().item()
      })
      yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Try the explicitly unavailable Task" } })
      const messages = yield* finished(parent.id, "EXPECTED_TASK_REJECTION")
      expect(
        messages
          .flatMap((message) =>
            message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
          )
          .map((tool) => tool.state.status),
      ).toEqual(["error"])
      const listed = yield* HttpClient.get("/api/session").pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(SessionsResponse)),
      )
      expect(listed.data.filter((session) => session.parentID === parent.id)).toEqual([])
    }
    expect(yield* llm.calls).toBe(2)
  }),
)

it.instance("deleting a parent joins its held native Task before ID reuse and late response", () =>
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
      reply().tool("task", { description: "Held", prompt: "HELD_CHILD", subagent_type: "helper" }).item(),
    )
    yield* llm.respond(() => reply().text("LATE_OLD_CHILD").wait(gate.promise).stop().item())
    yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Start the held Task" } })
    yield* llm.wait(2)
    const listed = yield* HttpClient.get("/api/session").pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(SessionsResponse)),
    )
    const child = listed.data.find((session) => session.parentID === parent.id)
    expect(child).toBeDefined()
    expect((yield* HttpClient.del(`/api/session/${parent.id}`)).status).toBe(204)
    expect((yield* HttpClient.get(`/api/session/${child!.id}`)).status).toBe(404)
    expect(
      (yield* post("/api/session", {
        id: parent.id,
        location: { directory: instance.directory },
        model: { providerID: "task-fixture", id: "model" },
        agent: "build",
      })).status,
    ).toBe(200)
    expect(
      (yield* post("/api/session", {
        id: child!.id,
        location: { directory: instance.directory },
        model: { providerID: "task-fixture", id: "model" },
        agent: "build",
      })).status,
    ).toBe(200)
    gate.resolve()
    yield* llm.text("NEW_INCARNATION_RESULT")
    yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "New user work" } })
    const history = yield* finished(parent.id, "NEW_INCARNATION_RESULT")
    expect(JSON.stringify(history)).not.toContain("LATE_OLD_CHILD")
    expect((yield* readMessages(child!.id)).data).toEqual([])
    expect(yield* llm.calls).toBe(3)
  }),
)

it.instance("native Task management waits without waking and cancels the exact owned child", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    yield* configure(instance.directory, llm.url)
    const create = () =>
      post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "task-fixture", id: "model" },
        agent: "build",
      }).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(SessionResponse)),
        Effect.map((response) => response.data),
      )
    const parent = yield* create()
    const foreign = yield* create()
    const gate = Promise.withResolvers<void>()
    yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
    yield* llm.respond(() =>
      reply()
        .tool("task", { description: "Held owned task", prompt: "HELD_MANAGED_CHILD", subagent_type: "helper" })
        .item(),
    )
    yield* llm.push(reply().text("LATE_CHILD_MUST_NOT_SETTLE").wait(gate.promise).stop())
    yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Start a held Task" } })
    yield* llm.wait(2)
    const root = `/api/session/${parent.id}/task`
    const response = yield* HttpClient.get(root)
    expect(response.status).toBe(200)
    const raw = yield* response.json
    const listed = yield* Schema.decodeUnknownEffect(Schema.Array(Task.Summary))(raw)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ parentSessionID: parent.id, description: "Held owned task", status: "running" })
    expect(JSON.stringify(raw)).not.toContain("authority")
    expect(JSON.stringify(raw)).not.toContain("output")
    const child = listed[0].id
    expect((yield* HttpClient.get(`${root}?limit=0`)).status).toBe(400)
    expect((yield* HttpClient.get(`${root}?limit=101`)).status).toBe(400)
    expect((yield* HttpClient.get(`${root}/ses_missing`)).status).toBe(404)
    expect((yield* HttpClient.get(`/api/session/${foreign.id}/task/${child}`)).status).toBe(404)
    expect((yield* HttpClient.post(`/api/session/${foreign.id}/task/${child}/cancel`)).status).toBe(404)
    const waited = yield* post(`${root}/${child}/wait`, { timeoutMs: 0 })
    expect(waited.status).toBe(200)
    expect(yield* Schema.decodeUnknownEffect(Task.WaitResult)(yield* waited.json)).toMatchObject({
      timedOut: true,
      task: { id: child, status: "running" },
    })
    expect(yield* llm.calls).toBe(2)
    yield* llm.respond((hit) => {
      expect(JSON.stringify(hit.body.messages)).toContain("cancelled")
      return reply().text("PARENT_AFTER_CANCEL").stop().item()
    })
    const controls = yield* Effect.all(
      [
        HttpClient.post(`${root}/${child}/cancel`),
        HttpClient.post(`${root}/${child}/cancel`),
        post(`${root}/${child}/wait`, { timeoutMs: 1000 }),
      ],
      { concurrency: "unbounded" },
    )
    expect(controls.map((response) => response.status)).toEqual([204, 204, 200])
    expect(yield* Schema.decodeUnknownEffect(Task.WaitResult)(yield* controls[2].json)).toMatchObject({
      timedOut: false,
      task: { status: "cancelled" },
    })

    const detail = yield* HttpClient.get(`${root}/${child}`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Task.Detail)),
    )
    expect(detail.status).toBe("cancelled")
    expect(detail.completedAt).toBeDefined()
    const settled = yield* post(`${root}/${child}/wait`, { timeoutMs: 0 }).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Task.WaitResult)),
    )
    expect(settled.timedOut).toBe(false)
    expect(settled.task).toEqual(detail)
    expect((yield* HttpClient.post(`${root}/${child}/cancel`)).status).toBe(204)
    gate.resolve()
    yield* finished(parent.id, "PARENT_AFTER_CANCEL")
    expect(yield* llm.calls).toBe(3)
    expect(
      yield* HttpClient.get(`${root}/${child}`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Task.Detail)),
      ),
    ).toEqual(detail)
  }),
)

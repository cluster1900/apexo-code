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
  HttpClient.get(`/api/session/${parent}/task`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
  )
const detail = (parent: string, child: string) =>
  HttpClient.get(`/api/session/${parent}/task/${child}`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(Task.Detail)),
  )
const parentRequest = (hit: { body: Record<string, unknown> }) => JSON.stringify(hit.body.tools).includes('"task"')

for (const active of [false, true])
  it.instance(`native background Task delivers once after ${active ? "active" : "idle"} parent settles`, () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      const childGate = Promise.withResolvers<void>()
      const parentGate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          childGate.resolve()
          parentGate.resolve()
        }),
      )
      const parent = yield* create(instance.directory)
      yield* llm.respond(
        () =>
          reply()
            .tool("task", {
              description: "Independent child",
              prompt: "BACKGROUND_CHILD",
              subagent_type: "helper",
              background: true,
            })
            .item(),
        parentRequest,
      )
      yield* llm.respond(
        () => reply().text("BACKGROUND_RESULT").wait(childGate.promise).stop().item(),
        (hit) => !parentRequest(hit),
      )
      const runningReplies: string[] = []
      yield* llm.respond((hit) => {
        runningReplies.push(JSON.stringify(hit.body.messages))
        return active
          ? reply().text("PARENT_INITIAL").wait(parentGate.promise).stop().item()
          : reply().text("PARENT_INITIAL").stop().item()
      }, parentRequest)
      yield* llm.respond((hit) => {
        const text = JSON.stringify(hit.body.messages)
        expect(text).toContain("Background Task completion data follows")
        expect(text).toContain("BACKGROUND_RESULT")
        return reply().text("PARENT_COMPLETION_DELIVERED").stop().item()
      }, parentRequest)
      expect(
        (yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Start independent work" }, resume: true }))
          .status,
      ).toBe(200)
      yield* llm.wait(3).pipe(Effect.timeout("8 seconds"))
      expect(runningReplies[0]).toContain("running")
      const tasks = yield* list(parent)
      expect(tasks).toHaveLength(1)
      expect(tasks[0]).toMatchObject({ background: true, status: "running" })
      if (!active) yield* finished(parent, "PARENT_INITIAL")
      childGate.resolve()
      yield* pollWithTimeout(
        detail(parent, tasks[0].id).pipe(Effect.map((value) => (value.status === "completed" ? value : undefined))),
        "Child did not settle",
        "10 seconds",
      )
      if (active) {
        yield* Effect.sleep("50 millis")
        expect(yield* llm.calls).toBe(3)
        parentGate.resolve()
      }
      const history = yield* finished(parent, "PARENT_COMPLETION_DELIVERED")
      expect(history.filter((message) => message.type === "user").map((message) => message.text)).toEqual([
        "Start independent work",
      ])
      expect((yield* detail(parent, tasks[0].id)).output).toBe("BACKGROUND_RESULT")
      expect((yield* HttpClient.post(`/api/session/${parent}/wait`)).status).toBe(204)
      expect(yield* llm.calls).toBe(4)
      expect((yield* list(parent))[0].status).toBe("completed")
      expect(yield* llm.calls).toBe(4)
    }),
  )

for (const cancel of [false, true])
  it.instance(
    `native background Task ${cancel ? "cancel" : "blocking model wait"} suppresses duplicate completion`,
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const llm = yield* TestLLMServer
        yield* configure(instance.directory, llm.url)
        const gate = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
        const parent = yield* create(instance.directory)
        yield* llm.respond(
          () =>
            reply()
              .tool("task", {
                description: "Observed child",
                prompt: "OBSERVED_CHILD",
                subagent_type: "helper",
                background: true,
              })
              .item(),
          parentRequest,
        )
        yield* llm.respond(
          () => reply().text("OBSERVED_RESULT").wait(gate.promise).stop().item(),
          (hit) => !parentRequest(hit),
        )
        yield* llm.respond((hit) => {
          const child = JSON.stringify(hit.body.messages).match(/ses_[a-f0-9]{64}/)?.[0]
          expect(child).toBeDefined()
          return reply()
            .tool(cancel ? "task_cancel" : "task_wait", { task_id: child, timeout_ms: 10000 })
            .item()
        }, parentRequest)
        yield* llm.respond((hit) => {
          const text = JSON.stringify(hit.body.messages)
          expect(text).toContain(cancel ? "cancelled" : "OBSERVED_RESULT")
          expect(text).not.toContain("Background Task completion data follows")
          return reply().text("PARENT_OBSERVED").stop().item()
        }, parentRequest)
        yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Start then observe child" } })
        yield* llm.wait(3).pipe(Effect.timeout("8 seconds"))
        if (!cancel) gate.resolve()
        yield* finished(parent, "PARENT_OBSERVED")
        gate.resolve()
        expect((yield* HttpClient.post(`/api/session/${parent}/wait`)).status).toBe(204)
        expect(yield* llm.calls).toBe(4)
        const tasks = yield* list(parent)
        expect(tasks[0].status).toBe(cancel ? "cancelled" : "completed")
        expect((yield* readMessages(parent)).data.filter((message) => message.type === "user")).toHaveLength(1)
      }),
  )

it.instance("accepted parent Stop suppresses a late background completion without replaying provider work", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    yield* configure(instance.directory, llm.url)
    const childGate = Promise.withResolvers<void>()
    const parentGate = Promise.withResolvers<void>()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        childGate.resolve()
        parentGate.resolve()
      }),
    )
    const parent = yield* create(instance.directory)
    yield* llm.respond(
      () =>
        reply()
          .tool("task", {
            description: "Late result",
            prompt: "LATE_BACKGROUND",
            subagent_type: "helper",
            background: true,
          })
          .item(),
      parentRequest,
    )
    yield* llm.respond(
      () => reply().text("LATE_BACKGROUND_RESULT").wait(childGate.promise).stop().item(),
      (hit) => !parentRequest(hit),
    )
    yield* llm.respond(() => reply().text("HELD_PARENT").wait(parentGate.promise).stop().item(), parentRequest)
    yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Work until stopped" } })
    yield* llm.wait(3).pipe(Effect.timeout("8 seconds"))
    const child = (yield* list(parent))[0].id
    expect((yield* HttpClient.post(`/api/session/${parent}/interrupt`)).status).toBe(204)
    parentGate.resolve()
    childGate.resolve()
    const result = yield* pollWithTimeout(
      detail(parent, child).pipe(Effect.map((value) => (value.status === "completed" ? value : undefined))),
      "Stopped parent child did not settle",
      "10 seconds",
    )
    expect(result.output).toBe("LATE_BACKGROUND_RESULT")
    yield* Effect.sleep("50 millis")
    expect((yield* HttpClient.post(`/api/session/${parent}/wait`)).status).toBe(204)
    expect(yield* llm.calls).toBe(3)
    expect(JSON.stringify((yield* readMessages(parent)).data)).not.toContain("Background Task completion data follows")
  }),
)

it.instance("deleting an idle parent joins its independent child and fences reused Session IDs", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    yield* configure(instance.directory, llm.url)
    const gate = Promise.withResolvers<void>()
    yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
    const parent = yield* create(instance.directory)
    yield* llm.respond(
      () =>
        reply()
          .tool("task", {
            description: "Delete owned child",
            prompt: "DELETE_BACKGROUND",
            subagent_type: "helper",
            background: true,
          })
          .item(),
      parentRequest,
    )
    yield* llm.respond(
      () => reply().text("DELETED_CHILD_RESULT").wait(gate.promise).stop().item(),
      (hit) => !parentRequest(hit),
    )
    yield* llm.respond(() => reply().text("PARENT_ALREADY_IDLE").stop().item(), parentRequest)
    yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Start independently" } })
    yield* finished(parent, "PARENT_ALREADY_IDLE")
    const child = (yield* list(parent))[0].id
    expect((yield* HttpClient.del(`/api/session/${parent}`)).status).toBe(204)
    expect((yield* HttpClient.get(`/api/session/${child}`)).status).toBe(404)
    for (const id of [parent, child])
      expect(
        (yield* post("/api/session", {
          id,
          location: { directory: instance.directory },
          model: { providerID: "task-fixture", id: "model" },
          agent: "build",
        })).status,
      ).toBe(200)
    gate.resolve()
    yield* llm.respond(() => reply().text("NEW_PARENT_RESULT").stop().item(), parentRequest)
    yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "New incarnation" } })
    const history = yield* finished(parent, "NEW_PARENT_RESULT")
    expect(JSON.stringify(history)).not.toContain("DELETED_CHILD_RESULT")
    expect((yield* readMessages(child)).data).toEqual([])
    expect(yield* list(parent)).toEqual([])
    expect(yield* llm.calls).toBe(4)
  }),
)

it.instance("a failed background child delivers one bounded failure notice at the ordinary parent boundary", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    yield* configure(instance.directory, llm.url)
    const parent = yield* create(instance.directory)
    yield* llm.respond(
      () =>
        reply()
          .tool("task", {
            description: "Failed child",
            prompt: "FAILED_BACKGROUND",
            subagent_type: "helper",
            background: true,
          })
          .item(),
      parentRequest,
    )
    yield* llm.respond(
      () => ({ type: "http-error", status: 400, body: { error: { message: "Invalid fixture request" } } }),
      (hit) => !parentRequest(hit),
    )
    yield* llm.respond(() => reply().text("PARENT_INITIAL").stop().item(), parentRequest)
    yield* llm.respond((hit) => {
      expect(JSON.stringify(hit.body.messages)).toContain("Background Task completion data follows")
      expect(JSON.stringify(hit.body.messages)).toContain("failed")
      return reply().text("PARENT_FAILURE_NOTICED").stop().item()
    }, parentRequest)
    yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Start independent failure" } })
    yield* finished(parent, "PARENT_FAILURE_NOTICED")
    expect((yield* list(parent))[0].status).toBe("failed")
    expect((yield* HttpClient.post(`/api/session/${parent}/wait`)).status).toBe(204)
    expect(yield* llm.calls).toBe(4)
  }),
)

it.instance("a settled background Task can follow up the same owned child in foreground mode", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    yield* configure(instance.directory, llm.url)
    const parent = yield* create(instance.directory)
    yield* llm.respond(
      () =>
        reply()
          .tool("task", {
            description: "Background first",
            prompt: "BACKGROUND_FIRST",
            subagent_type: "helper",
            background: true,
          })
          .item(),
      parentRequest,
    )
    yield* llm.respond(
      () => reply().text("FIRST_BACKGROUND_RESULT").stop().item(),
      (hit) => !parentRequest(hit),
    )
    yield* llm.respond(() => reply().text("FIRST_PARENT").stop().item(), parentRequest)
    yield* llm.respond(() => reply().text("FIRST_NOTICE").stop().item(), parentRequest)
    yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Start independent task" } })
    yield* finished(parent, "FIRST_NOTICE")
    const child = (yield* list(parent))[0].id
    yield* llm.respond(
      () =>
        reply()
          .tool("task", {
            description: "Foreground follow-up",
            prompt: "FOLLOWUP_BACKGROUND_CHILD",
            subagent_type: "helper",
            task_id: child,
          })
          .item(),
      parentRequest,
    )
    yield* llm.respond(
      (hit) => {
        expect(JSON.stringify(hit.body.messages)).toContain("FIRST_BACKGROUND_RESULT")
        expect(JSON.stringify(hit.body.messages)).toContain("FOLLOWUP_BACKGROUND_CHILD")
        return reply().text("FOLLOWUP_RESULT").stop().item()
      },
      (hit) => !parentRequest(hit),
    )
    yield* llm.respond(() => reply().text("FOLLOWUP_PARENT").stop().item(), parentRequest)
    yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Follow up completed child" } })
    yield* finished(parent, "FOLLOWUP_PARENT")
    const tasks = yield* list(parent)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe(child)
    expect(tasks[0].background).toBeUndefined()
    expect((yield* detail(parent, child)).output).toBe("FOLLOWUP_RESULT")
    expect(
      (yield* readMessages(child)).data.filter((message) => message.type === "user").map((message) => message.text),
    ).toEqual(["BACKGROUND_FIRST", "FOLLOWUP_BACKGROUND_CHILD"])
    expect((yield* HttpClient.post(`/api/session/${parent}/wait`)).status).toBe(204)
    expect(yield* llm.calls).toBe(7)
  }),
)

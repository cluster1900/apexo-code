import { expect } from "bun:test"
import { Goal } from "@apexo/schema/goal"
import { Task } from "@apexo/schema/task"
import { Effect, Fiber, Layer, Schema } from "effect"
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

const configure = (directory: string, url: string, ask = false) =>
  Effect.promise(() =>
    Bun.write(
      path.join(directory, "apexo.json"),
      JSON.stringify({
        snapshots: false,
        task: { activeMessages: true },
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          ...(ask ? [{ action: "send_subagent_message", resource: "ses_*", effect: "ask" }] : []),
        ],
        agents: {
          helper: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] },
          restricted: { mode: "primary", permissions: [{ action: "task", resource: "ses_*", effect: "deny" }] },
        },
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

for (const delivery of ["steer", "queue", "interject"] as const)
  it.instance(`native active Task ${delivery} admits via HTTP and continues the existing launch`, () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      const gate = Promise.withResolvers<void>()
      const arrived = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
      const parent = yield* create(instance.directory)
      yield* llm.respond(
        () =>
          reply()
            .tool("task", {
              description: "Active child",
              prompt: "ACTIVE_DELIVERY_CHILD",
              subagent_type: "helper",
              background: true,
            })
            .item(),
        parentRequest,
      )
      yield* llm.respond(
        () => {
          arrived.resolve()
          return reply().text("INITIAL_CHILD_RESPONSE").wait(gate.promise).stop().item()
        },
        (hit) => !parentRequest(hit),
      )
      yield* llm.respond(() => reply().text("PARENT_INITIAL").stop().item(), parentRequest)
      yield* llm.respond(
        (hit) => {
          const messages = hit.body.messages
          if (!Array.isArray(messages)) throw new Error("Expected Chat Completions messages")
          const users = messages.filter(
            (message) =>
              typeof message === "object" && message !== null && "role" in message && message.role === "user",
          )
          expect(JSON.stringify(users).split("DELIVERED_CORRECTION").length - 1).toBe(1)
          return reply().text("CORRECTED_CHILD_RESPONSE").stop().item()
        },
        (hit) => !parentRequest(hit),
      )
      yield* llm.respond(() => reply().text("PARENT_COMPLETION_DELIVERED").stop().item(), parentRequest)
      expect(
        (yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Start active work" }, resume: true })).status,
      ).toBe(200)
      yield* Effect.promise(() => arrived.promise).pipe(Effect.timeout("8 seconds"))
      const tasks = yield* list(parent)
      expect(tasks).toHaveLength(1)
      const input = { inputID: SessionMessage.ID.create(), text: "DELIVERED_CORRECTION", delivery }
      const sent = yield* post(`/api/session/${parent}/task/${tasks[0].id}/message`, input)
      expect(sent.status).toBe(200)
      const admitted = yield* sent.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Task.MessageReceipt)))
      expect(admitted.status).toBe("admitted")
      expect((yield* post(`/api/session/${parent}/task/${tasks[0].id}/message`, input)).status).toBe(200)
      gate.resolve()
      yield* finished(parent, "PARENT_COMPLETION_DELIVERED")
      expect((yield* detail(parent, tasks[0].id)).output).toBe("CORRECTED_CHILD_RESPONSE")
      const receipt = yield* HttpClient.get(`/api/session/${parent}/task/${tasks[0].id}/message/${input.inputID}`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Task.MessageReceipt)),
      )
      expect(receipt.status).toBe("promoted")
      expect(
        (yield* readMessages(tasks[0].id)).data
          .filter((message) => message.type === "user")
          .map((message) => message.text),
      ).toEqual(["ACTIVE_DELIVERY_CHILD", "DELIVERED_CORRECTION"])
      expect(yield* llm.calls).toBe(5)
    }),
  )

it.instance(
  "Task cancellation during permission evaluation rejects late message admission",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url, true)
      const arrived = Promise.withResolvers<void>()
      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
      const parent = yield* create(instance.directory)
      yield* llm.respond(
        () =>
          reply()
            .tool("task", {
              description: "permission race",
              prompt: "HELD_CHILD",
              subagent_type: "helper",
              background: true,
            })
            .item(),
        parentRequest,
      )
      yield* llm.respond(
        () => {
          arrived.resolve()
          return reply().text("HELD_RESULT").wait(gate.promise).stop().item()
        },
        (hit) => !parentRequest(hit),
      )
      yield* llm.respond(() => reply().text("PARENT_INITIAL").stop().item(), parentRequest)
      yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Start permission race" }, resume: true })
      yield* Effect.promise(() => arrived.promise).pipe(
        Effect.timeoutOrElse({
          duration: "8 seconds",
          orElse: () =>
            Effect.gen(function* () {
              const history = yield* readMessages(parent)
              const permissions = yield* HttpClient.get(`/api/session/${parent}/permission`).pipe(
                Effect.flatMap((response) => response.json),
              )
              return yield* Effect.fail(
                new Error(
                  `Child provider did not arrive: ${JSON.stringify({ history, permissions, calls: yield* llm.calls })}`,
                ),
              )
            }),
        }),
      )
      const child = (yield* list(parent))[0]!.id
      const input = { inputID: SessionMessage.ID.create(), text: "MUST_NOT_ADMIT" }
      const sending = yield* post(`/api/session/${parent}/task/${child}/message`, input).pipe(Effect.forkChild)
      const permission = yield* pollWithTimeout(
        HttpClient.get(`/api/session/${parent}/permission`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({
                data: Schema.Array(
                  Schema.Struct({ id: Schema.String, action: Schema.String, resources: Schema.Array(Schema.String) }),
                ),
              }),
            ),
          ),
          Effect.map((result) => result.data.find((item) => item.action === "task" && item.resources.includes(child))),
        ),
        "send permission was not pending",
        "8 seconds",
      )
      expect((yield* HttpClient.post(`/api/session/${parent}/task/${child}/cancel`)).status).toBe(204)
      expect((yield* post(`/api/session/${parent}/permission/${permission.id}/reply`, { reply: "once" })).status).toBe(
        204,
      )
      expect((yield* Fiber.join(sending)).status).toBe(409)
      expect((yield* HttpClient.get(`/api/session/${parent}/task/${child}/message/${input.inputID}`)).status).toBe(404)
      gate.resolve()
      expect((yield* detail(parent, child)).status).toBe("cancelled")
    }),
  20000,
)

it.instance(
  "Goal pause during message permission evaluation rejects late admission",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url, true)
      const arrived = Promise.withResolvers<void>()
      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
      const parent = yield* create(instance.directory)
      const goalID = Goal.ID.create()
      expect(
        (yield* post(`/api/session/${parent}/goal`, {
          id: goalID,
          objective: "Delegate bounded work",
          tokenBudget: 100,
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
          .tool("goal_report_write", { path: JSON.parse(file), content: "Delegate bounded inspection." })
          .usage({ input: 1, output: 1 })
          .item()
      })
      yield* llm.text("Plan written", { usage: { input: 1, output: 1 } })
      yield* llm.respond(() =>
        reply()
          .tool("task", { description: "Goal child", prompt: "HELD_GOAL_CHILD", subagent_type: "helper" })
          .usage({ input: 1, output: 1 })
          .item(),
      )
      yield* llm.respond(() => {
        arrived.resolve()
        return reply().text("HELD_RESULT").wait(gate.promise).usage({ input: 1, output: 1 }).stop().item()
      })
      expect(
        (yield* post(`/api/session/${parent}/goal/${goalID}/start`, {
          agent: "build",
          model: { providerID: "task-fixture", id: "model" },
        })).status,
      ).toBe(200)
      yield* Effect.promise(() => arrived.promise).pipe(Effect.timeout("8 seconds"))
      const child = (yield* list(parent))[0]!.id
      const input = { inputID: SessionMessage.ID.create(), text: "MUST_NOT_ADMIT" }
      const sending = yield* post(`/api/session/${parent}/task/${child}/message`, input).pipe(Effect.forkChild)
      const permission = yield* pollWithTimeout(
        HttpClient.get(`/api/session/${parent}/permission`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({
                data: Schema.Array(
                  Schema.Struct({ id: Schema.String, action: Schema.String, resources: Schema.Array(Schema.String) }),
                ),
              }),
            ),
          ),
          Effect.map((result) => result.data.find((item) => item.action === "task" && item.resources.includes(child))),
        ),
        "send permission was not pending",
        "8 seconds",
      )
      expect((yield* HttpClient.post(`/api/session/${parent}/goal/${goalID}/pause`)).status).toBe(200)
      expect((yield* post(`/api/session/${parent}/permission/${permission.id}/reply`, { reply: "once" })).status).toBe(
        204,
      )
      expect((yield* Fiber.join(sending)).status).toBe(409)
      expect((yield* HttpClient.get(`/api/session/${parent}/task/${child}/message/${input.inputID}`)).status).toBe(404)
      gate.resolve()
      expect((yield* detail(parent, child)).status).toBe("cancelled")
    }),
  20000,
)

it.instance(
  "Goal correction retains actual provider usage and stops at its token budget",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      const arrived = Promise.withResolvers<void>()
      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
      const parent = yield* create(instance.directory)
      const goalID = Goal.ID.create()
      expect(
        (yield* post(`/api/session/${parent}/goal`, {
          id: goalID,
          objective: "Delegate bounded work",
          tokenBudget: 10,
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
          .tool("goal_report_write", { path: JSON.parse(file), content: "Delegate bounded inspection." })
          .usage({ input: 1, output: 1 })
          .item()
      })
      yield* llm.text("Plan written", { usage: { input: 1, output: 1 } })
      yield* llm.respond(() =>
        reply()
          .tool("task", { description: "Goal child", prompt: "HELD_GOAL_CHILD", subagent_type: "helper" })
          .usage({ input: 1, output: 1 })
          .item(),
      )
      yield* llm.respond(() => {
        arrived.resolve()
        return reply().text("HELD_RESULT").wait(gate.promise).usage({ input: 1, output: 1 }).stop().item()
      })
      expect(
        (yield* post(`/api/session/${parent}/goal/${goalID}/start`, {
          agent: "build",
          model: { providerID: "task-fixture", id: "model" },
        })).status,
      ).toBe(200)
      yield* Effect.promise(() => arrived.promise).pipe(Effect.timeout("8 seconds"))
      const child = (yield* list(parent))[0]!.id
      const input = { inputID: SessionMessage.ID.create(), text: "ACCOUNTED_GOAL_CORRECTION" }
      expect((yield* post(`/api/session/${parent}/task/${child}/message`, input)).status).toBe(200)
      yield* llm.respond((hit) => {
        const messages = hit.body.messages as { role: string; content: unknown }[]
        const users = messages.filter((message) => message.role === "user")
        expect(JSON.stringify(users).split("ACCOUNTED_GOAL_CORRECTION").length - 1).toBe(1)
        return reply().text("ACCOUNTED_CORRECTION_RESULT").usage({ input: 1, output: 1 }).stop().item()
      })
      gate.resolve()
      const goal = yield* pollWithTimeout(
        HttpClient.get(`/api/session/${parent}/goal`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Goal.Info)),
          Effect.map((response) => (response.status === "budget_limited" ? response : undefined)),
        ),
        "Goal correction did not settle its budget",
        "8 seconds",
      )
      expect(goal.tokensUsed).toBe(10)
      expect(yield* llm.calls).toBe(5)
      const receipt = yield* HttpClient.get(`/api/session/${parent}/task/${child}/message/${input.inputID}`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Task.MessageReceipt)),
      )
      expect(receipt.status).toBe("promoted")
    }),
  20000,
)

it.instance(
  "Operator agent switch during permission evaluation rejects the old Task send",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url, true)
      const arrived = Promise.withResolvers<void>()
      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
      const parent = yield* create(instance.directory)
      yield* llm.respond(
        () =>
          reply()
            .tool("task", {
              description: "permission race",
              prompt: "HELD_CHILD",
              subagent_type: "helper",
              background: true,
            })
            .item(),
        parentRequest,
      )
      yield* llm.respond(
        () => {
          arrived.resolve()
          return reply().text("HELD_RESULT").wait(gate.promise).stop().item()
        },
        (hit) => !parentRequest(hit),
      )
      yield* llm.respond(() => reply().text("PARENT_INITIAL").stop().item(), parentRequest)
      yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Start permission race" }, resume: true })
      yield* Effect.promise(() => arrived.promise).pipe(
        Effect.timeoutOrElse({
          duration: "8 seconds",
          orElse: () =>
            Effect.gen(function* () {
              const history = yield* readMessages(parent)
              const permissions = yield* HttpClient.get(`/api/session/${parent}/permission`).pipe(
                Effect.flatMap((response) => response.json),
              )
              return yield* Effect.fail(
                new Error(
                  `Child provider did not arrive: ${JSON.stringify({ history, permissions, calls: yield* llm.calls })}`,
                ),
              )
            }),
        }),
      )
      const child = (yield* list(parent))[0]!.id
      const input = { inputID: SessionMessage.ID.create(), text: "MUST_NOT_ADMIT" }
      const sending = yield* post(`/api/session/${parent}/task/${child}/message`, input).pipe(Effect.forkChild)
      const permission = yield* pollWithTimeout(
        HttpClient.get(`/api/session/${parent}/permission`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({
                data: Schema.Array(
                  Schema.Struct({ id: Schema.String, action: Schema.String, resources: Schema.Array(Schema.String) }),
                ),
              }),
            ),
          ),
          Effect.map((result) => result.data.find((item) => item.action === "task" && item.resources.includes(child))),
        ),
        "send permission was not pending",
        "8 seconds",
      )
      expect((yield* post(`/api/session/${parent}/agent`, { agent: "restricted" })).status).toBe(204)
      expect((yield* post(`/api/session/${parent}/permission/${permission.id}/reply`, { reply: "once" })).status).toBe(
        204,
      )
      expect((yield* Fiber.join(sending)).status).toBe(409)
      expect((yield* HttpClient.get(`/api/session/${parent}/task/${child}/message/${input.inputID}`)).status).toBe(404)
      expect(
        (yield* post(`/api/session/${parent}/task/${child}/message`, {
          inputID: SessionMessage.ID.create(),
          text: "NEW_RESTRICTED_OPERATION",
        })).status,
      ).toBe(403)
      expect((yield* detail(parent, child)).status).toBe("running")
      expect((yield* HttpClient.post(`/api/session/${parent}/task/${child}/cancel`)).status).toBe(204)
      gate.resolve()
    }),
  20000,
)

for (const delivery of ["steer", "queue", "interject"] as const)
  it.instance(`completed native Task ${delivery} wakes once through its tool owner`, () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      const parent = yield* create(instance.directory)
      const arrived = Promise.withResolvers<void>()
      const gate = Promise.withResolvers<void>()
      const accepted = Promise.withResolvers<Task.MessageReceipt>()
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
      const output = (hit: { body: Record<string, unknown> }) => {
        const messages = Schema.decodeUnknownSync(
          Schema.Array(
            Schema.Struct({
              role: Schema.String,
              content: Schema.Unknown,
            }),
          ),
        )(hit.body.messages)
        const content = messages.findLast((message) => message.role === "tool")?.content
        if (typeof content !== "string") throw new Error("Missing actual tool result")
        return Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(content)
      }
      yield* llm.respond(
        () =>
          reply()
            .tool("task", {
              description: "Completed child",
              prompt: "FIRST_CHILD_INPUT",
              subagent_type: "helper",
            })
            .item(),
        parentRequest,
      )
      yield* llm.respond(
        () => reply().text("FIRST_CHILD_FINISHED").stop().item(),
        (hit) => !parentRequest(hit),
      )
      yield* llm.respond((hit) => {
        const child = Schema.decodeUnknownSync(Task.Detail)(output(hit))
        expect(child.status).toBe("completed")
        expect(child.output).toBe("FIRST_CHILD_FINISHED")
        return reply()
          .tool("send_subagent_message", {
            subagent_id: child.id,
            text: "WAKE_CHILD_INPUT",
            delivery,
          })
          .item()
      }, parentRequest)
      yield* llm.respond(
        (hit) => {
          const messages = Schema.decodeUnknownSync(
            Schema.Array(
              Schema.Struct({
                role: Schema.String,
                content: Schema.Unknown,
              }),
            ),
          )(hit.body.messages)
          expect(
            JSON.stringify(messages.filter((message) => message.role === "user")).split("WAKE_CHILD_INPUT").length - 1,
          ).toBe(1)
          arrived.resolve()
          return reply().text("WOKEN_CHILD_FINISHED").wait(gate.promise).stop().item()
        },
        (hit) => !parentRequest(hit),
      )
      yield* llm.respond((hit) => {
        const receipt = Schema.decodeUnknownSync(Task.MessageReceipt)(output(hit))
        expect(receipt.delivery).toBe(delivery)
        expect(["admitted", "promoted"]).toContain(receipt.status)
        accepted.resolve(receipt)
        return reply().tool("task_wait", { task_id: receipt.taskID, timeout_ms: 10000 }).item()
      }, parentRequest)
      yield* llm.respond((hit) => {
        const child = Schema.decodeUnknownSync(Task.Detail)(output(hit))
        expect(child.status).toBe("completed")
        expect(child.output).toBe("WOKEN_CHILD_FINISHED")
        return reply().text("WAKE_PARENT_FINISHED").stop().item()
      }, parentRequest)
      expect(
        (yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Wake an owned child" }, resume: true }))
          .status,
      ).toBe(200)
      yield* Effect.promise(() => arrived.promise).pipe(Effect.timeout("8 seconds"))
      const receipt = yield* Effect.promise(() => accepted.promise).pipe(Effect.timeout("8 seconds"))
      gate.resolve()
      yield* finished(parent, "WAKE_PARENT_FINISHED")
      const before = yield* detail(parent, receipt.taskID)
      const retried = yield* post(`/api/session/${parent}/task/${receipt.taskID}/message`, {
        inputID: receipt.inputID,
        text: "WAKE_CHILD_INPUT",
        delivery,
      })
      expect(retried.status).toBe(200)
      expect((yield* retried.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Task.MessageReceipt)))).status).toBe(
        "promoted",
      )
      expect(yield* detail(parent, receipt.taskID)).toEqual(before)
      expect(
        (yield* post(`/api/session/${yield* create(instance.directory)}/task/${receipt.taskID}/message`, {
          inputID: SessionMessage.ID.create(),
          text: "HTTP_HAS_NO_CHILD_OWNER",
          delivery,
        })).status,
      ).toBe(404)
      expect(
        (yield* readMessages(receipt.taskID)).data
          .filter((message) => message.type === "user")
          .map((message) => message.text),
      ).toEqual(["FIRST_CHILD_INPUT", "WAKE_CHILD_INPUT"])
      expect(yield* llm.calls).toBe(6)
    }),
  )

it.instance("completed Task wake rejects a sender agent changed during permission evaluation", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    yield* configure(instance.directory, llm.url, true)
    const parent = yield* create(instance.directory)
    yield* llm.respond(
      () =>
        reply()
          .tool("task", { description: "Completed child", prompt: "FIRST_CHILD_INPUT", subagent_type: "helper" })
          .item(),
      parentRequest,
    )
    yield* llm.respond(
      () => reply().text("FIRST_CHILD_FINISHED").stop().item(),
      (hit) => !parentRequest(hit),
    )
    yield* llm.respond((hit) => {
      const messages = Schema.decodeUnknownSync(
        Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.Unknown })),
      )(hit.body.messages)
      const content = messages.findLast((message) => message.role === "tool")?.content
      if (typeof content !== "string") throw new Error("Missing Task result")
      const child = Schema.decodeUnknownSync(Task.Detail)(
        Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(content),
      )
      expect(child.status).toBe("completed")
      return reply().tool("send_subagent_message", { subagent_id: child.id, text: "REVOKED_WAKE" }).item()
    }, parentRequest)
    yield* llm.respond(() => reply().text("REVOKED_PARENT_FINISHED").stop().item(), parentRequest)
    expect((yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Wake permission race" } })).status).toBe(
      200,
    )
    const permission = yield* pollWithTimeout(
      HttpClient.get(`/api/session/${parent}/permission`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.Struct({
              data: Schema.Array(
                Schema.Struct({ id: Schema.String, action: Schema.String, resources: Schema.Array(Schema.String) }),
              ),
            }),
          ),
        ),
        Effect.map((result) =>
          result.data.find(
            (item) => item.action === "task" && item.resources.some((resource) => resource.startsWith("ses_")),
          ),
        ),
      ),
      "wake permission was not pending",
      "8 seconds",
    )
    const child = (yield* list(parent))[0]!
    expect(child.status).toBe("completed")
    expect((yield* post(`/api/session/${parent}/agent`, { agent: "restricted" })).status).toBe(204)
    expect((yield* post(`/api/session/${parent}/permission/${permission.id}/reply`, { reply: "once" })).status).toBe(
      204,
    )
    yield* finished(parent, "REVOKED_PARENT_FINISHED")
    expect(yield* detail(parent, child.id)).toMatchObject({ status: "completed", output: "FIRST_CHILD_FINISHED" })
    expect(
      (yield* readMessages(child.id)).data.filter((message) => message.type === "user").map((message) => message.text),
    ).toEqual(["FIRST_CHILD_INPUT"])
    expect(yield* llm.calls).toBe(4)
  }),
)

for (const delivery of ["steer", "queue", "interject"] as const)
  it.instance(`operator HTTP ${delivery} wakes the same completed Task exactly once`, () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      const parent = yield* create(instance.directory)
      yield* llm.respond(
        () =>
          reply()
            .tool("task", { description: "Operator child", prompt: "OPERATOR_FIRST", subagent_type: "helper" })
            .item(),
        parentRequest,
      )
      yield* llm.respond(
        () => reply().text("OPERATOR_FIRST_DONE").stop().item(),
        (hit) => !parentRequest(hit),
      )
      yield* llm.respond(() => reply().text("OPERATOR_PARENT_IDLE").stop().item(), parentRequest)
      expect((yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Create operator child" } })).status).toBe(
        200,
      )
      yield* finished(parent, "OPERATOR_PARENT_IDLE")
      expect((yield* HttpClient.post(`/api/session/${parent}/wait`)).status).toBe(204)
      const child = (yield* list(parent))[0]!
      expect(child.status).toBe("completed")
      const arrived = Promise.withResolvers<void>()
      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
      yield* llm.respond(
        (hit) => {
          const msgs = Schema.decodeUnknownSync(
            Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.Unknown })),
          )(hit.body.messages)
          expect(
            JSON.stringify(msgs.filter((message) => message.role === "user")).split("OPERATOR_SECOND").length - 1,
          ).toBe(1)
          expect(JSON.stringify(msgs)).toContain("OPERATOR_FIRST_DONE")
          arrived.resolve()
          return reply().text("OPERATOR_SECOND_DONE").wait(gate.promise).stop().item()
        },
        (hit) => !parentRequest(hit),
      )
      yield* llm.respond(() => reply().text("OPERATOR_PARENT_NOTIFIED").stop().item(), parentRequest)
      const input = { inputID: SessionMessage.ID.create(), text: "OPERATOR_SECOND", delivery }
      const route = `/api/session/${parent}/task/${child.id}/message`
      const sent = yield* post(route, input)
      expect(sent.status).toBe(200)
      const receipt = yield* sent.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Task.MessageReceipt)))
      expect(receipt.taskID).toBe(child.id)
      yield* Effect.promise(() => arrived.promise).pipe(Effect.timeout("8 seconds"))
      expect((yield* post(route, input)).status).toBe(200)
      expect((yield* post(route, { ...input, text: "CONFLICT" })).status).toBe(400)
      gate.resolve()
      yield* finished(parent, "OPERATOR_PARENT_NOTIFIED")
      expect((yield* detail(parent, child.id)).output).toBe("OPERATOR_SECOND_DONE")
      expect((yield* post(route, input)).status).toBe(200)
      expect((yield* list(parent)).map((task) => task.id)).toEqual([child.id])
      expect(
        (yield* readMessages(child.id)).data
          .filter((message) => message.type === "user")
          .map((message) => message.text),
      ).toEqual(["OPERATOR_FIRST", "OPERATOR_SECOND"])
      expect(yield* llm.calls).toBe(5)
    }),
  )

for (const change of ["agent", "delete"] as const)
  it.instance(`operator completed wake rejects ${change} during permission admission without an inbox`, () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url, true)
      const parent = yield* create(instance.directory)
      yield* llm.respond(
        () =>
          reply()
            .tool("task", { description: "Held operator", prompt: "HELD_OPERATOR_FIRST", subagent_type: "helper" })
            .item(),
        parentRequest,
      )
      yield* llm.respond(
        () => reply().text("HELD_OPERATOR_DONE").stop().item(),
        (hit) => !parentRequest(hit),
      )
      yield* llm.respond(() => reply().text("HELD_OPERATOR_IDLE").stop().item(), parentRequest)
      yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Create held operator child" } })
      yield* finished(parent, "HELD_OPERATOR_IDLE")
      expect((yield* HttpClient.post(`/api/session/${parent}/wait`)).status).toBe(204)
      const child = (yield* list(parent))[0]!
      const input = { inputID: SessionMessage.ID.create(), text: "MUST_NOT_WAKE_OPERATOR" }
      const sending = yield* post(`/api/session/${parent}/task/${child.id}/message`, input).pipe(Effect.forkChild)
      const permission = yield* pollWithTimeout(
        HttpClient.get(`/api/session/${parent}/permission`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({
                data: Schema.Array(
                  Schema.Struct({ id: Schema.String, action: Schema.String, resources: Schema.Array(Schema.String) }),
                ),
              }),
            ),
          ),
          Effect.map((result) =>
            result.data.find((item) => item.action === "task" && item.resources.includes(child.id)),
          ),
        ),
        "operator permission was not pending",
        "8 seconds",
      )
      if (change === "agent") {
        expect((yield* post(`/api/session/${parent}/agent`, { agent: "restricted" })).status).toBe(204)
        expect(
          (yield* post(`/api/session/${parent}/permission/${permission.id}/reply`, { reply: "once" })).status,
        ).toBe(204)
        expect([403, 409]).toContain((yield* Fiber.join(sending)).status)
        expect((yield* detail(parent, child.id)).status).toBe("completed")
        expect(
          (yield* readMessages(child.id)).data
            .filter((message) => message.type === "user")
            .map((message) => message.text),
        ).toEqual(["HELD_OPERATOR_FIRST"])
      } else {
        expect((yield* HttpClient.del(`/api/session/${parent}`)).status).toBe(204)
        expect((yield* Fiber.join(sending)).status).toBe(503)
      }
      expect((yield* HttpClient.get(`/api/session/${parent}/task/${child.id}/message/${input.inputID}`)).status).toBe(
        404,
      )
      expect(yield* llm.calls).toBe(3)
    }),
  )

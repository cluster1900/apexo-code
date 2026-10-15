import { expect } from "bun:test"
import { Task } from "@apexo/schema/task"
import { Workflow } from "@apexo/schema/workflow"
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
        task: { activeMessages: true },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
        agents: {
          helper: {
            mode: "subagent",
            model: "task-fixture/saved",
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
          },
          other: { mode: "subagent", model: "task-fixture/override" },
        },
        providers: {
          "task-fixture": {
            api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: url, settings: { apiKey: "test" } },
            models: Object.fromEntries(
              ["model", "saved", "override"].map((id) => [
                id,
                {
                  name: id,
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  limit: { context: 100000, output: 4096 },
                },
              ]),
            ),
          },
        },
      }),
    ),
  )

const history = (id: string) =>
  HttpClient.get(`/api/session/${id}/message?order=asc`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
    Effect.map((value) => value.data),
  )

it.instance("Task resume_from creates a fresh owned child with source transcript and pinned selection", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    yield* configure(instance.directory, llm.url)
    const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(
      yield* (yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "task-fixture", id: "model" },
        agent: "build",
      })).json,
    )).data
    const source = { id: "" }
    const requests: Record<string, unknown>[] = []
    yield* llm.respond(() =>
      reply()
        .tool("task", { description: "Original source", prompt: "TASK_RESUME_ORIGINAL", subagent_type: "helper" })
        .item(),
    )
    yield* llm.respond((hit) => {
      requests.push(hit.body)
      return reply().text("TASK_RESUME_SOURCE_RESULT").usage({ input: 2, output: 3 }).stop().item()
    })
    yield* llm.respond((hit) => {
      const messages = Schema.decodeUnknownSync(
        Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.Unknown })),
      )(hit.body.messages)
      const text = messages.findLast((message) => message.role === "tool")?.content
      if (typeof text !== "string") throw new Error("Missing source Task receipt")
      source.id = Schema.decodeUnknownSync(Task.Detail)(Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(text)).id
      return reply()
        .tool("task", {
          description: "Transcript continuation",
          prompt: "TASK_RESUME_NEXT",
          subagent_type: "other",
          resume_from: source.id,
        })
        .item()
    })
    yield* llm.respond((hit) => {
      requests.push(hit.body)
      return reply().text("TASK_RESUME_NEW_RESULT").usage({ input: 7, output: 11 }).stop().item()
    })
    yield* llm.respond(() => reply().text("TASK_RESUME_PARENT_DONE").stop().item())
    expect(
      (yield* post(`/api/session/${parent.id}/prompt`, {
        prompt: { text: "Continue a finished source in a new child" },
      })).status,
    ).toBe(200)
    yield* pollWithTimeout(
      history(parent.id).pipe(
        Effect.map((messages) =>
          messages.some(
            (message) =>
              message.type === "assistant" &&
              message.time.completed &&
              message.content.some((part) => part.type === "text" && part.text === "TASK_RESUME_PARENT_DONE"),
          )
            ? true
            : undefined,
        ),
      ),
      "parent did not settle",
      "20 seconds",
    )
    const children = yield* HttpClient.get(`/api/session/${parent.id}/task`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
    )
    expect(children).toHaveLength(2)
    const child = children.find((child) => child.id !== source.id)!
    expect(requests.map((request) => request.model)).toEqual(["saved", "saved"])
    expect(JSON.stringify(requests[1].messages)).toContain("TASK_RESUME_SOURCE_RESULT")
    expect(
      (yield* history(source.id)).filter((message) => message.type === "user").map((message) => message.text),
    ).toEqual(["TASK_RESUME_ORIGINAL"])
    expect(
      (yield* history(child.id)).filter((message) => message.type === "user").map((message) => message.text),
    ).toEqual(["TASK_RESUME_ORIGINAL", "TASK_RESUME_NEXT"])
    expect(yield* llm.calls).toBe(5)
  }),
)

for (const failed of [false, true]) {
  it.instance(
    `Task resume_from imports ${failed ? "failed" : "completed read-only"} Workflow history without changing its owner`,
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const llm = yield* TestLLMServer
        yield* configure(instance.directory, llm.url)
        const file = path.join(instance.directory, "source-fact.txt")
        yield* Effect.promise(() => Bun.write(file, "WORKFLOW_DURABLE_FACT"))
        const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(
          yield* (yield* post("/api/session", {
            location: { directory: instance.directory },
            agent: "build",
            model: { providerID: "task-fixture", id: "model" },
          })).json,
        )).data
        yield* llm.respond(() => reply().tool("read", { filePath: file }).usage({ input: 2, output: 3 }).item())
        yield* llm.respond(() => reply().text("WORKFLOW_SOURCE_RESULT").usage({ input: 5, output: 7 }).stop().item())
        if (failed)
          yield* llm.respond(() => reply().text("WORKFLOW_INVALID_JSON").usage({ input: 1, output: 1 }).stop().item())
        const root = `/api/session/${parent.id}/workflow`
        const pending = yield* Schema.decodeUnknownEffect(Workflow.Info)(
          yield* (yield* post(root, {
            source: {
              type: "script",
              name: "task-resume-source",
              script: failed
                ? 'complete(agent("WORKFLOW_ORIGINAL",#{agent_type:"helper",output_schema:#{type:"object",required:["ok"],properties:#{ok:#{type:"boolean"}}}}));'
                : 'complete(agent("WORKFLOW_ORIGINAL",#{capability_mode:"read-only"}));',
            },
          })).json,
        )
        const done = yield* pollWithTimeout(
          HttpClient.get(`${root}/${pending.id}`).pipe(
            Effect.flatMap((response) => response.json),
            Effect.flatMap(Schema.decodeUnknownEffect(Workflow.Info)),
            Effect.map((info) => (["pending", "running"].includes(info.status) ? undefined : info)),
          ),
          "Workflow source did not settle",
          "20 seconds",
        )
        expect(done.status).toBe(failed ? "failed" : "completed")
        expect(done.children).toHaveLength(1)
        const source = yield* history(done.children[0])
        const requests: Record<string, unknown>[] = []
        yield* llm.respond(() =>
          reply()
            .tool("task", {
              description: "Resume Workflow history",
              prompt: "TASK_AFTER_WORKFLOW",
              subagent_type: "other",
              resume_from: done.children[0],
            })
            .item(),
        )
        yield* llm.respond((hit) => {
          requests.push(hit.body)
          return reply().text("TASK_WORKFLOW_RESUMED").usage({ input: 11, output: 13 }).stop().item()
        })
        yield* llm.respond(() => reply().text("PARENT_WORKFLOW_RESUME_DONE").stop().item())
        yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Resume the Workflow child" } })
        yield* HttpClient.post(`/api/session/${parent.id}/wait`)
        const tasks = yield* HttpClient.get(`/api/session/${parent.id}/task`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
        )
        expect(tasks).toHaveLength(1)
        expect(tasks[0].status).toBe("completed")
        expect(tasks[0].id).not.toBe(done.children[0])
        expect(requests).toHaveLength(1)
        expect(requests[0].model).toBe(failed ? "saved" : "model")
        expect(JSON.stringify(requests[0].messages)).toContain("WORKFLOW_DURABLE_FACT")
        expect(JSON.stringify(requests[0].messages)).toContain("WORKFLOW_SOURCE_RESULT")
        for (const tool of [
          "workflow",
          "task",
          "task_output",
          "task_wait",
          "task_cancel",
          "update_goal",
          "scheduler_create",
          ...(!failed ? ["bash"] : []),
        ])
          expect(JSON.stringify(requests[0].tools)).not.toContain(`"${tool}"`)
        expect(yield* history(done.children[0])).toEqual(source)
        expect(
          yield* HttpClient.get(`${root}/${pending.id}`).pipe(Effect.flatMap((response) => response.json)),
        ).toEqual(done)
        const resumed = yield* history(tasks[0].id)
        expect(resumed.filter((message) => message.type === "user").map((message) => message.text)).toEqual([
          ...source.filter((message) => message.type === "user").map((message) => message.text),
          "TASK_AFTER_WORKFLOW",
        ])
        expect(resumed.every((message) => !source.some((old) => old.id === message.id))).toBe(true)
        expect(yield* llm.calls).toBe(failed ? 6 : 5)
        if (!failed) {
          yield* llm.respond((hit) => {
            requests.push(hit.body)
            return reply().text("INHERITED_TASK_WAKE_DONE").stop().item()
          })
          const sent = yield* post(`/api/session/${parent.id}/task/${tasks[0].id}/message`, {
            inputID: SessionMessage.ID.create(),
            text: "WAKE_INHERITED_TASK",
          })
          expect(sent.status).toBe(200)
          yield* HttpClient.post(`/api/session/${parent.id}/wait`)
          yield* pollWithTimeout(
            history(tasks[0].id).pipe(
              Effect.map((messages) =>
                messages.some(
                  (message) =>
                    message.type === "assistant" &&
                    message.time.completed &&
                    message.content.some((part) => part.type === "text" && part.text === "INHERITED_TASK_WAKE_DONE"),
                )
                  ? true
                  : undefined,
              ),
            ),
            "resumed inherited Task did not wake",
            "10 seconds",
          )
          expect(requests).toHaveLength(2)
          expect(requests[1].model).toBe("model")
          expect(JSON.stringify(requests[1].tools)).not.toContain('"bash"')
          expect(yield* history(done.children[0])).toEqual(source)
        }
      }),
  )
}
it.instance("Task resume_from accepts a cancelled direct Task without borrowing its owner", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    yield* Effect.promise(() =>
      Bun.write(
        path.join(instance.directory, "apexo.json"),
        JSON.stringify({
          snapshots: false,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          agents: { helper: { mode: "subagent", model: "fixture/selected" } },
          providers: {
            fixture: {
              api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url, settings: { apiKey: "test" } },
              models: Object.fromEntries(
                ["parent", "selected"].map((id) => [
                  id,
                  {
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 100000, output: 4096 },
                  },
                ]),
              ),
            },
          },
        }),
      ),
    )
    const created = yield* post("/api/session", {
      location: { directory: instance.directory },
      agent: "build",
      model: { providerID: "fixture", id: "parent" },
    })
    const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
    const taskFile = path.join(instance.directory, "task-fact.txt")
    yield* Effect.promise(() => Bun.write(taskFile, "TASK_DURABLE_TOOL_FACT"))
    const gate = Promise.withResolvers<void>()
    yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
    yield* llm.respond(() =>
      reply()
        .tool("task", { description: "Cancellation source", prompt: "TASK_SOURCE_ORIGINAL", subagent_type: "helper" })
        .item(),
    )
    yield* llm.respond(() => reply().tool("read", { filePath: taskFile }).item())
    yield* llm.push(reply().text("PARTIAL_TASK_HISTORY").wait(gate.promise).stop())
    yield* llm.respond(() => reply().text("PARENT_AFTER_CANCEL").stop().item())
    yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Run cancellable task" } })
    yield* llm.wait(3)
    const tasks = yield* HttpClient.get(`/api/session/${parent.id}/task`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
    )
    expect(tasks).toHaveLength(1)
    expect(tasks[0].status).toBe("running")
    const cancellation = yield* HttpClient.post(`/api/session/${parent.id}/task/${tasks[0].id}/cancel`)
    expect(cancellation.status).toBe(204)
    gate.resolve()
    yield* HttpClient.post(`/api/session/${parent.id}/wait`)
    const detail = yield* HttpClient.get(`/api/session/${parent.id}/task/${tasks[0].id}`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Task.Detail)),
    )
    expect(detail.status).toBe("cancelled")
    const original = yield* history(tasks[0].id)
    const requests: Record<string, unknown>[] = []
    yield* llm.respond(() =>
      reply()
        .tool("task", {
          description: "Resume cancelled",
          prompt: "CONTINUE_CANCELLED_TASK",
          subagent_type: "helper",
          resume_from: tasks[0].id,
        })
        .item(),
    )
    yield* llm.respond((hit) => {
      requests.push(hit.body)
      return reply().text("TASK_COPY_CONTINUED").usage({ input: 3, output: 5 }).stop().item()
    })
    yield* llm.respond(() => reply().text("CANCELLED_COPY_PARENT_DONE").stop().item())
    yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Resume cancelled source" } })
    yield* HttpClient.post(`/api/session/${parent.id}/wait`)
    const resumed = yield* HttpClient.get(`/api/session/${parent.id}/task`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
    )
    expect(resumed).toHaveLength(2)
    expect(resumed.find((child) => child.id !== tasks[0].id)?.status).toBe("completed")
    expect(requests).toHaveLength(1)
    expect(requests[0].model).toBe("selected")
    const messages = requests[0].messages as { role: string; content: unknown }[]
    expect(JSON.stringify(messages.filter((message) => message.role === "user"))).toContain("TASK_SOURCE_ORIGINAL")
    expect(JSON.stringify(messages.filter((message) => message.role === "user"))).toContain("CONTINUE_CANCELLED_TASK")
    expect(JSON.stringify(messages.filter((message) => message.role === "tool"))).toContain("TASK_DURABLE_TOOL_FACT")
    expect(JSON.stringify(requests[0].tools)).not.toContain('"scheduler_create"')
    expect(yield* history(tasks[0].id)).toEqual(original)
    const after = yield* HttpClient.get(`/api/session/${parent.id}/task/${tasks[0].id}`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Task.Detail)),
    )
    expect(after).toEqual(detail)
    expect(yield* llm.calls).toBe(7)
  }),
)

it.instance(
  "Task resumed history never re-bills the active Goal",
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
      const root = `/api/session/${parent.id}`
      yield* llm.respond(() =>
        reply()
          .tool("task", { description: "Historical billed source", prompt: "OLD_GOAL_SOURCE", subagent_type: "helper" })
          .item(),
      )
      yield* llm.respond(() => reply().text("SOURCE_ALREADY_BILLED").usage({ input: 30, output: 40 }).stop().item())
      yield* llm.respond(() => reply().text("SOURCE_PARENT_DONE").stop().item())
      yield* post(`${root}/prompt`, { prompt: { text: "Make history before starting Goal" } })
      yield* HttpClient.post(`${root}/wait`)
      const sources = yield* HttpClient.get(`${root}/task`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
      )
      expect(sources).toHaveLength(1)
      const original = yield* history(sources[0].id)
      const before = yield* llm.calls
      const goalID = "goal_taskresume"
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
          .tool("task", {
            description: "Budgeted child",
            prompt: "OWNED_GOAL_TASK",
            subagent_type: "other",
            resume_from: sources[0].id,
          })
          .usage({ input: 1, output: 1 })
          .item(),
      )
      yield* llm.respond((hit) => {
        expect(JSON.stringify(hit.body.messages)).toContain("OWNED_GOAL_TASK")
        expect(JSON.stringify(hit.body.messages)).toContain("SOURCE_ALREADY_BILLED")
        expect(hit.body.model).toBe("saved")
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
      expect(goal).toEqual({ status: "budget_limited", tokensUsed: 11 })
      expect((yield* HttpClient.post(`${root}/wait`)).status).toBe(204)
      expect((yield* llm.calls) - before).toBe(4)
      expect(yield* history(sources[0].id)).toEqual(original)
    }),
  { git: true },
  30000,
)

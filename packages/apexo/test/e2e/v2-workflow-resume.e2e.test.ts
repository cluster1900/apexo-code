import { SessionMessage } from "@apexo/core/session/message"
import { Task } from "@apexo/schema/task"
import { Workflow } from "@apexo/schema/workflow"
import { expect } from "bun:test"
import { Config, Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { TestInstance } from "../fixture/fixture"
import { reply, TestLLMServer } from "../lib/llm-server"
import { pollWithTimeout, testEffect } from "../lib/effect"
import path from "node:path"

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
const post = (url: string, body: unknown) =>
  HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))

const terminal = (root: string) =>
  pollWithTimeout(
    HttpClient.get(root).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Workflow.Info)),
      Effect.map((info) => (["pending", "running"].includes(info.status) ? undefined : info)),
    ),
    "Workflow did not settle",
    "20 seconds",
  )

const MessagesResponse = Schema.Struct({ data: Schema.Array(SessionMessage.Message) })
const history = (id: string) =>
  HttpClient.get(`/api/session/${id}/message?order=asc`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
    Effect.map((value) => value.data),
  )

it.instance("Workflow resume_from copies a completed owned child with pinned policy and fresh usage", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    const file = path.join(instance.directory, "fact.txt")
    yield* Effect.promise(() => Bun.write(file, "DURABLE_TOOL_FACT"))
    yield* Effect.promise(() =>
      Bun.write(
        path.join(instance.directory, "apexo.json"),
        JSON.stringify({
          snapshots: false,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          agents: { helper: { mode: "subagent", model: "fixture/selected", system: "PINNED_HELPER_POLICY" } },
          providers: {
            fixture: {
              api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url, settings: { apiKey: "test" } },
              models: Object.fromEntries(
                ["parent", "selected", "override"].map((id) => [
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
    const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(
      yield* (yield* post("/api/session", {
        location: { directory: instance.directory },
        agent: "build",
        model: { providerID: "fixture", id: "parent" },
      })).json,
    )).data
    const root = `/api/session/${parent.id}/workflow`
    const requests: Record<string, unknown>[] = []
    yield* llm.respond((hit) => {
      requests.push(hit.body)
      return reply().tool("read", { filePath: file }).usage({ input: 2, output: 3 }).item()
    })
    yield* llm.respond((hit) => {
      requests.push(hit.body)
      return reply().text("SOURCE_FINISHED").usage({ input: 5, output: 7 }).stop().item()
    })
    yield* llm.respond((hit) => {
      requests.push(hit.body)
      return reply().text("RESUMED_FINISHED").usage({ input: 11, output: 13 }).stop().item()
    })
    const started = yield* post(root, {
      source: {
        type: "script",
        name: "resume-owned",
        script:
          'let first=agent("ORIGINAL_CHILD_INPUT",#{agent_type:"helper",capability_mode:"read-only"}); let second=agent("NEW_CONTINUATION_INPUT",#{resume_from:first.agent_id,agent_type:"not-selected",model:"fixture/override",capability_mode:"default"}); complete(#{source:first.agent_id,child:second.agent_id,source_tokens:first.tokens_used,new_tokens:second.tokens_used});',
      },
      agentBudget: 2,
    })
    const pending = yield* Schema.decodeUnknownEffect(Workflow.Info)(yield* started.json)
    const done = yield* terminal(`${root}/${pending.id}`)
    expect(done.status).toBe("completed")
    expect(done.children).toHaveLength(2)
    expect(done.children[0]).not.toBe(done.children[1])
    expect(done.result).toEqual({
      source: done.children[0],
      child: done.children[1],
      source_tokens: 17,
      new_tokens: 24,
    })
    expect(done.tokens).toBe(41)
    expect(yield* llm.calls).toBe(3)
    expect(requests.map((request) => request.model)).toEqual(["selected", "selected", "selected"])
    const resumedMessages = requests[2].messages as { role: string; content: unknown }[]
    expect(JSON.stringify(resumedMessages.filter((message) => message.role === "user"))).toContain(
      "ORIGINAL_CHILD_INPUT",
    )
    expect(JSON.stringify(resumedMessages.filter((message) => message.role === "user"))).toContain(
      "NEW_CONTINUATION_INPUT",
    )
    expect(JSON.stringify(resumedMessages.filter((message) => message.role === "tool"))).toContain("DURABLE_TOOL_FACT")
    expect(JSON.stringify(resumedMessages.filter((message) => message.role === "assistant"))).toContain(
      "SOURCE_FINISHED",
    )
    expect(JSON.stringify(resumedMessages.filter((message) => message.role === "system"))).toContain(
      "PINNED_HELPER_POLICY",
    )
    expect(JSON.stringify(requests[2].tools)).not.toContain('"bash"')
    const source = yield* history(done.children[0])
    const child = yield* history(done.children[1])
    expect(source.filter((message) => message.type === "user").map((message) => message.text)).toEqual([
      "ORIGINAL_CHILD_INPUT",
    ])
    expect(child.filter((message) => message.type === "user").map((message) => message.text)).toEqual([
      "ORIGINAL_CHILD_INPUT",
      "NEW_CONTINUATION_INPUT",
    ])
    expect(child.every((message) => !source.some((old) => old.id === message.id))).toBe(true)
    expect(child.filter((message) => message.type === "assistant")).toHaveLength(3)
    const rejected = yield* post(root, {
      source: {
        type: "script",
        name: "reject-parent",
        script: `complete(agent("NO_PROVIDER",#{resume_from:"${parent.id}"}));`,
      },
    })
    const rejection = yield* Schema.decodeUnknownEffect(Workflow.Info)(yield* rejected.json)
    const failed = yield* terminal(`${root}/${rejection.id}`)
    expect(failed.status).toBe("failed")
    expect(failed.children).toEqual([])
    expect(yield* llm.calls).toBe(3)
    yield* llm.respond(() => reply().text("INVALID_SOURCE_JSON_ONE").stop().item())
    yield* llm.respond(() => reply().text("INVALID_SOURCE_JSON_TWO").stop().item())
    const invalid = yield* post(root, {
      source: {
        type: "script",
        name: "failed-source",
        script:
          'complete(agent("FAILED_SOURCE_INPUT",#{agent_type:"helper",output_schema:#{type:"object",required:["valid"],properties:#{valid:#{type:"boolean"}}}}));',
      },
    })
    const invalidPending = yield* Schema.decodeUnknownEffect(Workflow.Info)(yield* invalid.json)
    const invalidDone = yield* terminal(`${root}/${invalidPending.id}`)
    expect(invalidDone.status).toBe("failed")
    expect(invalidDone.children).toHaveLength(1)
    const failedSourceHistory = yield* history(invalidDone.children[0])
    const failedSourceCalls: Record<string, unknown>[] = []
    yield* llm.respond((hit) => {
      failedSourceCalls.push(hit.body)
      return reply().text("FAILED_SOURCE_CONTINUED").stop().item()
    })
    const continued = yield* post(root, {
      source: {
        type: "script",
        name: "continue-failed",
        script: `complete(agent("REPAIR_FAILED_SOURCE",#{resume_from:"${invalidDone.children[0]}"}));`,
      },
    })
    const continuedPending = yield* Schema.decodeUnknownEffect(Workflow.Info)(yield* continued.json)
    const continuedDone = yield* terminal(`${root}/${continuedPending.id}`)
    expect(continuedDone.status).toBe("completed")
    expect(continuedDone.children[0]).not.toBe(invalidDone.children[0])
    expect(failedSourceCalls).toHaveLength(1)
    expect(JSON.stringify(failedSourceCalls[0].messages)).toContain("FAILED_SOURCE_INPUT")
    expect(JSON.stringify(failedSourceCalls[0].messages)).toContain("INVALID_SOURCE_JSON_TWO")
    expect(yield* history(invalidDone.children[0])).toEqual(failedSourceHistory)
    expect(yield* llm.calls).toBe(6)
  }),
)

it.instance("Workflow resume_from accepts a cancelled direct Task without borrowing its owner", () =>
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
    yield* llm.respond((hit) => {
      requests.push(hit.body)
      return reply().text("TASK_COPY_CONTINUED").usage({ input: 3, output: 5 }).stop().item()
    })
    const root = `/api/session/${parent.id}/workflow`
    const started = yield* post(root, {
      source: {
        type: "script",
        name: "resume-task",
        script: `complete(agent("CONTINUE_CANCELLED_TASK",#{resume_from:"${tasks[0].id}"}));`,
      },
    })
    const pending = yield* Schema.decodeUnknownEffect(Workflow.Info)(yield* started.json)
    const done = yield* terminal(`${root}/${pending.id}`)
    expect(done.status).toBe("completed")
    expect(done.children).toHaveLength(1)
    expect(done.children[0]).not.toBe(tasks[0].id)
    expect(done.tokens).toBe(8)
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
    expect(yield* llm.calls).toBe(5)
  }),
)

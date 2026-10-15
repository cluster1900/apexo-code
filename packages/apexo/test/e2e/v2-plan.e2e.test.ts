import { expect } from "bun:test"
import { Config, Effect, Layer, Schema, Stream } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { SessionMessage } from "@apexo/core/session/message"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { TestInstance } from "../fixture/fixture"
import { raw, reply, TestLLMServer } from "../lib/llm-server"
import { pollWithTimeout, testEffect } from "../lib/effect"
import path from "path"
import { decodeDataSchema } from "effect/unstable/encoding/Sse"

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

const QuestionResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({ id: Schema.String, questions: Schema.Array(Schema.Struct({ question: Schema.String })) }),
  ),
})
const SessionInfoResponse = Schema.Struct({ data: Schema.Struct({ agent: Schema.String }) })

const setup = (entry?: "ask" | "deny", shell?: "deny") =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    yield* Effect.promise(() =>
      Bun.write(
        path.join(instance.directory, "apexo.json"),
        JSON.stringify({
          snapshots: false,
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            ...(entry ? [{ action: "plan_enter", resource: "*", effect: entry }] : []),
            ...(shell ? [{ action: "bash", resource: "*", effect: shell }] : []),
          ],
          compaction: { auto: false },
          providers: {
            "v2-test": {
              name: "Plan provider",
              api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url, settings: { apiKey: "test" } },
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
      agent: "build",
      model: { providerID: "v2-test", id: "test-model" },
    })
    expect(created.status).toBe(200)
    const root = `/api/session/${(yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data.id}`
    const selected = HttpClient.get(root).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(SessionInfoResponse)),
      Effect.map((response) => response.data.agent),
    )
    const questions = HttpClient.get(`${root}/question`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(QuestionResponse)),
      Effect.map((response) => response.data),
    )
    const messages = HttpClient.get(`${root}/message?order=asc`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
      Effect.map((response) => response.data),
    )
    return { instance, llm, root, selected, questions, messages }
  })

it.instance(
  "native Plan switches at the batch boundary and requires an explicit answer",
  () =>
    Effect.gen(function* () {
      const { llm, root, selected, questions, messages } = yield* setup()
      yield* llm.respond(() => reply().tool("plan_enter", {}).item())
      yield* llm.respond((hit) => {
        const request = JSON.stringify(hit.body)
        const filename = request.match(/Draft the plan at ([^;]+);/)?.[1]
        expect(filename).toBeDefined()
        const definitions = Schema.decodeUnknownSync(
          Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String }) })),
        )(hit.body.tools)
        expect(definitions.some((tool) => tool.function.name === "bash")).toBe(true)
        expect(definitions.some((tool) => tool.function.name === "task")).toBe(false)
        return raw({
          chunks: [
            {
              id: "plan_batch",
              object: "chat.completion.chunk",
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    tool_calls: [
                      {
                        index: 0,
                        id: "exit_batch",
                        type: "function",
                        function: { name: "plan_exit", arguments: "{}" },
                      },
                      {
                        index: 1,
                        id: "write_batch",
                        type: "function",
                        function: {
                          name: "write",
                          arguments: JSON.stringify({ path: filename, content: "REVIEW_THIS_BATCH_PLAN" }),
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            },
            {
              id: "plan_batch",
              object: "chat.completion.chunk",
              choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            },
          ],
        })
      })
      yield* llm.text("PLAN_APPROVED_DONE")
      const admission = yield* post(`${root}/prompt`, { id: "msg_plan_batch", prompt: { text: "Plan the change" } })
      expect(admission.status, yield* admission.text).toBe(200)
      yield* pollWithTimeout(
        questions.pipe(Effect.map((items) => (items.length === 1 ? items : undefined))),
        "Plan approval question",
        "10 seconds",
      ).pipe(
        Effect.tapError(() =>
          Effect.gen(function* () {
            yield* Effect.logError("Plan approval timeout state", {
              calls: yield* llm.calls,
              agent: yield* selected,
              questions: yield* questions,
              messages: yield* messages,
            })
          }),
        ),
      )
      const pending = (yield* questions)[0]!
      expect(pending.questions[0]!.question).toContain("REVIEW_THIS_BATCH_PLAN")
      expect(yield* selected).toBe("plan")
      expect(yield* llm.calls).toBe(2)
      expect((yield* messages).filter((message) => message.type === "user")).toHaveLength(1)
      expect((yield* post(`${root}/question/${pending.id}/reply`, { answers: [["Approve"]] })).status).toBe(204)
      expect((yield* post(`${root}/wait`)).status).toBe(204)
      expect(yield* selected).toBe("build")
      expect(yield* llm.calls).toBe(3)
      expect(yield* questions).toEqual([])
      expect((yield* post(`${root}/question/${pending.id}/reply`, { answers: [["Approve"]] })).status).toBe(204)
      expect((yield* post(`${root}/question/${pending.id}/reply`, { answers: [["Keep planning"]] })).status).toBe(409)
      expect(yield* llm.calls).toBe(3)
      expect((yield* messages).filter((message) => message.type === "user")).toHaveLength(1)
    }),
  { timeout: 30000 },
)

for (const outcome of ["reject", "unknown", "interrupt", "changed", "switched", "delete"] as const) {
  it.instance(
    `native Plan approval ${outcome} cannot switch or replay`,
    () =>
      Effect.gen(function* () {
        const state = yield* setup()
        const observed: { type: string; data: { requestID?: string } }[] = []
        const events = yield* HttpClient.get("/api/event")
        yield* events.stream.pipe(
          Stream.decodeText(),
          Stream.pipeThroughChannel(
            decodeDataSchema(
              Schema.Struct({
                type: Schema.String,
                data: Schema.Struct({ requestID: Schema.optional(Schema.String) }),
              }),
            ),
          ),
          Stream.runForEach((event) =>
            Effect.sync(() => {
              observed.push(event.data)
            }),
          ),
          Effect.forkScoped,
        )
        yield* pollWithTimeout(
          Effect.sync(() => observed.some((event) => event.type === "server.connected")),
          "Plan event subscription",
        )
        yield* state.llm.respond(() => reply().tool("plan_enter", {}).item())
        yield* state.llm.respond(() => reply().tool("plan_exit", {}).item())
        if (outcome === "unknown") yield* state.llm.text("KEEP_PLANNING")
        expect(
          (yield* post(`${state.root}/prompt`, { id: "msg_plan_decision", prompt: { text: "Prepare a plan" } })).status,
        ).toBe(200)
        const pending = (yield* pollWithTimeout(
          state.questions.pipe(Effect.map((items) => (items.length ? items : undefined))),
          "Plan question",
        ))[0]!
        expect(yield* state.selected).toBe("plan")
        if (outcome === "changed") {
          const filename = pending.questions[0]!.question.split("\n\n")[1]!
          yield* Effect.promise(() => Bun.write(filename, "CHANGED_AFTER_REVIEW"))
        }
        if (outcome === "switched") {
          expect((yield* post(`${state.root}/agent`, { agent: "build" })).status).toBe(204)
          expect((yield* post(`${state.root}/agent`, { agent: "plan" })).status).toBe(204)
        }
        const response =
          outcome === "interrupt"
            ? yield* post(`${state.root}/interrupt`)
            : outcome === "delete"
              ? yield* HttpClient.execute(HttpClientRequest.delete(state.root))
              : outcome === "reject"
                ? yield* post(`${state.root}/question/${pending.id}/reject`)
                : yield* post(`${state.root}/question/${pending.id}/reply`, {
                    answers: [[outcome === "changed" || outcome === "switched" ? "Approve" : "unexpected"]],
                  })
        expect(response.status).toBe(outcome === "changed" || outcome === "switched" ? 409 : 204)
        if (outcome === "changed" || outcome === "switched") {
          expect(yield* state.questions).toHaveLength(1)
          expect((yield* post(`${state.root}/question/${pending.id}/reject`)).status).toBe(204)
        }
        if (outcome === "delete") {
          expect(
            (yield* post("/api/session", {
              id: state.root.split("/").at(-1),
              location: { directory: state.instance.directory },
              agent: "build",
              model: { providerID: "v2-test", id: "test-model" },
            })).status,
          ).toBe(200)
          expect(yield* state.selected).toBe("build")
          expect(yield* state.messages).toEqual([])
        } else {
          expect((yield* post(`${state.root}/wait`)).status).toBe(204)
          expect(yield* state.selected).toBe("plan")
          expect((yield* state.messages).filter((message) => message.type === "user")).toHaveLength(1)
        }
        expect(yield* state.questions).toEqual([])
        if (outcome === "interrupt") {
          yield* pollWithTimeout(
            Effect.sync(() =>
              observed.some((event) => event.type === "question.v2.rejected" && event.data.requestID === pending.id),
            ),
            "active Stop rejection event",
          )
          expect(
            observed.filter((event) => event.type === "question.v2.rejected" && event.data.requestID === pending.id),
          ).toHaveLength(1)
        }
        if (outcome === "delete" || outcome === "unknown")
          expect(
            observed.filter((event) => event.type === "question.v2.rejected" && event.data.requestID === pending.id),
          ).toHaveLength(0)
        expect((yield* post(`${state.root}/question/${pending.id}/reply`, { answers: [["Approve"]] })).status).toBe(
          outcome === "delete" ? 404 : 409,
        )
        expect(yield* state.llm.calls).toBe(outcome === "unknown" ? 3 : 2)
      }),
    { timeout: 30000 },
  )
}

it.instance(
  "native Plan permission ask precedes entry and plan writes stay in the captured artifact",
  () =>
    Effect.gen(function* () {
      const state = yield* setup("ask")
      yield* state.llm.respond(() => reply().tool("plan_enter", {}).item())
      yield* state.llm.respond(() =>
        reply().tool("write", { path: "outside-plan.txt", content: "MUST_NOT_WRITE" }).item(),
      )
      yield* state.llm.respond(() => reply().tool("bash", { command: "touch forbidden-shell.txt" }).item())
      yield* state.llm.text("STILL_PLANNING")
      expect(
        (yield* post(`${state.root}/prompt`, { id: "msg_plan_ask", prompt: { text: "Plan safely" } })).status,
      ).toBe(200)
      const permissions = HttpClient.get(`${state.root}/permission`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) })),
        ),
        Effect.map((response) => response.data),
      )
      const pending = (yield* pollWithTimeout(
        permissions.pipe(Effect.map((items) => (items.length ? items : undefined))),
        "Plan entry permission",
      ))[0]!
      expect(yield* state.selected).toBe("build")
      expect(yield* state.llm.calls).toBe(1)
      expect((yield* post(`${state.root}/permission/${pending.id}/reply`, { reply: "once" })).status).toBe(204)
      const shell = yield* pollWithTimeout(
        permissions.pipe(Effect.map((items) => items.find((item) => item.id !== pending.id))),
        "Plan shell permission",
      )
      expect(yield* state.llm.calls).toBe(3)
      expect((yield* post(`${state.root}/permission/${shell.id}/reply`, { reply: "reject" })).status).toBe(204)
      expect((yield* post(`${state.root}/wait`)).status).toBe(204)
      expect(yield* state.selected).toBe("plan")
      expect(
        yield* Effect.promise(() => Bun.file(path.join(state.instance.directory, "outside-plan.txt")).exists()),
      ).toBe(false)
      expect(
        yield* Effect.promise(() => Bun.file(path.join(state.instance.directory, "forbidden-shell.txt")).exists()),
      ).toBe(false)
      expect(yield* state.llm.calls).toBe(3)
    }),
  { timeout: 30000 },
)

it.instance(
  "native Plan configured denial survives a fabricated model call",
  () =>
    Effect.gen(function* () {
      const state = yield* setup("deny")
      yield* state.llm.respond((hit) => {
        const definitions = Schema.decodeUnknownSync(
          Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String }) })),
        )(hit.body.tools)
        expect(definitions.some((tool) => tool.function.name === "plan_enter")).toBe(false)
        return reply().tool("plan_enter", {}).item()
      })
      yield* state.llm.text("ENTRY_DENIED")
      expect(
        (yield* post(`${state.root}/prompt`, { id: "msg_plan_deny", prompt: { text: "Plan is denied" } })).status,
      ).toBe(200)
      expect((yield* post(`${state.root}/wait`)).status).toBe(204)
      expect(yield* state.selected).toBe("build")
      expect(yield* state.questions).toEqual([])
      expect(yield* state.llm.calls).toBe(2)
    }),
  { timeout: 30000 },
)

for (const kind of ["stream-error", "cancel-stream"] as const) {
  it.instance(
    `native Plan does not execute a transition after ${kind}`,
    () =>
      Effect.gen(function* () {
        const state = yield* setup()
        yield* state.llm.respond(() =>
          kind === "stream-error"
            ? reply().tool("plan_enter", {}).streamError("MODEL_BATCH_FAILED").item()
            : reply().tool("plan_enter", {}).hang().item(),
        )
        expect(
          (yield* post(`${state.root}/prompt`, {
            id: "msg_plan_failedstream",
            prompt: { text: "Plan only after the full batch" },
          })).status,
        ).toBe(200)
        yield* state.llm.wait(1)
        if (kind === "cancel-stream") expect((yield* post(`${state.root}/interrupt`)).status).toBe(204)
        yield* post(`${state.root}/wait`)
        expect(yield* state.selected).toBe("build")
        expect(yield* state.questions).toEqual([])
        expect(yield* state.llm.calls).toBe(1)
        expect((yield* state.messages).filter((item) => item.type === "agent-switched")).toEqual([])
      }),
    { timeout: 30000 },
  )
}

for (const choice of ["once", "deny"] as const) {
  it.instance(
    `native Plan shell ${choice} preserves ordinary permission and mode`,
    () =>
      Effect.gen(function* () {
        const state = yield* setup(undefined, choice === "deny" ? "deny" : undefined)
        yield* state.llm.respond(() => reply().tool("plan_enter", {}).item())
        yield* state.llm.respond(() => reply().tool("bash", { command: "printf PLAN_SHELL > shell-result.txt" }).item())
        yield* state.llm.text("SHELL_SETTLED_STILL_PLAN")
        expect(
          (yield* post(`${state.root}/prompt`, {
            id: "msg_plan_shell",
            prompt: { text: "Inspect with an approved shell command" },
          })).status,
        ).toBe(200)
        if (choice === "once") {
          const pending = yield* pollWithTimeout(
            HttpClient.get(`${state.root}/permission`).pipe(
              Effect.flatMap((response) => response.json),
              Effect.flatMap(
                Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) })),
              ),
              Effect.map((response) => response.data[0]),
            ),
            "Plan shell ask",
          )
          expect(yield* state.llm.calls).toBe(2)
          expect(
            yield* Effect.promise(() => Bun.file(path.join(state.instance.directory, "shell-result.txt")).exists()),
          ).toBe(false)
          expect((yield* post(`${state.root}/permission/${pending.id}/reply`, { reply: "once" })).status).toBe(204)
        }
        expect((yield* post(`${state.root}/wait`)).status).toBe(204)
        expect(yield* state.selected).toBe("plan")
        expect(
          yield* Effect.promise(() => Bun.file(path.join(state.instance.directory, "shell-result.txt")).exists()),
        ).toBe(choice === "once")
        expect(yield* state.llm.calls).toBe(3)
        expect((yield* state.messages).filter((message) => message.type === "user")).toHaveLength(1)
      }),
    { timeout: 30000 },
  )
}

import { Goal } from "@apexo/schema/goal"
import { describe, expect } from "bun:test"
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
const post = (url: string, body: unknown) =>
  HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))

const GoalResponse = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  phase: Schema.String,
  tokensUsed: Schema.Number,
  verificationRounds: Schema.Number,
  summary: Schema.optional(Goal.Summary),
})
const reportPath = (body: Record<string, unknown>, key: string) => {
  const messages = body.messages as { content: string }[]
  const text = messages
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
    .join("\n")
  const value = new RegExp(`${key}=("[^"\n]+")`).exec(text)?.[1]
  if (!value) throw new Error(`Missing ${key} in native Goal request`)
  return JSON.parse(value) as string
}

describe.each(["concurrent", "after-evaluation"])("Native V2 Goal (%s)", (scheduling) => {
  it.instance(
    "plans, works, evaluates and verifies through durable V2 child Sessions",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const llm = yield* TestLLMServer
        const diagnostic = { stage: "configuration", sessionID: "", goalID: "", startedAt: Date.now() }
        yield* Effect.sleep("25 seconds").pipe(
          Effect.andThen(
            Effect.gen(function* () {
              console.error("Native Goal deadline diagnostic", {
                ...diagnostic,
                elapsed: Date.now() - diagnostic.startedAt,
                calls: yield* llm.calls,
              })
            }),
          ),
          Effect.forkScoped,
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(instance.directory, "apexo.json"),
            JSON.stringify({
              goal: { verifier_count: 1 },
              snapshots: true,
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
              providers: {
                "v2-test": {
                  name: "V2 provider",
                  api: {
                    type: "aisdk",
                    package: "@ai-sdk/openai-compatible",
                    url: llm.url,
                    settings: { apiKey: "test" },
                  },
                  models: {
                    "test-model": {
                      name: "test",
                      capabilities: { tools: true, input: ["text"], output: ["text"] },
                      limit: { context: 100000, output: 4096 },
                    },
                  },
                },
              },
            }),
          ),
        )
        diagnostic.stage = "create Session"
        const created = yield* post("/api/session", {
          location: { directory: instance.directory },
          model: { providerID: "v2-test", id: "test-model" },
          agent: "build",
        })
        expect(created.status).toBe(200)
        const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
        const root = `/api/session/${session.id}/goal`
        const goalID = "goal_v2native"
        diagnostic.sessionID = session.id
        diagnostic.goalID = goalID
        diagnostic.stage = "create Goal"
        const persisted = yield* post(root, {
          id: goalID,
          objective: "Inspect the workspace and report that the native V2 transport is working.",
        })
        expect(persisted.status).toBe(200)
        expect(yield* llm.calls).toBe(0)
        yield* llm.respond((hit) =>
          reply()
            .tool("goal_report_write", {
              path: reportPath(hit.body, "PLAN_FILE"),
              content: "Verify native execution and its durable evidence.",
            })
            .usage({ input: 1, output: 1 })
            .item(),
        )
        yield* llm.text("Done", { usage: { input: 1, output: 1 } })
        const workerGate = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => workerGate.resolve()))
        yield* llm.push(
          reply()
            .text("Native execution has completed the requested inspection.")
            .usage({ input: 1, output: 1 })
            .wait(workerGate.promise)
            .stop(),
        )
        yield* llm.textMatch(
          (hit) => JSON.stringify(hit.body.messages).includes("Create a new anchored summary"),
          "## Objective\nNative execution verified. Continue independent review.",
          { usage: { input: 3, output: 4 } },
        )
        yield* llm.text(
          JSON.stringify({
            decision: "candidate_complete",
            evidence: "Worker transcript contains the requested result",
            next_step: "Independently verify it",
            blocker_key: "",
          }),
          { usage: { input: 1, output: 1 } },
        )
        yield* llm.respond((hit) =>
          reply()
            .tool("goal_report_write", {
              path: reportPath(hit.body, "VERDICT_FILE"),
              content: JSON.stringify({
                achieved: true,
                evidence: "Native projected worker result verified",
                unmet: [],
                confidence: "high",
                blocking: "none",
              }),
            })
            .usage({ input: 1, output: 1 })
            .item(),
        )
        yield* llm.respond((hit) =>
          reply()
            .tool("goal_report_write", {
              path: reportPath(hit.body, "DETAILS_FILE"),
              content: "# Verification\nThe original requirement is satisfied by the native worker transcript.",
            })
            .usage({ input: 1, output: 1 })
            .item(),
        )
        yield* llm.text("Done", { usage: { input: 1, output: 1 } })
        yield* llm.respond((hit) => {
          expect(JSON.stringify(hit.body)).toContain("optional closing summary")
          expect(hit.body.tools ?? []).toEqual([])
          return reply()
            .text("The native execution and its durable evidence were independently verified.")
            .usage({ input: 1, output: 1 })
            .stop()
            .item()
        })
        yield* llm.text("QUEUED_AFTER_GOAL", { usage: { input: 1, output: 1 } })
        expect(
          (yield* post(`/api/session/${session.id}/prompt`, {
            id: "msg_v2goalqueue",
            prompt: { text: "Respond after this Goal becomes idle" },
            delivery: "queue",
            resume: false,
          })).status,
        ).toBe(200)
        diagnostic.stage = "start Goal"
        const started = yield* post(`${root}/${goalID}/start`, {
          agent: "build",
          model: { providerID: "v2-test", id: "test-model" },
        })
        expect(started.status).toBe(200)
        diagnostic.stage = "wait for worker provider request"
        yield* llm.wait(3)
        diagnostic.stage = "compact held worker"
        const compactAdmission = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => compactAdmission.resolve()))
        if (scheduling === "concurrent") compactAdmission.resolve()
        const compact = yield* Effect.promise(() => compactAdmission.promise).pipe(
          Effect.andThen(HttpClient.execute(HttpClientRequest.post(`/api/session/${session.id}/compact`))),
          Effect.forkChild,
        )
        yield* Effect.yieldNow
        workerGate.resolve()
        if (scheduling === "after-evaluation") {
          yield* llm.wait(4)
          expect(JSON.stringify((yield* llm.hits)[3].body.messages)).toContain(
            "independent hidden completion evaluator",
          )
          compactAdmission.resolve()
        }
        expect((yield* Fiber.join(compact)).status).toBe(204)
        diagnostic.stage = "wait for verification and summary"
        const result = yield* pollWithTimeout(
          HttpClient.get(root).pipe(
            Effect.flatMap((response) => response.json),
            Effect.flatMap(Schema.decodeUnknownEffect(GoalResponse)),
            Effect.map((goal) =>
              goal.status !== "active" && (goal.status !== "complete" || goal.summary?.status === "completed")
                ? goal
                : undefined,
            ),
          ),
          "Native Goal did not settle",
          "20 seconds",
        )
        diagnostic.stage = "wait for queued provider request"
        yield* llm.wait(10)
        diagnostic.stage = "wait for idle Session"
        yield* pollWithTimeout(
          HttpClient.get("/api/session/active").pipe(
            Effect.flatMap((response) => response.json),
            Effect.map((value) =>
              Object.keys((value as { data: Record<string, unknown> }).data).length === 0 ? true : undefined,
            ),
          ),
          "Queued native turn did not settle",
          "10 seconds",
        )
        expect(result.status).toBe("complete")
        const hits = yield* llm.hits
        const compactionIndex = hits.findIndex((hit) =>
          JSON.stringify(hit.body.messages).includes("Create a new anchored summary"),
        )
        const evaluationIndex = hits.findIndex((hit) =>
          JSON.stringify(hit.body.messages).includes("independent hidden completion evaluator"),
        )
        expect(compactionIndex).toBeGreaterThan(-1)
        expect(evaluationIndex).toBeGreaterThan(-1)
        // A queued control may arrive before the worker boundary or after Goal completion.
        // Only compaction inside the active Goal contributes its seven tokens to the Goal ledger.
        expect(
          hits.filter((hit) => JSON.stringify(hit.body.messages).includes("Create a new anchored summary")),
        ).toHaveLength(1)
        expect(result.tokensUsed).toBe(
          scheduling === "after-evaluation" ? 16 : compactionIndex < evaluationIndex ? 23 : 16,
        )
        expect(result.verificationRounds).toBe(1)
        expect(result.summary).toMatchObject({ status: "completed", tokensUsed: 2 })
        expect(yield* llm.calls).toBe(10)
        diagnostic.stage = "verify durable reports and history"
        const reports = yield* HttpClient.get(`${root}/${goalID}/reports`)
        expect(reports.status).toBe(200)
        const reportList = yield* Schema.decodeUnknownEffect(Schema.Array(Goal.Report))(yield* reports.json)
        expect(reportList).toHaveLength(2)
        const missing = yield* HttpClient.get(`${root}/${goalID}/reports/review-missing/plan`)
        expect(missing.status).toBe(404)
        expect(yield* missing.json).toMatchObject({ _tag: "GoalReportNotFoundError" })
        const messages = yield* HttpClient.get(`/api/session/${session.id}/message`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
        )
        expect(messages.data.filter((message) => message.type === "assistant")).toHaveLength(2)
        expect(messages.data.filter((message) => message.type === "user")).toHaveLength(2)
        expect(messages.data.some((message) => message.type === "assistant" && message.snapshot?.start)).toBe(true)
        expect(messages.data.filter((message) => message.type === "compaction")).toHaveLength(1)
        const verification = hits.find((hit) => JSON.stringify(hit.body.messages).includes("VERDICT_FILE="))
        expect(verification).toBeDefined()
        expect(JSON.stringify(verification!.body)).not.toContain('\\"snapshot\\":')

        const full = yield* HttpClient.get(root).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Goal.Info)),
        )
        yield* Effect.promise(() => Bun.write(full.plannerFiles!.plan.path, "Altered report"))
        const invalid = yield* HttpClient.get(
          `${root}/${goalID}/reports/${reportList.find((report) => report.kind === "planning")!.id}/plan`,
        )
        expect(invalid.status).toBe(400)
        expect(yield* invalid.json).toMatchObject({ _tag: "InvalidRequestError" })

        const budgetID = "goal_v2budget"
        diagnostic.goalID = budgetID
        diagnostic.stage = "create budget Goal"
        expect(
          (yield* post(root, { id: budgetID, objective: "Stop at the actual transport budget", tokenBudget: 2 }))
            .status,
        ).toBe(200)
        yield* llm.respond((hit) =>
          reply()
            .tool("goal_report_write", { path: reportPath(hit.body, "PLAN_FILE"), content: "Budget plan" })
            .usage({ input: 1, output: 1 })
            .item(),
        )
        expect(
          (yield* post(`${root}/${budgetID}/start`, {
            agent: "build",
            model: { providerID: "v2-test", id: "test-model" },
          })).status,
        ).toBe(200)
        diagnostic.stage = "wait for budget settlement"
        const budget = yield* pollWithTimeout(
          HttpClient.get(root).pipe(
            Effect.flatMap((response) => response.json),
            Effect.flatMap(Schema.decodeUnknownEffect(GoalResponse)),
            Effect.map((value) => (value.status !== "active" ? value : undefined)),
          ),
          "Budget did not stop native transport",
          "10 seconds",
        )
        expect(budget.status).toBe("budget_limited")
        expect(budget.tokensUsed).toBe(2)
        expect(yield* llm.calls).toBe(11)
        expect((yield* HttpClient.execute(HttpClientRequest.post(`${root}/${budgetID}/resume`))).status).toBe(409)
        expect((yield* HttpClient.del(`${root}/${budgetID}`)).status).toBe(204)

        const pauseID = "goal_v2pause"
        diagnostic.goalID = pauseID
        diagnostic.stage = "create pause Goal"
        expect((yield* post(root, { id: pauseID, objective: "Pause during independent planning" })).status).toBe(200)
        yield* llm.hang
        expect(
          (yield* post(`${root}/${pauseID}/start`, {
            agent: "build",
            model: { providerID: "v2-test", id: "test-model" },
          })).status,
        ).toBe(200)
        diagnostic.stage = "wait for pause provider request"
        yield* llm.wait(12)
        const active = yield* HttpClient.get("/api/session/active").pipe(Effect.flatMap((response) => response.json))
        expect(Object.keys((active as { data: Record<string, unknown> }).data)).toHaveLength(2)
        diagnostic.stage = "join Goal pause"
        expect((yield* HttpClient.execute(HttpClientRequest.post(`${root}/${pauseID}/pause`))).status).toBe(200)
        const idle = yield* HttpClient.get("/api/session/active").pipe(Effect.flatMap((response) => response.json))
        expect((idle as { data: Record<string, unknown> }).data).toEqual({})
        expect(yield* llm.calls).toBe(12)
        expect((yield* HttpClient.del(`${root}/${pauseID}/reports`)).status).toBe(409)
        expect((yield* HttpClient.del(`${root}/${pauseID}`)).status).toBe(204)
        diagnostic.stage = "assertions completed; joining fixture cleanup"
      }),
    { git: true },
    30000,
  )
})

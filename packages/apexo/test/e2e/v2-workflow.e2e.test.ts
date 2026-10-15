import { Workflow } from "@apexo/schema/workflow"
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

it.instance("Workflow Git evidence preserves configured denials after Session grants", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    const secret = path.join(instance.directory, "secret.txt")
    yield* Effect.promise(async () => {
      await Bun.write(
        path.join(instance.directory, "apexo.json"),
        JSON.stringify({
          permission: { "*": "allow" },
          agent: { restricted: { permission: { "*": "allow", read: { "*": "allow", [secret]: "deny" } } } },
        }),
      )
      await Bun.write(path.join(instance.directory, "public.txt"), "before\n")
      await Bun.write(secret, "before\n")
      await Bun.$`git init --initial-branch=fixture`.cwd(instance.directory).quiet()
      await Bun.$`git add public.txt secret.txt`.cwd(instance.directory).quiet()
      await Bun.$`git -c commit.gpgsign=false -c user.name=Fixture -c user.email=fixture@example.invalid commit -m baseline`
        .cwd(instance.directory)
        .quiet()
      await Bun.write(path.join(instance.directory, "public.txt"), "PUBLIC_WORKFLOW_CHANGE\n")
      await Bun.write(secret, "PRIVATE_WORKFLOW_CHANGE\n")
    })
    const baseline = (yield* Effect.promise(() =>
      Bun.$`git rev-parse HEAD`.cwd(instance.directory).quiet().text(),
    )).trim()
    const created = yield* post("/api/session", { location: { directory: instance.directory }, agent: "restricted" })
    expect(created.status).toBe(200)
    const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
    const root = `/api/session/${session.id}/workflow`
    const grant = yield* HttpClientRequest.patch(
      `/session/${session.id}?directory=${encodeURIComponent(instance.directory)}`,
    ).pipe(
      HttpClientRequest.bodyJson({ permission: [{ permission: "read", pattern: "*", action: "allow" }] }),
      Effect.flatMap(HttpClient.execute),
    )
    expect(grant.status).toBe(200)
    yield* grant.json
    const started = yield* post(root, {
      source: { type: "script", name: "permission-evidence", script: `complete(git_diff_since("${baseline}"));` },
      agentBudget: 1,
    })
    expect(started.status).toBe(200)
    const info = yield* Schema.decodeUnknownEffect(Workflow.Info)(yield* started.json)
    const result = yield* terminal(`${root}/${info.id}`)
    expect(result.status).toBe("completed")
    expect(result.result).toContain("PUBLIC_WORKFLOW_CHANGE")
    expect(result.result).not.toContain("PRIVATE_WORKFLOW_CHANGE")
    expect(result.children).toEqual([])
    expect(result.agentsSpent).toBe(0)
    expect(yield* llm.calls).toBe(0)
  }),
)

it.instance(
  "native Deep Research and real Rhai use independent bounded child Sessions",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* Effect.promise(() =>
        Bun.write(
          path.join(instance.directory, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            compaction: { buffer: 10000, keep: { tokens: 0 } },
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            providers: {
              "v2-test": {
                name: "V2",
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
                  "compact-model": {
                    name: "Compaction test",
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 20000, output: 1024 },
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
        agent: "build",
      })
      const session = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* created.json)).data
      const root = `/api/session/${session.id}/workflow`
      const tools: string[][] = []
      const answer = (value: unknown) =>
        llm.respond((hit) => {
          const definitions = hit.body.tools as { function: { name: string } }[] | undefined
          tools.push((definitions ?? []).map((tool) => tool.function.name))
          return reply().text(JSON.stringify(value)).usage({ input: 2, output: 3 }).stop().item()
        })
      const plannerGate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => plannerGate.resolve()))
      yield* llm.push(
        reply()
          .text(JSON.stringify({ questions: ["First evidence target", "Second evidence target"] }))
          .usage({ input: 2, output: 3 })
          .wait(plannerGate.promise)
          .stop(),
      )
      for (const _ of [1, 2])
        yield* answer({
          claims: [
            { claim: "Supported fact", evidence: "Primary source inspected", url: "https://example.com/source" },
          ],
          uncertainties: [],
        })
      for (const _ of [1, 2])
        yield* answer({
          accepted: [{ claim: "Supported fact", evidence: "Independently checked", url: "https://example.com/source" }],
          rejected: [],
        })
      yield* answer({
        report: "Supported fact [source](https://example.com/source)",
        sources: ["https://example.com/source"],
      })
      const started = yield* post(root, {
        source: { type: "builtin", name: "deep-research" },
        args: { query: "Research evidence" },
        agentBudget: 6,
        concurrency: 2,
      })
      const startedBody = yield* started.json
      if (started.status !== 200) console.error(startedBody)
      expect(started.status).toBe(200)
      const first = yield* Schema.decodeUnknownEffect(Workflow.Info)(startedBody)
      yield* llm.wait(1)
      const running = yield* HttpClient.get(`${root}/${first.id}`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Workflow.Info)),
      )
      expect(running.children).toHaveLength(1)
      const compact = yield* HttpClient.execute(
        HttpClientRequest.post(`/api/session/${running.children[0]}/compact`),
      ).pipe(Effect.forkChild)
      yield* Effect.sleep("30 millis")
      plannerGate.resolve()
      expect((yield* Fiber.join(compact)).status).toBe(503)
      const research = yield* terminal(`${root}/${first.id}`)
      expect(research).toMatchObject({ status: "completed", agentsSpent: 6, tokens: 30 })
      expect(new Set(research.children).size).toBe(6)
      expect(yield* llm.calls).toBe(6)
      expect(
        tools.every((names) => !names.includes("workflow") && !names.includes("write") && !names.includes("bash")),
      ).toBe(true)
      expect(
        (yield* HttpClient.execute(HttpClientRequest.post(`/api/session/${research.children[0]}/compact`))).status,
      ).toBe(503)
      const orphan = yield* post(`/api/session/${research.children[0]}/workflow`, {
        source: { type: "builtin", name: "deep-research" },
      })
      expect(orphan.status).toBe(400)
      yield* orphan.json
      yield* llm.text("Script child", { usage: { input: 1, output: 2 } })
      const script = yield* post(root, {
        source: {
          type: "script",
          name: "saved-review",
          script:
            'let meta = #{name: "saved-review", description: "native"}; let r = agent("Inspect evidence", #{capability_mode: "read-only"}); complete(r.output);',
        },
        agentBudget: 1,
      })
      expect(script.status).toBe(200)
      const second = yield* Schema.decodeUnknownEffect(Workflow.Info)(yield* script.json)
      expect(yield* terminal(`${root}/${second.id}`)).toMatchObject({
        status: "completed",
        agentsSpent: 1,
        result: "Script child",
      })
      expect(yield* llm.calls).toBe(7)
      const compactCreated = yield* post("/api/session", {
        location: { directory: instance.directory },
        model: { providerID: "v2-test", id: "compact-model" },
        agent: "build",
      })
      const compactSession = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* compactCreated.json)).data
      yield* llm.text("## Objective\nInspect evidence and return the result.", { usage: { input: 3, output: 4 } })
      yield* llm.text("Compacted script child", { usage: { input: 1, output: 2 } })
      const compactWorkflow = yield* post(`/api/session/${compactSession.id}/workflow`, {
        source: {
          type: "script",
          name: "compaction-usage",
          script: `let meta = #{name: "compaction-usage"}; let r = agent(${JSON.stringify("Inspect evidence. ".repeat(3000))}, #{capability_mode: "read-only"}); complete(r.output);`,
        },
        agentBudget: 1,
      })
      expect(compactWorkflow.status).toBe(200)
      const third = yield* Schema.decodeUnknownEffect(Workflow.Info)(yield* compactWorkflow.json)
      expect(yield* terminal(`/api/session/${compactSession.id}/workflow/${third.id}`)).toMatchObject({
        status: "completed",
        agentsSpent: 1,
        tokens: 10,
        result: "Compacted script child",
      })
      expect(yield* llm.calls).toBe(9)
    }),
  { timeout: 30000 },
)

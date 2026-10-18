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

it.instance("Workflow selected agents use native models, prompts and parent permission ceilings", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    const secret = path.join(instance.directory, "secret.txt")
    yield* Effect.promise(() => Bun.write(secret, "WORKFLOW_PRIVATE_CONTENT"))
    yield* Effect.promise(() => Bun.write(path.join(instance.directory, "public.txt"), "WORKFLOW_PUBLIC_CONTENT"))
    yield* Effect.promise(() =>
      Bun.write(
        path.join(instance.directory, "apexo.json"),
        JSON.stringify({
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          agents: {
            parent: {
              system: "PARENT_AGENT_MARKER",
              permissions: [
                { action: "*", resource: "*", effect: "allow" },
                { action: "read", resource: "*secret.txt", effect: "deny" },
                { action: "task", resource: "blocked", effect: "deny" },
              ],
            },
            helper: {
              mode: "subagent",
              model: "agent-fixture/selected",
              system: "SELECTED_AGENT_MARKER",
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
            },
            blocked: { mode: "subagent", model: "agent-fixture/selected" },
            primary: { mode: "primary" },
            hidden: { mode: "subagent", hidden: true },
          },
          providers: {
            "agent-fixture": {
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
    const response = yield* post("/api/session", {
      location: { directory: instance.directory },
      model: { providerID: "agent-fixture", id: "parent" },
      agent: "parent",
    })
    const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(yield* response.json)).data
    const root = `/api/session/${parent.id}/workflow`
    const observed: Record<string, unknown>[] = []
    yield* llm.respond((hit) => {
      observed.push(hit.body)
      return reply().tool("read", { filePath: secret }).item()
    })
    yield* llm.respond((hit) => {
      observed.push(hit.body)
      return reply()
        .tool("read", { filePath: path.join(instance.directory, "public.txt") })
        .item()
    })
    yield* llm.respond((hit) => {
      observed.push(hit.body)
      return reply().text("DENIAL_CONFIRMED").stop().item()
    })
    yield* llm.respond((hit) => {
      observed.push(hit.body)
      return reply().text("OVERRIDE_CONFIRMED").stop().item()
    })
    const started = yield* post(root, {
      source: {
        type: "script",
        name: "selected-agents",
        script:
          'let first = agent("Inspect the secret", #{agent_type:"helper"}); await_user("verification", "Inspect selected agent"); let second = agent("Explicit model", #{agent_type:"helper",model:"agent-fixture/override"}); complete(#{first:first.output,second:second.output});',
      },
      agentBudget: 2,
    })
    const pending = yield* Schema.decodeUnknownEffect(Workflow.Info)(yield* started.json)
    const paused = yield* terminal(`${root}/${pending.id}`)
    expect(paused.status).toBe("paused")
    expect(paused.children).toHaveLength(1)
    expect(yield* llm.calls).toBe(3)
    const resumed = yield* post(`${root}/${pending.id}/resume`, {})
    expect(resumed.status).toBe(200)
    yield* resumed.json
    const done = yield* terminal(`${root}/${pending.id}`)
    expect(done.status).toBe("completed")
    expect(done.children).toHaveLength(2)
    expect(done.result).toEqual({ first: "DENIAL_CONFIRMED", second: "OVERRIDE_CONFIRMED" })
    expect(yield* llm.calls).toBe(4)
    expect(observed.map((body) => body.model)).toEqual(["selected", "selected", "selected", "override"])
    const messages = observed[0]!.messages as { role: string; content: unknown }[]
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n")
    expect(system).toContain("SELECTED_AGENT_MARKER")
    expect(system).not.toContain("PARENT_AGENT_MARKER")
    const continued = observed[1]!.messages as { role: string; content: unknown }[]
    const results = continued.filter((message) => message.role === "tool").map((message) => message.content)
    expect(results).toHaveLength(1)
    expect(JSON.stringify(results)).not.toContain("WORKFLOW_PRIVATE_CONTENT")
    expect(JSON.stringify(results)).toContain("Unable to read")
    const publicResults = (observed[2]!.messages as { role: string; content: unknown }[])
      .filter((message) => message.role === "tool")
      .map((message) => message.content)
    expect(JSON.stringify(publicResults)).toContain("WORKFLOW_PUBLIC_CONTENT")
    expect(JSON.stringify(publicResults)).not.toContain("WORKFLOW_PRIVATE_CONTENT")
    for (const agent of ["missing", "primary", "hidden", "blocked"]) {
      const rejected = yield* post(root, {
        source: {
          type: "script",
          name: "rejected-agent",
          script: `complete(agent("Do not run", #{agent_type:"${agent}"}));`,
        },
      })
      const info = yield* Schema.decodeUnknownEffect(Workflow.Info)(yield* rejected.json)
      const failed = yield* terminal(`${root}/${info.id}`)
      expect(failed.status).toBe("failed")
      expect(failed.children).toEqual([])
    }
    expect(yield* llm.calls).toBe(4)
  }),
)

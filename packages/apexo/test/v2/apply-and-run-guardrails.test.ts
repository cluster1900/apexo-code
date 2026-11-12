import { expect } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { createServer, type ServerResponse } from "node:http"
import path from "node:path"
import { AgentV2 } from "@apexo/core/agent"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { ModelV2 } from "@apexo/core/model"
import { ModelsDev } from "@apexo/core/models-dev"
import { ProviderV2 } from "@apexo/core/provider"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionInputExecution } from "@apexo/core/session/input-execution"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionStore } from "@apexo/core/session/store"
import { AbsolutePath } from "@apexo/schema/schema"
import { Effect, Layer } from "effect"
import type { ApplyReport } from "../../src/cli/cmd/apply"
import type { ParallelAttemptsReport } from "../../src/cli/run-attempts"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { httpError, reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
const apexoRoot = path.resolve(import.meta.dir, "../..")

async function spawnCli(args: ReadonlyArray<string>, env: Record<string, string | undefined>) {
  const proc = Bun.spawn(["bun", "src/index.ts", ...args], {
    cwd: apexoRoot,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

function writeSse(res: ServerResponse, events: ReadonlyArray<Record<string, unknown>>) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
  for (const event of events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  res.write("data: [DONE]\n\n")
  res.end()
}

function responsesTextEvents(text: string, usage = { input_tokens: 100, output_tokens: 50, total_tokens: 150 }) {
  return [
    {
      type: "response.created",
      sequence_number: 1,
      response: { id: "resp_txt", object: "response", status: "in_progress", model: "fixture", output: [] },
    },
    {
      type: "response.output_item.added",
      sequence_number: 2,
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [], status: "in_progress" },
    },
    {
      type: "response.output_text.delta",
      sequence_number: 3,
      item_id: "msg_1",
      output_index: 0,
      content_index: 0,
      delta: text,
      logprobs: [],
    },
    {
      type: "response.output_item.done",
      sequence_number: 4,
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [], status: "completed" },
    },
    {
      type: "response.completed",
      sequence_number: 5,
      response: {
        id: "resp_txt",
        object: "response",
        status: "completed",
        output: [],
        usage,
      },
    },
  ]
}

function responsesSingleToolEvents(
  callId: string,
  name: string,
  input: Record<string, unknown>,
  usage = { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
) {
  const args = JSON.stringify(input)
  return [
    {
      type: "response.created",
      sequence_number: 1,
      response: { id: "resp_tool", object: "response", status: "in_progress", model: "fixture", output: [] },
    },
    {
      type: "response.output_item.added",
      sequence_number: 2,
      output_index: 0,
      item: { type: "function_call", id: "fc_1", call_id: callId, name, arguments: "", status: "in_progress" },
    },
    {
      type: "response.function_call_arguments.delta",
      sequence_number: 3,
      output_index: 0,
      item_id: "fc_1",
      delta: args,
    },
    {
      type: "response.function_call_arguments.done",
      sequence_number: 4,
      output_index: 0,
      item_id: "fc_1",
      arguments: args,
    },
    {
      type: "response.output_item.done",
      sequence_number: 5,
      output_index: 0,
      item: { type: "function_call", id: "fc_1", call_id: callId, name, arguments: args, status: "completed" },
    },
    {
      type: "response.completed",
      sequence_number: 6,
      response: {
        id: "resp_tool",
        object: "response",
        status: "completed",
        output: [],
        usage,
      },
    },
  ]
}

const setupNativeGuardrails = Effect.gen(function* () {
  const root = yield* tmpdirScoped()
  const llm = yield* TestLLMServer
  yield* llm.reset
  yield* Effect.promise(async () => {
    await mkdir(path.join(root, "data"), { recursive: true })
    await Bun.write(
      path.join(root, "apexo.json"),
      JSON.stringify({
        snapshots: false,
        compaction: { auto: false },
        agents: {
          operator: {
            mode: "primary",
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
          },
        },
        providers: {
          primary: {
            name: "Primary Provider",
            api: {
              type: "aisdk",
              package: "@ai-sdk/openai-compatible",
              url: llm.url,
              settings: { apiKey: "primary-key" },
            },
            models: {
              priced: {
                name: "Primary Priced",
                capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
                limit: { context: 500000, output: 4096 },
                // $10 / 1M input, $30 / 1M output; over 200k context: $20 / 1M input, $60 / 1M output
                cost: [
                  { input: 10, output: 30, cache: { read: 1, write: 12.5 } },
                  {
                    tier: { type: "context", size: 200000 },
                    input: 20,
                    output: 60,
                    cache: { read: 2, write: 25 },
                  },
                ],
              },
              unpriced: {
                name: "Primary Unpriced",
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 100000, output: 4096 },
              },
            },
          },
          remotevision: {
            name: "Remote Vision Provider",
            api: {
              type: "aisdk",
              package: "@ai-sdk/openai-compatible",
              url: llm.url.replace(/^http:/, "HTTP:"),
              settings: { apiKey: "vision-key" },
            },
            models: {
              vision: {
                name: "Remote Vision",
                capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
                limit: { context: 500000, output: 4096 },
                cost: { input: 5, output: 15, cache: { read: 0.5, write: 5 } },
              },
            },
          },
          modelsdev: {
            name: "ModelsDev Builtin Override",
            api: {
              type: "aisdk",
              package: "@ai-sdk/openai-compatible",
              url: llm.url,
              settings: { apiKey: "modelsdev-key" },
            },
          },
          backup: {
            name: "Backup Provider",
            api: {
              type: "aisdk",
              package: "@ai-sdk/openai-compatible",
              url: llm.url,
              settings: { apiKey: "backup-key" },
            },
            models: {
              fast: {
                name: "Backup Fast",
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 500000, output: 4096 },
                cost: { input: 2, output: 8, cache: { read: 0.2, write: 2.5 } },
              },
            },
          },
        },
      }),
    )
  })
  return {
    root,
    llm,
    location: { directory: AbsolutePath.make(root) },
    app: AppNodeBuilder.build(
      LayerNode.group([
        SessionV2.node,
        SessionExecutionLocal.node,
        SessionInputExecution.node,
        SessionStore.node,
        Database.node,
      ]),
      [
        [SessionExecution.node, SessionExecutionLocal.node],
        [
          Global.node,
          Layer.succeed(Global.Service)(
            Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
          ),
        ],
        [
          ModelsDev.node,
          Layer.succeed(ModelsDev.Service, {
            get: () =>
              Effect.succeed({
                modelsdev: {
                  id: "modelsdev",
                  name: "ModelsDev Builtin",
                  env: [],
                  npm: "@ai-sdk/openai-compatible",
                  api: llm.url,
                  models: {
                    "unpriced-builtin": {
                      id: "unpriced-builtin",
                      name: "Unpriced Builtin Model",
                      release_date: "2026-01-01",
                      attachment: false,
                      reasoning: false,
                      temperature: true,
                      tool_call: true,
                      limit: { context: 128000, output: 4096 },
                    },
                  },
                },
              }),
            refresh: () => Effect.void,
          }),
        ],
      ],
    ),
  }
})

it.live(
  "Native SessionRunner enforces maxTurns, maxTokens, maxBudgetUsd (including tiered pricing and unpriced fail-closed), and fallbackModel without corrupting usage accounting",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setupNativeGuardrails
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const inputs = yield* SessionInputExecution.Service
        const store = yield* SessionStore.Service

        const waitTerminal = (sessionID: SessionV2.ID, inputID: SessionMessage.ID) =>
          pollWithTimeout(
            inputs
              .get({ sessionID, inputID })
              .pipe(Effect.map((receipt) => (SessionInputExecution.terminal(receipt) ? receipt : undefined))),
            `Timed out waiting for input ${inputID}`,
            "15 seconds",
          )

        // 1. maxTurns: 1 succeeds when model finishes in 1 turn without tool continuation
        yield* fixture.llm.reset
        yield* fixture.llm.text("single-turn-ok", { usage: { input: 40, output: 10 } })
        const sMax1Ok = yield* sessions.create({
          location: fixture.location,
          agent: AgentV2.ID.make("operator"),
          model: { providerID: ProviderV2.ID.make("primary"), id: ModelV2.ID.make("priced") },
        })
        const iMax1Ok = SessionMessage.ID.create()
        yield* sessions.prompt({
          sessionID: sMax1Ok.id,
          id: iMax1Ok,
          prompt: { text: "answer directly" },
          executionPolicy: { mode: "headless", permissions: "approve_once", maxTurns: 1 },
        })
        const rMax1Ok = yield* waitTerminal(sMax1Ok.id, iMax1Ok)
        expect(rMax1Ok.status).toBe("completed")
        expect(rMax1Ok.reason).toBe("completed")
        expect(rMax1Ok.usageIncomplete).toBe(false)
        expect(yield* fixture.llm.calls).toBe(1)

        // 2. maxTurns: 2 halts cleanly after turn 2 tool settlement when turn 2 still requests continuation
        yield* fixture.llm.reset
        yield* fixture.llm.push(
          reply().tool("bash", { command: "echo turn1", description: "t1" }).usage({ input: 50, output: 20 }).item(),
          reply().tool("bash", { command: "echo turn2", description: "t2" }).usage({ input: 70, output: 30 }).item(),
          reply().text("turn3-must-not-run").usage({ input: 80, output: 20 }).stop().item(),
        )
        const sMax2Stop = yield* sessions.create({
          location: fixture.location,
          agent: AgentV2.ID.make("operator"),
          model: { providerID: ProviderV2.ID.make("primary"), id: ModelV2.ID.make("priced") },
        })
        const iMax2Stop = SessionMessage.ID.create()
        yield* sessions.prompt({
          sessionID: sMax2Stop.id,
          id: iMax2Stop,
          prompt: { text: "keep calling tools" },
          executionPolicy: { mode: "headless", permissions: "approve_once", maxTurns: 2 },
        })
        const rMax2Stop = yield* waitTerminal(sMax2Stop.id, iMax2Stop)
        expect(rMax2Stop.status).toBe("failed")
        expect(rMax2Stop.reason).toBe("turn_limit")
        expect(rMax2Stop.usageIncomplete).toBe(false)
        expect(yield* fixture.llm.calls).toBe(2)
        const max2History = yield* store.context(sMax2Stop.id)
        const max2Tools = max2History
          .flatMap((msg) => (msg.type === "assistant" ? msg.content : []))
          .filter((part) => part.type === "tool")
        expect(max2Tools).toHaveLength(2)
        expect(max2Tools.every((part) => part.state.status === "completed")).toBe(true)

        // 3. maxTokens: enforces cumulative token budget across turns (halting before turn 3)
        yield* fixture.llm.reset
        yield* fixture.llm.push(
          // Turn 1: 150 + 50 = 200 tokens (< 300) -> allowed to continue to Turn 2
          reply().tool("bash", { command: "echo tok1", description: "tok1" }).usage({ input: 150, output: 50 }).item(),
          // Turn 2: 180 + 70 = 250 tokens (total 450 > 300) -> halts before Turn 3 with budget_limit
          reply().tool("bash", { command: "echo tok2", description: "tok2" }).usage({ input: 180, output: 70 }).item(),
          reply().text("turn3-must-not-run").usage({ input: 100, output: 20 }).stop().item(),
        )
        const sMaxTok = yield* sessions.create({
          location: fixture.location,
          agent: AgentV2.ID.make("operator"),
          model: { providerID: ProviderV2.ID.make("primary"), id: ModelV2.ID.make("priced") },
        })
        const iMaxTok = SessionMessage.ID.create()
        yield* sessions.prompt({
          sessionID: sMaxTok.id,
          id: iMaxTok,
          prompt: { text: "run bounded tokens" },
          executionPolicy: { mode: "headless", permissions: "approve_once", maxTokens: 300 },
        })
        const rMaxTok = yield* waitTerminal(sMaxTok.id, iMaxTok)
        expect(rMaxTok.status).toBe("failed")
        expect(rMaxTok.reason).toBe("budget_limit")
        expect(rMaxTok.usageIncomplete).toBe(false)
        expect(yield* fixture.llm.calls).toBe(2)

        // 4. maxBudgetUsd: enforces cumulative USD cost across turns + context-over-200k tiered rate
        // Base rate on primary/priced: $10/1M input, $30/1M output.
        // Turn 1: 10_000 input ($0.10) + 5_000 output ($0.15) = $0.25 (< $0.40) -> continues to Turn 2.
        // Turn 2: 250_000 input (> 200_000 context tier -> $20/1M = $5.00) + 1_000 output ($60/1M = $0.06) = $5.06 -> exceeds $0.40!
        yield* fixture.llm.reset
        yield* fixture.llm.push(
          reply()
            .tool("bash", { command: "echo usd1", description: "usd1" })
            .usage({ input: 10000, output: 5000 })
            .item(),
          reply()
            .tool("bash", { command: "echo usd2", description: "usd2" })
            .usage({ input: 250000, output: 1000 })
            .item(),
          reply().text("turn3-must-not-run").usage({ input: 1000, output: 100 }).stop().item(),
        )
        const sBudget = yield* sessions.create({
          location: fixture.location,
          agent: AgentV2.ID.make("operator"),
          model: { providerID: ProviderV2.ID.make("primary"), id: ModelV2.ID.make("priced") },
        })
        const iBudget = SessionMessage.ID.create()
        yield* sessions.prompt({
          sessionID: sBudget.id,
          id: iBudget,
          prompt: { text: "run bounded usd" },
          executionPolicy: { mode: "headless", permissions: "approve_once", maxBudgetUsd: 0.4 },
        })
        const rBudget = yield* waitTerminal(sBudget.id, iBudget)
        expect(rBudget.status).toBe("failed")
        expect(rBudget.reason).toBe("budget_limit")
        expect(rBudget.usageIncomplete).toBe(false)
        expect(yield* fixture.llm.calls).toBe(2)

        // 5. maxBudgetUsd fail-closed when model has no pricing metadata configured (0 provider calls!)
        yield* fixture.llm.reset
        const sUnpriced = yield* sessions.create({
          location: fixture.location,
          agent: AgentV2.ID.make("operator"),
          model: { providerID: ProviderV2.ID.make("primary"), id: ModelV2.ID.make("unpriced") },
        })
        const iUnpriced = SessionMessage.ID.create()
        yield* sessions.prompt({
          sessionID: sUnpriced.id,
          id: iUnpriced,
          prompt: { text: "must not call unpriced model" },
          executionPolicy: { mode: "headless", permissions: "approve_once", maxBudgetUsd: 1.0 },
        })
        const rUnpriced = yield* waitTerminal(sUnpriced.id, iUnpriced)
        expect(rUnpriced.status).toBe("failed")
        expect(rUnpriced.reason).toBe("budget_limit")
        expect(yield* fixture.llm.calls).toBe(0)
        const unpricedHistory = yield* store.context(sUnpriced.id)
        const unpricedAssistant = unpricedHistory.find((msg) => msg.type === "assistant")
        expect(unpricedAssistant?.type).toBe("assistant")
        if (unpricedAssistant?.type === "assistant") {
          expect(unpricedAssistant.error?.message).toContain("no token pricing metadata configured")
        }

        // 5b. maxBudgetUsd ALSO fails closed for built-in ModelsDev models with `cost: undefined` (never treated as $0 free!)
        yield* fixture.llm.reset
        const sModelsDevUnpriced = yield* sessions.create({
          location: fixture.location,
          agent: AgentV2.ID.make("operator"),
          model: { providerID: ProviderV2.ID.make("modelsdev"), id: ModelV2.ID.make("unpriced-builtin") },
        })
        const iModelsDevUnpriced = SessionMessage.ID.create()
        yield* sessions.prompt({
          sessionID: sModelsDevUnpriced.id,
          id: iModelsDevUnpriced,
          prompt: { text: "must not treat unpriced models.dev model as free" },
          executionPolicy: { mode: "headless", permissions: "approve_once", maxBudgetUsd: 1.0 },
        })
        const rModelsDevUnpriced = yield* waitTerminal(sModelsDevUnpriced.id, iModelsDevUnpriced)
        expect(rModelsDevUnpriced.status).toBe("failed")
        expect(rModelsDevUnpriced.reason).toBe("budget_limit")
        expect(yield* fixture.llm.calls).toBe(0)

        // 5c. maxTokens does NOT prematurely reject turn 1 when large base64 attachments inflate serialized message chars
        yield* fixture.llm.reset
        yield* fixture.llm.text("vision-ok", { usage: { input: 120, output: 30 } })
        const sVision = yield* sessions.create({
          location: fixture.location,
          agent: AgentV2.ID.make("operator"),
          model: { providerID: ProviderV2.ID.make("remotevision"), id: ModelV2.ID.make("vision") },
        })
        const iVision = SessionMessage.ID.create()
        const largeBase64Png = `data:image/png;base64,${"A".repeat(120_000)}`
        yield* sessions.prompt({
          sessionID: sVision.id,
          id: iVision,
          prompt: {
            text: "describe attached screenshot",
            files: [{ uri: largeBase64Png, name: "screenshot.png" }],
          },
          executionPolicy: { mode: "headless", permissions: "approve_once", maxTokens: 1_000 },
        })
        const rVision = yield* waitTerminal(sVision.id, iVision)
        expect(rVision.status).toBe("completed")
        expect(rVision.reason).toBe("completed")
        expect(rVision.usageIncomplete).toBe(false)
        expect(yield* fixture.llm.calls).toBe(1)

        // 6. fallbackModel: HTTP 503 overload on primary model seamlessly switches to backup/fast
        yield* fixture.llm.reset
        yield* fixture.llm.pushMatch(
          (hit) => hit.body.model === "priced",
          httpError(503, { error: { message: "Primary model overloaded" } }),
          httpError(503, { error: { message: "Primary model overloaded" } }),
          httpError(503, { error: { message: "Primary model overloaded" } }),
        )
        yield* fixture.llm.textMatch((hit) => hit.body.model === "fast", "answered-by-fallback-http", {
          usage: { input: 60, output: 20 },
        })
        const sFallbackHttp = yield* sessions.create({
          location: fixture.location,
          agent: AgentV2.ID.make("operator"),
          model: { providerID: ProviderV2.ID.make("primary"), id: ModelV2.ID.make("priced") },
        })
        const iFallbackHttp = SessionMessage.ID.create()
        yield* sessions.prompt({
          sessionID: sFallbackHttp.id,
          id: iFallbackHttp,
          prompt: { text: "survive primary 503" },
          executionPolicy: {
            mode: "headless",
            permissions: "approve_once",
            maxBudgetUsd: 0.5,
            fallbackModel: { providerID: ProviderV2.ID.make("backup"), id: ModelV2.ID.make("fast") },
          },
        })
        const rFallbackHttp = yield* waitTerminal(sFallbackHttp.id, iFallbackHttp)
        expect(rFallbackHttp.status).toBe("completed")
        expect(rFallbackHttp.reason).toBe("completed")
        expect(rFallbackHttp.usageIncomplete).toBe(false)
        const fbHttpHistory = yield* store.context(sFallbackHttp.id)
        const fbHttpAssistant = fbHttpHistory.findLast((msg) => msg.type === "assistant")
        expect(fbHttpAssistant?.type).toBe("assistant")
        if (fbHttpAssistant?.type === "assistant") {
          expect(String(fbHttpAssistant.model.providerID)).toBe("backup")
          expect(String(fbHttpAssistant.model.id)).toBe("fast")
          const text = fbHttpAssistant.content
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("\n")
          expect(text).toContain("answered-by-fallback-http")
        }

        // 7. fallbackModel: pre-output SSE stream disconnect switches to backup/fast without corrupting usage
        yield* fixture.llm.reset
        yield* fixture.llm.pushMatch(
          (hit) => hit.body.model === "priced",
          reply().streamError("overloaded_error: upstream stream dropped before output").item(),
        )
        yield* fixture.llm.textMatch((hit) => hit.body.model === "fast", "answered-by-fallback-sse", {
          usage: { input: 55, output: 18 },
        })
        const sFallbackSse = yield* sessions.create({
          location: fixture.location,
          agent: AgentV2.ID.make("operator"),
          model: { providerID: ProviderV2.ID.make("primary"), id: ModelV2.ID.make("priced") },
        })
        const iFallbackSse = SessionMessage.ID.create()
        yield* sessions.prompt({
          sessionID: sFallbackSse.id,
          id: iFallbackSse,
          prompt: { text: "survive primary sse overload" },
          executionPolicy: {
            mode: "headless",
            permissions: "approve_once",
            fallbackModel: { providerID: ProviderV2.ID.make("backup"), id: ModelV2.ID.make("fast") },
          },
        })
        const rFallbackSse = yield* waitTerminal(sFallbackSse.id, iFallbackSse)
        expect(rFallbackSse.status).toBe("completed")
        expect(rFallbackSse.usageIncomplete).toBe(false)
        const fbSseHistory = yield* store.context(sFallbackSse.id)
        const fbSseAssistant = fbSseHistory.findLast((msg) => msg.type === "assistant")
        expect(fbSseAssistant?.type).toBe("assistant")
        if (fbSseAssistant?.type === "assistant") {
          expect(String(fbSseAssistant.model.providerID)).toBe("backup")
          expect(String(fbSseAssistant.model.id)).toBe("fast")
        }

        // 8. Mid-stream failure AFTER emitting partial assistant text must NOT switch to fallback
        yield* fixture.llm.reset
        yield* fixture.llm.pushMatch(
          (hit) => hit.body.model === "priced",
          reply().text("partial-output-before-crash").streamError("overloaded_error: mid-stream drop").item(),
        )
        const sMidFail = yield* sessions.create({
          location: fixture.location,
          agent: AgentV2.ID.make("operator"),
          model: { providerID: ProviderV2.ID.make("primary"), id: ModelV2.ID.make("priced") },
        })
        const iMidFail = SessionMessage.ID.create()
        yield* sessions.prompt({
          sessionID: sMidFail.id,
          id: iMidFail,
          prompt: { text: "partial stream" },
          executionPolicy: {
            mode: "headless",
            permissions: "approve_once",
            fallbackModel: { providerID: ProviderV2.ID.make("backup"), id: ModelV2.ID.make("fast") },
          },
        })
        const rMidFail = yield* waitTerminal(sMidFail.id, iMidFail)
        expect(rMidFail.status).toBe("failed")
        expect(rMidFail.reason).toBe("provider_error")
        const midHits = yield* fixture.llm.hits
        expect(midHits.every((hit) => hit.body.model === "priced")).toBe(true)
      }).pipe(Effect.provide(fixture.app))
    }),
  45_000,
)

it.live(
  "`apexo run`, `apexo review`, `apexo run --attempts`, and `apexo apply` work end-to-end with guardrails, preflight `--check`, `--3way` merge, `--index`, and `--cleanup`",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const repoDir = path.join(root, "repo")
      const reportFile = path.join(root, "attempts-report.json")

      let callCount = 0
      const llmServer = yield* Effect.acquireRelease(
        Effect.promise(
          () =>
            new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
              const httpServer = createServer((req, res) => {
                const chunks: Buffer[] = []
                req.on("data", (chunk: Buffer) => chunks.push(chunk))
                req.on("end", () => {
                  const raw = Buffer.concat(chunks).toString("utf8")
                  const parsed = JSON.parse(raw) as { model?: string }
                  if (parsed.model === "flaky-primary") {
                    res.writeHead(429, { "content-type": "application/json" })
                    res.end(
                      JSON.stringify({
                        error: {
                          message: "insufficient_quota: primary quota exhausted",
                          type: "insufficient_quota",
                        },
                      }),
                    )
                    return
                  }
                  if (raw.includes("ENDLESS_TOOL_LOOP")) {
                    callCount += 1
                    writeSse(
                      res,
                      responsesSingleToolEvents(`call_loop_${callCount}`, "bash", {
                        command: `printf 'loop-%d\\n' ${callCount}`,
                        description: "keep looping",
                      }),
                    )
                    return
                  }
                  if (raw.includes("Perform a read-only code review of the frozen changes")) {
                    writeSse(
                      res,
                      responsesTextEvents(
                        JSON.stringify({
                          summary: "LGTM: fallback review completed cleanly.",
                          assessment: "no_findings",
                          findings: [],
                        }),
                      ),
                    )
                    return
                  }
                  if (raw.includes("Execution Scope & Guardrails")) {
                    writeSse(res, responsesTextEvents("LGTM: fallback review completed cleanly."))
                    return
                  }
                  const renameDone = /SUBDIR_RENAMED=(attempt-\d+)/.exec(raw)
                  if (renameDone) {
                    writeSse(res, responsesTextEvents(`Subdir rename ${renameDone[1]} ready.`))
                    return
                  }
                  if (raw.includes("SUBDIR_RENAME_REFACTOR")) {
                    callCount += 1
                    writeSse(
                      res,
                      responsesSingleToolEvents(`call_ren_${callCount}`, "bash", {
                        command: [
                          'wt=$(git rev-parse --show-toplevel)',
                          'tag=$(basename "$wt")',
                          'node -e \'const fs=require("fs"); const tag=process.argv[1]; const lines=fs.readFileSync("legacy.ts","utf8").split("\\n"); const idx=lines.findIndex((l)=>l.includes("pkgFooter =")); lines[idx]=`export const pkgFooter = "${tag}";`; fs.writeFileSync(`modern-${tag}.ts`, lines.join("\\n")); fs.unlinkSync("legacy.ts");\' "$tag"',
                          'printf "SUBDIR_RENAMED=%s\\n" "$tag"',
                        ].join("; "),
                        description: "rename legacy.ts in monorepo package subdir",
                      }),
                    )
                    return
                  }
                  const attemptDone = /CANDIDATE_APPLIED=(attempt-\d+)/.exec(raw)
                  if (attemptDone) {
                    writeSse(res, responsesTextEvents(`Candidate ${attemptDone[1]} ready.`))
                    return
                  }
                  callCount += 1
                  writeSse(
                    res,
                    responsesSingleToolEvents(`call_cand_${callCount}`, "bash", {
                      command: [
                        'tag=$(basename "$PWD")',
                        'node -e \'const fs=require("fs"); const tag=process.argv[1]; const lines=fs.readFileSync("src/service.ts","utf8").split("\\n"); const idx=lines.findIndex((l)=>l.includes("footerValue =")); lines[idx]=`export const footerValue = "${tag}";`; fs.writeFileSync("src/service.ts", lines.join("\\n"));\' "$tag"',
                        'printf "export const helper = \\"%s\\";\\n" "$tag" > "src/helper-$tag.ts"',
                        "rm -f obsolete.txt",
                        'printf "CANDIDATE_APPLIED=%s\\n" "$tag"',
                      ].join("; "),
                      description: "modify service, add helper, remove obsolete file",
                    }),
                  )
                })
              })
              httpServer.listen(0, "127.0.0.1", () => {
                const addr = httpServer.address()
                const port = typeof addr === "object" && addr ? addr.port : 0
                resolve({
                  url: `http://127.0.0.1:${port}/v1`,
                  close: () => new Promise<void>((done) => httpServer.close(() => done())),
                })
              })
            }),
        ),
        (handle) => Effect.promise(() => handle.close()),
      )

      const initialServiceLines = [
        'export const headerBanner = "v1";',
        "",
        "export function compute(x: number) {",
        "  const step1 = x + 1;",
        "  const step2 = step1 * 2;",
        "  const step3 = step2 - 3;",
        "  return step3;",
        "}",
        "",
        'export const footerValue = "initial";',
        "",
      ].join("\n")

      const initialPkgLegacyLines = [
        'export const pkgHeader = "v1";',
        "",
        "export function helperValue(n: number) {",
        "  const a = n + 10;",
        "  const b = a * 3;",
        "  const c = b - 5;",
        "  return c;",
        "}",
        "",
        'export const pkgFooter = "initial";',
        "",
      ].join("\n")

      yield* Effect.promise(async () => {
        await mkdir(path.join(repoDir, "src"), { recursive: true })
        await mkdir(path.join(repoDir, "packages", "pkg-a"), { recursive: true })
        Bun.spawnSync(["git", "init"], { cwd: repoDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
        await Bun.write(path.join(repoDir, "src", "service.ts"), initialServiceLines)
        await Bun.write(path.join(repoDir, "packages", "pkg-a", "legacy.ts"), initialPkgLegacyLines)
        await Bun.write(path.join(repoDir, "obsolete.txt"), "remove-me\n")
        await Bun.write(path.join(repoDir, "notes.local.txt"), "committed-notes\n")
        Bun.spawnSync(["git", "add", "."], { cwd: repoDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
        Bun.spawnSync(
          [
            "git",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-m",
            "initial commit",
          ],
          { cwd: repoDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
        )
        // Pre-existing dirty working tree modification that attempts must NOT clobber or include in candidate diff!
        await Bun.write(path.join(repoDir, "notes.local.txt"), "dirty-local-wip\n")
        await Bun.write(
          path.join(repoDir, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            compaction: { auto: false },
            model: "test/stable",
            providers: {
              test: {
                name: "TestResponses",
                api: {
                  type: "aisdk",
                  package: "@ai-sdk/openai",
                  url: llmServer.url,
                  settings: { apiKey: "fixture-key" },
                },
                models: {
                  stable: {
                    name: "Stable",
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 200000, output: 4096 },
                    cost: { input: 2.5, output: 10 },
                  },
                  "flaky-primary": {
                    name: "Flaky Primary",
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 200000, output: 4096 },
                    cost: { input: 5, output: 15 },
                  },
                },
              },
            },
          }),
        )
      })

      const cliEnv = {
        ...process.env,
        APEXO_PURE: "1",
        GROK_MEMORY: "0",
        APEXO_TEST_HOME: root,
        XDG_DATA_HOME: path.join(root, "xdg-data"),
        XDG_CONFIG_HOME: path.join(root, "xdg-config"),
        XDG_STATE_HOME: path.join(root, "xdg-state"),
        XDG_CACHE_HOME: path.join(root, "xdg-cache"),
      }

      // 1. CLI guardrail validation errors
      const badFallback = yield* Effect.promise(() =>
        spawnCli(
          ["run", "--dir", repoDir, "--model", "test/stable", "--fallback-model", "test/stable", "hello"],
          cliEnv,
        ),
      )
      expect(badFallback.exitCode).not.toBe(0)
      expect(badFallback.stdout + badFallback.stderr).toContain("--fallback-model must differ from --model")

      // 2. CLI `apexo run --max-turns 1` (default `--session-protocol auto`) stops after 1 turn with turn_limit
      const turnCapRes = yield* Effect.promise(() =>
        spawnCli(
          ["run", "--dir", repoDir, "--max-turns", "1", "--auto", "--format", "json", "ENDLESS_TOOL_LOOP"],
          cliEnv,
        ),
      )
      expect(turnCapRes.exitCode).toBe(1)
      const turnCapEvents = turnCapRes.stdout
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      const turnCapReceipt = turnCapEvents.find((event) => event.type === "input_execution")
      expect(turnCapReceipt).toBeDefined()
      expect(turnCapReceipt?.status).toBe("failed")
      expect(turnCapReceipt?.reason).toBe("turn_limit")
      expect(turnCapReceipt?.usageIncomplete).toBe(false)

      // 3. CLI `apexo review --model test/flaky-primary --fallback-model test/stable --max-budget-usd 1.0`
      const reviewFallbackRes = yield* Effect.promise(() =>
        spawnCli(
          [
            "review",
            "--dir",
            repoDir,
            "--model",
            "test/flaky-primary",
            "--fallback-model",
            "test/stable",
            "--max-budget-usd",
            "1.0",
            "--ephemeral",
            "check uncommitted changes",
          ],
          cliEnv,
        ),
      )
      if (reviewFallbackRes.exitCode !== 0) {
        throw new Error(
          `apexo review with --fallback-model failed (${reviewFallbackRes.exitCode}):\nSTDOUT: ${reviewFallbackRes.stdout}\nSTDERR: ${reviewFallbackRes.stderr}`,
        )
      }
      expect(reviewFallbackRes.stdout).toContain("LGTM: fallback review completed cleanly.")

      // 4. `apexo run --attempts 2` generates persistent batch manifest + candidate worktrees
      const attemptsRes = yield* Effect.promise(() =>
        spawnCli(
          [
            "run",
            "--dir",
            repoDir,
            "--attempts",
            "2",
            "--max-turns",
            "4",
            "--max-budget-usd",
            "2.0",
            "--auto",
            "--format",
            "json",
            "implement candidate feature",
          ],
          cliEnv,
        ),
      )
      if (attemptsRes.exitCode !== 0) {
        throw new Error(
          `apexo run --attempts 2 failed (${attemptsRes.exitCode}):\nSTDOUT: ${attemptsRes.stdout}\nSTDERR: ${attemptsRes.stderr}`,
        )
      }
      const attemptsReport = JSON.parse(attemptsRes.stdout) as ParallelAttemptsReport
      expect(attemptsReport.succeeded).toBe(2)
      expect(attemptsReport.winnerAttempt).toBe(1)
      expect(attemptsReport.batchDirectory).toBeDefined()
      expect(existsSync(path.join(attemptsReport.batchDirectory!, "manifest.json"))).toBe(true)
      yield* Effect.promise(() => Bun.write(reportFile, attemptsRes.stdout))

      // Main repo is still untouched
      expect(yield* Effect.promise(() => Bun.file(path.join(repoDir, "src", "service.ts")).text())).toBe(
        initialServiceLines,
      )
      expect(existsSync(path.join(repoDir, "obsolete.txt"))).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(path.join(repoDir, "notes.local.txt")).text())).toBe(
        "dirty-local-wip\n",
      )

      // 5. `apexo apply --check --attempt 2 --json` verifies clean applicability without modifying working tree
      const checkRes = yield* Effect.promise(() =>
        spawnCli(["apply", "--dir", repoDir, "--attempt", "2", "--check", "--json"], cliEnv),
      )
      if (checkRes.exitCode !== 0) {
        throw new Error(`apexo apply --check failed (${checkRes.exitCode}):\nSTDOUT: ${checkRes.stdout}\nSTDERR: ${checkRes.stderr}`)
      }
      const checkReport = JSON.parse(checkRes.stdout) as ApplyReport
      expect(checkReport.type).toBe("apply.result")
      expect(checkReport.attempt).toBe(2)
      expect(checkReport.checkOnly).toBe(true)
      expect(checkReport.clean).toBe(true)
      expect(checkReport.applied).toBe(false)
      expect(checkReport.changedFiles).toEqual(["obsolete.txt", "src/helper-attempt-2.ts", "src/service.ts"])
      // Confirm preflight left main working tree completely unchanged
      expect(yield* Effect.promise(() => Bun.file(path.join(repoDir, "src", "service.ts")).text())).toBe(
        initialServiceLines,
      )
      expect(existsSync(path.join(repoDir, "src", "helper-attempt-2.ts"))).toBe(false)
      expect(existsSync(path.join(repoDir, "obsolete.txt"))).toBe(true)

      // Reject `--cleanup` combined with `--check`
      const invalidCleanup = yield* Effect.promise(() =>
        spawnCli(["apply", "--dir", repoDir, "--check", "--cleanup"], cliEnv),
      )
      expect(invalidCleanup.exitCode).not.toBe(0)
      expect(invalidCleanup.stdout + invalidCleanup.stderr).toContain("--cleanup cannot be combined with --check")

      // 6a. Overlapping unstaged local edit on the SAME line causes `--3way` to report conflict cleanly
      //     without dumping conflict markers into the working tree or deleting candidate worktrees
      const conflictingLocalService = initialServiceLines.replace(
        'export const footerValue = "initial";',
        'export const footerValue = "conflicting-local-edit";',
      )
      yield* Effect.promise(() => Bun.write(path.join(repoDir, "src", "service.ts"), conflictingLocalService))
      const conflictRes = yield* Effect.promise(() =>
        spawnCli(["apply", "attempt-2", "--dir", repoDir, "--3way", "--cleanup", "--json"], cliEnv),
      )
      expect(conflictRes.exitCode).toBe(1)
      const conflictReport = JSON.parse(conflictRes.stdout) as ApplyReport
      expect(conflictReport.clean).toBe(false)
      expect(conflictReport.applied).toBe(false)
      expect(conflictReport.cleanedUp).toBe(false)
      expect(yield* Effect.promise(() => Bun.file(path.join(repoDir, "src", "service.ts")).text())).toBe(
        conflictingLocalService,
      )
      expect(existsSync(attemptsReport.batchDirectory!)).toBe(true)

      // 6b. Non-overlapping unstaged local edit to top of `src/service.ts` in main working tree,
      //     then promote Attempt 2 via `apexo apply attempt-2 --3way --index --cleanup --json`!
      const locallyEditedService = initialServiceLines.replace(
        'export const headerBanner = "v1";',
        'export const headerBanner = "v2-local-edit";',
      )
      yield* Effect.promise(() => Bun.write(path.join(repoDir, "src", "service.ts"), locallyEditedService))

      const applyRes = yield* Effect.promise(() =>
        spawnCli(
          ["apply", "attempt-2", "--dir", repoDir, "--3way", "--index", "--cleanup", "--json"],
          cliEnv,
        ),
      )
      if (applyRes.exitCode !== 0) {
        throw new Error(`apexo apply --3way failed (${applyRes.exitCode}):\nSTDOUT: ${applyRes.stdout}\nSTDERR: ${applyRes.stderr}`)
      }
      const applyReport = JSON.parse(applyRes.stdout) as ApplyReport
      expect(applyReport.clean).toBe(true)
      expect(applyReport.applied).toBe(true)
      expect(applyReport.threeWay).toBe(true)
      expect(applyReport.index).toBe(true)
      expect(applyReport.cleanedUp).toBe(true)
      expect(applyReport.attempt).toBe(2)

      // Both the local top-of-file edit AND Attempt 2's bottom-of-file edit are preserved!
      const mergedService = yield* Effect.promise(() => Bun.file(path.join(repoDir, "src", "service.ts")).text())
      expect(mergedService).toContain('export const headerBanner = "v2-local-edit";')
      expect(mergedService).toContain('export const footerValue = "attempt-2";')
      // New file from Attempt 2 was created, Attempt 1's file was NOT, obsolete.txt was deleted, and pre-existing dirty notes.local.txt survived!
      expect(yield* Effect.promise(() => Bun.file(path.join(repoDir, "src", "helper-attempt-2.ts")).text())).toBe(
        'export const helper = "attempt-2";\n',
      )
      expect(existsSync(path.join(repoDir, "src", "helper-attempt-1.ts"))).toBe(false)
      expect(existsSync(path.join(repoDir, "obsolete.txt"))).toBe(false)
      expect(yield* Effect.promise(() => Bun.file(path.join(repoDir, "notes.local.txt")).text())).toBe(
        "dirty-local-wip\n",
      )

      // Verify `--index` staged the applied files in Git's index
      const stagedOut = new TextDecoder()
        .decode(
          Bun.spawnSync(["git", "diff", "--cached", "--name-only"], {
            cwd: repoDir,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          }).stdout,
        )
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .toSorted()
      expect(stagedOut).toEqual(["obsolete.txt", "src/helper-attempt-2.ts", "src/service.ts"])

      // Verify `--cleanup` removed the batch directory and unlinked all candidate worktrees from Git
      expect(existsSync(attemptsReport.batchDirectory!)).toBe(false)
      const wtList = new TextDecoder().decode(
        Bun.spawnSync(["git", "worktree", "list"], {
          cwd: repoDir,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        }).stdout,
      )
      expect(wtList).not.toContain("attempt-1")
      expect(wtList).not.toContain("attempt-2")

      // 7. Monorepo subdirectory `--attempts` + file rename + `apexo apply <subDirectory> --3way --index --cleanup`:
      //    Commit previous staged changes so we start a clean second batch while keeping `notes.local.txt` dirty
      Bun.spawnSync(
        [
          "git",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "-m",
          "commit first batch",
        ],
        { cwd: repoDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
      )
      const pkgSubdir = path.join(repoDir, "packages", "pkg-a")
      const subAttemptsRes = yield* Effect.promise(() =>
        spawnCli(
          [
            "run",
            "--dir",
            pkgSubdir,
            "--attempts",
            "2",
            "--auto",
            "--format",
            "json",
            "SUBDIR_RENAME_REFACTOR",
          ],
          cliEnv,
        ),
      )
      if (subAttemptsRes.exitCode !== 0) {
        throw new Error(
          `subdir apexo run --attempts 2 failed (${subAttemptsRes.exitCode}):\nSTDOUT: ${subAttemptsRes.stdout}\nSTDERR: ${subAttemptsRes.stderr}`,
        )
      }
      const subAttemptsReport = JSON.parse(subAttemptsRes.stdout) as ParallelAttemptsReport
      expect(subAttemptsReport.succeeded).toBe(2)
      const attempt2Subdir = subAttemptsReport.attempts[1]!.directory
      // Confirm reported directory is the monorepo subdirectory inside attempt-2 worktree
      expect(attempt2Subdir.endsWith(path.join("attempt-2", "packages", "pkg-a"))).toBe(true)

      // Make a non-overlapping unstaged local edit to `packages/pkg-a/legacy.ts` BEFORE applying the rename!
      const locallyEditedLegacy = initialPkgLegacyLines.replace(
        'export const pkgHeader = "v1";',
        'export const pkgHeader = "v2-local-before-rename";',
      )
      yield* Effect.promise(() => Bun.write(path.join(pkgSubdir, "legacy.ts"), locallyEditedLegacy))

      // Pass the monorepo subdirectory path `attempt2Subdir` directly as positional `[target]`!
      const subApplyRes = yield* Effect.promise(() =>
        spawnCli(
          ["apply", attempt2Subdir, "--dir", repoDir, "--3way", "--index", "--cleanup", "--json"],
          cliEnv,
        ),
      )
      if (subApplyRes.exitCode !== 0) {
        throw new Error(
          `subdir rename apexo apply failed (${subApplyRes.exitCode}):\nSTDOUT: ${subApplyRes.stdout}\nSTDERR: ${subApplyRes.stderr}`,
        )
      }
      const subApplyReport = JSON.parse(subApplyRes.stdout) as ApplyReport
      expect(subApplyReport.clean).toBe(true)
      expect(subApplyReport.applied).toBe(true)
      expect(subApplyReport.cleanedUp).toBe(true)
      expect(subApplyReport.attempt).toBe(2)
      expect(subApplyReport.batchDirectory).toBe(subAttemptsReport.batchDirectory)
      expect(subApplyReport.changedFiles).toEqual([
        "packages/pkg-a/legacy.ts",
        "packages/pkg-a/modern-attempt-2.ts",
      ])

      // Old file removed from disk, new file contains BOTH local unstaged edit and Attempt 2's edit, dirty notes untouched!
      expect(existsSync(path.join(pkgSubdir, "legacy.ts"))).toBe(false)
      const mergedModern = yield* Effect.promise(() => Bun.file(path.join(pkgSubdir, "modern-attempt-2.ts")).text())
      expect(mergedModern).toContain('export const pkgHeader = "v2-local-before-rename";')
      expect(mergedModern).toContain('export const pkgFooter = "attempt-2";')
      expect(yield* Effect.promise(() => Bun.file(path.join(repoDir, "notes.local.txt")).text())).toBe(
        "dirty-local-wip\n",
      )

      // Both old path removal and new path addition are staged in `.git/index` (no leftover unstaged deletion of legacy.ts!)
      const stagedRenameOut = new TextDecoder()
        .decode(
          Bun.spawnSync(["git", "diff", "--cached", "--no-renames", "--name-only"], {
            cwd: repoDir,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          }).stdout,
        )
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .toSorted()
      expect(stagedRenameOut).toEqual(["packages/pkg-a/legacy.ts", "packages/pkg-a/modern-attempt-2.ts"])
      const unstagedAfterRename = new TextDecoder()
        .decode(
          Bun.spawnSync(["git", "diff", "--name-only"], {
            cwd: repoDir,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          }).stdout,
        )
        .trim()
      expect(unstagedAfterRename).toBe("notes.local.txt")
      expect(existsSync(subAttemptsReport.batchDirectory!)).toBe(false)
    }),
  90_000,
)

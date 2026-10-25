import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { ConfigV1 } from "@apexo/core/v1/config/config"
import { SessionV1 } from "@apexo/core/v1/session"
import { Database } from "@apexo/core/database/database"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { SessionProjector } from "@apexo/core/session/projector"
import { SessionGoal } from "@apexo/core/session/goal"
import { MAX_STEPS_PROMPT } from "@apexo/core/session/runner/max-steps"
import { Goal } from "@apexo/schema/goal"
import { SessionGoalModel } from "@/session/goal-review"
import { eq } from "drizzle-orm"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer } from "effect"
import path from "path"
import { fileURLToPath } from "url"
import { NamedError } from "@apexo/core/util/error"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"

import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { SessionMessageTable } from "@apexo/core/session/sql"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { FSUtil } from "@apexo/core/fs-util"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Shell } from "@apexo/core/shell"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Ripgrep } from "@apexo/core/ripgrep"
import { Format } from "../../src/format"
import { TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"
import { goalReply, goalReplyMatch } from "../lib/goal-reply"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { LocationServiceMap, locationServiceMapLayer } from "@apexo/core/location-services"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

function withSh<A, E, R>(fx: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.SHELL
      process.env.SHELL = "/bin/sh"
      Shell.preferred.reset()
      return prev
    }),
    () => fx(),
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env.SHELL
        else process.env.SHELL = prev
        Shell.preferred.reset()
      }),
  )
}

function toolPart(parts: SessionV1.Part[]) {
  return parts.find((part): part is SessionV1.ToolPart => part.type === "tool")
}

type CompletedToolPart = SessionV1.ToolPart & { state: SessionV1.ToolStateCompleted }
type ErrorToolPart = SessionV1.ToolPart & { state: SessionV1.ToolStateError }

function completedTool(parts: SessionV1.Part[]) {
  const part = toolPart(parts)
  expect(part?.state.status).toBe("completed")
  return part?.state.status === "completed" ? (part as CompletedToolPart) : undefined
}

function errorTool(parts: SessionV1.Part[]) {
  const part = toolPart(parts)
  expect(part?.state.status).toBe("error")
  return part?.state.status === "error" ? (part as ErrorToolPart) : undefined
}

function makeMcp(instructions: MCP.ServerInstructions[] = []) {
  return Layer.succeed(
    MCP.Service,
    MCP.Service.of({
      status: () => Effect.succeed({}),
      clients: () => Effect.succeed({}),
      instructions: () => Effect.succeed(instructions),
      tools: () => Effect.succeed({}),
      prompts: () => Effect.succeed({}),
      resources: () => Effect.succeed({}),
      resourceTemplates: () => Effect.succeed({}),
      add: () => Effect.succeed({ status: { status: "disabled" as const } }),
      connect: () => Effect.void,
      disconnect: () => Effect.void,
      getPrompt: () => Effect.succeed(undefined),
      readResource: () => Effect.succeed(undefined),
      startAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      authenticate: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      finishAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      removeAuth: () => Effect.void,
      supportsOAuth: () => Effect.succeed(false),
      hasStoredTokens: () => Effect.succeed(false),
      getAuthStatus: () => Effect.succeed("not_authenticated" as const),
    }),
  )
}

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const processorCreateStarted: Array<() => void> = []
const blockingProcessor = Layer.succeed(
  SessionProcessor.Service,
  SessionProcessor.Service.of({
    create: () => Effect.sync(() => processorCreateStarted.shift()?.()).pipe(Effect.andThen(Effect.never)),
  }),
)

const runtimeFlags = RuntimeFlags.layer({ experimentalEventSystem: true })

const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

const promptRoot = LayerNode.group([
  SessionGoalModel.node,
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  LSP.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  SessionStatus.node,
  SessionRunState.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  Truncate.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
])

function makePrompt(input?: { mcpInstructions?: MCP.ServerInstructions[]; processor?: "blocking" }) {
  const replacements = [
    [LocationServiceMap.node, locationServiceMapLayer],
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, makeMcp(input?.mcpInstructions)],
    [RuntimeFlags.node, runtimeFlags],
  ] as const
  if (input?.processor === "blocking") {
    return AppNodeBuilderV1.build(promptRoot, [...replacements, [SessionProcessor.node, blockingProcessor]])
  }
  return AppNodeBuilderV1.build(promptRoot, replacements)
}

function makeHttp(input?: {
  mcpInstructions?: MCP.ServerInstructions[]
  processor?: "blocking"
  runtimeProfile?: "apexo" | "grok-build"
  backgroundSubagents?: boolean
}) {
  const root = LayerNode.group([promptRoot, testLLMServerNode])
  const replacements = [
    [LocationServiceMap.node, locationServiceMapLayer],
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, makeMcp(input?.mcpInstructions)],
    [
      RuntimeFlags.node,
      input?.runtimeProfile
        ? RuntimeFlags.layer({
            experimentalEventSystem: true,
            runtimeProfile: input.runtimeProfile,
            experimentalBackgroundSubagents: input.backgroundSubagents ?? false,
          })
        : runtimeFlags,
    ],
  ] as const
  if (input?.processor === "blocking") {
    return AppNodeBuilderV1.build(root, [...replacements, [SessionProcessor.node, blockingProcessor]])
  }
  return AppNodeBuilderV1.build(root, replacements)
}

function makeHttpNoLLMServer(input?: { mcpInstructions?: MCP.ServerInstructions[]; processor?: "blocking" }) {
  return makePrompt(input)
}

const it = testEffect(makeHttp())
const grok = testEffect(makeHttp({ runtimeProfile: "grok-build" }))
const grokWithChildren = testEffect(makeHttp({ runtimeProfile: "grok-build", backgroundSubagents: true }))
const goalCandidate = JSON.stringify({
  decision: "candidate_complete",
  evidence: "The supplied test evidence covers the objective",
  next_step: "Independently verify all requirements",
  blocker_key: "",
})

grokWithChildren.instance("goal execution waits for its background child before independent verification", () =>
  Effect.gen(function* () {
    const server = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const database = yield* Database.Service
    const goals = SessionGoal.make(database.db)
    const chat = yield* sessions.create({
      title: "Goal background child",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: chat.id,
      model: ref,
      noReply: true,
      parts: [{ type: "text", text: "Delegate the inspection" }],
    })
    const goal = yield* goals.create(chat.id, {
      id: Goal.ID.create(),
      objective: "Finish the delegated inspection and verify it",
    })
    const released = yield* Deferred.make<void>()
    const child = (body: Record<string, unknown>) =>
      Array.isArray(body.messages) &&
      body.messages.some((message) => message.role === "user" && message.content === "CHILD_ASYNC_WORK")
    const worker = (body: Record<string, unknown>) => Array.isArray(body.tools) && body.tools.length > 0 && !child(body)
    yield* goalReplyMatch(
      server.llm,
      (hit) => JSON.stringify(hit.body.messages).includes("independent goal planner"),
      '{"plan":"Delegate, await child, verify"}',
      { usage: { input: 10, output: 5 } },
    )
    yield* server.llm.toolMatch((hit) => worker(hit.body), "task", {
      description: "Async inspection",
      prompt: "CHILD_ASYNC_WORK",
      subagent_type: "general",
      run_in_background: true,
    })
    yield* server.llm.pushMatch(
      (hit) => child(hit.body),
      reply()
        .wait(deferredAsPromise(released))
        .text("Child inspection evidence")
        .usage({ input: 100, output: 20 })
        .stop(),
    )
    yield* goalReplyMatch(server.llm, (hit) => worker(hit.body), "Waiting for the child", {
      usage: { input: 10, output: 5 },
    })
    yield* goalReplyMatch(server.llm, (hit) => worker(hit.body), "Child work complete", {
      usage: { input: 10, output: 5 },
    })
    yield* goalReplyMatch(
      server.llm,
      (hit) => JSON.stringify(hit.body.messages).includes("hidden completion evaluator"),
      goalCandidate,
      { usage: { input: 10, output: 5 } },
    )
    for (const _ of [0, 1, 2]) {
      yield* goalReplyMatch(
        server.llm,
        (hit) => JSON.stringify(hit.body.messages).includes("independent skeptical goal verifier"),
        '{"confidence":"high","blocking":"none","achieved":true,"evidence":"The child finished and its evidence is available","unmet":[]}',
        { usage: { input: 10, output: 5 } },
      )
    }
    const running = yield* prompt.runGoal({ sessionID: chat.id, goalID: goal.id }).pipe(Effect.forkChild)
    yield* server.llm.wait(4)
    yield* pollWithTimeout(
      sessions
        .messages({ sessionID: chat.id })
        .pipe(
          Effect.map((messages) =>
            messages.some(
              (message) =>
                message.info.role === "assistant" &&
                message.info.time.completed &&
                message.parts.some((part) => part.type === "text" && part.text === "Waiting for the child"),
            )
              ? true
              : undefined,
          ),
        ),
      "parent did not settle before child",
    )
    expect(yield* goals.get(chat.id)).toMatchObject({ phase: "executing", status: "active", verificationRounds: 0 })
    yield* Deferred.succeed(released, undefined)
    yield* Fiber.join(running)
    expect(yield* goals.get(chat.id)).toMatchObject({ status: "complete" })
    expect((yield* goals.get(chat.id))!.tokensUsed).toBeGreaterThanOrEqual(165)
    expect(yield* server.llm.misses).toHaveLength(0)
  }),
)
;[undefined, 1].forEach((steps) =>
  grok.instance(
    `goal execution automatically continues after rejection and preserves the original objective (steps=${steps ?? "unlimited"})`,
    () =>
      Effect.gen(function* () {
        const server = yield* useServerConfig((url) => ({
          ...providerCfg(url),
          ...(steps
            ? {
                agent: { build: { steps }, inspector: { prompt: "Review the complete objective" } },
                goal: {
                  planner_model: { model: "test/test-model", agent_type: "inspector" },
                  skeptic_models: [{ model: "test/test-model", agent_type: "inspector" }],
                },
              }
            : {}),
        }))
        const sessions = yield* Session.Service
        const prompt = yield* SessionPrompt.Service
        const database = yield* Database.Service
        const goals = SessionGoal.make(database.db)
        const chat = yield* sessions.create({ title: "Goal execution" })
        yield* prompt.prompt({
          sessionID: chat.id,
          model: ref,
          noReply: true,
          parts: [{ type: "text", text: "Implement A and B" }],
        })
        const goal = yield* goals.create(chat.id, {
          id: Goal.ID.create(),
          objective: "ORIGINAL_FULL_SCOPE: implement A and B and verify both",
        })
        for (const text of [
          '{"plan":"Implement A and B, verify both"}',
          "A is ready",
          goalCandidate,
          '{"confidence":"high","blocking":"none","achieved":false,"evidence":"Only A was checked","unmet":["Implement and verify B"]}',
          "B is now ready and both tests pass",
          goalCandidate,
          '{"confidence":"high","blocking":"none","achieved":true,"evidence":"A and B tests passed","unmet":[]}',
          '{"confidence":"high","blocking":"none","achieved":true,"evidence":"A and B tests passed","unmet":[]}',
          '{"confidence":"high","blocking":"none","achieved":true,"evidence":"A and B tests passed","unmet":[]}',
        ])
          yield* goalReply(server.llm, text, { usage: { input: 20, output: 10 } })
        yield* prompt.runGoal({ sessionID: chat.id, goalID: goal.id })
        if ((yield* goals.get(chat.id))?.status === "infra_paused") {
          const children = yield* sessions.children(chat.id)
          const errors = yield* Effect.forEach(children, (child) =>
            sessions
              .messages({ sessionID: child.id })
              .pipe(
                Effect.map((messages) =>
                  messages.flatMap((message) =>
                    message.info.role === "assistant" && message.info.error ? [message.info.error] : [],
                  ),
                ),
              ),
          )
          yield* Effect.logError(
            "Goal fixture transport errors",
            errors,
            "received model requests",
            yield* server.llm.calls,
          )
        }
        expect(yield* goals.get(chat.id)).toMatchObject({
          status: "complete",
          tokensUsed: 270,
          workerRounds: 2,
          verificationRounds: 2,
        })
        const requests = yield* server.llm.inputs
        expect(requests).toHaveLength(18)
        expect(JSON.stringify(requests[1])).toContain("ORIGINAL_FULL_SCOPE")
        expect(JSON.stringify(requests[7])).toContain("Implement and verify B")
        // The second worker call must carry the evaluator's correction as a new turn.
        // Gemini rejects assistant-prefill requests, which this full execution used to produce.
        const workerRequests = (yield* server.llm.hits).filter((call) =>
          JSON.stringify(call.body).includes("The user explicitly started this persistent goal"),
        )
        expect(workerRequests).toHaveLength(2)
        expect((workerRequests[1].body.messages as { role: string }[]).at(-1)).toMatchObject({ role: "user" })
        if (steps) {
          for (const request of workerRequests)
            expect((request.body.messages as { role: string; content: string }[]).at(-1)).toMatchObject({
              role: "user",
              content: MAX_STEPS_PROMPT,
            })
        }
        const messages = yield* sessions.messages({ sessionID: chat.id })
        expect(messages.filter((item) => item.info.role === "user")).toHaveLength(1)
        expect(messages.filter((item) => item.info.role === "assistant")).toHaveLength(2)
      }),
  ),
)
;(process.platform === "win32" ? grok.instance.skip : grok.instance)(
  "background notification after a goal ends does not inherit its expired billing attempt",
  () =>
    Effect.gen(function* () {
      const server = yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service
      const database = yield* Database.Service
      const goals = SessionGoal.make(database.db)
      const chat = yield* sessions.create({
        title: "Goal notification ownership",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* prompt.prompt({
        sessionID: chat.id,
        model: ref,
        noReply: true,
        parts: [{ type: "text", text: "Launch a background operation; its eventual notification is separate work" }],
      })
      const goal = yield* goals.create(chat.id, {
        id: Goal.ID.create(),
        objective: "Launch the background operation and finish once it has started",
      })
      yield* goalReply(server.llm, '{"plan":"Launch the command, verify that it started"}', {
        usage: { input: 10, output: 5 },
      })
      yield* server.llm.tool("run_terminal_cmd", {
        command: "while [ ! -f release-goal-notification ]; do sleep 0.01; done; printf LATE_GOAL_OUTPUT",
        description: "Background operation",
        block_until_ms: 0,
      })
      yield* goalReply(server.llm, "The background operation has started", { usage: { input: 10, output: 5 } })
      yield* goalReply(server.llm, goalCandidate, { usage: { input: 10, output: 5 } })
      for (const _ of [0, 1, 2]) {
        yield* goalReply(
          server.llm,
          '{"confidence":"high","blocking":"none","achieved":true,"evidence":"The task launch returned its running job ID","unmet":[]}',
          {
            usage: { input: 10, output: 5 },
          },
        )
      }
      yield* goalReply(server.llm, "LATE_NOTIFICATION_OBSERVED", { usage: { input: 100, output: 20 } })
      yield* prompt.runGoal({ sessionID: chat.id, goalID: goal.id })
      const completed = yield* goals.get(chat.id)
      expect(completed?.status).toBe("complete")
      yield* writeText(path.join(server.dir, "release-goal-notification"), "release")
      yield* pollWithTimeout(
        sessions
          .messages({ sessionID: chat.id })
          .pipe(
            Effect.map((messages) =>
              messages.some((message) =>
                message.parts.some((part) => part.type === "text" && part.text === "LATE_NOTIFICATION_OBSERVED"),
              )
                ? true
                : undefined,
            ),
          ),
        "late notification did not execute independently",
        "10 seconds",
      )
      expect(yield* goals.get(chat.id)).toEqual(completed)
      expect(yield* server.llm.inputs).toHaveLength(15)
    }),
  30_000,
)

grok.instance("goal execution stops at a budget boundary without issuing a verification request", () =>
  Effect.gen(function* () {
    const server = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const database = yield* Database.Service
    const goals = SessionGoal.make(database.db)
    const chat = yield* sessions.create({ title: "Goal budget" })
    yield* prompt.prompt({
      sessionID: chat.id,
      model: ref,
      noReply: true,
      parts: [{ type: "text", text: "Do the work" }],
    })
    const goal = yield* goals.create(chat.id, {
      id: Goal.ID.create(),
      objective: "Complete and verify all work",
      tokenBudget: 100,
    })
    yield* goalReply(server.llm, '{"plan":"Implement and verify"}', { usage: { input: 20, output: 10 } })
    yield* goalReply(server.llm, "Work completed", { usage: { input: 75, output: 5 } })
    yield* prompt.runGoal({ sessionID: chat.id, goalID: goal.id })
    expect(yield* server.llm.calls).toBe(3)
    expect(yield* goals.get(chat.id)).toMatchObject({
      status: "budget_limited",
      tokensUsed: 110,
      verificationRounds: 0,
    })
  }),
)

grok.instance("goal execution cancellation persists pause and an explicit run cannot silently resume it", () =>
  Effect.gen(function* () {
    const server = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const database = yield* Database.Service
    const goals = SessionGoal.make(database.db)
    const chat = yield* sessions.create({ title: "Goal pause" })
    yield* prompt.prompt({
      sessionID: chat.id,
      model: ref,
      noReply: true,
      parts: [{ type: "text", text: "Do the work" }],
    })
    const goal = yield* goals.create(chat.id, { id: Goal.ID.create(), objective: "Complete and verify work" })
    const target = { sessionID: chat.id, goalID: goal.id }
    yield* goalReply(server.llm, '{"plan":"Implement and verify"}', { usage: { input: 20, output: 10 } })
    yield* server.llm.hang
    const running = yield* prompt.runGoal(target).pipe(Effect.forkChild)
    yield* server.llm.wait(3)
    const duplicate = yield* prompt.runGoal(target).pipe(Effect.result)
    expect(duplicate._tag).toBe("Failure")
    yield* prompt.cancel(chat.id)
    yield* Fiber.join(running)
    expect(yield* goals.get(chat.id)).toMatchObject({ status: "user_paused", tokensUsed: 30 })
    yield* prompt.runGoal(target)
    expect(yield* server.llm.calls).toBe(3)
  }),
)

grok.instance("ordinary prompts do not activate a persisted goal", () =>
  Effect.gen(function* () {
    const server = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const database = yield* Database.Service
    const goals = SessionGoal.make(database.db)
    const chat = yield* sessions.create({ title: "No implicit goal execution" })
    yield* goals.create(chat.id, { id: Goal.ID.create(), objective: "Do not run until explicitly started" })
    yield* goalReply(server.llm, "Answer to the ordinary question")
    yield* prompt.prompt({ sessionID: chat.id, model: ref, parts: [{ type: "text", text: "An ordinary question" }] })
    expect(yield* server.llm.calls).toBe(1)
    expect(yield* goals.get(chat.id)).toMatchObject({ phase: "idle", workerRounds: 0, tokensUsed: 0 })
  }),
)

grok.instance("goal execution requires three distinct blocked rounds and update_goal cannot finish it directly", () =>
  Effect.gen(function* () {
    const server = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const database = yield* Database.Service
    const goals = SessionGoal.make(database.db)
    const chat = yield* sessions.create({
      title: "Goal blocker",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: chat.id,
      model: ref,
      noReply: true,
      parts: [{ type: "text", text: "Do all the work" }],
    })
    const goal = yield* goals.create(chat.id, {
      id: Goal.ID.create(),
      objective: "Implement and verify every requirement",
    })
    yield* goalReply(server.llm, '{"plan":"Implement, run tests, verify"}', { usage: { input: 10, output: 5 } })
    for (const _ of [1, 2, 3]) {
      yield* server.llm.tool("update_goal", { blocked_reason: "Required service is unavailable" })
      yield* goalReply(server.llm, "The required service remains unavailable")
      yield* goalReply(
        server.llm,
        JSON.stringify({
          decision: "blocked",
          evidence: "The service rejected the actual request",
          next_step: "Restore the required service",
          blocker_key: "required_service",
        }),
        { usage: { input: 10, output: 5 } },
      )
    }
    yield* prompt.runGoal({ sessionID: chat.id, goalID: goal.id })
    expect(yield* server.llm.calls).toBe(11)
    expect(yield* goals.get(chat.id)).toMatchObject({ status: "blocked", workerRounds: 3, verificationRounds: 0 })
    const messages = yield* sessions.messages({ sessionID: chat.id })
    const calls = messages.flatMap((message) =>
      message.parts.filter((part) => part.type === "tool" && part.tool === "update_goal"),
    )
    expect(calls).toHaveLength(3)
    expect(calls.every((part) => part.type === "tool" && part.state.status === "completed")).toBe(true)
  }),
)

grok.instance("goal execution includes actual child model usage in the parent budget", () =>
  Effect.gen(function* () {
    const server = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const database = yield* Database.Service
    const goals = SessionGoal.make(database.db)
    const chat = yield* sessions.create({
      title: "Goal child usage",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: chat.id,
      model: ref,
      noReply: true,
      parts: [{ type: "text", text: "Delegate the inspection, then finish" }],
    })
    const goal = yield* goals.create(chat.id, {
      id: Goal.ID.create(),
      objective: "Inspect with a child and verify the answer",
    })
    yield* goalReply(server.llm, '{"plan":"Delegate, inspect, verify"}', { usage: { input: 10, output: 5 } })
    yield* server.llm.tool("task", {
      description: "Inspect fixture",
      prompt: "CHILD_GOAL_INSPECT",
      subagent_type: "general",
      run_in_background: false,
    })
    yield* goalReply(server.llm, "Child inspection evidence", { usage: { input: 200, output: 50 } })
    yield* goalReply(server.llm, "Inspection done", { usage: { input: 20, output: 10 } })
    yield* goalReply(server.llm, goalCandidate, { usage: { input: 10, output: 5 } })
    for (const _ of [0, 1, 2]) {
      yield* goalReply(
        server.llm,
        '{"confidence":"high","blocking":"none","achieved":true,"evidence":"Child inspection and final output satisfy the goal","unmet":[]}',
        { usage: { input: 30, output: 10 } },
      )
    }
    yield* prompt.runGoal({ sessionID: chat.id, goalID: goal.id })
    const parentMessages = yield* sessions.messages({ sessionID: chat.id })
    const delegated = parentMessages
      .flatMap((message) => message.parts)
      .find((part) => part.type === "tool" && part.tool === "task")
    expect(delegated && delegated.type === "tool" ? delegated.state : undefined).toMatchObject({ status: "completed" })
    expect(yield* server.llm.calls).toBe(15)
    expect(yield* goals.get(chat.id)).toMatchObject({ status: "complete", tokensUsed: 430 })
    expect(yield* sessions.children(chat.id)).toHaveLength(5)
  }),
)

grok.instance(
  "goal model planning and rejection use independent HTTP requests without changing conversation history",
  () =>
    Effect.gen(function* () {
      const server = yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service
      const models = yield* SessionGoalModel.Service
      const database = yield* Database.Service
      const goals = SessionGoal.make(database.db)
      const chat = yield* sessions.create({ title: "Goal model review" })
      yield* prompt.prompt({
        sessionID: chat.id,
        model: ref,
        noReply: true,
        parts: [{ type: "text", text: "WORKER_HISTORY_MARKER" }],
      })
      const info = yield* goals.create(chat.id, {
        id: Goal.ID.create(),
        objective: "Implement feature A and verify feature B",
      })
      const target = { sessionID: chat.id, goalID: info.id }
      const history = yield* sessions.messages({ sessionID: chat.id })
      yield* goalReply(server.llm, '{"plan":"1. Implement A. 2. Verify B with the required tests."}', {
        usage: { input: 20, output: 10 },
      })
      const planned = yield* models.run({ target, prompt, kind: "planning", evidence: "Repository evidence" })
      expect(planned.info?.plan).toContain("Verify B")
      expect(planned.info?.tokensUsed).toBe(30)
      const worker = yield* goals.begin(target, "executing")
      yield* goals.update(worker, { completed: true })
      yield* goals.finish(worker, {})
      yield* goalReply(
        server.llm,
        '{"confidence":"high","blocking":"none","achieved":false,"evidence":"A was checked but B has no test evidence","unmet":["Verify B"]}',
        { usage: { input: 40, output: 20 } },
      )
      const verified = yield* models.run({
        target,
        prompt,
        kind: "verifying",
        evidence: "A passed; worker says all done",
      })
      expect(verified.info?.status).toBe("active")
      expect(verified.info?.unmet).toEqual(["Verify B"])
      expect(verified.info?.tokensUsed).toBe(90)
      expect(yield* sessions.messages({ sessionID: chat.id })).toEqual(history)
      const inputs = yield* server.llm.inputs
      expect(inputs).toHaveLength(5)
      for (const input of inputs) {
        expect(JSON.stringify(input)).toContain(info.objective)
        expect(JSON.stringify(input)).not.toContain("WORKER_HISTORY_MARKER")
        expect(input.tools).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ function: expect.objectContaining({ name: "read_file" }) }),
          ]),
        )
        expect(input.tools).toEqual(
          expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: "write" }) })]),
        )
      }
      expect(JSON.stringify(inputs[2])).toContain("independent skeptical goal verifier")
    }),
)

grok.instance("goal model HTTP failures pause without retrying or certifying completion", () =>
  Effect.gen(function* () {
    const server = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const models = yield* SessionGoalModel.Service
    const database = yield* Database.Service
    const goals = SessionGoal.make(database.db)
    const chat = yield* sessions.create({ title: "Goal unavailable" })
    yield* prompt.prompt({ sessionID: chat.id, model: ref, noReply: true, parts: [{ type: "text", text: "Work" }] })
    const info = yield* goals.create(chat.id, { id: Goal.ID.create(), objective: "Complete the full objective" })
    yield* server.llm.error(503, { error: { message: "Provider unavailable" } })
    const result = yield* models.run({
      prompt,
      target: { sessionID: chat.id, goalID: info.id },
      kind: "planning",
      evidence: "Current code",
    })
    expect(result.info?.status).toBe("infra_paused")
    expect(yield* server.llm.calls).toBe(1)
    expect(result.info?.history.some((item) => item.event === "completed")).toBe(false)
  }),
)

grok.instance("goal model abort closes the HTTP request and pauses the owned attempt", () =>
  Effect.gen(function* () {
    const server = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const models = yield* SessionGoalModel.Service
    const database = yield* Database.Service
    const goals = SessionGoal.make(database.db)
    const chat = yield* sessions.create({ title: "Goal cancel" })
    yield* prompt.prompt({ sessionID: chat.id, model: ref, noReply: true, parts: [{ type: "text", text: "Work" }] })
    const info = yield* goals.create(chat.id, { id: Goal.ID.create(), objective: "Complete every requirement" })
    yield* server.llm.hang
    const running = yield* models
      .run({ prompt, target: { sessionID: chat.id, goalID: info.id }, kind: "planning", evidence: "Current code" })
      .pipe(Effect.forkChild)
    yield* server.llm.wait(1)
    yield* Fiber.interrupt(running)
    expect((yield* goals.get(chat.id))?.status).toBe("user_paused")
    expect(yield* sessions.messages({ sessionID: chat.id })).toHaveLength(1)
  }),
)
grok.instance("goal roles read workspace files, bill every turn once, and resume only the first skeptic", () =>
  Effect.gen(function* () {
    const server = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const models = yield* SessionGoalModel.Service
    const database = yield* Database.Service
    const fs = yield* FSUtil.Service
    const dir = yield* TestInstance
    const file = path.join(dir.directory, "evidence.txt")
    yield* fs.writeWithDirs(file, "REAL_WORKSPACE_EVIDENCE_FIRST")
    const goals = SessionGoal.make(database.db)
    const chat = yield* sessions.create({ title: "Goal workspace review" })
    yield* prompt.prompt({ sessionID: chat.id, model: ref, noReply: true, parts: [{ type: "text", text: "Work" }] })
    const info = yield* goals.create(chat.id, { id: Goal.ID.create(), objective: "Check the current evidence file" })
    const target = { sessionID: chat.id, goalID: info.id }
    yield* server.llm.push(reply().tool("read_file", { target_file: file }).usage({ input: 10, output: 5 }))
    yield* goalReply(server.llm, '{"plan":"Read current evidence, fix the gap, and verify"}', {
      usage: { input: 20, output: 10 },
    })
    const planned = yield* models.run({ target, prompt, kind: "planning", evidence: "Inspect evidence.txt" })
    expect(planned.info?.plannerSessionID).toBeDefined()
    expect(planned.info?.tokensUsed).toBe(45)
    expect(JSON.stringify((yield* server.llm.inputs)[1])).toContain("REAL_WORKSPACE_EVIDENCE_FIRST")
    const work = yield* goals.begin(target, "executing")
    yield* goals.finish(work, { verify: true })
    yield* server.llm.push(reply().tool("read_file", { target_file: file }).usage({ input: 10, output: 5 }))
    yield* goalReply(
      server.llm,
      JSON.stringify({
        achieved: false,
        confidence: "high",
        blocking: "none",
        evidence: "File still has first evidence",
        unmet: ["Replace first evidence"],
      }),
      { usage: { input: 20, output: 10 } },
    )
    const rejected = yield* models.run({ target, prompt, kind: "verifying", evidence: "Worker claims done" })
    const first = rejected.info?.verification?.results[0]
    expect(first?.sessionID).toBeDefined()
    expect(first?.tokensUsed).toBe(45)
    expect(rejected.info?.status).toBe("active")
    yield* fs.writeWithDirs(file, "REAL_WORKSPACE_EVIDENCE_FIXED")
    const next = yield* goals.begin(target, "executing")
    yield* goals.finish(next, { verify: true })
    yield* server.llm.push(reply().tool("read_file", { target_file: file }).usage({ input: 10, output: 5 }))
    for (const _ of [0, 1, 2])
      yield* goalReply(
        server.llm,
        JSON.stringify({
          achieved: true,
          confidence: "high",
          blocking: "none",
          evidence: "Current file is fixed",
          unmet: [],
        }),
        { usage: { input: 20, output: 10 } },
      )
    const verified = yield* models.run({ target, prompt, kind: "verifying", evidence: "Check the changed file again" })
    expect(verified.info?.status).toBe("complete")
    expect(verified.info?.tokensUsed).toBe(195)
    expect(verified.info?.verification?.results.map((item) => item.tokensUsed)).toEqual([45, 30, 30])
    expect(verified.info?.verification?.results[0].sessionID).toBe(first?.sessionID)
    expect(new Set(verified.info?.verification?.results.map((item) => item.sessionID)).size).toBe(3)
    const inputs = yield* server.llm.inputs
    expect(JSON.stringify(inputs[7])).toContain("REAL_WORKSPACE_EVIDENCE_FIRST")
    expect(JSON.stringify(inputs[8])).toContain("REAL_WORKSPACE_EVIDENCE_FIXED")
    expect(JSON.stringify(inputs.slice(11))).not.toContain("REAL_WORKSPACE_EVIDENCE_FIRST")
    expect(yield* sessions.messages({ sessionID: chat.id })).toHaveLength(1)
    const history = yield* sessions.messages({ sessionID: first!.sessionID! })
    expect(history.filter((message) => message.info.role === "user")).toHaveLength(2)
    expect(history.flatMap((message) => message.parts).filter((part) => part.type === "tool")).toHaveLength(6)
    expect(yield* server.llm.misses).toHaveLength(0)
  }),
)

grok.instance("goal role pairs select real models and agents without widening parent or role permissions", () =>
  Effect.gen(function* () {
    const server = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      provider: {
        test: {
          ...providerCfg(url).provider.test,
          models: Object.fromEntries(
            ["test-model", "planner-model", "skeptic-model"].map((id) => [
              id,
              { ...cfg.provider.test.models["test-model"], id },
            ]),
          ),
        },
      },
      agent: {
        build: { permission: { bash: "deny" } },
        inspector: { prompt: "ROLE_INSPECTOR_MARKER", permission: { webfetch: "deny" } },
      },
      goal: {
        planner_model: { model: "test/planner-model", agent_type: "inspector" },
        skeptic_models: [
          { model: "skeptic-model", agent_type: "inspector" },
          { model: "test/test-model", agent_type: "build" },
        ],
      },
    }))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const models = yield* SessionGoalModel.Service
    const database = yield* Database.Service
    const goals = SessionGoal.make(database.db)
    const chat = yield* sessions.create({ title: "Role model routing" })
    yield* prompt.prompt({
      sessionID: chat.id,
      model: ref,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "Inspect" }],
    })
    const info = yield* goals.create(chat.id, { id: Goal.ID.create(), objective: "Check every requirement" })
    const target = { sessionID: chat.id, goalID: info.id }
    yield* goalReply(server.llm, '{"plan":"Inspect then verify"}', { usage: { input: 10, output: 5 } })
    const planned = yield* models.run({ target, prompt, kind: "planning", evidence: "Current files" })
    expect(planned.info?.plannerExecution).toMatchObject({
      model: { providerID: "test", id: "planner-model" },
      agent: "inspector",
    })
    const work = yield* goals.begin(target, "executing")
    yield* goals.finish(work, { verify: true })
    for (const _ of [0, 1, 2])
      yield* goalReply(
        server.llm,
        JSON.stringify({ achieved: true, confidence: "high", blocking: "none", evidence: "Checked", unmet: [] }),
        { usage: { input: 10, output: 5 } },
      )
    const verified = yield* models.run({ target, prompt, kind: "verifying", evidence: "Work complete" })
    expect(verified.info?.status).toBe("complete")
    expect(verified.info?.tokensUsed).toBe(60)
    expect(verified.info?.verification?.results.map((item) => String(item.execution?.model.id))).toEqual([
      "skeptic-model",
      "test-model",
      "skeptic-model",
    ])
    const requests = yield* server.llm.inputs
    expect(requests.map((item) => item.model).toSorted()).toEqual([
      "planner-model",
      "planner-model",
      "skeptic-model",
      "skeptic-model",
      "skeptic-model",
      "skeptic-model",
      "skeptic-model",
      "skeptic-model",
      "test-model",
      "test-model",
      "test-model",
    ])
    expect(JSON.stringify(requests[0])).toContain("ROLE_INSPECTOR_MARKER")
    expect(JSON.stringify(requests[0]?.tools)).not.toContain('"run_terminal_cmd"')
    expect(JSON.stringify(requests[0]?.tools)).not.toContain('"web_fetch"')
    expect(JSON.stringify(requests[0]?.tools)).toContain('"read_file"')
    expect(yield* sessions.messages({ sessionID: chat.id })).toHaveLength(1)
  }),
)

grok.instance("unknown Goal role pairs fall back atomically and record the actual selection", () =>
  Effect.gen(function* () {
    const server = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      goal: { planner_model: { model: "test/missing", agent_type: "build" } },
    }))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const models = yield* SessionGoalModel.Service
    const database = yield* Database.Service
    const goals = SessionGoal.make(database.db)
    const chat = yield* sessions.create({ title: "Unavailable role pair" })
    yield* prompt.prompt({ sessionID: chat.id, model: ref, noReply: true, parts: [{ type: "text", text: "Inspect" }] })
    const info = yield* goals.create(chat.id, { id: Goal.ID.create(), objective: "Check requirements" })
    yield* goalReply(server.llm, '{"plan":"Inspect requirements"}', { usage: { input: 10, output: 5 } })
    const result = yield* models.run({
      target: { sessionID: chat.id, goalID: info.id },
      prompt,
      kind: "planning",
      evidence: "Current files",
    })
    expect(result.info?.plannerExecution).toMatchObject({
      model: { id: ref.modelID, providerID: ref.providerID },
      agent: "build",
      fallback: "model_unavailable",
      requested: { model: "test/missing", agent_type: "build" },
    })
    expect((yield* server.llm.inputs).map((item) => item.model)).toEqual(["test-model", "test-model"])
    expect(result.info?.tokensUsed).toBe(15)
  }),
)

grok.instance("goal workspace review respects inherited path denials", () =>
  Effect.gen(function* () {
    const server = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const models = yield* SessionGoalModel.Service
    const database = yield* Database.Service
    const fs = yield* FSUtil.Service
    const dir = yield* TestInstance
    const file = path.join(dir.directory, "restricted.txt")
    yield* fs.writeWithDirs(file, "MUST_NOT_REACH_THE_REVIEWER")
    const chat = yield* sessions.create({
      title: "Goal permissions",
      permission: [
        { permission: "*", pattern: "*", action: "allow" },
        { permission: "read", pattern: "*restricted.txt", action: "deny" },
      ],
    })
    yield* prompt.prompt({ sessionID: chat.id, model: ref, noReply: true, parts: [{ type: "text", text: "Work" }] })
    const goals = SessionGoal.make(database.db)
    const info = yield* goals.create(chat.id, { id: Goal.ID.create(), objective: "Inspect restricted evidence" })
    yield* server.llm.push(reply().tool("read_file", { target_file: file }).usage({ input: 10, output: 5 }))
    const result = yield* models.run({
      target: { sessionID: chat.id, goalID: info.id },
      prompt,
      kind: "planning",
      evidence: "Try the file under existing permissions",
    })
    expect(result.info?.status).toBe("infra_paused")
    expect(result.info?.tokensUsed).toBe(15)
    expect(JSON.stringify(yield* server.llm.inputs)).not.toContain("MUST_NOT_REACH_THE_REVIEWER")
    const children = yield* sessions.children(chat.id)
    expect(children).toHaveLength(1)
    const messages = yield* sessions.messages({ sessionID: children[0].id })
    expect(
      messages
        .flatMap((message) => message.parts)
        .some((part) => part.type === "tool" && part.state.status === "error"),
    ).toBe(true)
  }),
)

const noLLMServer = testEffect(makeHttpNoLLMServer())
const raceNoLLMServer = testEffect(makeHttpNoLLMServer({ processor: "blocking" }))
const withMcpInstructions = testEffect(
  makeHttp({
    mcpInstructions: [
      {
        name: "guide-server",
        instructions: "Use lookup before mutate.",
        tools: ["guide-server_lookup"],
      },
    ],
  }),
)
const unix = process.platform !== "win32" ? it.instance : it.instance.skip
const unixNoLLMServer = process.platform !== "win32" ? noLLMServer.instance : noLLMServer.instance.skip

;(process.platform === "win32" ? grok.instance.skip : grok.instance)(
  "monitor stderr events wake an idle parent while the command is still running",
  () =>
    Effect.gen(function* () {
      const server = yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service
      const jobs = yield* BackgroundJob.Service
      const chat = yield* sessions.create({
        title: "Monitor events",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* server.llm.tool("monitor", {
        command:
          "(printf PARTIAL; while [ ! -f release-monitor ]; do sleep 0.01; done; printf ' EVENT\\n'; while [ ! -f release-suppressed ]; do sleep 0.01; done; printf 'SUPPRESSED_EVENT\\n'; while [ ! -f release-resumed ]; do sleep 0.01; done; printf 'RESUMED_EVENT\\n'; while [ ! -f finish-monitor ]; do sleep 0.01; done) >&2",
        description: "watch event",
        persistent: true,
      })
      yield* server.llm.text("Monitor started.")
      yield* server.llm.text("MONITOR_OBSERVED")
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        model: ref,
        parts: [{ type: "text", text: "Watch for the event." }],
      })
      expect(yield* server.llm.inputs).toHaveLength(2)
      yield* writeText(path.join(server.dir, "release-monitor"), "release")
      const history = yield* pollWithTimeout(
        sessions
          .messages({ sessionID: chat.id })
          .pipe(
            Effect.map((messages) =>
              messages.some(
                (message) =>
                  message.info.role === "assistant" &&
                  message.info.time.completed &&
                  message.parts.some((part) => part.type === "text" && part.text === "MONITOR_OBSERVED"),
              )
                ? messages
                : undefined,
            ),
          ),
        "monitor did not notify the idle parent",
        "10 seconds",
      )
      const notifications = history
        .flatMap((message) => message.parts)
        .filter((part) => part.type === "text" && part.synthetic && part.text.startsWith("Monitor event:"))
      expect(notifications).toHaveLength(1)
      expect(JSON.stringify(notifications)).toContain("PARTIAL EVENT")
      const monitor = (yield* jobs.list()).find((job) => job.type === "monitor")
      expect(monitor?.status).toBe("running")
      expect(monitor?.metadata?.lineCount).toBe(1)
      yield* prompt.cancel(chat.id)
      yield* writeText(path.join(server.dir, "release-suppressed"), "release")
      yield* pollWithTimeout(
        jobs.get(monitor!.id).pipe(Effect.map((job) => (job?.metadata?.eventBatches === 2 ? true : undefined))),
        "monitor did not process the suppressed event",
        "10 seconds",
      )
      expect(yield* server.llm.inputs).toHaveLength(3)
      yield* server.llm.text("User resumed watching.")
      yield* prompt.prompt({ sessionID: chat.id, model: ref, parts: [{ type: "text", text: "Continue watching." }] })
      yield* server.llm.text("MONITOR_RESUMED")
      yield* writeText(path.join(server.dir, "release-resumed"), "release")
      const resumed = yield* pollWithTimeout(
        sessions
          .messages({ sessionID: chat.id })
          .pipe(
            Effect.map((messages) =>
              messages.some(
                (message) =>
                  message.info.role === "assistant" &&
                  message.info.time.completed &&
                  message.parts.some((part) => part.type === "text" && part.text === "MONITOR_RESUMED"),
              )
                ? messages
                : undefined,
            ),
          ),
        "user input did not re-enable monitor wakeups",
        "10 seconds",
      )
      expect(JSON.stringify(resumed)).toContain("RESUMED_EVENT")
      const received = resumed
        .flatMap((message) => message.parts)
        .filter((part) => part.type === "text" && part.synthetic)
      expect(JSON.stringify(received)).not.toContain("SUPPRESSED_EVENT")
      yield* jobs.cancel(monitor!.id)
      expect((yield* jobs.get(monitor!.id))?.status).toBe("cancelled")
      expect(yield* server.llm.inputs).toHaveLength(5)
    }),
  30_000,
)
;[
  { blockUntil: 0, exit: 0 },
  { blockUntil: 1, exit: 0 },
  { blockUntil: 0, exit: 7 },
].forEach((scenario) => {
  const run = process.platform === "win32" ? grok.instance.skip : grok.instance
  run(
    `background shell wakes an idle parent after block_until_ms=${scenario.blockUntil}, exit=${scenario.exit}`,
    () =>
      Effect.gen(function* () {
        const server = yield* useServerConfig(providerCfg)
        const sessions = yield* Session.Service
        const prompt = yield* SessionPrompt.Service
        const status = yield* SessionStatus.Service
        const chat = yield* sessions.create({
          title: "Background completion",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* server.llm.tool("run_terminal_cmd", {
          command: `while [ ! -f release-background ]; do sleep 0.01; done; printf BACKGROUND_RESULT; exit ${scenario.exit}`,
          description: "wait for release",
          block_until_ms: scenario.blockUntil,
        })
        yield* server.llm.text("Waiting for the background command.")
        yield* server.llm.text("BACKGROUND_OBSERVED")
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          model: ref,
          parts: [{ type: "text", text: "Start the background command and report its completion." }],
        })
        expect((yield* status.get(chat.id)).type).toBe("idle")
        expect(yield* server.llm.inputs).toHaveLength(2)
        yield* writeText(path.join(server.dir, "release-background"), "release")
        const history = yield* pollWithTimeout(
          sessions
            .messages({ sessionID: chat.id })
            .pipe(
              Effect.map((messages) =>
                messages.some((message) =>
                  message.parts.some((part) => part.type === "text" && part.text === "BACKGROUND_OBSERVED"),
                )
                  ? messages
                  : undefined,
              ),
            ),
          "background command did not wake the idle parent",
          "10 seconds",
        )
        const notifications = history
          .flatMap((message) => message.parts)
          .filter(
            (part) =>
              part.type === "text" &&
              part.synthetic &&
              part.text.startsWith(`Background command ${scenario.exit ? "failed" : "completed"}:`),
          )
        expect(notifications).toHaveLength(1)
        expect(JSON.stringify(notifications)).toContain("BACKGROUND_RESULT")
        expect(JSON.stringify((yield* server.llm.inputs).at(-1))).toContain("BACKGROUND_RESULT")
        expect(yield* server.llm.inputs).toHaveLength(3)
      }),
    30_000,
  )
})
;["explicit", "steer"].forEach((mode) => {
  const run = process.platform === "win32" ? grok.instance.skip : grok.instance
  run(
    `foreground shell promotion by ${mode} preserves the command and wakes the idle parent once`,
    () =>
      Effect.gen(function* () {
        const server = yield* useServerConfig(providerCfg)
        const sessions = yield* Session.Service
        const prompt = yield* SessionPrompt.Service
        const jobs = yield* BackgroundJob.Service
        const status = yield* SessionStatus.Service
        const chat = yield* sessions.create({
          title: "Foreground promotion",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* server.llm.tool("run_terminal_cmd", {
          command:
            "printf 'PROMOTED_STARTED\\n'; while [ ! -f release-promoted ]; do sleep 0.01; done; printf PROMOTED_RESULT",
          description: "foreground command",
        })
        yield* server.llm.text("Command is now in the background.")
        yield* server.llm.text("PROMOTED_OBSERVED")
        const first = yield* prompt
          .prompt({
            sessionID: chat.id,
            agent: "build",
            model: ref,
            parts: [{ type: "text", text: "Run a foreground command." }],
          })
          .pipe(Effect.forkChild)
        const job = yield* pollWithTimeout(
          jobs
            .list()
            .pipe(
              Effect.map((jobs) =>
                jobs.find(
                  (job) => job.metadata?.ownerSessionId === chat.id && job.output?.includes("PROMOTED_STARTED"),
                ),
              ),
            ),
          "foreground command did not start",
        )
        expect(job.metadata?.background).toBe(false)
        if (mode === "explicit") expect(yield* BackgroundJob.promoteSession(jobs, chat.id, false)).toBe(true)
        if (mode === "steer")
          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "build",
            model: ref,
            parts: [{ type: "text", text: "Continue with another task while that command finishes." }],
          })
        yield* Fiber.join(first)
        expect((yield* status.get(chat.id)).type).toBe("idle")
        expect((yield* jobs.get(job.id))?.status).toBe("running")
        expect((yield* jobs.get(job.id))?.metadata?.background).toBe(true)
        expect(yield* server.llm.inputs).toHaveLength(2)
        yield* writeText(path.join(server.dir, "release-promoted"), "release")
        const messages = yield* pollWithTimeout(
          sessions
            .messages({ sessionID: chat.id })
            .pipe(
              Effect.map((messages) =>
                messages.some((message) =>
                  message.parts.some((part) => part.type === "text" && part.text === "PROMOTED_OBSERVED"),
                )
                  ? messages
                  : undefined,
              ),
            ),
          "promoted command did not deliver its result",
          "10 seconds",
        )
        const notifications = messages
          .flatMap((message) => message.parts)
          .filter(
            (part) => part.type === "text" && part.synthetic && part.text.startsWith("Background command completed:"),
          )
        expect(notifications).toHaveLength(1)
        expect(JSON.stringify(notifications)).toContain("PROMOTED_RESULT")
        expect(yield* server.llm.inputs).toHaveLength(3)
      }),
    30_000,
  )
})

// Config that registers a custom "test" provider with a "test-model" model
// so provider model lookup succeeds inside the loop.
const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

const writeText = Effect.fn("test.writeText")(function* (file: string, text: string) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(file, text)
})

const writeConfig = Effect.fn("test.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  yield* writeText(
    path.join(dir, "apexo.json"),
    JSON.stringify({
      $schema: "https://raw.githubusercontent.com/cluster1900/apexo-grok/main/schemas/config.json",
      ...config,
    }),
  )
})

const useServerConfig = Effect.fn("test.useServerConfig")(function* (config: (url: string) => Partial<ConfigV1.Info>) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

// Wait for a session's runner to enter a busy state. SessionStatus is flipped
// inside Runner.startShell's serialized transition, so cancel can't no-op once
// we observe it.
const waitForBusy = (sessionID: SessionID, duration: Duration.Input = "2 seconds") =>
  pollWithTimeout(
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service
      const s = yield* status.get(sessionID)
      return s.type === "busy" ? (true as const) : undefined
    }),
    `session ${sessionID} never became busy`,
    duration,
  )

const hasBash = Effect.sync(() => Bun.which("bash") !== null)

const deferredAsPromise = <A>(deferred: Deferred.Deferred<A>): PromiseLike<A> => ({
  then: (onfulfilled, onrejected) => {
    Effect.runFork(
      Deferred.await(deferred).pipe(
        Effect.match({
          onFailure: (error) => {
            onrejected?.(error)
          },
          onSuccess: (value) => {
            onfulfilled?.(value)
          },
        }),
      ),
    )
    return deferredAsPromise(deferred) as PromiseLike<never>
  },
})

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const succeedVoid = (deferred: Deferred.Deferred<void>) => {
  Effect.runSync(Deferred.succeed(deferred, void 0).pipe(Effect.ignore))
}

const user = Effect.fn("test.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const seed = Effect.fn("test.seed")(function* (sessionID: SessionID, opts?: { finish?: string }) {
  const session = yield* Session.Service
  const msg = yield* user(sessionID, "hello")
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: msg.id,
    sessionID,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
    ...(opts?.finish ? { finish: opts.finish } : {}),
  }
  yield* session.updateMessage(assistant)
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID,
    type: "text",
    text: "hi there",
  })
  return { user: msg, assistant }
})

const addSubtask = (sessionID: SessionID, messageID: MessageID, model = ref) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    yield* session.updatePart({
      id: PartID.ascending(),
      messageID,
      sessionID,
      type: "subtask",
      prompt: "look into the cache key path",
      description: "inspect bug",
      agent: "general",
      model,
    })
  })

const boot = Effect.fn("test.boot")(function* (input?: { title?: string }) {
  const config = yield* Config.Service
  const prompt = yield* SessionPrompt.Service
  const run = yield* SessionRunState.Service
  const sessions = yield* Session.Service
  yield* config.get()
  const chat = yield* sessions.create(input ?? { title: "Pinned" })
  return { prompt, run, sessions, chat }
})

// Loop semantics

noLLMServer.instance(
  "loop exits immediately when last assistant has stop finish",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* seed(chat.id, { finish: "stop" })

      const result = yield* prompt.loop({ sessionID: chat.id })
      expect(result.info.role).toBe("assistant")
      if (result.info.role === "assistant") expect(result.info.finish).toBe("stop")
    }),
  { config: cfg },
)

noLLMServer.instance(
  "loop exits for a completed parent turn with nonmonotonic message IDs",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      const userID = MessageID.make("msg_z_user")
      const assistantID = MessageID.make("msg_a_assistant")
      yield* sessions.updateMessage({
        id: userID,
        role: "user",
        sessionID: chat.id,
        agent: "build",
        model: ref,
        time: { created: 100 },
      })
      yield* sessions.updateMessage({
        id: assistantID,
        role: "assistant",
        parentID: userID,
        sessionID: chat.id,
        mode: "build",
        agent: "build",
        cost: 0,
        path: { cwd: "/tmp", root: "/tmp" },
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ref.modelID,
        providerID: ref.providerID,
        time: { created: 200, completed: 201 },
        finish: "stop",
      })

      const result = yield* prompt.loop({ sessionID: chat.id })

      expect(result.info.id).toBe(assistantID)
    }),
  { config: cfg },
)

it.instance("loop exits without an LLM request for interrupted orphan tool calls", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    const seeded = yield* seed(chat.id, { finish: "stop" })
    yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: seeded.assistant.id,
      sessionID: chat.id,
      type: "tool",
      callID: "interrupted-call",
      tool: "edit",
      state: {
        status: "error",
        input: {},
        error: "Tool execution aborted",
        metadata: { interrupted: true },
        time: { start: 1, end: 2 },
      },
    })

    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.id).toBe(seeded.assistant.id)
    expect(yield* llm.hits).toHaveLength(0)
  }),
)

it.instance("loop calls LLM and returns assistant message", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.text("world")

    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.role).toBe("assistant")
    const parts = result.parts.filter((p) => p.type === "text")
    expect(parts.some((p) => p.type === "text" && p.text === "world")).toBe(true)
    expect(yield* llm.hits).toHaveLength(1)
  }),
)

withMcpInstructions.instance(
  "loop includes MCP instructions in model system context",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.hang
      yield* user(chat.id, "hello")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* awaitWithTimeout(llm.wait(1), "timed out waiting for MCP instruction request", "10 seconds")

      const hits = yield* llm.hits
      const body = JSON.stringify(hits[0]?.body)
      expect(body).toContain('<server name=\\"guide-server\\">')
      expect(body).toContain("Use lookup before mutate.")
      yield* Fiber.interrupt(fiber)
    }),
  15_000,
)

it.instance("legacy prompt emits message events without session.next events", () =>
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({
      title: "Pinned",
      agent: "plan",
      model: { providerID: ProviderV2.ID.make("old"), id: ModelV2.ID.make("old-model") },
    })
    const seen: string[] = []
    const off = yield* events.listen((event) => {
      seen.push(event.type)
      return Effect.void
    })

    const first = yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      model: ref,
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    const second = yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "again" }],
    })
    yield* off

    expect(first.info.role).toBe("user")
    expect(second.info.role).toBe("user")
    if (first.info.role === "user" && second.info.role === "user") {
      expect(first.info.model).toEqual(ref)
      expect(second.info.model).toEqual(ref)
    }
    expect(yield* sessions.get(chat.id)).toMatchObject({
      agent: "build",
      model: { providerID: ref.providerID, id: ref.modelID },
    })
    expect(seen).toContain(Session.Event.Updated.type)
    expect(seen).toContain(MessageV2.Event.Updated.type)
    expect(seen).toContain(MessageV2.Event.PartUpdated.type)
    expect(seen.filter((type) => type.startsWith("session.next."))).toEqual([])
  }),
)

it.instance("loop surfaces content-filter finishes as session errors", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    const errors: NonNullable<SessionV1.Assistant["error"]>[] = []
    const expected = {
      name: "ContentFilterError",
      data: { message: "The response was blocked by the provider's content filter" },
    } satisfies NonNullable<SessionV1.Assistant["error"]>
    const off = yield* events.listen((event) => {
      if (event.type !== Session.Event.Error.type) return Effect.void
      const data = event.data as typeof Session.Event.Error.data.Type
      if (data.sessionID === chat.id && data.error) errors.push(data.error)
      return Effect.void
    })

    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.push(reply().text("partial response").contentFilter())

    const result = yield* prompt.loop({ sessionID: chat.id })
    const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: result.info.id })
    yield* off

    expect(yield* llm.hits).toHaveLength(1)
    expect(result.info.role).toBe("assistant")
    expect(stored.info.role).toBe("assistant")
    if (result.info.role === "assistant" && stored.info.role === "assistant") {
      expect(result.info.finish).toBe("content-filter")
      expect(result.info.error).toEqual(expected)
      expect(stored.info.error).toEqual(result.info.error)
      expect(errors).toContainEqual(expected)
    }
    expect(result.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text", text: "partial response" })]),
    )
  }),
)

it.instance("loop stops provider overflow instead of auto-compacting when disabled", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      compaction: { auto: false },
    }))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })

    yield* llm.error(413, { error: { message: "request entity too large" } })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })

    const result = yield* prompt.loop({ sessionID: chat.id })
    const messages = yield* sessions.messages({ sessionID: chat.id })

    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.info.error?.name).toBe("ContextOverflowError")
      expect(result.info.finish).toBe("error")
    }
    expect(messages.some((message) => message.parts.some((part) => part.type === "compaction"))).toBe(false)
  }),
)

noLLMServer.instance.skip(
  "prompt emits v2 prompted and synthetic events (v2 projector disabled)",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [
          { type: "text", text: "hello v2" },
          {
            type: "file",
            mime: "text/plain",
            filename: "note.txt",
            url: "data:text/plain;base64,bm90ZSBjb250ZW50",
          },
        ],
      })

      const messages = yield* SessionV2.Service.use((session) => session.messages({ sessionID: chat.id })).pipe(
        Effect.provide(
          LayerNode.compile(SessionV2.node, [
            [SessionExecution.node, SessionExecution.noopLayer],
            [LocationServiceMap.node, locationServiceMapLayer],
          ]),
        ),
      )
      const { db } = yield* Database.Service
      const row = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, chat.id))
        .get()
        .pipe(Effect.orDie)
      expect(messages.find((message) => message.type === "user")).toMatchObject({ type: "user", text: "hello v2" })
      expect(typeof row?.data.time.created).toBe("number")
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "synthetic", text: expect.stringContaining("Called the Read tool") }),
          expect.objectContaining({ type: "synthetic", text: "note content" }),
        ]),
      )
    }),
  { config: cfg },
)

it.instance("static loop returns assistant text through local provider", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Prompt provider",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })

    yield* llm.text("world")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(result.info.role).toBe("assistant")
    expect(result.parts.some((part) => part.type === "text" && part.text === "world")).toBe(true)
    expect(yield* llm.hits).toHaveLength(1)
    expect(yield* llm.pending).toBe(0)
  }),
)

it.instance("static loop consumes queued replies across turns", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Prompt provider turns",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello one" }],
    })

    yield* llm.text("world one")

    const first = yield* prompt.loop({ sessionID: session.id })
    expect(first.info.role).toBe("assistant")
    expect(first.parts.some((part) => part.type === "text" && part.text === "world one")).toBe(true)

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello two" }],
    })

    yield* llm.text("world two")

    const second = yield* prompt.loop({ sessionID: session.id })
    expect(second.info.role).toBe("assistant")
    expect(second.parts.some((part) => part.type === "text" && part.text === "world two")).toBe(true)

    expect(yield* llm.hits).toHaveLength(2)
    expect(yield* llm.pending).toBe(0)
  }),
)

it.instance("Grok carries source inspection instructions and tool results through repeated Responses turns", () =>
  Effect.gen(function* () {
    const env = yield* Env.Service
    yield* env.set("XAI_API_KEY", "test-key")
    const { dir, llm } = yield* useServerConfig((url) => ({
      enabled_providers: ["xai"],
      provider: {
        xai: {
          name: "xAI",
          npm: "@ai-sdk/xai",
          models: {
            "grok-4.7": {
              ...cfg.provider.test.models["test-model"],
              id: "grok-4.7",
              reasoning: true,
              variants: { xhigh: { reasoningEffort: "xhigh" } },
            },
          },
          options: { apiKey: "test-key", baseURL: url },
        },
      },
    }))
    yield* writeText(
      path.join(dir, "src/index.ts"),
      'import { summarize } from "./summary"\nexport const run = summarize\n',
    )
    yield* writeText(path.join(dir, "src/summary.ts"), 'export const summarize = () => "source inspection completed"\n')
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    const input = {
      sessionID: session.id,
      agent: "build",
      model: { providerID: ProviderV2.ID.make("xai"), modelID: ModelV2.ID.make("grok-4.7") },
      variant: "xhigh",
      parts: [{ type: "text" as const, text: "Read the code and explain what this project does." }],
    }
    yield* llm.text("The README describes a summary tool.")
    const previous = yield* prompt.prompt(input)
    yield* llm.tool("read", { filePath: path.join(dir, "src/index.ts") })
    yield* llm.tool("read", { filePath: path.join(dir, "src/summary.ts") })
    yield* llm.text("The entry point exports summarize, which returns the source inspection result.")
    const result = yield* prompt.prompt(input)
    if (result.info.role === "assistant") expect(result.info.error).toBeUndefined()
    const hits = yield* llm.hits
    expect(hits).toHaveLength(4)
    hits.forEach((hit) => {
      expect(hit.url.pathname).toBe("/v1/responses")
      expect(hit.body.reasoning).toMatchObject({ effort: "xhigh" })
      expect(hit.body.tools).toContainEqual(expect.objectContaining({ type: "function", name: "read" }))
    })
    const request = JSON.stringify(hits[1]!.body.input)
    expect(request).toContain("The README describes a summary tool.")
    expect(request).toContain("Read relevant source implementations before drawing conclusions")
    expect(request).not.toContain("fewer than 4 lines")
    expect(request).not.toContain("One word answers are best")
    expect(JSON.stringify(hits[2]!.body.input)).toContain("export const run = summarize")
    expect(JSON.stringify(hits[3]!.body.input)).toContain("source inspection completed")
    expect(previous.info.role).toBe("assistant")
    expect(result.info.role).toBe("assistant")
    if (previous.info.role !== "assistant" || result.info.role !== "assistant") return
    expect(result.info.parentID).not.toBe(previous.info.parentID)
    expect(result.info.finish).toBe("stop")
    expect(result.info.error).toBeUndefined()
    expect(
      result.parts.some(
        (part) =>
          part.type === "text" &&
          part.text === "The entry point exports summarize, which returns the source inspection result.",
      ),
    ).toBe(true)
    const history = yield* sessions.messages({ sessionID: session.id })
    const reads = history.flatMap((message) =>
      message.parts.filter((part): part is SessionV1.ToolPart => part.type === "tool" && part.tool === "read"),
    )
    expect(reads).toHaveLength(2)
    expect(reads.every((part) => part.state.status === "completed")).toBe(true)
  }),
)

it.instance("steering after structured output does not reuse the previous result", () =>
  Effect.gen(function* () {
    const server = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Pinned" })
    const release = yield* Deferred.make<void>()
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      format: new SessionV1.OutputFormatJsonSchema({
        type: "json_schema",
        schema: { type: "object", properties: { value: { type: "string" } } },
        retryCount: 2,
      }),
      parts: [{ type: "text", text: "return structured data" }],
    })
    yield* server.llm.push(reply().wait(deferredAsPromise(release)).tool("StructuredOutput", { value: "first" }))
    yield* server.llm.text("follow-up answer")
    const running = yield* prompt.loop({ sessionID: session.id }).pipe(Effect.forkChild)
    yield* server.llm.wait(1)
    const followup = yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "now answer in plain text" }],
    })
    yield* Deferred.succeed(release, undefined)
    const result = yield* Fiber.join(running).pipe(Effect.timeout("10 seconds"))
    expect(yield* server.llm.calls).toBe(2)
    expect(result.info.role).toBe("assistant")
    if (result.info.role !== "assistant") return
    expect(result.info.parentID).toBe(followup.info.id)
    expect(result.info.structured).toBeUndefined()
    expect(result.parts.some((part) => part.type === "text" && part.text === "follow-up answer")).toBe(true)
  }),
)

it.instance("loop continues when finish is tool-calls", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.tool("first", { value: "first" })
    yield* llm.text("second")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(yield* llm.calls).toBe(2)
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)
      expect(result.info.finish).toBe("stop")
    }
  }),
)

it.instance("loop continues when finish is unknown", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.push(reply())
    yield* llm.text("second")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(yield* llm.calls).toBe(2)
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)
      expect(result.info.finish).toBe("stop")
    }
  }),
)

it.instance("glob tool keeps instance context during prompt runs", () =>
  Effect.gen(function* () {
    const { dir, llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Glob context",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    const file = path.join(dir, "probe.txt")
    yield* writeText(file, "probe")

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "find text files" }],
    })
    yield* llm.tool("glob", { pattern: "**/*.txt" })
    yield* llm.text("done")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(result.info.role).toBe("assistant")

    const msgs = yield* MessageV2.filterCompactedEffect(session.id)
    const tool = msgs
      .flatMap((msg) => msg.parts)
      .find(
        (part): part is CompletedToolPart =>
          part.type === "tool" && part.tool === "glob" && part.state.status === "completed",
      )
    if (!tool) return

    expect(tool.state.output).toContain(file)
    expect(tool.state.output).not.toContain("No context found for instance")
    expect(result.parts.some((part) => part.type === "text" && part.text === "done")).toBe(true)
  }),
)

it.instance("loop continues when finish is stop but assistant has tool parts", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.push(reply().tool("first", { value: "first" }).stop())
    yield* llm.text("second")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(yield* llm.calls).toBe(2)
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)
      expect(result.info.finish).toBe("stop")
    }
  }),
)

it.instance("failed subtask preserves metadata on error tool state", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      agent: {
        general: {
          model: "test/missing-model",
        },
      },
    }))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* llm.tool("task", {
      description: "inspect bug",
      prompt: "look into the cache key path",
      subagent_type: "general",
    })
    yield* llm.text("done")
    const msg = yield* user(chat.id, "hello")
    yield* addSubtask(chat.id, msg.id)

    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.role).toBe("assistant")
    expect(yield* llm.calls).toBe(2)

    const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
    const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
    expect(taskMsg?.info.role).toBe("assistant")
    if (!taskMsg || taskMsg.info.role !== "assistant") return

    const tool = errorTool(taskMsg.parts)
    if (!tool) return

    expect(tool.state.error).toContain("Tool execution failed")
    expect(tool.state.metadata).toBeDefined()
    expect(tool.state.metadata?.sessionId).toBeDefined()
    expect(tool.state.metadata?.model).toEqual({
      providerID: ProviderV2.ID.make("test"),
      modelID: ModelV2.ID.make("missing-model"),
    })
  }),
)

it.instance("subtask child inherits parent session external_directory allow", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({
      title: "Parent",
      permission: [{ permission: "external_directory", pattern: "/tmp/allowed/*", action: "allow" }],
    })
    yield* llm.text("done")
    const msg = yield* user(chat.id, "hello")
    yield* addSubtask(chat.id, msg.id)

    yield* prompt.loop({ sessionID: chat.id })

    const kids = yield* sessions.children(chat.id)
    expect(kids).toHaveLength(1)
    const child = kids[0]!
    const rules = child.permission ?? []
    expect(rules).toEqual(
      expect.arrayContaining([{ permission: "external_directory", pattern: "/tmp/allowed/*", action: "allow" }]),
    )
    expect(Permission.evaluate("external_directory", "/tmp/allowed/file", rules).action).toBe("allow")
    expect(Permission.evaluate("task", "anything", rules).action).toBe("deny")
  }),
)

noLLMServer.instance("prompt tools merge with remembered session permission rules", () =>
  Effect.gen(function* () {
    // A provider must be available to resolve the default model (no keyless hosted provider exists anymore).
    yield* Env.use.set("ANTHROPIC_API_KEY", "test-key")
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Prompt tools" })

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      tools: { bash: false },
      parts: [{ type: "text", text: "first" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      tools: { read: true },
      parts: [{ type: "text", text: "second" }],
    })

    const reloaded = yield* sessions.get(session.id)
    expect(reloaded.permission).toEqual([
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "read", pattern: "*", action: "allow" },
    ])
    expect(Permission.evaluate("bash", "anything", reloaded.permission ?? []).action).toBe("deny")
  }),
)

it.instance(
  "running subtask preserves metadata after tool-call transition",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* llm.hang
      const msg = yield* user(chat.id, "hello")
      yield* addSubtask(chat.id, msg.id)

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

      const tool = yield* pollWithTimeout(
        Effect.gen(function* () {
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
          const tool = taskMsg?.parts.find((part): part is SessionV1.ToolPart => part.type === "tool")
          if (tool?.state.status === "running" && tool.state.metadata?.sessionId) return tool
        }),
        "timed out waiting for running subtask metadata",
      )

      if (tool.state.status !== "running") return
      expect(typeof tool.state.metadata?.sessionId).toBe("string")
      expect(tool.state.title).toBeDefined()
      expect(tool.state.metadata?.model).toBeDefined()

      yield* prompt.cancel(chat.id)
      yield* Fiber.await(fiber)
    }),
  5_000,
)

it.instance(
  "running task tool preserves metadata after tool-call transition",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.tool("task", {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
      })
      yield* llm.hang
      yield* user(chat.id, "hello")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

      const tool = yield* pollWithTimeout(
        Effect.gen(function* () {
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const assistant = msgs.findLast((item) => item.info.role === "assistant" && item.info.agent === "build")
          const tool = assistant?.parts.find(
            (part): part is SessionV1.ToolPart => part.type === "tool" && part.tool === "task",
          )
          if (tool?.state.status === "running" && tool.state.metadata?.sessionId) return tool
        }),
        "timed out waiting for running task metadata",
      )

      if (tool.state.status !== "running") return
      expect(typeof tool.state.metadata?.sessionId).toBe("string")
      expect(tool.state.title).toBe("inspect bug")
      expect(tool.state.metadata?.model).toBeDefined()

      yield* prompt.cancel(chat.id)
      yield* Fiber.await(fiber)
    }),
  10_000,
)

it.instance(
  "loop sets status to busy then idle",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const status = yield* SessionStatus.Service

      yield* llm.hang

      const chat = yield* sessions.create({})
      yield* user(chat.id, "hi")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)
      expect((yield* status.get(chat.id)).type).toBe("busy")
      yield* prompt.cancel(chat.id)
      yield* Fiber.await(fiber)
      expect((yield* status.get(chat.id)).type).toBe("idle")
    }),
  3_000,
)

// Cancel semantics

it.instance("cancel interrupts loop and resolves with an assistant message", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* seed(chat.id)

    yield* llm.hang

    yield* user(chat.id, "more")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)
    yield* prompt.cancel(chat.id)
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.info.role).toBe("assistant")
    }
  }),
)

it.instance("cancel records MessageAbortedError on interrupted process", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* llm.hang
    yield* user(chat.id, "hello")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)
    yield* prompt.cancel(chat.id)
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      const info = exit.value.info
      if (info.role === "assistant") {
        expect(info.error?.name).toBe("MessageAbortedError")
      }
    }
  }),
)

raceNoLLMServer.instance(
  "finalizes assistant when cancelled before processor creation completes",
  () =>
    Effect.gen(function* () {
      processorCreateStarted.length = 0
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          processorCreateStarted.length = 0
        }),
      )

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Processor creation race" })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "first" }],
      })

      const firstCreate = defer<void>()
      processorCreateStarted.push(firstCreate.resolve)
      const first = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.promise(() => firstCreate.promise)

      yield* prompt.cancel(chat.id)
      const firstExit = yield* Fiber.await(first)
      expect(Exit.isSuccess(firstExit)).toBe(true)

      let messages = yield* sessions.messages({ sessionID: chat.id })
      const firstInterrupted = messages.at(-1)
      expect(firstInterrupted?.info.role).toBe("assistant")
      expect(firstInterrupted?.parts).toHaveLength(0)
      if (firstInterrupted?.info.role === "assistant") {
        expect(firstInterrupted.info.finish).toBeUndefined()
        expect(firstInterrupted.info.time.completed).toBeNumber()
        expect(firstInterrupted.info.error?.name).toBe("MessageAbortedError")
      }

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "second" }],
      })

      const secondCreate = defer<void>()
      processorCreateStarted.push(secondCreate.resolve)
      const second = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.promise(() => secondCreate.promise)

      yield* prompt.cancel(chat.id)
      const secondExit = yield* Fiber.await(second)
      expect(Exit.isSuccess(secondExit)).toBe(true)

      messages = yield* sessions.messages({ sessionID: chat.id })
      const poisonMessages = messages.filter(
        (message) =>
          message.info.role === "assistant" &&
          message.parts.length === 0 &&
          !message.info.finish &&
          !message.info.time.completed &&
          !message.info.error,
      )
      expect(poisonMessages).toHaveLength(0)

      const interruptedMessages = messages.filter(
        (message) =>
          message.info.role === "assistant" &&
          message.parts.length === 0 &&
          message.info.time.completed &&
          message.info.error?.name === "MessageAbortedError",
      )
      expect(interruptedMessages).toHaveLength(2)

      const lastUser = messages.at(-2)
      const lastAssistant = messages.at(-1)
      expect(lastUser?.info.role).toBe("user")
      expect(lastAssistant?.info.role).toBe("assistant")
      if (lastUser?.info.role === "user" && lastAssistant?.info.role === "assistant") {
        expect(lastAssistant.info.parentID).toBe(lastUser?.info.id)
      }
    }),
  { config: cfg },
  3_000,
)

noLLMServer.instance(
  "cancel finalizes subtask tool state",
  () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>()
      const aborted = yield* Deferred.make<void>()
      const registry = yield* ToolRegistry.Service
      const { task } = yield* registry.named()
      const original = task.execute
      task.execute = (_args, ctx) =>
        Effect.callback<never>((_resume) => {
          ctx.abort.addEventListener("abort", () => succeedVoid(aborted), { once: true })
          if (ctx.abort.aborted) succeedVoid(aborted)
          succeedVoid(ready)
          return Effect.sync(() => succeedVoid(aborted))
        })
      yield* Effect.addFinalizer(() => Effect.sync(() => void (task.execute = original)))

      const { prompt, chat } = yield* boot()
      const msg = yield* user(chat.id, "hello")
      yield* addSubtask(chat.id, msg.id)

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for task tool to start", "10 seconds")
      yield* prompt.cancel(chat.id)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
      yield* awaitWithTimeout(Deferred.await(aborted), "timed out waiting for task tool abort", "10 seconds")

      const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
      const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
      expect(taskMsg?.info.role).toBe("assistant")
      if (!taskMsg || taskMsg.info.role !== "assistant") return

      const tool = toolPart(taskMsg.parts)
      expect(tool?.type).toBe("tool")
      if (!tool) return

      expect(tool.state.status).not.toBe("running")
      expect(taskMsg.info.time.completed).toBeDefined()
      expect(taskMsg.info.finish).toBeDefined()
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "cancel propagates from slash command subtask to child session",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const status = yield* SessionStatus.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* llm.hang
      const msg = yield* user(chat.id, "hello")
      yield* addSubtask(chat.id, msg.id)

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)

      const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
      const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
      const tool = taskMsg ? toolPart(taskMsg.parts) : undefined
      const sessionID = tool?.state.status === "running" ? tool.state.metadata?.sessionId : undefined
      expect(typeof sessionID).toBe("string")
      if (typeof sessionID !== "string") throw new Error("missing child session id")
      const childID = SessionID.make(sessionID)
      expect((yield* status.get(childID)).type).toBe("busy")

      yield* prompt.cancel(chat.id)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)

      expect((yield* status.get(chat.id)).type).toBe("idle")
      expect((yield* status.get(childID)).type).toBe("idle")
    }),
  10_000,
)

it.instance(
  "cancel with queued callers resolves all cleanly",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* llm.hang
      yield* user(chat.id, "hello")

      const a = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)
      const b = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      yield* prompt.cancel(chat.id)
      const [exitA, exitB] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
      expect(Exit.isSuccess(exitA)).toBe(true)
      expect(Exit.isSuccess(exitB)).toBe(true)
      if (Exit.isSuccess(exitA) && Exit.isSuccess(exitB)) {
        expect(exitA.value.info.id).toBe(exitB.value.info.id)
      }
    }),
  { git: true },
  10_000,
)

// Queue semantics

noLLMServer.instance("concurrent loop callers get same result", () =>
  Effect.gen(function* () {
    const { prompt, run, chat } = yield* boot()
    yield* seed(chat.id, { finish: "stop" })

    const [a, b] = yield* Effect.all([prompt.loop({ sessionID: chat.id }), prompt.loop({ sessionID: chat.id })], {
      concurrency: "unbounded",
    })

    expect(a.info.id).toBe(b.info.id)
    expect(a.info.role).toBe("assistant")
    yield* run.assertNotBusy(chat.id)
  }),
)

it.instance("concurrent loop callers all receive same error result", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })

    yield* llm.fail("boom")
    yield* user(chat.id, "hello")

    const [a, b] = yield* Effect.all([prompt.loop({ sessionID: chat.id }), prompt.loop({ sessionID: chat.id })], {
      concurrency: "unbounded",
    })
    expect(a.info.id).toBe(b.info.id)
    expect(a.info.role).toBe("assistant")
  }),
)

it.instance("prompt submitted during an active run is included in the next LLM input", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const gate = yield* Deferred.make<void>()
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })

    yield* llm.hold("first", deferredAsPromise(gate))
    yield* llm.text("second")

    const a = yield* prompt
      .prompt({
        sessionID: chat.id,
        agent: "build",
        model: ref,
        parts: [{ type: "text", text: "first" }],
      })
      .pipe(Effect.forkChild)

    yield* llm.wait(1)
    yield* waitForBusy(chat.id)

    const id = MessageID.ascending()
    const b = yield* prompt
      .prompt({
        sessionID: chat.id,
        messageID: id,
        agent: "build",
        model: ref,
        parts: [{ type: "text", text: "second" }],
      })
      .pipe(Effect.forkChild)

    yield* pollWithTimeout(
      sessions
        .messages({ sessionID: chat.id })
        .pipe(
          Effect.map((msgs) => (msgs.some((msg) => msg.info.role === "user" && msg.info.id === id) ? true : undefined)),
        ),
      "timed out waiting for second prompt to save",
    )

    yield* Deferred.succeed(gate, void 0)

    const [ea, eb] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
    expect(Exit.isSuccess(ea)).toBe(true)
    expect(Exit.isSuccess(eb)).toBe(true)
    expect(yield* llm.calls).toBe(2)

    const msgs = yield* sessions.messages({ sessionID: chat.id })
    const assistants = msgs.filter((msg) => msg.info.role === "assistant")
    expect(assistants).toHaveLength(2)
    const last = assistants.at(-1)
    if (!last || last.info.role !== "assistant") throw new Error("expected second assistant")
    expect(last.info.parentID).toBe(id)
    expect(last.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)

    const inputs = yield* llm.inputs
    expect(inputs).toHaveLength(2)
    const messages = inputs.at(-1)?.messages
    if (!Array.isArray(messages)) throw new Error("expected LLM messages")
    expect(messages).toContainEqual({ role: "user", content: "second" })
    expect(messages.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("<active-task-reminder>") })
  }),
)

it.instance(
  "steering preserves the original task through tool continuations without changing stored user messages",
  () =>
    Effect.gen(function* () {
      const { dir, llm } = yield* useServerConfig(providerCfg)
      yield* writeText(path.join(dir, "entry.ts"), 'export { summarize } from "./report"')
      yield* writeText(path.join(dir, "skills.md"), "Available skill: code-review")
      yield* writeText(path.join(dir, "report.ts"), 'export const summarize = () => "project report"')
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      const gate = yield* Deferred.make<void>()
      const followupGate = yield* Deferred.make<void>()
      yield* llm.push(
        reply()
          .wait(deferredAsPromise(gate))
          .tool("read", { filePath: path.join(dir, "entry.ts") }),
      )
      yield* llm.push(
        reply()
          .wait(deferredAsPromise(followupGate))
          .tool("read", { filePath: path.join(dir, "skills.md") }),
      )
      yield* llm.tool("read", { filePath: path.join(dir, "report.ts") })
      yield* llm.text(
        "The code-review skill is available. The entry exports summarize, which produces a project report.",
      )
      const running = yield* prompt
        .prompt({
          sessionID: chat.id,
          agent: "build",
          model: ref,
          parts: [{ type: "text", text: "Read the implementation and summarize this project." }],
        })
        .pipe(Effect.forkChild)
      yield* llm.wait(1)
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        model: ref,
        noReply: true,
        parts: [{ type: "text", text: "Which skills are available?" }],
      })
      yield* Deferred.succeed(gate, undefined)
      yield* llm.wait(2)
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        model: ref,
        noReply: true,
        parts: [{ type: "text", text: "Keep the project summary concise." }],
      })
      yield* Deferred.succeed(followupGate, undefined)
      const result = yield* Fiber.join(running).pipe(Effect.timeout("10 seconds"))
      const inputs = yield* llm.inputs
      expect(inputs).toHaveLength(4)
      expect(JSON.stringify(inputs[0])).not.toContain("<active-task-reminder>")
      inputs.slice(1).forEach((input) => {
        if (!Array.isArray(input.messages)) throw new Error("expected model messages")
        const reminder = input.messages.at(-1)
        expect(reminder?.role).toBe("user")
        expect(JSON.stringify(reminder?.content)).toContain("<active-task-reminder>")
        expect(JSON.stringify(reminder?.content)).toContain("Read the implementation and summarize this project.")
        expect(JSON.stringify(reminder?.content)).toContain("continue unfinished work")
        expect(JSON.stringify(input.messages)).toContain("Which skills are available?")
      })
      expect(JSON.stringify(inputs[3])).toContain("project report")
      expect(
        result.parts.some((part) => part.type === "text" && part.text.includes("The entry exports summarize")),
      ).toBe(true)
      const history = yield* sessions.messages({ sessionID: chat.id })
      const users = history.filter((message) => message.info.role === "user")
      expect(users).toHaveLength(3)
      expect(JSON.stringify(history)).not.toContain("<active-task-reminder>")

      yield* llm.text("A separate question after the task finished.")
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        model: ref,
        parts: [{ type: "text", text: "What is two plus two?" }],
      })
      expect(JSON.stringify((yield* llm.inputs).at(-1))).not.toContain("<active-task-reminder>")
    }),
)

it.instance("an explicit task replacement during steering can finish without restarting the original work", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    const gate = yield* Deferred.make<void>()
    yield* llm.hold("I am starting the project review.", deferredAsPromise(gate))
    yield* llm.text("Stopped the review. Two plus two is four.")
    const running = yield* prompt
      .prompt({
        sessionID: chat.id,
        agent: "build",
        model: ref,
        parts: [{ type: "text", text: "Review the project." }],
      })
      .pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      model: ref,
      noReply: true,
      parts: [{ type: "text", text: "Cancel that review. Only tell me what two plus two is." }],
    })
    yield* Deferred.succeed(gate, undefined)
    yield* Fiber.join(running).pipe(Effect.timeout("10 seconds"))
    const inputs = yield* llm.inputs
    expect(inputs).toHaveLength(2)
    expect(JSON.stringify(inputs[1])).toContain("Cancel that review. Only tell me what two plus two is.")
    expect(JSON.stringify(inputs[1])).toContain("Do not resume cancelled work")
    const status = yield* SessionStatus.Service
    expect(yield* status.get(chat.id)).toEqual({ type: "idle" })
  }),
)

it.instance("assertNotBusy fails with BusyError when loop running", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const run = yield* SessionRunState.Service
    const sessions = yield* Session.Service
    yield* llm.hang

    const chat = yield* sessions.create({})
    yield* user(chat.id, "hi")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)

    const exit = yield* run.assertNotBusy(chat.id).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBeInstanceOf(Session.BusyError)
      expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "SessionBusyError", sessionID: chat.id })
    }

    yield* prompt.cancel(chat.id)
    yield* Fiber.await(fiber)
  }),
)

noLLMServer.instance("assertNotBusy succeeds when idle", () =>
  Effect.gen(function* () {
    const run = yield* SessionRunState.Service
    const sessions = yield* Session.Service

    const chat = yield* sessions.create({})
    const exit = yield* run.assertNotBusy(chat.id).pipe(Effect.exit)
    expect(Exit.isSuccess(exit)).toBe(true)
  }),
)

// Shell semantics

it.instance("shell rejects with BusyError when loop running", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* llm.hang
    yield* user(chat.id, "hi")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)

    const exit = yield* prompt.shell({ sessionID: chat.id, agent: "build", command: "echo hi" }).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBeInstanceOf(Session.BusyError)
      expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "SessionBusyError", sessionID: chat.id })
    }

    yield* prompt.cancel(chat.id)
    yield* Fiber.await(fiber)
  }),
)

unixNoLLMServer(
  "shell captures stdout and stderr in completed tool output",
  () =>
    Effect.gen(function* () {
      const { prompt, run, chat } = yield* boot()
      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "printf out && printf err >&2",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.output).toContain("out")
      expect(tool.state.output).toContain("err")
      expect(tool.state.metadata.output).toContain("out")
      expect(tool.state.metadata.output).toContain("err")
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell completes a fast command on the preferred shell",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const { prompt, run, chat } = yield* boot()
      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "pwd",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.input.command).toBe("pwd")
      expect(tool.state.output).toContain(dir)
      expect(tool.state.metadata.output).toContain(dir)
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell uses configured shell over env shell",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        if (!(yield* hasBash)) return

        const { prompt, chat } = yield* boot()
        const result = yield* prompt.shell({
          sessionID: chat.id,
          agent: "build",
          command: "[[ 1 -eq 1 ]] && printf configured",
        })

        const tool = completedTool(result.parts)
        if (!tool) return
        expect(tool.state.output).toContain("configured")
      }),
    ),
  { config: { ...cfg, shell: "bash" } },
  30_000,
)

unixNoLLMServer(
  "shell commands can change directory after startup",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const { prompt, run, chat } = yield* boot()
        const parent = path.dirname(dir)
        const result = yield* prompt.shell({
          sessionID: chat.id,
          agent: "build",
          command: "cd .. && pwd",
        })

        expect(result.info.role).toBe("assistant")
        const tool = completedTool(result.parts)
        if (!tool) return

        expect(tool.state.output).toContain(parent)
        expect(tool.state.metadata.output).toContain(parent)
        yield* run.assertNotBusy(chat.id)
      }),
    ),
  { config: cfg },
)

unixNoLLMServer(
  "shell lists files from the project directory",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const { prompt, run, chat } = yield* boot()
      yield* writeText(path.join(dir, "README.md"), "# e2e\n")

      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "command ls",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.input.command).toBe("command ls")
      expect(tool.state.output).toContain("README.md")
      expect(tool.state.metadata.output).toContain("README.md")
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell captures stderr from a failing command",
  () =>
    Effect.gen(function* () {
      const { prompt, run, chat } = yield* boot()
      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "command -v __nonexistent_cmd_e2e__ || echo 'not found' >&2; exit 1",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.output).toContain("not found")
      expect(tool.state.metadata.output).toContain("not found")
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell updates running metadata before process exit",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, chat } = yield* boot()

        const fiber = yield* prompt
          .shell({ sessionID: chat.id, agent: "build", command: "printf first && sleep 0.2 && printf second" })
          .pipe(Effect.forkChild)

        yield* pollWithTimeout(
          Effect.gen(function* () {
            const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
            const taskMsg = msgs.find((item) => item.info.role === "assistant")
            const tool = taskMsg ? toolPart(taskMsg.parts) : undefined
            if (tool?.state.status === "running" && tool.state.metadata?.output.includes("first")) return true
          }),
          "timed out waiting for running shell metadata",
        )

        const exit = yield* Fiber.await(fiber)
        expect(Exit.isSuccess(exit)).toBe(true)
      }),
    ),
  { config: cfg },
  30_000,
)

it.instance(
  "loop waits while shell runs and starts after shell exits",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.text("after-shell")

      const sh = yield* prompt
        .shell({ sessionID: chat.id, agent: "build", command: "sleep 0.2" })
        .pipe(Effect.forkChild)
      yield* waitForBusy(chat.id)

      const loop = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      expect(yield* llm.calls).toBe(0)

      yield* Fiber.await(sh)
      const exit = yield* Fiber.await(loop)

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.info.role).toBe("assistant")
        expect(exit.value.parts.some((part) => part.type === "text" && part.text === "after-shell")).toBe(true)
      }
      expect(yield* llm.calls).toBe(1)
    }),
  { git: true },
  10_000,
)

it.instance(
  "shell completion resumes queued loop callers",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.text("done")

      const sh = yield* prompt
        .shell({ sessionID: chat.id, agent: "build", command: "sleep 0.2" })
        .pipe(Effect.forkChild)
      yield* waitForBusy(chat.id)

      const a = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      const b = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      expect(yield* llm.calls).toBe(0)

      yield* Fiber.await(sh)
      const [ea, eb] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])

      expect(Exit.isSuccess(ea)).toBe(true)
      expect(Exit.isSuccess(eb)).toBe(true)
      if (Exit.isSuccess(ea) && Exit.isSuccess(eb)) {
        expect(ea.value.info.id).toBe(eb.value.info.id)
        expect(ea.value.info.role).toBe("assistant")
      }
      expect(yield* llm.calls).toBe(1)
    }),
  { git: true },
  10_000,
)

unix(
  "command ! expansion uses configured shell over env shell",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        if (!(yield* hasBash)) return
        const { llm } = yield* useServerConfig((url) => ({
          ...providerCfg(url),
          shell: "bash",
          command: {
            probe: {
              template: "Probe: !`[[ 1 -eq 1 ]] && printf configured`",
            },
          },
        }))

        const { prompt, chat } = yield* boot()
        yield* llm.text("done")

        const result = yield* prompt.command({
          sessionID: chat.id,
          command: "probe",
          arguments: "",
        })

        expect(result.info.role).toBe("assistant")
        const inputs = yield* llm.inputs
        expect(JSON.stringify(inputs.at(-1)?.messages)).toContain("configured")
      }),
    ),
  30_000,
)

unixNoLLMServer(
  "cancel interrupts shell and resolves cleanly",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, run, chat } = yield* boot()
        const { directory: dir } = yield* TestInstance
        const afs = yield* FSUtil.Service
        const ready = path.join(dir, ".shell-ready")

        const sh = yield* prompt
          .shell({ sessionID: chat.id, agent: "build", command: ": > '.shell-ready'; sleep 30" })
          .pipe(Effect.forkChild)
        yield* pollWithTimeout(
          afs.existsSafe(ready).pipe(Effect.map((exists) => (exists ? (true as const) : undefined))),
          "shell never created readiness marker",
        )

        yield* prompt.cancel(chat.id)

        const status = yield* SessionStatus.Service
        expect((yield* status.get(chat.id)).type).toBe("idle")
        const busy = yield* run.assertNotBusy(chat.id).pipe(Effect.exit)
        expect(Exit.isSuccess(busy)).toBe(true)

        const exit = yield* Fiber.await(sh)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          expect(exit.value.info.role).toBe("assistant")
          const tool = completedTool(exit.value.parts)
          if (tool) {
            expect(tool.state.output).toContain("User aborted the command")
          }
        }
      }),
    ),
  { git: true, config: cfg },
  30_000,
)

unixNoLLMServer(
  "cancel persists aborted shell result when shell ignores TERM",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, chat } = yield* boot()
        const { directory: dir } = yield* TestInstance
        const afs = yield* FSUtil.Service
        const ready = path.join(dir, ".trap-ready")

        const sh = yield* prompt
          .shell({
            sessionID: chat.id,
            agent: "build",
            // Touch marker AFTER trap installs so the test waits for the actual
            // ignore-TERM state before cancelling; otherwise SIGTERM can arrive
            // before `trap` runs and the escalation path is never exercised.
            command: `trap '' TERM; touch "${ready}"; sleep 30`,
          })
          .pipe(Effect.forkChild)

        yield* Effect.gen(function* () {
          while (!(yield* afs.existsSafe(ready))) {
            yield* Effect.sleep(Duration.millis(10))
          }
        }).pipe(Effect.timeout(Duration.seconds(5)))

        yield* prompt.cancel(chat.id)

        const exit = yield* Fiber.await(sh)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          expect(exit.value.info.role).toBe("assistant")
          const tool = completedTool(exit.value.parts)
          if (tool) {
            expect(tool.state.output).toContain("User aborted the command")
          }
        }
      }),
    ),
  { git: true, config: cfg },
  30_000,
)

unix(
  "cancel finalizes interrupted bash tool output through normal truncation",
  () =>
    Effect.gen(function* () {
      const { dir, llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Interrupted bash truncation",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "run bash" }],
      })

      yield* llm.tool("bash", {
        command:
          'i=0; while [ "$i" -lt 4000 ]; do printf "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx %05d\\n" "$i"; i=$((i + 1)); done; printf truncation-ready; sleep 30',
        timeout: 30_000,
        workdir: path.resolve(dir),
      })

      const run = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const assistant = msgs.findLast((item) => item.info.role === "assistant")
          const tool = assistant ? toolPart(assistant.parts) : undefined
          if (tool?.state.status === "running" && tool.state.metadata?.output.includes("truncation-ready")) return true
        }),
        "timed out waiting for truncated shell output",
      )
      yield* prompt.cancel(chat.id)

      const exit = yield* Fiber.await(run)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isFailure(exit)) return

      const tool = completedTool(exit.value.parts)
      if (!tool) return

      expect(tool.state.metadata.truncated).toBe(true)
      expect(typeof tool.state.metadata.outputPath).toBe("string")
      expect(tool.state.output).toMatch(/\.\.\.output truncated\.\.\./)
      expect(tool.state.output).toMatch(/Full output saved to:\s+\S+/)
      expect(tool.state.output).not.toContain("Tool execution aborted")
    }),
  { git: true },
  30_000,
)

unixNoLLMServer(
  "cancel interrupts loop queued behind shell",
  () =>
    Effect.gen(function* () {
      const { prompt, chat } = yield* boot()

      const sh = yield* prompt.shell({ sessionID: chat.id, agent: "build", command: "sleep 30" }).pipe(Effect.forkChild)
      yield* waitForBusy(chat.id)

      const loop = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      yield* prompt.cancel(chat.id)

      const exit = yield* Fiber.await(loop)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const tool = completedTool(exit.value.parts)
        expect(tool?.state.output).toContain("User aborted the command")
      }

      yield* Fiber.await(sh)
    }),
  { git: true, config: cfg },
  30_000,
)

unixNoLLMServer(
  "shell rejects when another shell is already running",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, chat } = yield* boot()

        const a = yield* prompt
          .shell({ sessionID: chat.id, agent: "build", command: "sleep 30" })
          .pipe(Effect.forkChild)
        yield* waitForBusy(chat.id)

        const exit = yield* prompt.shell({ sessionID: chat.id, agent: "build", command: "echo hi" }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.squash(exit.cause)).toBeInstanceOf(Session.BusyError)
        }

        yield* prompt.cancel(chat.id)
        yield* Fiber.await(a)
      }),
    ),
  { git: true, config: cfg },
  30_000,
)

// Abort signal propagation tests for inline tool execution

function hangUntilAborted(tool: { execute: (...args: any[]) => any }) {
  return Effect.gen(function* () {
    const ready = yield* Deferred.make<void>()
    const aborted = yield* Deferred.make<void>()
    const original = tool.execute
    tool.execute = (_args: any, ctx: any) => {
      ctx.abort.addEventListener("abort", () => succeedVoid(aborted), { once: true })
      if (ctx.abort.aborted) succeedVoid(aborted)
      succeedVoid(ready)
      return Effect.callback<never>(() => Effect.sync(() => succeedVoid(aborted)))
    }
    const restore = Effect.addFinalizer(() => Effect.sync(() => void (tool.execute = original)))
    return { ready, aborted, restore }
  })
}

noLLMServer.instance(
  "interrupt propagates abort signal to read tool via file part (text/plain)",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const registry = yield* ToolRegistry.Service
      const { read } = yield* registry.named()
      const { ready, restore } = yield* hangUntilAborted(read)
      yield* restore

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Abort Test" })

      const testFile = path.join(dir, "test.txt")
      yield* writeText(testFile, "hello world")

      const fiber = yield* prompt
        .prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [
            { type: "text", text: "read this" },
            { type: "file", url: `file://${testFile}`, filename: "test.txt", mime: "text/plain" },
          ],
        })
        .pipe(Effect.forkChild)

      yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for read tool to start", "10 seconds")
      yield* prompt.cancel(chat.id)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  { config: cfg },
  30_000,
)

noLLMServer.instance(
  "interrupt propagates abort signal to read tool via file part (directory)",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const registry = yield* ToolRegistry.Service
      const { read } = yield* registry.named()
      const { ready, restore } = yield* hangUntilAborted(read)
      yield* restore

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Abort Test" })

      const fiber = yield* prompt
        .prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [
            { type: "text", text: "read this" },
            { type: "file", url: `file://${dir}`, filename: "dir", mime: "application/x-directory" },
          ],
        })
        .pipe(Effect.forkChild)

      yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for read tool to start", "10 seconds")
      yield* prompt.cancel(chat.id)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  { config: cfg },
  30_000,
)

// Missing file handling

noLLMServer.instance(
  "does not fail the prompt when a file part is missing",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})

      const missing = path.join(dir, "does-not-exist.ts")
      const msg = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [
          { type: "text", text: "please review @does-not-exist.ts" },
          {
            type: "file",
            mime: "text/plain",
            url: `file://${missing}`,
            filename: "does-not-exist.ts",
          },
        ],
      })

      if (msg.info.role !== "user") throw new Error("expected user message")
      const hasFailure = msg.parts.some(
        (part) => part.type === "text" && part.synthetic && part.text.includes("Read tool failed to read"),
      )
      expect(hasFailure).toBe(true)

      yield* sessions.remove(session.id)
    }),
  { config: cfg },
)

noLLMServer.instance(
  "keeps stored part order stable when file resolution is async",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})

      const missing = path.join(dir, "still-missing.ts")
      const msg = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [
          {
            type: "file",
            mime: "text/plain",
            url: `file://${missing}`,
            filename: "still-missing.ts",
          },
          { type: "text", text: "after-file" },
        ],
      })

      if (msg.info.role !== "user") throw new Error("expected user message")

      const stored = yield* MessageV2.get({
        sessionID: session.id,
        messageID: msg.info.id,
      })
      const text = stored.parts.filter((part) => part.type === "text").map((part) => part.text)

      expect(text[0]?.startsWith("Called the Read tool with the following input:")).toBe(true)
      expect(text[1]?.includes("Read tool failed to read")).toBe(true)
      expect(text[2]).toBe("after-file")

      yield* sessions.remove(session.id)
    }),
  { config: cfg },
)

// Special characters in filenames

noLLMServer.instance(
  "handles filenames with # character",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      yield* writeText(path.join(dir, "file#name.txt"), "special content\n")

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const parts = yield* prompt.resolvePromptParts("Read @file#name.txt")
      const fileParts = parts.filter((part) => part.type === "file")

      expect(fileParts.length).toBe(1)
      expect(fileParts[0].filename).toBe("file#name.txt")
      expect(fileParts[0].url).toContain("%23")

      const decodedPath = fileURLToPath(fileParts[0].url)
      expect(decodedPath).toBe(path.join(dir, "file#name.txt"))

      const message = yield* prompt.prompt({
        sessionID: session.id,
        parts,
        noReply: true,
      })
      const stored = yield* MessageV2.get({ sessionID: session.id, messageID: message.info.id })
      const textParts = stored.parts.filter((part) => part.type === "text")
      const hasContent = textParts.some((part) => part.text.includes("special content"))
      expect(hasContent).toBe(true)

      yield* sessions.remove(session.id)
    }),
  { git: true, config: cfg },
)

// Regression: empty assistant turn loop

it.instance("does not loop empty assistant turns for a simple reply", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Prompt regression" })

    yield* llm.text("packages/apexo/src/session/processor.ts")

    const result = yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      parts: [{ type: "text", text: "Where is SessionProcessor?" }],
    })

    expect(result.info.role).toBe("assistant")
    expect(result.parts.some((part) => part.type === "text" && part.text.includes("processor.ts"))).toBe(true)

    const msgs = yield* sessions.messages({ sessionID: session.id })
    expect(msgs.filter((msg) => msg.info.role === "assistant")).toHaveLength(1)
    expect(yield* llm.calls).toBe(1)
  }),
)

it.instance("records aborted errors when prompt is cancelled mid-stream", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Prompt cancel regression" })

    yield* llm.hang

    const fiber = yield* prompt
      .prompt({
        sessionID: session.id,
        agent: "build",
        parts: [{ type: "text", text: "Cancel me" }],
      })
      .pipe(Effect.forkChild)

    yield* llm.wait(1)
    yield* waitForBusy(session.id)
    yield* prompt.cancel(session.id)

    const exit = yield* Fiber.await(fiber)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.info.role).toBe("assistant")
      if (exit.value.info.role === "assistant") {
        expect(exit.value.info.error?.name).toBe("MessageAbortedError")
      }
    }

    const msgs = yield* sessions.messages({ sessionID: session.id })
    const last = msgs.findLast((msg) => msg.info.role === "assistant")
    expect(last?.info.role).toBe("assistant")
    if (last?.info.role === "assistant") {
      expect(last.info.error?.name).toBe("MessageAbortedError")
    }
  }),
)

// Agent variant

noLLMServer.instance(
  "applies agent variant only when using agent model",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})

      const other = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        model: { providerID: ProviderV2.ID.make("apexo"), modelID: ModelV2.ID.make("kimi-k2.5-free") },
        noReply: true,
        parts: [{ type: "text", text: "hello" }],
      })
      if (other.info.role !== "user") throw new Error("expected user message")
      expect(other.info.model.variant).toBeUndefined()

      const match = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "hello again" }],
      })
      if (match.info.role !== "user") throw new Error("expected user message")
      expect(match.info.model).toEqual({
        providerID: ProviderV2.ID.make("test"),
        modelID: ModelV2.ID.make("test-model"),
        variant: "xhigh",
      })
      expect(match.info.model.variant).toBe("xhigh")

      const override = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        variant: "high",
        parts: [{ type: "text", text: "hello third" }],
      })
      if (override.info.role !== "user") throw new Error("expected user message")
      expect(override.info.model.variant).toBe("high")

      yield* sessions.remove(session.id)
    }),
  {
    config: {
      ...cfg,
      provider: {
        ...cfg.provider,
        test: {
          ...cfg.provider.test,
          models: {
            "test-model": {
              ...cfg.provider.test.models["test-model"],
              variants: { xhigh: {}, high: {} },
            },
          },
        },
      },
      agent: {
        build: {
          model: "test/test-model",
          variant: "xhigh",
        },
      },
    },
  },
)

// /context-window

noLLMServer.instance(
  "keeps a context window choice only when the model supports that size",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }
      const supported = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        model,
        contextWindow: 500_000,
        noReply: true,
        parts: [{ type: "text", text: "hello" }],
      })
      if (supported.info.role !== "user") throw new Error("expected user message")
      expect(supported.info.model.contextWindow).toBe(500_000)
      const unsupported = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        model,
        contextWindow: 123_000,
        noReply: true,
        parts: [{ type: "text", text: "hello again" }],
      })
      if (unsupported.info.role !== "user") throw new Error("expected user message")
      expect(unsupported.info.model.contextWindow).toBeUndefined()
      yield* sessions.remove(session.id)
    }),
  {
    config: {
      ...cfg,
      provider: {
        ...cfg.provider,
        test: {
          ...cfg.provider.test,
          models: {
            "test-model": {
              ...cfg.provider.test.models["test-model"],
              limit: { context: 2_000_000, output: 32_000, context_options: [256_000, 500_000, 2_000_000] },
            },
          },
        },
      },
    },
  },
)

// Agent / command resolution errors

noLLMServer.instance(
  "unknown agent throws typed error",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const exit = yield* prompt
        .prompt({
          sessionID: session.id,
          agent: "nonexistent-agent-xyz",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(err).not.toBeInstanceOf(TypeError)
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain('Agent not found: "nonexistent-agent-xyz"')
        }
      }
    }),
  30_000,
)

noLLMServer.instance(
  "unknown agent error includes available agent names",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const exit = yield* prompt
        .prompt({
          sessionID: session.id,
          agent: "nonexistent-agent-xyz",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain("build")
        }
      }
    }),
  30_000,
)

noLLMServer.instance(
  "unknown command throws typed error with available names",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const exit = yield* prompt
        .command({
          sessionID: session.id,
          command: "nonexistent-command-xyz",
          arguments: "",
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(err).not.toBeInstanceOf(TypeError)
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain('Command not found: "nonexistent-command-xyz"')
          expect(err.data.message).toContain("init")
        }
      }
    }),
  30_000,
)

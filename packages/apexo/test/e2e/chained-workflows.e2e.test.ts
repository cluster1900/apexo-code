import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { describe, expect } from "bun:test"
import { ConfigV1 } from "@apexo/core/v1/config/config"
import { SessionV1 } from "@apexo/core/v1/session"
import { Database } from "@apexo/core/database/database"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { SessionProjector } from "@apexo/core/session/projector"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Deferred, Effect, Fiber, Layer } from "effect"
import path from "path"
import fs from "fs/promises"

import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
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
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"

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

function makeMcp() {
  return Layer.succeed(
    MCP.Service,
    MCP.Service.of({
      status: () => Effect.succeed({}),
      clients: () => Effect.succeed({}),
      instructions: () => Effect.succeed([]),
      tools: () => Effect.succeed({}),
      prompts: () => Effect.succeed({}),
      resources: () => Effect.succeed({}),
      resourceTemplates: () => Effect.succeed({}),
      add: () => Effect.succeed({ status: { status: "disabled" as const } }),
      connect: () => Effect.void,
      disconnect: () => Effect.void,
      getPrompt: () => Effect.succeed(undefined),
      readResource: () => Effect.succeed(undefined),
      startAuth: () => Effect.die("unexpected MCP auth"),
      authenticate: () => Effect.die("unexpected MCP auth"),
      finishAuth: () => Effect.die("unexpected MCP auth"),
      removeAuth: () => Effect.void,
      supportsOAuth: () => Effect.succeed(false),
      hasStoredTokens: () => Effect.succeed(false),
      getAuthStatus: () => Effect.succeed("not_authenticated" as const),
    }),
  )
}

const runtimeFlags = RuntimeFlags.layer({ experimentalEventSystem: true })
const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

const promptRoot = LayerNode.group([
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  Agent.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  Provider.node,
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

function makeHttp() {
  const root = LayerNode.group([promptRoot, testLLMServerNode])
  const replacements = [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, makeMcp()],
    [RuntimeFlags.node, runtimeFlags],
  ] as const
  return AppNodeBuilderV1.build(root, replacements)
}

const it = testEffect(makeHttp())

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

describe("V1 backend end-to-end workflows (local HTTP provider)", () => {
  describe("Workflow 1: Prompt -> LLM Tool Call -> Tool Auto-Execution -> Tool Result Fed Back -> Continuation -> Final Streamed Answer", () => {
    it.instance("executes a complete multi-turn tool calling loop", () =>
      Effect.gen(function* () {
        const { dir, llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const chat = yield* sessions.create({
          title: "Tool Execution Workflow",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // Turn 1 input: User asks to create a greeting file
        yield* user(chat.id, "Please create a greeting file greeting.txt")

        const targetFile = path.join(dir, "greeting.txt")

        // Turn 1 LLM response: Tool call to "write"
        yield* llm.push(reply().tool("write", { filePath: targetFile, content: "Hello Chained Apexo!" }).stop())

        // Turn 2 LLM response: Model receives tool result and provides final confirmation
        yield* llm.text("Greeting file has been created successfully.")

        // Run prompt loop
        const result = yield* prompt.loop({ sessionID: chat.id })

        // Assertions
        expect(yield* llm.calls).toBe(2)
        expect(result.info.role).toBe("assistant")

        // Check file was actually written to disk by the tool execution
        const fileContent = yield* Effect.promise(() => fs.readFile(targetFile, "utf-8"))
        expect(fileContent).toBe("Hello Chained Apexo!")

        // Check assistant message parts contain tool execution state and final text
        const messages = yield* sessions.messages({ sessionID: chat.id })
        const toolMsg = messages.find((m) => m.parts.some((p) => p.type === "tool"))
        expect(toolMsg).toBeDefined()

        const toolPart = toolMsg?.parts.find((p) => p.type === "tool")
        expect(toolPart).toBeDefined()
        expect(toolPart?.tool).toBe("write")
        expect(toolPart?.state.status).toBe("completed")

        expect(result.parts.some((p) => p.type === "text" && p.text.includes("Greeting file has been created"))).toBe(
          true,
        )
      }),
    )
  })

  describe("Workflow 2: Permission-Gated Tool Execution Chain (Approval Flow)", () => {
    it.instance("pauses for user permission approval and resumes execution upon grant", () =>
      Effect.gen(function* () {
        const { dir, llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service

        // Create session requiring manual permission for all tools
        const chat = yield* sessions.create({
          title: "Permission Approval Workflow",
          permission: [{ permission: "*", pattern: "*", action: "ask" }],
        })

        yield* user(chat.id, "Please write file with permission")

        const targetFile = path.join(dir, "permitted.txt")

        // Turn 1 LLM response: requests write tool call
        yield* llm.push(reply().tool("write", { filePath: targetFile, content: "permitted-content" }).stop())

        // Turn 2 LLM response: confirmation after tool succeeds
        yield* llm.text("File written with permission.")

        // Start prompt loop in a fiber so we can interact with permission
        const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

        // Wait for permission request to appear
        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const list = yield* permission.list()
            return list.length > 0 ? list[0] : undefined
          }),
          "timed out waiting for permission request",
          "5 seconds",
        )

        expect(pending.sessionID).toBe(chat.id)
        expect(yield* Effect.promise(() => Bun.file(targetFile).exists())).toBe(false)

        // Approve permission
        yield* permission.reply({
          requestID: pending.id,
          reply: "always",
        })

        // Wait for loop to complete
        const result = yield* Fiber.join(fiber)
        expect(result.info.role).toBe("assistant")

        // Tool state in messages should be completed
        const messages = yield* sessions.messages({ sessionID: chat.id })
        const toolMsg = messages.find((m) => m.parts.some((p) => p.type === "tool"))
        const toolPart = toolMsg?.parts.find((p) => p.type === "tool")
        expect(toolPart?.state.status).toBe("completed")

        const fileExists = yield* Effect.promise(() => fs.readFile(targetFile, "utf-8"))
        expect(fileExists).toBe("permitted-content")
      }),
    )
  })

  describe("Workflow 3: Permission-Gated Tool Execution Chain (Rejection Flow)", () => {
    it.instance("aborts tool execution when permission is denied and feeds rejection back to model", () =>
      Effect.gen(function* () {
        const { dir, llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service

        const chat = yield* sessions.create({
          title: "Permission Rejection Workflow",
          permission: [{ permission: "*", pattern: "*", action: "ask" }],
        })

        yield* user(chat.id, "Please delete secret file")

        // Turn 1 LLM response: requests write command
        yield* llm.push(
          reply()
            .tool("write", { filePath: path.join(dir, "danger.txt"), content: "danger" })
            .stop(),
        )

        // Turn 2 LLM response: model handles rejection notice
        yield* llm.text("Understood, I will not write the file since permission was denied.")

        // Start prompt loop in fiber
        const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

        // Wait for permission request
        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const list = yield* permission.list()
            return list.length > 0 ? list[0] : undefined
          }),
          "timed out waiting for permission request",
          "5 seconds",
        )

        expect(pending).toBeDefined()

        // Reject permission
        yield* permission.reply({
          requestID: pending.id,
          reply: "reject",
          message: "Operation rejected by user policy.",
        })

        // Wait for loop to complete
        const result = yield* Fiber.join(fiber)
        expect(result.info.role).toBe("assistant")

        // Tool state should be error due to rejection
        const messages = yield* sessions.messages({ sessionID: chat.id })
        const toolMsg = messages.find((m) => m.parts.some((p) => p.type === "tool"))
        const toolPart = toolMsg?.parts.find((p) => p.type === "tool")
        expect(toolPart?.state.status).toBe("error")
        expect(yield* Effect.promise(() => Bun.file(path.join(dir, "danger.txt")).exists())).toBe(false)
      }),
    )
  })

  describe("Workflow 4: Interactive Question Answering Chain (`ask_question` tool)", () => {
    it.instance("pauses when model asks a question and resumes with selected answer", () =>
      Effect.gen(function* () {
        const { dir, llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const question = yield* Question.Service

        const chat = yield* sessions.create({
          title: "Question Answering Workflow",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* user(chat.id, "Help me pick a database")

        // Turn 1: model calls question tool
        yield* llm.push(
          reply()
            .tool("question", {
              questions: [
                {
                  question: "Which database do you prefer?",
                  header: "Database Choice",
                  options: [
                    { label: "PostgreSQL", description: "Relational DB" },
                    { label: "SQLite", description: "Embedded DB" },
                  ],
                },
              ],
            })
            .stop(),
        )

        // Turn 2: model continues with the chosen answer
        yield* llm.text("Great! We will configure PostgreSQL for your app.")

        const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

        // Wait for question request to appear
        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const list = yield* question.list()
            return list.length > 0 ? list[0] : undefined
          }),
          "timed out waiting for question request",
          "5 seconds",
        )

        expect(pending).toBeDefined()

        // Reply to the question
        yield* question.reply({
          requestID: pending.id,
          answers: [["PostgreSQL"]],
        })

        const result = yield* Fiber.join(fiber)
        expect(result.info.role).toBe("assistant")

        const messages = yield* sessions.messages({ sessionID: chat.id })
        const toolMsg = messages.find((m) => m.parts.some((p) => p.type === "tool"))
        const toolPart = toolMsg?.parts.find((p) => p.type === "tool")
        expect(toolPart?.state.status).toBe("completed")
        expect(result.parts.some((p) => p.type === "text" && p.text.includes("PostgreSQL"))).toBe(true)
      }),
    )
  })

  describe("Workflow 5: Concurrent Multi-turn Delivery: Steer Mode", () => {
    it.instance("includes a legacy follow-up at the next provider turn with the original request reminder", () =>
      Effect.gen(function* () {
        const { dir, llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const chat = yield* sessions.create({
          title: "Steer Workflow",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // Initial task
        yield* user(chat.id, "Task 1: Analyze performance")

        const gate = yield* Deferred.make<void>()

        // Turn 1: model executes tool and waits on gate
        yield* llm.push(
          reply()
            .tool("write", { filePath: path.join(dir, "perf.txt"), content: "initial" })
            .wait(
              new Promise((resolve) => {
                Effect.runPromise(Deferred.await(gate)).then(resolve)
              }),
            )
            .stop(),
        )

        // Turn 2: response
        yield* llm.text("Addressed both initial analysis and steering request.")

        // Start loop in background
        const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

        // Wait for first turn to be active
        yield* llm.wait(1)

        // Submit steer message while turn is running
        yield* user(chat.id, "Steer: also check memory usage")

        // Release gate to let turn 1 complete
        yield* Deferred.succeed(gate, void 0)

        // Join loop
        const result = yield* Fiber.join(fiber)
        expect(result.info.role).toBe("assistant")

        // Verify the second LLM request contained the <active-task-reminder>
        const hits = yield* llm.hits
        expect(hits.length).toBeGreaterThanOrEqual(2)
        const secondHitBody = JSON.stringify(hits[1]?.body)
        expect(secondHitBody).toContain("active-task-reminder")
        expect(secondHitBody).toContain("Task 1: Analyze performance")
        expect(secondHitBody).toContain("Steer: also check memory usage")
      }),
    )
  })

  describe("Workflow 6: Active Generation Abort / Cancellation Chain", () => {
    it.instance("cancels running generation and returns session to idle via cancel", () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const status = yield* SessionStatus.Service

        const chat = yield* sessions.create({
          title: "Abort Workflow",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* user(chat.id, "Start long running task")

        // Make LLM hang so loop stays busy
        yield* llm.hang

        const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

        // Wait for session to become busy
        yield* pollWithTimeout(
          Effect.gen(function* () {
            const s = yield* status.get(chat.id)
            return s.type === "busy" ? true : undefined
          }),
          "session never became busy",
          "5 seconds",
        )

        // Call official cancel
        yield* llm.wait(1)
        yield* prompt.cancel(chat.id)
        yield* awaitWithTimeout(Fiber.join(fiber), "cancel did not settle the prompt loop")

        // Session status should return to idle
        const finalStatus = yield* status.get(chat.id)
        expect(finalStatus.type).toBe("idle")
      }),
    )
  })

  describe("Workflow 7: File Modification & Snapshot Revert Chain", () => {
    it.instance(
      "reverts modified files back to clean pre-session state",
      () =>
        Effect.gen(function* () {
          const { directory: dir } = yield* TestInstance
          const snapshot = yield* Snapshot.Service

          const filePath = path.join(dir, "code.ts")
          yield* Effect.promise(() => fs.writeFile(filePath, "const version = 1;\n"))

          // Track initial snapshot
          const initialSnap = yield* snapshot.track()
          expect(initialSnap).toBeDefined()

          // Modify file
          yield* Effect.promise(() => fs.writeFile(filePath, "const version = 2; // modified\n"))

          // Compute diff string
          const diff = yield* snapshot.diff(initialSnap!)
          expect(diff).toContain("const version = 2")

          // Create patch and revert
          const patch = yield* snapshot.patch(initialSnap!)
          yield* snapshot.revert([patch])

          // File should be restored to version 1
          const revertedContent = yield* Effect.promise(() => fs.readFile(filePath, "utf-8"))
          expect(revertedContent).toBe("const version = 1;\n")
        }),
      { git: true },
    )
  })

  describe("Workflow 8: Multi-turn Conversation Continuity", () => {
    it.instance("preserves conversation history across sequential user prompts", () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const chat = yield* sessions.create({
          title: "Multi-turn Continuity",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // Turn 1
        yield* user(chat.id, "My secret codename is Falcon.")
        yield* llm.text("Acknowledged, I have noted your codename.")
        yield* prompt.loop({ sessionID: chat.id })

        // Turn 2
        yield* user(chat.id, "What is my codename?")
        yield* llm.text("Your secret codename is Falcon.")
        const result2 = yield* prompt.loop({ sessionID: chat.id })

        expect(result2.parts.some((p) => p.type === "text" && p.text.includes("Falcon"))).toBe(true)

        // Verify that LLM received both user messages in turn 2 request
        const hits = yield* llm.hits
        expect(hits.length).toBe(2)
        const turn2Body = JSON.stringify(hits[1]?.body)
        expect(turn2Body).toContain("Falcon")
        expect(turn2Body).toContain("What is my codename?")
      }),
    )
  })

  describe("Workflow 9: Subagent Delegation Chain (`task` tool)", () => {
    it.instance("runs a real child prompt and returns its result to the parent provider", () =>
      Effect.gen(function* () {
        const setup = yield* useServerConfig(providerCfg)
        const sessions = yield* Session.Service
        const prompt = yield* SessionPrompt.Service
        const parent = yield* sessions.create({
          title: "Parent Delegation Session",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* setup.llm.push(
          reply()
            .tool("task", {
              description: "Analyze code module",
              prompt: "Check for security vulnerabilities",
              subagent_type: "general",
            })
            .stop(),
        )
        yield* setup.llm.text("Child audit result: no issues in the supplied fixture.")
        yield* setup.llm.text("The child audit is complete.")
        const result = yield* prompt.prompt({
          sessionID: parent.id,
          agent: "build",
          model: ref,
          parts: [{ type: "text", text: "Delegate the audit to a general subagent" }],
        })
        expect(result.parts.some((part) => part.type === "text" && part.text === "The child audit is complete.")).toBe(
          true,
        )
        const children = yield* sessions.children(parent.id)
        expect(children).toHaveLength(1)
        const messages = yield* sessions.messages({ sessionID: children[0].id })
        expect(
          messages.some((message) =>
            message.parts.some(
              (part) => part.type === "text" && part.text === "Child audit result: no issues in the supplied fixture.",
            ),
          ),
        ).toBe(true)
        const hits = yield* setup.llm.hits
        expect(hits).toHaveLength(3)
        expect(JSON.stringify(hits[1].body)).toContain("Check for security vulnerabilities")
        expect(JSON.stringify(hits[2].body)).toContain("Child audit result")
      }),
    )
  })

  describe("Workflow 10: Context Window Compaction Chain", () => {
    it.instance("executes a requested compaction and continues with the generated summary", () =>
      Effect.gen(function* () {
        const setup = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const compact = yield* SessionCompaction.Service
        const sessions = yield* Session.Service

        const chat = yield* sessions.create({
          title: "Compaction Workflow",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // Simulate multi-turn transcript
        yield* user(chat.id, "Turn 1: Project specification and requirements details...")
        yield* user(chat.id, "Turn 2: Database schemas and data migration scripts...")
        yield* user(chat.id, "Turn 3: API routing definitions and error handling...")

        // Trigger compaction
        yield* compact.create({
          sessionID: chat.id,
          agent: "build",
          model: ref,
          auto: true,
          overflow: true,
        })

        // Check that a compaction message and part was generated
        const msgs = yield* sessions.messages({ sessionID: chat.id })
        const compactionMsg = msgs.find((m) => m.parts.some((p) => p.type === "compaction"))
        expect(compactionMsg).toBeDefined()

        const compactionPart = compactionMsg?.parts.find((p) => p.type === "compaction")
        expect(compactionPart).toBeDefined()
        expect(compactionPart?.auto).toBe(true)
        expect(compactionPart?.overflow).toBe(true)
        yield* setup.llm.text("Compact summary: requirements, schemas, and routing remain to be implemented.")
        yield* setup.llm.text("Continuing from the compact summary.")
        const result = yield* prompt.loop({ sessionID: chat.id })
        expect(
          result.parts.some((part) => part.type === "text" && part.text === "Continuing from the compact summary."),
        ).toBe(true)
        const completed = yield* sessions.messages({ sessionID: chat.id })
        expect(
          completed.some(
            (message) =>
              message.info.role === "assistant" &&
              message.info.summary &&
              message.parts.some((part) => part.type === "text" && part.text.startsWith("Compact summary:")),
          ),
        ).toBe(true)
        const hits = yield* setup.llm.hits
        expect(hits).toHaveLength(2)
        expect(JSON.stringify(hits[1].body)).toContain("Compact summary:")
      }),
    )
  })
})

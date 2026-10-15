import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { describe, expect } from "bun:test"
import { SessionV1 } from "@apexo/core/v1/session"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { Effect, Layer } from "effect"
import path from "path"
import fs from "fs/promises"

import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { FSUtil } from "@apexo/core/fs-util"
import { Ripgrep } from "@apexo/core/ripgrep"
import { Format } from "../../src/format"
import { Truncate } from "@/tool/truncate"
import { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { WriteTool } from "../../src/tool/write"
import { ReadTool } from "../../src/tool/read"
import { EditTool } from "../../src/tool/edit"
import { GlobTool } from "../../src/tool/glob"
import { GrepTool } from "../../src/tool/grep"
import { ShellTool } from "../../src/tool/shell"
import { Agent } from "../../src/agent/agent"
import { Config } from "@/config/config"
import { Plugin } from "../../src/plugin"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { SessionProjector } from "@apexo/core/session/projector"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { Database } from "@apexo/core/database/database"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "../../src/session/instruction"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))

const mockLsp = Layer.succeed(
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

const mockInstruction = Layer.succeed(
  Instruction.Service,
  Instruction.Service.of({
    clear: () => Effect.void,
    systemPaths: () => Effect.succeed(new Set()),
    system: () => Effect.succeed([]),
    find: () => Effect.succeed(undefined),
    resolve: () => Effect.succeed([]),
  }),
)

const testLayer = AppNodeBuilder.build(
  LayerNode.group([
    Agent.node,
    Config.node,
    CrossSpawnSpawner.node,
    Database.node,
    EventV2Bridge.node,
    Format.node,
    FSUtil.node,
    InstanceStore.node,
    Instruction.node,
    LSP.node,
    Plugin.node,
    Provider.node,
    Ripgrep.node,
    RuntimeFlags.node,
    Session.node,
    SessionProjector.node,
    SessionRunState.node,
    SessionStatus.node,
    ToolRegistry.node,
    Truncate.node,
  ]),
  [
    [InstanceStore.bootstrapNode, noopBootstrap],
    [Instruction.node, mockInstruction],
    [LSP.node, mockLsp],
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
  ],
)

const it = testEffect(testLayer)

const toolCtx = (sessionID: SessionID, messageID: MessageID): Tool.Context => ({
  sessionID,
  messageID,
  callID: "call_test_123",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

describe("V1 service integration - core capabilities", () => {
  describe("Feature 1: Project & Workspace Environment", () => {
    it.instance("detects directory structure, initializes files, and discovers paths", () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const fsys = yield* FSUtil.Service

        // Verify root directory exists
        const exists = yield* fsys.existsSafe(dir)
        expect(exists).toBe(true)

        // Write a test configuration file
        const configPath = path.join(dir, "apexo.json")
        yield* fsys.writeWithDirs(configPath, JSON.stringify({ username: "e2e-tester" }, null, 2))

        const readContent = yield* Effect.promise(() => fs.readFile(configPath, "utf-8"))
        expect(readContent).toContain("e2e-tester")

        // Create nested directories and files
        const nestedDir = path.join(dir, "src", "sub")
        const nestedFile = path.join(nestedDir, "app.ts")
        yield* fsys.writeWithDirs(nestedFile, "export const greeting = 'hello world';")

        const nestedExists = yield* fsys.existsSafe(nestedFile)
        expect(nestedExists).toBe(true)
      }),
    )
  })

  describe("Feature 2: Providers & Model Resolution", () => {
    it.instance("resolves configured provider catalogs and models list", () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const fsys = yield* FSUtil.Service
        const providerSvc = yield* Provider.Service

        // Configure a provider in apexo.json
        const configPath = path.join(dir, "apexo.json")
        yield* fsys.writeWithDirs(
          configPath,
          JSON.stringify(
            {
              provider: {
                test: {
                  name: "Test Provider",
                  id: "test",
                  models: {
                    "test-model": {
                      id: "test-model",
                      name: "Test Model",
                      tool_call: true,
                      limit: { context: 128000, output: 4096 },
                    },
                  },
                },
              },
            },
            null,
            2,
          ),
        )

        const providers = yield* providerSvc.list()
        const providerList = Object.values(providers)
        expect(providerList.length).toBeGreaterThan(0)

        const testProvider = providers[ProviderV2.ID.make("test")]
        expect(testProvider).toBeDefined()
        expect(testProvider.name).toBe("Test Provider")
        expect(testProvider.models["test-model"]).toBeDefined()
        expect(testProvider.models["test-model"].capabilities.toolcall).toBe(true)
      }),
    )
  })

  describe("Feature 3: Session Lifecycle & Persistence", () => {
    it.instance("performs complete session CRUD with metadata", () =>
      Effect.gen(function* () {
        const sessionSvc = yield* Session.Service

        // 1. Create session
        const created = yield* sessionSvc.create({ title: "E2E Session" })
        expect(created.id).toBeDefined()
        expect(created.title).toBe("E2E Session")

        // 2. Retrieve session
        const retrieved = yield* sessionSvc.get(created.id)
        expect(retrieved.id).toBe(created.id)
        expect(retrieved.title).toBe("E2E Session")

        // 3. Update session title
        yield* sessionSvc.setTitle({ sessionID: created.id, title: "Updated E2E Session" })
        const afterUpdate = yield* sessionSvc.get(created.id)
        expect(afterUpdate.title).toBe("Updated E2E Session")

        // 4. List sessions
        const list = yield* sessionSvc.list()
        const found = list.some((s) => s.id === created.id)
        expect(found).toBe(true)

        // 5. Delete session
        yield* sessionSvc.remove(created.id)
        const afterRemove = yield* sessionSvc.list()
        expect(afterRemove.some((s) => s.id === created.id)).toBe(false)
      }),
    )

    it.instance("switches agent and model on an existing session", () =>
      Effect.gen(function* () {
        const sessionSvc = yield* Session.Service
        const chat = yield* sessionSvc.create({ title: "Agent Switch Session" })

        // Update session agent and model
        const newModel = {
          providerID: ProviderV2.ID.make("test-provider"),
          id: ModelV2.ID.make("test-model"),
        }
        yield* sessionSvc.setAgentModel({
          sessionID: chat.id,
          agent: "plan",
          model: newModel,
          time: Date.now(),
        })

        const afterSwitch = yield* sessionSvc.get(chat.id)
        expect(afterSwitch.agent).toBe("plan")
        expect(afterSwitch.model?.providerID).toBe(newModel.providerID)
        expect(afterSwitch.model?.id).toBe(newModel.id)
      }),
    )
  })

  describe("Feature 4: Legacy message persistence", () => {
    it.instance("persists legacy user messages with text and file parts", () =>
      Effect.gen(function* () {
        const sessionSvc = yield* Session.Service
        const chat = yield* sessionSvc.create({ title: "Message Parts Session" })

        const userMsgID = MessageID.ascending()
        const userMsg: SessionV1.User = {
          id: userMsgID,
          role: "user",
          sessionID: chat.id,
          agent: "build",
          model: {
            providerID: ProviderV2.ID.make("test"),
            modelID: ModelV2.ID.make("test-model"),
          },
          time: { created: Date.now() },
        }

        yield* sessionSvc.updateMessage(userMsg)

        // Add text part
        const textPart = yield* sessionSvc.updatePart({
          id: PartID.ascending(),
          messageID: userMsgID,
          sessionID: chat.id,
          type: "text",
          text: "Please analyze the source code.",
        })
        expect(textPart.type).toBe("text")

        // Add file attachment part
        const filePart = yield* sessionSvc.updatePart({
          id: PartID.ascending(),
          messageID: userMsgID,
          sessionID: chat.id,
          type: "file",
          url: "file:///tmp/main.ts",
          filename: "main.ts",
          mime: "text/typescript",
        })
        expect(filePart.type).toBe("file")

        // Retrieve messages and verify all parts exist
        const msgs = yield* sessionSvc.messages({ sessionID: chat.id })
        expect(msgs.length).toBe(1)
        expect(msgs[0].parts.length).toBe(2)
        expect(msgs[0].parts.some((p) => p.type === "text")).toBe(true)
        expect(msgs[0].parts.some((p) => p.type === "file")).toBe(true)
      }),
    )
  })

  describe("Feature 5: Built-in Tool Execution Engine", () => {
    it.instance("executes write tool to create files", () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const writeTool = yield* WriteTool
        const tool = yield* writeTool.init()
        const targetPath = path.join(dir, "generated.txt")

        const result = yield* tool.execute(
          {
            filePath: targetPath,
            content: "Hello from WriteTool!",
          },
          toolCtx(SessionID.make("ses_1"), MessageID.make("msg_1")),
        )

        expect(result).toBeDefined()
        const diskContent = yield* Effect.promise(() => fs.readFile(targetPath, "utf-8"))
        expect(diskContent).toBe("Hello from WriteTool!")
      }),
    )

    it.instance("executes read tool to inspect file contents", () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const targetPath = path.join(dir, "readable.txt")
        yield* Effect.promise(() => fs.writeFile(targetPath, "Line 1\nLine 2\nLine 3\n"))

        const readTool = yield* ReadTool
        const tool = yield* readTool.init()

        const result = yield* tool.execute(
          {
            filePath: targetPath,
          },
          toolCtx(SessionID.make("ses_1"), MessageID.make("msg_1")),
        )

        expect(result.output).toContain("Line 1")
        expect(result.output).toContain("Line 2")
        expect(result.output).toContain("Line 3")
      }),
    )

    it.instance("executes edit tool for exact string replacements", () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const targetPath = path.join(dir, "editable.txt")
        yield* Effect.promise(() => fs.writeFile(targetPath, "foo = 1\nbar = 2\nbaz = 3\n"))

        const editTool = yield* EditTool
        const tool = yield* editTool.init()

        const result = yield* tool.execute(
          {
            filePath: targetPath,
            oldString: "bar = 2",
            newString: "bar = 42",
          },
          toolCtx(SessionID.make("ses_1"), MessageID.make("msg_1")),
        )

        expect(result).toBeDefined()
        const diskContent = yield* Effect.promise(() => fs.readFile(targetPath, "utf-8"))
        expect(diskContent).toBe("foo = 1\nbar = 42\nbaz = 3\n")
      }),
    )

    it.instance("executes glob tool to locate files by pattern", () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        yield* Effect.promise(() => fs.mkdir(path.join(dir, "docs"), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "docs", "a.md"), "a"))
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "docs", "b.md"), "b"))
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "docs", "c.txt"), "c"))

        const globTool = yield* GlobTool
        const tool = yield* globTool.init()

        const result = yield* tool.execute(
          {
            pattern: "**/*.md",
            path: dir,
          },
          toolCtx(SessionID.make("ses_1"), MessageID.make("msg_1")),
        )

        expect(result.output).toContain("a.md")
        expect(result.output).toContain("b.md")
        expect(result.output).not.toContain("c.txt")
        expect(result.metadata.count).toBe(2)
      }),
    )

    it.instance("executes grep tool to search pattern in files", () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "sample.txt"), "findme_pattern_12345 in line"))

        const grepTool = yield* GrepTool
        const tool = yield* grepTool.init()

        const result = yield* tool.execute(
          {
            pattern: "findme_pattern_12345",
            path: dir,
          },
          toolCtx(SessionID.make("ses_1"), MessageID.make("msg_1")),
        )

        expect(result.output).toContain("findme_pattern_12345")
        expect(result.metadata.matches).toBe(1)
      }),
    )

    it.instance("executes shell tool and captures output and exit code", () =>
      Effect.gen(function* () {
        const shellTool = yield* ShellTool
        const tool = yield* shellTool.init()

        const result = yield* tool.execute(
          {
            command: "echo 'apexo-e2e-shell-test'",
          },
          toolCtx(SessionID.make("ses_1"), MessageID.make("msg_1")),
        )

        expect(result.output).toContain("apexo-e2e-shell-test")
        expect(result.metadata.exit).toBe(0)
      }),
    )
  })

  describe("Feature 6: Tool Input Validation & Defense", () => {
    it.instance("returns error when reading a non-existent file", () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const readTool = yield* ReadTool
        const tool = yield* readTool.init()

        const exit = yield* tool
          .execute(
            {
              filePath: path.join(dir, "does-not-exist.txt"),
            },
            toolCtx(SessionID.make("ses_1"), MessageID.make("msg_1")),
          )
          .pipe(Effect.exit)

        expect(exit._tag).toBe("Failure")
      }),
    )

    it.instance("fails gracefully when editing with non-matching oldString", () =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const targetPath = path.join(dir, "target.txt")
        yield* Effect.promise(() => fs.writeFile(targetPath, "actual content"))

        const editTool = yield* EditTool
        const tool = yield* editTool.init()

        const exit = yield* tool
          .execute(
            {
              filePath: targetPath,
              oldString: "non-existent-search-string",
              newString: "replacement",
            },
            toolCtx(SessionID.make("ses_1"), MessageID.make("msg_1")),
          )
          .pipe(Effect.exit)

        expect(exit._tag).toBe("Failure")
      }),
    )
  })
})

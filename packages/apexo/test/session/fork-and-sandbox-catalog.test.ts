import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { DateTime, Effect } from "effect"
import { AbsolutePath } from "@apexo/schema/schema"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Database } from "@apexo/core/database/database"
import { EventV2 } from "@apexo/core/event"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { SessionV2 } from "@apexo/core/session"
import { SessionEvent } from "@apexo/core/session/event"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionMessage } from "@apexo/core/session/message"
import { TodoTable } from "@apexo/core/session/sql"
import { SessionCommandSandbox } from "@apexo/core/session/command-sandbox"
import { CommandSandbox } from "@apexo/core/command-sandbox"
import { AgentV2 } from "@apexo/core/agent"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { cliIt } from "../lib/cli-process"

const buildLayer = () =>
  AppNodeBuilder.build(
    LayerNode.group([
      SessionV2.node,
      SessionCommandSandbox.node,
      EventV2.node,
      Database.node,
      LocationServiceMap.node,
    ]),
    [
      [Database.node, Database.layerFromPath(":memory:")],
      [SessionExecution.node, SessionExecutionLocal.node],
    ],
  )

describe("SessionV2.fork and CommandSandbox.catalog", () => {
  test(
    "SessionV2.fork copies full history with todos, slices before messageID or staged revert while clearing todos, and preserves sandbox policy",
    async () => {
      const workspace = await mkdtemp(path.join(homedir(), ".apexo-fork-test-"))
      await mkdir(path.join(workspace, ".apexo"), { recursive: true })
      await writeFile(path.join(workspace, "apexo.json"), JSON.stringify({ snapshots: false }))
      await writeFile(
        path.join(workspace, ".apexo", "sandbox.toml"),
        [
          "[profiles.custom-net]",
          'extends = "workspace"',
          'allow_domains = ["api.github.com", "*.npmjs.org"]',
          "",
        ].join("\n"),
      )

      const layer = buildLayer()
      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const database = yield* Database.Service
            const events = yield* EventV2.Service
            const sessions = yield* SessionV2.Service
            const locations = yield* LocationServiceMap.Service
            const location = { directory: AbsolutePath.make(workspace) }
            const locationLayer = locations.get(location)

            const catalog = yield* Effect.gen(function* () {
              const sandbox = yield* CommandSandbox.Service
              return yield* sandbox.catalog
            }).pipe(Effect.provide(locationLayer))
            expect(catalog.scope).toBe("native_commands")
            expect(catalog.failure).toBeUndefined()
            expect(catalog.profiles.map((item) => item.name)).toContain("off")
            expect(catalog.profiles.map((item) => item.name)).toContain("workspace")
            expect(catalog.profiles.map((item) => item.name)).toContain("read-only")
            expect(catalog.profiles.map((item) => item.name)).toContain("strict")
            expect(catalog.profiles.map((item) => item.name)).toContain("devbox")
            expect(catalog.profiles.map((item) => item.name)).toContain("custom-net")
            const customProfile = catalog.profiles.find((item) => item.name === "custom-net")
            expect(customProfile).toMatchObject({
              name: "custom-net",
              builtin: false,
              base: "workspace",
              network: "off",
              allowDomains: ["*.npmjs.org", "api.github.com"],
            })

            const modelA = ModelV2.Ref.make({
              providerID: ProviderV2.ID.make("xai"),
              id: ModelV2.ID.make("grok-4"),
            })
            const modelB = ModelV2.Ref.make({
              providerID: ProviderV2.ID.make("xai"),
              id: ModelV2.ID.make("grok-4-mini"),
            })

            const source = yield* sessions.create({
              location,
              agent: AgentV2.ID.make("build"),
              model: modelA,
              commandSandbox: process.platform === "darwin" ? "custom-net" : "off",
            })

            if (process.platform === "darwin") {
              const sourceSandbox = yield* Effect.gen(function* () {
                const sandbox = yield* CommandSandbox.Service
                return yield* sandbox.status(source.id)
              }).pipe(Effect.provide(locationLayer))
              expect(sourceSandbox).toMatchObject({
                profile: "custom-net",
                base: "workspace",
                network: "off",
                allowDomains: ["*.npmjs.org", "api.github.com"],
              })
            }

            const m1 = SessionMessage.ID.create()
            const m2 = SessionMessage.ID.create()
            const mSwitchAgent = SessionMessage.ID.create()
            const mSwitchModel = SessionMessage.ID.create()
            const m3 = SessionMessage.ID.create()
            const now = yield* DateTime.now

            yield* events.publish(SessionEvent.Prompted, {
          origin: "unknown",
              sessionID: source.id,
              messageID: m1,
              prompt: { text: "First user message" },
              delivery: "steer",
              timestamp: now,
            })
            yield* events.publish(SessionEvent.Step.Started, {
              sessionID: source.id,
              assistantMessageID: m2,
              agent: "build",
              model: modelA,
              timestamp: now,
            })
            yield* events.publish(SessionEvent.Text.Started, {
              sessionID: source.id,
              assistantMessageID: m2,
              textID: "t1",
              timestamp: now,
            })
            yield* events.publish(SessionEvent.Text.Ended, {
              sessionID: source.id,
              assistantMessageID: m2,
              textID: "t1",
              text: "First assistant reply",
              timestamp: now,
            })
            yield* events.publish(SessionEvent.Step.Ended, {
              sessionID: source.id,
              assistantMessageID: m2,
              finish: "stop",
              timestamp: now,
              tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
              cost: 0,
            })
            yield* events.publish(SessionEvent.AgentSwitched, {
              sessionID: source.id,
              messageID: mSwitchAgent,
              agent: "plan",
              timestamp: now,
            })
            yield* events.publish(SessionEvent.ModelSwitched, {
              sessionID: source.id,
              messageID: mSwitchModel,
              model: modelB,
              timestamp: now,
            })
            yield* events.publish(SessionEvent.Prompted, {
          origin: "unknown",
              sessionID: source.id,
              messageID: m3,
              prompt: { text: "Second user message" },
              delivery: "steer",
              timestamp: now,
            })

            yield* database.db
              .insert(TodoTable)
              .values({
                session_id: source.id,
                content: "Ship V2 fork",
                status: "completed",
                priority: "high",
                position: 0,
                time_created: 1000,
                time_updated: 1000,
              })
              .run()

            // 1. Full fork (no messageID, no revert): copies all messages and inherits todos
            const fullFork = yield* sessions.fork({ sessionID: source.id })
            expect(fullFork.id).not.toBe(source.id)
            expect(fullFork.parentID).toBeUndefined()
            expect(fullFork.title).toBe(`${source.title} (fork #1)`)
            expect(fullFork.agent).toBe(AgentV2.ID.make("plan"))
            expect(fullFork.model?.id).toBe(ModelV2.ID.make("grok-4-mini"))

            const fullMessages = yield* sessions.messages({ sessionID: fullFork.id, order: "asc" })
            expect(fullMessages.map((msg) => msg.type)).toEqual([
              "user",
              "assistant",
              "agent-switched",
              "model-switched",
              "user",
            ])
            const fullTodos = yield* database.db
              .select()
              .from(TodoTable)
              .where(eq(TodoTable.session_id, fullFork.id))
              .all()
            expect(fullTodos.map((t) => t.content)).toEqual(["Ship V2 fork"])

            if (process.platform === "darwin") {
              const forkedSandbox = yield* Effect.gen(function* () {
                const sandbox = yield* CommandSandbox.Service
                return yield* sandbox.status(fullFork.id)
              }).pipe(Effect.provide(locationLayer))
              expect(forkedSandbox).toMatchObject({
                profile: "custom-net",
                base: "workspace",
                network: "off",
                allowDomains: ["*.npmjs.org", "api.github.com"],
              })
            }

            // Forking a fork increments (#1 -> #2)
            const secondFork = yield* sessions.fork({ sessionID: fullFork.id })
            expect(secondFork.title).toBe(`${source.title} (fork #2)`)

            // 2. Sliced fork before mSwitchAgent: keeps [m1, m2], inherits m2's agent/model, clears todos in target while keeping source todos intact
            const slicedFork = yield* sessions.fork({
              sessionID: source.id,
              messageID: mSwitchAgent,
              title: "Sliced Before Switch",
            })
            expect(slicedFork.title).toBe("Sliced Before Switch")
            expect(slicedFork.agent).toBe(AgentV2.ID.make("build"))
            expect(slicedFork.model?.id).toBe(ModelV2.ID.make("grok-4"))

            const slicedMessages = yield* sessions.messages({ sessionID: slicedFork.id, order: "asc" })
            expect(slicedMessages.map((msg) => msg.type)).toEqual(["user", "assistant"])
            const slicedTodos = yield* database.db
              .select()
              .from(TodoTable)
              .where(eq(TodoTable.session_id, slicedFork.id))
              .all()
            expect(slicedTodos).toEqual([])

            // 2b. Sliced fork before the first user message (m1): slice is empty, recovers initial creation agent/model instead of later-switched plan/grok-4-mini
            const emptySliceFork = yield* sessions.fork({
              sessionID: source.id,
              messageID: m1,
              title: "Sliced Before First Message",
            })
            expect(emptySliceFork.title).toBe("Sliced Before First Message")
            expect(emptySliceFork.agent).toBe(AgentV2.ID.make("build"))
            expect(emptySliceFork.model?.id).toBe(ModelV2.ID.make("grok-4"))
            const emptySliceMessages = yield* sessions.messages({ sessionID: emptySliceFork.id, order: "asc" })
            expect(emptySliceMessages).toEqual([])
            const emptySliceTodos = yield* database.db
              .select()
              .from(TodoTable)
              .where(eq(TodoTable.session_id, emptySliceFork.id))
              .all()
            expect(emptySliceTodos).toEqual([])

            // Source todos must still be intact
            const sourceTodos = yield* database.db
              .select()
              .from(TodoTable)
              .where(eq(TodoTable.session_id, source.id))
              .all()
            expect(sourceTodos.map((t) => t.content)).toEqual(["Ship V2 fork"])

            // 3. Staged revert truncation on source session: fork without messageID truncates at revert.messageID and clears todos
            yield* events.publish(SessionEvent.RevertEvent.Staged, {
              sessionID: source.id,
              revert: { messageID: mSwitchAgent },
              timestamp: now,
            })
            const revertedFork = yield* sessions.fork({ sessionID: source.id })
            const revertedMessages = yield* sessions.messages({ sessionID: revertedFork.id, order: "asc" })
            expect(revertedMessages.map((msg) => msg.type)).toEqual(["user", "assistant"])
            const revertedTodos = yield* database.db
              .select()
              .from(TodoTable)
              .where(eq(TodoTable.session_id, revertedFork.id))
              .all()
            expect(revertedTodos).toEqual([])
          }).pipe(Effect.scoped, Effect.provide(layer)),
        )
      } finally {
        await rm(workspace, { recursive: true, force: true })
      }
    },
    15_000,
  )

  test(
    "CommandSandbox.catalog surfaces failure when sandbox.toml is invalid while keeping built-ins",
    async () => {
      const workspace = await mkdtemp(path.join(homedir(), ".apexo-sandbox-catalog-bad-"))
      await mkdir(path.join(workspace, ".apexo"), { recursive: true })
      await writeFile(
        path.join(workspace, ".apexo", "sandbox.toml"),
        [
          "[profiles.broken]",
          'extends = "unknown-base"',
          "",
        ].join("\n"),
      )

      const layer = buildLayer()
      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const locations = yield* LocationServiceMap.Service
            const locationLayer = locations.get({ directory: AbsolutePath.make(workspace) })
            const catalog = yield* Effect.gen(function* () {
              const sandbox = yield* CommandSandbox.Service
              return yield* sandbox.catalog
            }).pipe(Effect.provide(locationLayer))
            expect(catalog.profiles.map((item) => item.name)).toEqual([
              "off",
              "workspace",
              "read-only",
              "strict",
              "devbox",
            ])
            expect(catalog.failure?.code).toBe("invalid_policy")
          }).pipe(Effect.scoped, Effect.provide(layer)),
        )
      } finally {
        await rm(workspace, { recursive: true, force: true })
      }
    },
    15_000,
  )
})

describe("CLI session fork and native headless --fork", () => {
  cliIt.live(
    "apexo session fork and apexo run --session-protocol native --fork branch from an existing session",
    ({ llm, apexo, home }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          Bun.write(
            path.join(home, "apexo.json"),
            JSON.stringify({
              providers: {
                test: {
                  api: {
                    type: "aisdk",
                    package: "@ai-sdk/openai-compatible",
                    url: llm.url,
                    settings: { apiKey: "test-key" },
                  },
                  models: {
                    "test-model": {
                      capabilities: { tools: true, input: ["text"], output: ["text"] },
                      limit: { context: 100000, output: 4096 },
                    },
                  },
                },
              },
            }),
          ),
        )
        const nativeEnv = {
          APEXO_DB: path.join(home, "fork.db"),
          APEXO_CONFIG_CONTENT: "",
          APEXO_DISABLE_PROJECT_CONFIG: "",
        }
        yield* llm.text("First response on source session")
        const firstRun = yield* apexo.run("Hello source", {
          format: "json",
          extraArgs: ["--dir", home, "--session-protocol", "native"],
          env: nativeEnv,
        })
        apexo.expectExit(firstRun, 0)
        const firstEvents = apexo.parseJsonEvents(firstRun.stdout)
        const sourceSessionID = firstEvents.find((event) => typeof event.sessionID === "string")?.sessionID as string
        expect(sourceSessionID).toBeDefined()

        // 1. CLI `apexo session fork <id> --title "CLI Forked" --format json`
        const forkCmd = yield* apexo.spawn(
          [
            "session",
            "fork",
            sourceSessionID,
            "--title",
            "CLI Forked",
            "--format",
            "json",
          ],
          { env: nativeEnv },
        )
        apexo.expectExit(forkCmd, 0)
        const forkedJson = JSON.parse(forkCmd.stdout) as {
          id: string
          sourceSessionID: string
          title: string
        }
        expect(forkedJson.sourceSessionID).toBe(sourceSessionID)
        expect(forkedJson.id).not.toBe(sourceSessionID)
        expect(forkedJson.title).toBe("CLI Forked")

        // 2. CLI `apexo run --session-protocol native --session <id> --fork "Followup on fork"`
        yield* llm.text("Response on forked headless session")
        const headlessFork = yield* apexo.run("Followup on fork", {
          format: "json",
          extraArgs: ["--dir", home, "--session-protocol", "native", "--session", sourceSessionID, "--fork"],
          env: nativeEnv,
        })
        apexo.expectExit(headlessFork, 0)
        expect(headlessFork.stdout).toContain("Response on forked headless session")
        const headlessEvents = apexo.parseJsonEvents(headlessFork.stdout)
        const headlessForkID = headlessEvents.find((event) => typeof event.sessionID === "string")?.sessionID as string
        expect(headlessForkID).toBeDefined()
        expect(headlessForkID).not.toBe(sourceSessionID)
        expect(headlessForkID).not.toBe(forkedJson.id)

        const requests = yield* llm.hits
        expect(requests).toHaveLength(2)
        const secondPromptBody = JSON.stringify(requests[1]?.body.messages ?? [])
        expect(secondPromptBody).toContain("Hello source")
        expect(secondPromptBody).toContain("First response on source session")
        expect(secondPromptBody).toContain("Followup on fork")

        // 3. Default CLI (compatibility mode) session can also be forked via `apexo session fork <id>`
        yield* llm.text("Compat response on default CLI session")
        const compatRun = yield* apexo.run("Hello default CLI", {
          format: "json",
          extraArgs: ["--dir", home],
          env: { APEXO_DB: nativeEnv.APEXO_DB },
        })
        apexo.expectExit(compatRun, 0)
        const compatEvents = apexo.parseJsonEvents(compatRun.stdout)
        const compatSessionID = compatEvents.find((event) => typeof event.sessionID === "string")?.sessionID as string
        expect(compatSessionID).toBeDefined()

        const compatForkCmd = yield* apexo.spawn(
          [
            "session",
            "fork",
            compatSessionID,
            "--title",
            "Compat CLI Forked",
            "--format",
            "json",
          ],
          { env: { APEXO_DB: nativeEnv.APEXO_DB } },
        )
        apexo.expectExit(compatForkCmd, 0)
        const compatForkedJson = JSON.parse(compatForkCmd.stdout) as {
          id: string
          sourceSessionID: string
          title: string
        }
        expect(compatForkedJson.sourceSessionID).toBe(compatSessionID)
        expect(compatForkedJson.id).not.toBe(compatSessionID)
        expect(compatForkedJson.title).toBe("Compat CLI Forked")
      }),
    60_000,
  )
})

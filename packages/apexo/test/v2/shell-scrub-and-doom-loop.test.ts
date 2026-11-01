import { expect } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { ConfigProvider, Effect, Layer } from "effect"
import { AgentV2 } from "@apexo/core/agent"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionInputExecution } from "@apexo/core/session/input-execution"
import { SessionMessage } from "@apexo/core/session/message"
import { ShellEnvironment } from "@apexo/core/shell-environment"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))

it.live(
  "subprocessEnv and native bash scrub sensitive host credentials while honoring env_allow",
  () =>
    Effect.gen(function* () {
      const sampleBase: NodeJS.ProcessEnv = {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/tester",
        SSH_AUTH_SOCK: "/tmp/ssh.sock",
        MONKEY_PATCH: "keep-word",
        OPENAI_API_KEY: "sk-openai-secret",
        ANTHROPIC_API_KEY: "sk-ant-secret",
        GITHUB_TOKEN: "ghp_secret",
        GH_TOKEN: "gho_allowed",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        APEXO_SERVER_PASSWORD: "pw-secret",
        PGPASSWORD: "pg-secret",
      }
      const scrubbed = ShellEnvironment.subprocessEnv(
        { PLUGIN_INJECTED_TOKEN: "plugin-ok" },
        { base: sampleBase, allow: ["GH_*"] },
      )
      expect(scrubbed.PATH).toBe("/usr/bin:/bin")
      expect(scrubbed.HOME).toBe("/Users/tester")
      expect(scrubbed.SSH_AUTH_SOCK).toBe("/tmp/ssh.sock")
      expect(scrubbed.MONKEY_PATCH).toBe("keep-word")
      expect(scrubbed.GH_TOKEN).toBe("gho_allowed")
      expect(scrubbed.PLUGIN_INJECTED_TOKEN).toBe("plugin-ok")
      expect(scrubbed.OPENAI_API_KEY).toBeUndefined()
      expect(scrubbed.ANTHROPIC_API_KEY).toBeUndefined()
      expect(scrubbed.GITHUB_TOKEN).toBeUndefined()
      expect(scrubbed.AWS_SECRET_ACCESS_KEY).toBeUndefined()
      expect(scrubbed.APEXO_SERVER_PASSWORD).toBeUndefined()
      expect(scrubbed.PGPASSWORD).toBeUndefined()

      const unscrubbed = ShellEnvironment.subprocessEnv({}, { base: sampleBase, scrub: false })
      expect(unscrubbed.OPENAI_API_KEY).toBe("sk-openai-secret")

      const root = yield* tmpdirScoped()
      const llm = yield* TestLLMServer
      yield* Effect.promise(async () => {
        await mkdir(path.join(root, "data"), { recursive: true })
        await Bun.write(
          path.join(root, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            compaction: { auto: false },
            permissions: [
              { action: "bash", resource: "*", effect: "allow" },
              { action: "process_*", resource: "*", effect: "allow" },
            ],
            toolset: {
              bash: {
                env_allow: ["APEXO_TEST_ALLOWED_TOKEN"],
              },
            },
            providers: {
              test: {
                name: "Fixture",
                api: {
                  type: "aisdk",
                  package: "@ai-sdk/openai-compatible",
                  url: llm.url,
                  settings: { apiKey: "fixture" },
                },
                models: {
                  fixture: {
                    name: "Fixture",
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 100000, output: 4096 },
                  },
                },
              },
            },
          }),
        )
      })

      const prevSecret = process.env.APEXO_TEST_HOST_API_KEY
      const prevAllowed = process.env.APEXO_TEST_ALLOWED_TOKEN
      const prevPlain = process.env.APEXO_TEST_PLAIN_VAR
      process.env.APEXO_TEST_HOST_API_KEY = "leaked-host-key"
      process.env.APEXO_TEST_ALLOWED_TOKEN = "explicitly-allowed-token"
      process.env.APEXO_TEST_PLAIN_VAR = "plain-visible"
      const app = AppNodeBuilder.build(
        LayerNode.group([
          SessionV2.node,
          SessionExecution.node,
          SessionExecutionLocal.node,
          SessionInputExecution.node,
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
        ],
      ).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))))

      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const execution = yield* SessionExecution.Service
        const outcomes = yield* SessionInputExecution.Service
        const session = yield* sessions.create({
          location: { directory: AbsolutePath.make(root) },
          model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("fixture") },
          agent: AgentV2.ID.make("build"),
        })
        yield* llm.tool("bash", {
          command:
            'printf "[%s|%s|%s]" "$APEXO_TEST_HOST_API_KEY" "$APEXO_TEST_ALLOWED_TOKEN" "$APEXO_TEST_PLAIN_VAR" > env-probe.txt',
          description: "probe env",
        })
        yield* llm.text("ENV_PROBED")
        const admitted = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "probe environment" },
          executionPolicy: { mode: "headless", permissions: "approve_once" },
        })
        const outcome = yield* outcomes.wait({ sessionID: session.id, inputID: admitted.id }, 10000)
        expect(outcome.execution.status).toBe("completed")
        const captured = yield* Effect.promise(() => Bun.file(path.join(root, "env-probe.txt")).text())
        expect(captured).toBe("[|explicitly-allowed-token|plain-visible]")

        // Owned background process (background: true -> process-execution.ts) in an ordinary non-headless
        // turn also scrubs host secrets, and 3+ consecutive identical process_output polls are exempt from doom_loop.
        const extractProcId = (hit: { body: Record<string, unknown> }) => {
          const match = /proc_[A-Za-z0-9]{26}/.exec(JSON.stringify(hit.body))
          if (!match) throw new Error("Expected proc_ ID in tool history")
          return match[0]
        }
        yield* llm.tool("bash", {
          command:
            'printf "[%s|%s|%s]" "$APEXO_TEST_HOST_API_KEY" "$APEXO_TEST_ALLOWED_TOKEN" "$APEXO_TEST_PLAIN_VAR" > bg-env-probe.txt',
          description: "background probe env",
          background: true,
        })
        yield* llm.respond((hit) => reply().tool("process_output", { process_id: extractProcId(hit) }).item())
        yield* llm.respond((hit) => reply().tool("process_output", { process_id: extractProcId(hit) }).item())
        yield* llm.respond((hit) => reply().tool("process_output", { process_id: extractProcId(hit) }).item())
        yield* llm.respond((hit) =>
          reply().tool("process_wait", { process_id: extractProcId(hit), timeout_ms: 5000 }).item(),
        )
        yield* llm.text("BG_ENV_PROBED")
        yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "probe background environment and poll 3 times" },
          resume: false,
        })
        yield* execution.resume(session.id)
        const bgCaptured = yield* Effect.promise(() => Bun.file(path.join(root, "bg-env-probe.txt")).text())
        expect(bgCaptured).toBe("[|explicitly-allowed-token|plain-visible]")
      }).pipe(
        Effect.provide(app),
        Effect.ensuring(
          Effect.sync(() => {
            if (prevSecret === undefined) delete process.env.APEXO_TEST_HOST_API_KEY
            else process.env.APEXO_TEST_HOST_API_KEY = prevSecret
            if (prevAllowed === undefined) delete process.env.APEXO_TEST_ALLOWED_TOKEN
            else process.env.APEXO_TEST_ALLOWED_TOKEN = prevAllowed
            if (prevPlain === undefined) delete process.env.APEXO_TEST_PLAIN_VAR
            else process.env.APEXO_TEST_PLAIN_VAR = prevPlain
          }),
        ),
      )
    }),
  25000,
)

it.live(
  "native V2 doom_loop blocks 3rd consecutive identical tool call, halts 4th repeat under --auto, and resets on new user prompt",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const llm = yield* TestLLMServer
      yield* Effect.promise(async () => {
        await mkdir(path.join(root, "data"), { recursive: true })
        await Bun.write(
          path.join(root, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            compaction: { auto: false },
            providers: {
              test: {
                name: "Fixture",
                api: {
                  type: "aisdk",
                  package: "@ai-sdk/openai-compatible",
                  url: llm.url,
                  settings: { apiKey: "fixture" },
                },
                models: {
                  fixture: {
                    name: "Fixture",
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 100000, output: 4096 },
                  },
                },
              },
            },
          }),
        )
      })
      const app = AppNodeBuilder.build(
        LayerNode.group([
          SessionV2.node,
          SessionExecution.node,
          SessionExecutionLocal.node,
          SessionInputExecution.node,
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
        ],
      ).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))))

      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const execution = yield* SessionExecution.Service
        const outcomes = yield* SessionInputExecution.Service
        const session = yield* sessions.create({
          location: { directory: AbsolutePath.make(root) },
          model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("fixture") },
          agent: AgentV2.ID.make("build"),
        })

        // Scenario 1: 3 identical bash calls (with differently ordered keys on #2) -> #3 is blocked without running, model recovers on turn 4
        const cmd = "printf x >> runs.txt"
        yield* llm.tool("bash", { command: cmd, description: "repeat" })
        yield* llm.tool("bash", { description: "repeat", command: cmd })
        yield* llm.tool("bash", { command: cmd, description: "repeat" })
        yield* llm.text("RECOVERED_FROM_DOOM_LOOP")
        const first = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "run command" },
          executionPolicy: { mode: "headless", permissions: "approve_once" },
        })
        const firstOutcome = yield* outcomes.wait({ sessionID: session.id, inputID: first.id }, 10000)
        expect(firstOutcome.execution.status).toBe("completed")
        // Only the first 2 bash invocations executed; the 3rd was blocked by doom_loop!
        expect(yield* Effect.promise(() => Bun.file(path.join(root, "runs.txt")).text())).toBe("xx")

        // Scenario 2: A new user turn resets the consecutive streak (2 more identical calls execute cleanly)
        yield* llm.tool("bash", { command: cmd, description: "repeat" })
        yield* llm.tool("bash", { command: cmd, description: "repeat" })
        yield* llm.text("NEW_TURN_OK")
        const second = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "new user prompt resets streak" },
          executionPolicy: { mode: "headless", permissions: "approve_once" },
        })
        const secondOutcome = yield* outcomes.wait({ sessionID: session.id, inputID: second.id }, 10000)
        expect(secondOutcome.execution.status).toBe("completed")
        expect(yield* Effect.promise(() => Bun.file(path.join(root, "runs.txt")).text())).toBe("xxxx")

        // Scenario 3: Stubborn model repeats a 4th consecutive identical call after #3 was blocked -> runner halts continuation with turn_limit
        const stubbornCmd = "printf y >> stubborn.txt"
        yield* llm.tool("bash", { command: stubbornCmd, description: "stubborn" })
        yield* llm.tool("bash", { command: stubbornCmd, description: "stubborn" })
        yield* llm.tool("bash", { command: stubbornCmd, description: "stubborn" })
        yield* llm.tool("bash", { command: stubbornCmd, description: "stubborn" })
        const third = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "stubborn loop" },
          executionPolicy: { mode: "headless", permissions: "approve_once" },
        })
        const thirdOutcome = yield* outcomes.wait({ sessionID: session.id, inputID: third.id }, 10000)
        expect(thirdOutcome.execution.status).toBe("failed")
        expect(thirdOutcome.execution.reason).toBe("turn_limit")
        expect(yield* Effect.promise(() => Bun.file(path.join(root, "stubborn.txt")).text())).toBe("yy")
      }).pipe(Effect.provide(app))
    }),
  25000,
)

import { expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AgentV2 } from "@apexo/core/agent"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { EventV2 } from "@apexo/core/event"
import { Global } from "@apexo/core/global"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { MCP } from "@apexo/core/mcp"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionMessage } from "@apexo/core/session/message"
import { ToolRegistry } from "@apexo/core/tool/registry"
import { AbsolutePath } from "@apexo/schema/schema"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { Effect, Layer } from "effect"
import { createApexoMcpServer } from "../../src/cli/cmd/mcp-serve"
import { createNativeLocalHost } from "../../src/cli/native-local-host"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))

it.live(
  "apexo mcp serve exposes apexo_run (multi-turn + ephemeral) and apexo_review over MCP",
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
            model: "test/fixture",
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

      const host = createNativeLocalHost(undefined, true)
      const makeSdk = (directory: string) =>
        createApexoClient({ baseUrl: "http://apexo.local", fetch: host.fetch, directory })

      const server = createApexoMcpServer({
        defaultDirectory: root,
        defaultAuto: true,
        clientForDirectory: makeSdk,
      })
      const client = new Client({ name: "mcp-test-client", version: "1.0.0" })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

      yield* Effect.promise(async () => {
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      })

      return yield* Effect.gen(function* () {
        const listed = yield* Effect.promise(() => client.listTools())
        expect(listed.tools.map((tool) => tool.name)).toEqual(["apexo_run", "apexo_review"])

        // 1. Multi-turn apexo_run: Turn 1 creates a session, Turn 2 continues it via sessionID
        yield* llm.text("TURN_ONE_OK")
        const turn1 = yield* Effect.promise(() =>
          client.callTool({
            name: "apexo_run",
            arguments: { prompt: "first task" },
          }),
        )
        expect(turn1.isError).toBeFalsy()
        const structured1 = turn1.structuredContent as {
          sessionID: string
          status: string
          ephemeral: boolean
          output: string
        }
        expect(structured1.status).toBe("completed")
        expect(structured1.ephemeral).toBe(false)
        expect(structured1.output).toBe("TURN_ONE_OK")
        expect(structured1.sessionID).toStartWith("ses_")

        yield* llm.text("TURN_TWO_OK")
        const turn2 = yield* Effect.promise(() =>
          client.callTool({
            name: "apexo_run",
            arguments: { prompt: "follow up", sessionID: structured1.sessionID },
          }),
        )
        expect(turn2.isError).toBeFalsy()
        const structured2 = turn2.structuredContent as { sessionID: string; output: string }
        expect(structured2.sessionID).toBe(structured1.sessionID)
        expect(structured2.output).toBe("TURN_TWO_OK")
        const sdk = makeSdk(root)
        const messages = yield* Effect.promise(() =>
          sdk.v2.session.messages({ sessionID: structured1.sessionID, order: "asc" }),
        )
        expect(messages.data?.data.filter((item) => item.type === "user")).toHaveLength(2)

        // 2. Ephemeral apexo_run deletes the created session on exit
        yield* llm.text("EPHEMERAL_OK")
        const ephemeralTurn = yield* Effect.promise(() =>
          client.callTool({
            name: "apexo_run",
            arguments: { prompt: "ephemeral task", ephemeral: true },
          }),
        )
        expect(ephemeralTurn.isError).toBeFalsy()
        const ephemeralStructured = ephemeralTurn.structuredContent as {
          sessionID: string
          ephemeral: boolean
          output: string
        }
        expect(ephemeralStructured.ephemeral).toBe(true)
        expect(ephemeralStructured.output).toBe("EPHEMERAL_OK")
        const removedCheck = yield* Effect.promise(() =>
          sdk.v2.session.get({ sessionID: ephemeralStructured.sessionID }),
        )
        expect(removedCheck.response.status).toBe(404)

        // 3. apexo_review runs read-only review ephemerally and validates conflicting review targets
        yield* llm.text("NO_ISSUES_FOUND")
        const reviewResult = yield* Effect.promise(() =>
          client.callTool({
            name: "apexo_review",
            arguments: { base: "main", prompt: "focus on security" },
          }),
        )
        expect(reviewResult.isError).toBeFalsy()
        const reviewStructured = reviewResult.structuredContent as {
          sessionID: string
          ephemeral: boolean
          output: string
        }
        expect(reviewStructured.ephemeral).toBe(true)
        expect(reviewStructured.output).toBe("NO_ISSUES_FOUND")

        const invalidReview = yield* Effect.promise(() =>
          client.callTool({
            name: "apexo_review",
            arguments: { base: "main", commit: "HEAD" },
          }),
        )
        expect(invalidReview.isError).toBe(true)
      }).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            await client.close().catch(() => {})
            await server.close().catch(() => {})
            await host.close().catch(() => {})
          }),
        ),
      )
    }),
  25000,
)

it.live(
  "real subprocess apexo mcp serve over stdio handles multi-turn bash, env scrubbing, git review, doom_loop, and clean EOF shutdown",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const llm = yield* TestLLMServer
      const homeDir = path.join(root, "home")
      const repoDir = path.join(root, "repo")
      const cliEntry = path.resolve(import.meta.dir, "../../src/index.ts")

      yield* Effect.promise(async () => {
        await mkdir(homeDir, { recursive: true })
        await mkdir(path.join(repoDir, "src"), { recursive: true })
        await Bun.write(path.join(repoDir, "src/calc.ts"), "export const divide = (a: number, b: number) => a / b\n")
        execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" })
        execFileSync("git", ["config", "user.email", "sim@example.com"], { cwd: repoDir, stdio: "ignore" })
        execFileSync("git", ["config", "user.name", "Sim Tester"], { cwd: repoDir, stdio: "ignore" })
        execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repoDir, stdio: "ignore" })
        execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore" })
        execFileSync("git", ["commit", "--no-gpg-sign", "-m", "initial"], { cwd: repoDir, stdio: "ignore" })
        // Leave an uncommitted working-tree change for apexo_review { uncommitted: true }
        await Bun.write(
          path.join(repoDir, "src/calc.ts"),
          "export const divide = (a: number, b: number) => a / (b - b)\n",
        )
        await Bun.write(
          path.join(repoDir, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            compaction: { auto: false },
            model: "test/fixture",
            toolset: {
              bash: {
                env_allow: ["ALLOWED_*"],
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

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["run", cliEntry, "mcp", "serve", "--dir", repoDir, "--model", "test/fixture", "--auto"],
        cwd: repoDir,
        stderr: "pipe",
        env: {
          APEXO_TEST_HOME: homeDir,
          HOME: homeDir,
          XDG_CONFIG_HOME: path.join(homeDir, ".config"),
          XDG_DATA_HOME: path.join(homeDir, ".local/share"),
          XDG_STATE_HOME: path.join(homeDir, ".local/state"),
          XDG_CACHE_HOME: path.join(homeDir, ".cache"),
          APEXO_PURE: "1",
          APEXO_DISABLE_AUTOCOMPACT: "1",
          APEXO_DISABLE_MODELS_FETCH: "1",
          APEXO_AUTH_CONTENT: "{}",
          OPENAI_API_KEY: "sk-host-secret-must-scrub",
          GITHUB_TOKEN: "ghp-host-token-must-scrub",
          AWS_SECRET_ACCESS_KEY: "aws-secret-must-scrub",
          ALLOWED_CI_TOKEN: "ci-token-allowed",
          APP_ENVIRONMENT: "simulation-e2e",
        },
      })
      const stderrChunks: string[] = []
      transport.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk.toString("utf8"))
      })
      const client = new Client({ name: "apexo-e2e-stdio-client", version: "1.0.0" })

      yield* Effect.promise(() => client.connect(transport))

      return yield* Effect.gen(function* () {
        // 1. Real stdio initialize + tools/list (proves zero stdout pollution on boot)
        const tools = yield* Effect.promise(() => client.listTools())
        expect(tools.tools.map((item) => item.name)).toEqual(["apexo_run", "apexo_review"])

        // 2. apexo_run executes a real bash tool subprocess; host secrets must be scrubbed while ALLOWED_* survives
        yield* llm.tool("bash", {
          command:
            'printf "%s|%s|%s|%s|%s" "$OPENAI_API_KEY" "$GITHUB_TOKEN" "$AWS_SECRET_ACCESS_KEY" "$ALLOWED_CI_TOKEN" "$APP_ENVIRONMENT" > env-e2e.txt',
          description: "verify subprocess env scrubbing",
        })
        yield* llm.text("E2E_ENV_SCRUB_VERIFIED")
        const run1 = yield* Effect.promise(() =>
          client.callTool({
            name: "apexo_run",
            arguments: { prompt: "probe environment variables" },
          }),
        )
        expect(run1.isError).toBeFalsy()
        const run1Structured = run1.structuredContent as {
          sessionID: string
          status: string
          output: string
        }
        expect(run1Structured.status).toBe("completed")
        expect(run1Structured.output).toBe("E2E_ENV_SCRUB_VERIFIED")
        const envCaptured = yield* Effect.promise(() => Bun.file(path.join(repoDir, "env-e2e.txt")).text())
        expect(envCaptured).toBe("|||ci-token-allowed|simulation-e2e")

        // 3. Multi-turn continuation over real stdio using sessionID from Turn 1
        const hitsBeforeTurn2 = (yield* llm.hits).length
        yield* llm.text("E2E_MULTI_TURN_CONTINUED")
        const run2 = yield* Effect.promise(() =>
          client.callTool({
            name: "apexo_run",
            arguments: {
              sessionID: run1Structured.sessionID,
              prompt: "continue our previous check",
            },
          }),
        )
        expect(run2.isError).toBeFalsy()
        const run2Structured = run2.structuredContent as { sessionID: string; output: string }
        expect(run2Structured.sessionID).toBe(run1Structured.sessionID)
        expect(run2Structured.output).toBe("E2E_MULTI_TURN_CONTINUED")
        const allHitsAfterTurn2 = yield* llm.hits
        const turn2Hit = allHitsAfterTurn2.slice(hitsBeforeTurn2).find((hit) =>
          JSON.stringify(hit.body).includes("continue our previous check"),
        )
        expect(JSON.stringify(turn2Hit?.body)).toContain("probe environment variables")
        expect(JSON.stringify(turn2Hit?.body)).toContain("E2E_ENV_SCRUB_VERIFIED")

        // 4. apexo_review { uncommitted: true } inspects real git diff via bash and deletes ephemeral session
        const hitsBeforeReview = (yield* llm.hits).length
        yield* llm.tool("bash", { command: "git diff src/calc.ts", description: "inspect uncommitted diff" })
        yield* llm.text("REVIEW_FINDING: division by zero in src/calc.ts")
        const review = yield* Effect.promise(() =>
          client.callTool({
            name: "apexo_review",
            arguments: { uncommitted: true, prompt: "check arithmetic safety" },
          }),
        )
        expect(review.isError).toBeFalsy()
        const reviewStructured = review.structuredContent as {
          sessionID: string
          ephemeral: boolean
          output: string
        }
        expect(reviewStructured.ephemeral).toBe(true)
        expect(reviewStructured.output).toContain("division by zero in src/calc.ts")
        const reviewFollowUpHit = (yield* llm.hits).slice(hitsBeforeReview).at(-1)
        expect(JSON.stringify(reviewFollowUpHit?.body)).toContain(
          "+export const divide = (a: number, b: number) => a / (b - b)",
        )
        // Continuing the deleted ephemeral review session must fail cleanly
        const deletedResume = yield* Effect.promise(() =>
          client.callTool({
            name: "apexo_run",
            arguments: { sessionID: reviewStructured.sessionID, prompt: "should not exist" },
          }),
        )
        expect(deletedResume.isError).toBe(true)

        // 5. doom_loop circuit breaker over real stdio even with --auto enabled
        const loopCmd = "printf z >> loop-e2e.txt"
        yield* llm.tool("bash", { command: loopCmd, description: "repeat loop" })
        yield* llm.tool("bash", { command: loopCmd, description: "repeat loop" })
        yield* llm.tool("bash", { command: loopCmd, description: "repeat loop" })
        yield* llm.tool("bash", { command: loopCmd, description: "repeat loop" })
        const hitsBeforeLoop = (yield* llm.hits).length
        const loopTurn = yield* Effect.promise(() =>
          client.callTool({
            name: "apexo_run",
            arguments: { prompt: "trigger stuck loop", ephemeral: true },
          }),
        )
        expect(loopTurn.isError).toBe(true)
        const loopStructured = loopTurn.structuredContent as { status: string; reason: string }
        expect(loopStructured.status).toBe("failed")
        expect(loopStructured.reason).toBe("turn_limit")
        expect(yield* Effect.promise(() => Bun.file(path.join(repoDir, "loop-e2e.txt")).text())).toBe("zz")
        const loopHits = (yield* llm.hits).slice(hitsBeforeLoop)
        expect(
          loopHits.some((hit) => JSON.stringify(hit.body).includes("Repeated identical tool call blocked (doom_loop)")),
        ).toBe(true)

        // 6. Clean, fast shutdown on stdin EOF (must not wait 2000ms for SIGTERM fallback)
        const closeStartedAt = Date.now()
        yield* Effect.promise(() => client.close())
        const closeElapsedMs = Date.now() - closeStartedAt
        expect(closeElapsedMs).toBeLessThan(1500)
      }).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            await client.close().catch(() => {})
          }),
        ),
      )
    }),
  45000,
)

it.live(
  "outer Apexo V2 Code Mode session orchestrates multi-turn apexo mcp serve child agent over stdio",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const llm = yield* TestLLMServer
      const outerHome = path.join(root, "outer-home")
      const outerProject = path.join(root, "outer-project")
      const workerHome = path.join(root, "worker-home")
      const workerProject = path.join(root, "worker-project")
      const cliEntry = path.resolve(import.meta.dir, "../../src/index.ts")

      yield* Effect.promise(async () => {
        await mkdir(path.join(outerHome, "data"), { recursive: true })
        await mkdir(outerProject, { recursive: true })
        await mkdir(workerHome, { recursive: true })
        await mkdir(workerProject, { recursive: true })
        await Bun.write(
          path.join(workerProject, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            compaction: { auto: false },
            model: "test/fixture",
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
        await Bun.write(
          path.join(outerProject, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            mcp: {
              servers: {
                worker: {
                  type: "local",
                  codemode: true,
                  timeout: { startup: 15000, request: 20000 },
                  command: [
                    process.execPath,
                    "run",
                    cliEntry,
                    "mcp",
                    "serve",
                    "--dir",
                    workerProject,
                    "--model",
                    "test/fixture",
                    "--auto",
                  ],
                  environment: {
                    APEXO_TEST_HOME: workerHome,
                    HOME: workerHome,
                    XDG_CONFIG_HOME: path.join(workerHome, ".config"),
                    XDG_DATA_HOME: path.join(workerHome, ".local/share"),
                    XDG_STATE_HOME: path.join(workerHome, ".local/state"),
                    XDG_CACHE_HOME: path.join(workerHome, ".cache"),
                    APEXO_PURE: "1",
                    APEXO_DISABLE_AUTOCOMPACT: "1",
                    APEXO_DISABLE_MODELS_FETCH: "1",
                    APEXO_AUTH_CONTENT: "{}",
                  },
                },
              },
            },
          }),
        )
      })

      const outerApp = AppNodeBuilder.build(
        LayerNode.group([SessionV2.node, LocationServiceMap.node, LocationRuntimeGuard.node, EventV2.node]),
        [
          [
            Global.node,
            Layer.succeed(Global.Service)(
              Global.make({
                data: path.join(outerHome, "data"),
                config: path.join(outerHome, "config"),
                home: outerHome,
              }),
            ),
          ],
          [SessionExecution.node, SessionExecution.noopLayer],
        ],
      )

      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(outerProject) } })

        yield* Effect.gen(function* () {
          const mcp = yield* MCP.Service
          const tools = yield* ToolRegistry.Service
          const registry = yield* tools.materialize()
          expect(registry.definitions.map((item) => item.name)).toContain("execute")

          yield* llm.text("WORKER_STEP_1_DONE")
          yield* llm.text("WORKER_STEP_2_DONE")

          const settled = yield* registry.settle({
            sessionID: session.id,
            agent: AgentV2.ID.make("build"),
            assistantMessageID: SessionMessage.ID.create(),
            call: {
              type: "tool-call" as const,
              id: crypto.randomUUID(),
              name: "execute",
              input: {
                code: `
                  const discovered = await tools.$codemode.search({ query: "review" })
                  const step1 = await tools.worker.apexo_run({ prompt: "prepare draft" })
                  const step2 = await tools.worker.apexo_run({
                    sessionID: step1.sessionID,
                    prompt: "finalize draft",
                  })
                  return {
                    discovered: discovered.items.map((item) => item.path),
                    sameSession: step1.sessionID === step2.sessionID,
                    step1Out: step1.output,
                    step2Out: step2.output,
                  }
                `,
              },
            },
          })

          expect(settled.result.type).toBe("text")
          expect(typeof settled.result.value).toBe("string")
          if (settled.result.type === "text" && typeof settled.result.value === "string") {
            expect(settled.result.value).toContain("tools.worker.apexo_review")
            expect(settled.result.value).toContain('"sameSession": true')
            expect(settled.result.value).toContain("WORKER_STEP_1_DONE")
            expect(settled.result.value).toContain("WORKER_STEP_2_DONE")
          }

          yield* mcp.disconnect("worker")
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(outerApp))
    }),
  45000,
)

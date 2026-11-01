import { expect } from "bun:test"
import { createServer, type ServerResponse } from "node:http"
import { mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { AgentV2 } from "@apexo/core/agent"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { FSUtil } from "@apexo/core/fs-util"
import { Global } from "@apexo/core/global"
import { Location } from "@apexo/core/location"
import { LocationServiceMap, buildLocationServiceMap } from "@apexo/core/location-services"
import { ModelV2 } from "@apexo/core/model"
import { PermissionSaved } from "@apexo/core/permission/saved"
import { ProjectTable } from "@apexo/core/project/sql"
import { ProviderV2 } from "@apexo/core/provider"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionInputExecution } from "@apexo/core/session/input-execution"
import { MAX_CONCURRENT_TOOL_CALLS, MAX_PRE_OUTPUT_STREAM_RETRIES } from "@apexo/core/session/runner/llm"
import { AbsolutePath } from "@apexo/schema/schema"
import { collectDoctorReport, evaluateDoctorCommandPolicy, type DoctorCommandPolicyReport, type DoctorReport } from "../../src/cli/cmd/doctor"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node])))
const apexoRoot = path.resolve(import.meta.dir, "../..")

function writeSse(res: ServerResponse, events: ReadonlyArray<Record<string, unknown>>) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
  for (const event of events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  res.write("data: [DONE]\n\n")
  res.end()
}

function responsesTextEvents(text: string) {
  return [
    {
      type: "response.created",
      sequence_number: 1,
      response: { id: "resp_ok", object: "response", status: "in_progress", model: "fixture", output: [] },
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
        id: "resp_ok",
        object: "response",
        status: "completed",
        output: [],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      },
    },
  ]
}

function responsesToolBatchEvents(calls: ReadonlyArray<{ id: string; name: string; input: Record<string, unknown> }>) {
  let seq = 1
  const events: Array<Record<string, unknown>> = [
    {
      type: "response.created",
      sequence_number: seq,
      response: { id: "resp_tools", object: "response", status: "in_progress", model: "fixture", output: [] },
    },
  ]
  calls.forEach((call, index) => {
    const itemId = `fc_${index + 1}`
    const args = JSON.stringify(call.input)
    seq += 1
    events.push({
      type: "response.output_item.added",
      sequence_number: seq,
      output_index: index,
      item: { type: "function_call", id: itemId, call_id: call.id, name: call.name, arguments: "", status: "in_progress" },
    })
    seq += 1
    events.push({
      type: "response.function_call_arguments.delta",
      sequence_number: seq,
      output_index: index,
      item_id: itemId,
      delta: args,
    })
    seq += 1
    events.push({
      type: "response.function_call_arguments.done",
      sequence_number: seq,
      output_index: index,
      item_id: itemId,
      arguments: args,
    })
    seq += 1
    events.push({
      type: "response.output_item.done",
      sequence_number: seq,
      output_index: index,
      item: {
        type: "function_call",
        id: itemId,
        call_id: call.id,
        name: call.name,
        arguments: args,
        status: "completed",
      },
    })
  })
  seq += 1
  events.push({
    type: "response.completed",
    sequence_number: seq,
    response: {
      id: "resp_tools",
      object: "response",
      status: "completed",
      output: [],
      usage: { input_tokens: 12, output_tokens: 20, total_tokens: 32 },
    },
  })
  return events
}

it.live(
  "apexo doctor validates environment, detects malformed config, and evaluates offline bash permissions with saved grants",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const badDir = path.join(root, "bad-workspace")
      const goodDir = path.join(root, "good-workspace")
      const dataDir = path.join(root, "data")
      const configDir = path.join(root, "config")
      yield* Effect.promise(async () => {
        await mkdir(badDir, { recursive: true })
        await mkdir(goodDir, { recursive: true })
        await mkdir(dataDir, { recursive: true })
        await mkdir(configDir, { recursive: true })
        Bun.spawnSync(["git", "init"], { cwd: goodDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
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
            "--allow-empty",
            "-m",
            "init",
          ],
          {
            cwd: goodDir,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          },
        )
        await Bun.write(path.join(badDir, "apexo.json"), '{ "permissions": [ broken json ')
        await Bun.write(
          path.join(goodDir, "apexo.json"),
          JSON.stringify({
            permissions: [
              { action: "bash", resource: "*", effect: "ask" },
              { action: "bash", resource: "git status*", effect: "allow" },
              { action: "bash", resource: "bun test*", effect: "allow" },
              { action: "bash", resource: "rm -rf *", effect: "deny" },
            ],
            toolset: {
              bash: {
                cmd_prefix: "echo preflight",
              },
            },
            providers: {
              test: {
                name: "DoctorFixture",
                api: {
                  type: "aisdk",
                  package: "@ai-sdk/openai-compatible",
                  url: "http://127.0.0.1:9/v1",
                  settings: { apiKey: "doctor-key" },
                },
                models: {
                  fixture: {
                    name: "Fixture",
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 64000, output: 4096 },
                  },
                },
              },
            },
          }),
        )
      })

      const isolatedDbLayer = Database.layerFromPath(path.join(dataDir, "apexo.db"))
      const globalOverride: LayerNode.Replacements = [
        [Database.node, isolatedDbLayer],
        [
          Global.node,
          Layer.succeed(Global.Service)(Global.make({ data: dataDir, config: configDir, home: root })),
        ],
      ]
      const mapLayer = buildLocationServiceMap(globalOverride)
      const savedApp = AppNodeBuilder.build(LayerNode.group([PermissionSaved.node, Database.node]), globalOverride)

      // 1. In-process doctor report + offline command policy + saved grants
      yield* Effect.gen(function* () {
        const report = yield* collectDoctorReport()
        expect(report.directory).toBe(AbsolutePath.make(FSUtil.resolve(goodDir)))
        expect(report.checks.find((item) => item.id === "git")?.status).toBe("ok")
        expect(report.checks.find((item) => item.id === "config")?.status).toBe("ok")
        expect(report.checks.find((item) => item.id === "providers")?.status).toBe("ok")
        expect(report.checks.find((item) => item.id === "mcp")?.status).toBe("ok")
        if (process.platform === "darwin" || process.platform === "linux") {
          expect(["ok", "warn"]).toContain(report.checks.find((item) => item.id === "sandbox")?.status ?? "")
        }

        // Decomposed compound command with cmd_prefix applied: echo preflight (ask), git status (allow), rm -rf dist (deny) => deny
        const denied = yield* evaluateDoctorCommandPolicy({ command: "git status && rm -rf dist" })
        expect(denied.opaque).toBe(false)
        expect(denied.effectiveCommand).toBe("echo preflight && git status && rm -rf dist")
        expect(denied.effect).toBe("deny")
        expect(denied.segments.some((item) => item.resource === "git status" && item.effect === "allow")).toBe(true)
        expect(denied.segments.some((item) => item.resource === "rm -rf dist" && item.effect === "deny")).toBe(true)

        // Opaque subshell/redirect command falls back to whole-script evaluation
        const opaque = yield* evaluateDoctorCommandPolicy({ command: "echo $(whoami) > out.txt" })
        expect(opaque.opaque).toBe(true)
        expect(opaque.effect).toBe("ask")

        // Project-saved "Always allow" grant lifts ask -> allow, while configured deny still wins over saved allow
        const location = yield* Location.Service
        yield* Effect.gen(function* () {
          const database = yield* Database.Service
          const saved = yield* PermissionSaved.Service
          yield* database.db
            .insert(ProjectTable)
            .values({
              id: location.project.id,
              worktree: location.project.directory,
              sandboxes: [],
            })
            .onConflictDoNothing()
            .run()
            .pipe(Effect.orDie)
          yield* saved.add({
            projectID: location.project.id,
            action: "bash",
            resources: ["echo preflight", "curl https://example.com", "rm -rf dist"],
          })
        }).pipe(Effect.provide(savedApp))

        const lifted = yield* evaluateDoctorCommandPolicy({ command: "curl https://example.com" })
        expect(lifted.effect).toBe("allow")

        const stillDenied = yield* evaluateDoctorCommandPolicy({ command: "rm -rf dist" })
        expect(stillDenied.effect).toBe("deny")
      }).pipe(
        Effect.provideService(Global.Service, Global.make({ data: dataDir, config: configDir, home: root })),
        Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(goodDir) }))),
        Effect.provide(mapLayer),
      )

      // 2. Real CLI subprocess execution: malformed config exits 1, valid --check-command --json exits 0, unknown --agent exits 1
      const cliEnv = {
        ...process.env,
        APEXO_PURE: "1",
        APEXO_TEST_HOME: root,
        XDG_DATA_HOME: path.join(root, "xdg-data"),
        XDG_CONFIG_HOME: path.join(root, "xdg-config"),
        XDG_STATE_HOME: path.join(root, "xdg-state"),
        XDG_CACHE_HOME: path.join(root, "xdg-cache"),
      }

      const badProc = Bun.spawnSync(["bun", "src/index.ts", "doctor", "--dir", badDir, "--json"], {
        cwd: apexoRoot,
        env: cliEnv,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(badProc.exitCode).toBe(1)
      const badReport = JSON.parse(new TextDecoder().decode(badProc.stdout)) as DoctorReport
      expect(badReport.status).toBe("error")
      expect(badReport.checks.find((item) => item.id === "config")?.status).toBe("error")
      expect(badReport.checks.find((item) => item.id === "config")?.summary).toContain("JSONC syntax error")

      const checkProc = Bun.spawnSync(
        ["bun", "src/index.ts", "doctor", "--dir", goodDir, "--check-command", "git status && bun test", "--json"],
        {
          cwd: apexoRoot,
          env: cliEnv,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      expect(checkProc.exitCode).toBe(0)
      const checkJson = JSON.parse(new TextDecoder().decode(checkProc.stdout)) as DoctorCommandPolicyReport
      expect(checkJson.opaque).toBe(false)
      // echo preflight from cmd_prefix asks while git status & bun test allow -> overall ask
      expect(checkJson.effect).toBe("ask")
      expect(checkJson.segments.find((item) => item.resource === "git status")?.effect).toBe("allow")
      expect(checkJson.segments.find((item) => item.resource === "bun test")?.effect).toBe("allow")

      const badAgentProc = Bun.spawnSync(
        ["bun", "src/index.ts", "doctor", "--dir", goodDir, "--check-command", "git status", "--agent", "no_such_agent"],
        {
          cwd: apexoRoot,
          env: cliEnv,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      expect(badAgentProc.exitCode).not.toBe(0)
      expect(new TextDecoder().decode(badAgentProc.stderr)).toContain("Unknown agent: no_such_agent")
    }),
  45000,
)

it.live(
  "V2 SessionRunner bounds per-turn concurrent local tool calls and retries transient pre-output SSE provider errors",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const activeDir = path.join(root, "active")
      const peaksDir = path.join(root, "peaks")
      yield* Effect.promise(async () => {
        await mkdir(path.join(root, "data"), { recursive: true })
        await mkdir(path.join(root, "config"), { recursive: true })
        await mkdir(activeDir, { recursive: true })
        await mkdir(peaksDir, { recursive: true })
      })

      type SseHandler = (res: ServerResponse, body: Record<string, unknown>) => void
      const scripted: SseHandler[] = []
      let requestCount = 0

      const server = yield* Effect.acquireRelease(
        Effect.promise(
          () =>
            new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
              const httpServer = createServer((req, res) => {
                const chunks: Buffer[] = []
                req.on("data", (chunk: Buffer) => chunks.push(chunk))
                req.on("end", () => {
                  const text = Buffer.concat(chunks).toString("utf8")
                  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
                  if (JSON.stringify(body).includes("Generate a title for this conversation")) {
                    writeSse(res, responsesTextEvents("Test Title"))
                    return
                  }
                  requestCount += 1
                  const handler = scripted.shift()
                  if (handler) {
                    handler(res, body)
                    return
                  }
                  writeSse(res, responsesTextEvents("DEFAULT_OK"))
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

      yield* Effect.promise(() =>
        Bun.write(
          path.join(root, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            compaction: { auto: false },
            permissions: [{ action: "bash", resource: "*", effect: "allow" }],
            providers: {
              test: {
                name: "OpenAIFixture",
                api: {
                  type: "aisdk",
                  package: "@ai-sdk/openai",
                  url: server.url,
                  settings: { apiKey: "fixture-key" },
                },
                models: {
                  fixture: {
                    name: "FixtureResponses",
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 100000, output: 4096 },
                  },
                },
              },
            },
          }),
        ),
      )

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
        const outcomes = yield* SessionInputExecution.Service
        const session = yield* sessions.create({
          location: { directory: AbsolutePath.make(root) },
          model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("fixture") },
          agent: AgentV2.ID.make("build"),
        })

        // 1. Pre-output SSE retryable provider-error (2 transient server_error frames -> 3rd attempt succeeds)
        scripted.push(
          (res) =>
            writeSse(res, [
              {
                type: "response.created",
                sequence_number: 1,
                response: { id: "r1", object: "response", status: "in_progress", model: "fixture", output: [] },
              },
              { type: "error", code: "server_error", message: "The server is temporarily overloaded" },
            ]),
          (res) =>
            writeSse(res, [
              {
                type: "response.created",
                sequence_number: 1,
                response: { id: "r2", object: "response", status: "in_progress", model: "fixture", output: [] },
              },
              { type: "error", code: "rate_limit_exceeded", message: "Rate limit temporarily exceeded" },
            ]),
          (res) => writeSse(res, responsesTextEvents("RECOVERED_AFTER_TRANSIENT_SSE")),
        )

        const retryInput = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "test sse retry" },
          executionPolicy: { mode: "headless", permissions: "approve_once" },
        })
        const retryOutcome = yield* outcomes.wait({ sessionID: session.id, inputID: retryInput.id }, 15000)
        expect(retryOutcome.execution.status).toBe("completed")
        expect(retryOutcome.execution.usageIncomplete).toBe(false)
        expect(requestCount).toBe(1 + MAX_PRE_OUTPUT_STREAM_RETRIES)

        const retryContext = yield* sessions.context(session.id)
        const retryAssistants = retryContext.filter((m) => m.type === "assistant")
        expect(retryAssistants.length).toBe(1)
        const firstText = retryAssistants[0]?.type === "assistant"
          ? retryAssistants[0].content.find((p) => p.type === "text")?.text
          : undefined
        expect(firstText).toBe("RECOVERED_AFTER_TRANSIENT_SSE")

        // 2. Non-retryable SSE provider-error fails immediately on attempt 1 without retrying
        const beforeNonRetryable = requestCount
        scripted.push((res) =>
          writeSse(res, [
            {
              type: "response.created",
              sequence_number: 1,
              response: { id: "r_bad", object: "response", status: "in_progress", model: "fixture", output: [] },
            },
            { type: "error", code: "invalid_request_error", message: "Invalid schema parameter" },
          ]),
        )
        const nonRetrySession = yield* sessions.create({
          location: { directory: AbsolutePath.make(root) },
          model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("fixture") },
          agent: AgentV2.ID.make("build"),
        })
        const badInput = yield* sessions.prompt({
          sessionID: nonRetrySession.id,
          prompt: { text: "bad request" },
          executionPolicy: { mode: "headless", permissions: "approve_once" },
        })
        const badOutcome = yield* outcomes.wait({ sessionID: nonRetrySession.id, inputID: badInput.id }, 10000)
        expect(badOutcome.execution.status).toBe("failed")
        expect(requestCount - beforeNonRetryable).toBe(1)

        // 2b. HTTP 503 status errors are retried solely by RequestExecutor (1 + 2 = 3 requests, never amplified to 3x3 = 9)
        const beforeHttp503 = requestCount
        const send503 = (res: ServerResponse) => {
          res.writeHead(503, { "retry-after-ms": "10", "content-type": "application/json" })
          res.end(JSON.stringify({ error: { message: "Service temporarily unavailable" } }))
        }
        scripted.push(send503, send503, send503)
        const http503Session = yield* sessions.create({
          location: { directory: AbsolutePath.make(root) },
          model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("fixture") },
          agent: AgentV2.ID.make("build"),
        })
        const http503Input = yield* sessions.prompt({
          sessionID: http503Session.id,
          prompt: { text: "http 503 check" },
          executionPolicy: { mode: "headless", permissions: "approve_once" },
        })
        const http503Outcome = yield* outcomes.wait({ sessionID: http503Session.id, inputID: http503Input.id }, 10000)
        expect(http503Outcome.execution.status).toBe("failed")
        expect(requestCount - beforeHttp503).toBe(3)

        // 3. Per-turn concurrent local tool-call backpressure cap (12 simultaneous bash calls capped at <= 8 active)
        const totalCalls = 12
        const batchCalls = Array.from({ length: totalCalls }, (_, idx) => ({
          id: `call_conc_${idx + 1}`,
          name: "bash",
          input: {
            command: [
              `touch "active/slot_${idx + 1}"`,
              `ls -1 active | wc -l > "peaks/peak_${idx + 1}"`,
              "sleep 0.25",
              `rm -f "active/slot_${idx + 1}"`,
            ].join(" && "),
            description: `concurrency slot ${idx + 1}`,
          },
        }))
        scripted.push(
          (res) => writeSse(res, responsesToolBatchEvents(batchCalls)),
          (res) => writeSse(res, responsesTextEvents("ALL_12_SETTLED")),
        )

        const concSession = yield* sessions.create({
          location: { directory: AbsolutePath.make(root) },
          model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("fixture") },
          agent: AgentV2.ID.make("build"),
        })
        const concInput = yield* sessions.prompt({
          sessionID: concSession.id,
          prompt: { text: "run 12 concurrent tools" },
          executionPolicy: { mode: "headless", permissions: "approve_once" },
        })
        const concOutcome = yield* outcomes.wait({ sessionID: concSession.id, inputID: concInput.id }, 25000)
        expect(concOutcome.execution.status).toBe("completed")

        const peakFiles = yield* Effect.promise(() => readdir(peaksDir))
        expect(peakFiles.length).toBe(totalCalls)
        const peaks = yield* Effect.promise(() =>
          Promise.all(
            peakFiles.map(async (file) => Number((await Bun.file(path.join(peaksDir, file)).text()).trim())),
          ),
        )
        const observedMax = Math.max(...peaks)
        expect(observedMax).toBeLessThanOrEqual(MAX_CONCURRENT_TOOL_CALLS)
        expect(observedMax).toBeGreaterThanOrEqual(3)
      }).pipe(Effect.provide(app))
    }),
  45000,
)

it.live(
  "DatabaseMigration serializes cold schema bootstrap and custom migrations across concurrent OS processes",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const dbPath = path.join(root, "concurrent-shared.db")
      const workerCode = [
        `import { sql } from "drizzle-orm"`,
        `import { Effect } from "effect"`,
        `import { Database } from "@apexo/core/database/database"`,
        `import { DatabaseMigration } from "@apexo/core/database/migration"`,
        `const dbPath = process.env.APEXO_TEST_DB_PATH!`,
        `const waitMs = Math.max(0, Number(process.env.APEXO_TEST_START_AT) - Date.now())`,
        `if (waitMs > 0) await Bun.sleep(waitMs)`,
        `const customMigration: DatabaseMigration.Migration = {`,
        `  id: "20991101000000_cross_process_serialization_probe",`,
        `  up: (tx) =>`,
        `    Effect.gen(function* () {`,
        `      yield* tx.run(sql\`CREATE TABLE cross_process_probe (applied_by INTEGER NOT NULL)\`)`,
        `      yield* tx.run(sql\`INSERT INTO cross_process_probe (applied_by) VALUES (\${process.pid})\`)`,
        `    }),`,
        `}`,
        `await Effect.runPromise(`,
        `  Effect.gen(function* () {`,
        `    const { db } = yield* Database.Service`,
        `    yield* DatabaseMigration.applyOnly(db, [customMigration])`,
        `  }).pipe(Effect.scoped, Effect.provide(Database.layerFromPath(dbPath))),`,
        `)`,
      ].join("\n")

      const workerCount = 6
      const startAt = String(Date.now() + 250)
      const results = yield* Effect.promise(async () => {
        const procs = Array.from({ length: workerCount }, () =>
          Bun.spawn(["bun", "-e", workerCode], {
            cwd: apexoRoot,
            env: {
              ...process.env,
              APEXO_TEST_DB_PATH: dbPath,
              APEXO_TEST_START_AT: startAt,
            },
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          }),
        )
        return Promise.all(
          procs.map(async (proc) => {
            const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
            return { exitCode, stderr }
          }),
        )
      })

      for (const result of results) {
        if (result.exitCode !== 0) throw new Error(`Worker failed (${result.exitCode}): ${result.stderr}`)
        expect(result.exitCode).toBe(0)
      }

      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const probeCount = yield* database.db.get<{ count: number }>(
          sql`SELECT COUNT(*) as count FROM cross_process_probe`,
        )
        expect(probeCount?.count).toBe(1)
        const journalRow = yield* database.db.get<{ id: string }>(
          sql`SELECT id FROM migration WHERE id = ${"20991101000000_cross_process_serialization_probe"}`,
        )
        expect(journalRow?.id).toBe("20991101000000_cross_process_serialization_probe")
      }).pipe(Effect.provide(Database.layerFromPath(dbPath)))
    }),
  30000,
)

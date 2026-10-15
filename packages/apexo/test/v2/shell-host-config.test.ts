import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Effect, Layer, Schedule } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { BackgroundJob } from "@apexo/core/background-job"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { AbsolutePath } from "@apexo/schema/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionStore } from "@apexo/core/session/store"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionProcessStore } from "@apexo/core/session/process-store"
import { SessionProcessControl } from "@apexo/core/session/process-control"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
for (const item of [
  { name: "zero default", settings: { default_block_until_ms: 0 }, wait: 0 },
  { name: "default clamp", settings: { default_block_until_ms: 500, max_block_until_ms: 25 }, wait: 25 },
  { name: "explicit clamp", settings: { max_block_until_ms: 25 }, input: 500, wait: 25 },
  { name: "seconds clamp", settings: { default_block_until_ms: 500, max_timeout_secs: 0.03 }, wait: 30 },
  { name: "zero caps", settings: { default_block_until_ms: 0, max_block_until_ms: 0, max_timeout_secs: 0 }, wait: 0 },
  { name: "headless foreground", settings: { default_block_until_ms: 0 }, wait: 0, headless: true },
  { name: "unconfigured default completes early", settings: {}, wait: 30000, early: true },
  { name: "permission denial", settings: { default_block_until_ms: 0 }, wait: 0, deny: true },
])
  it.live(
    `configured native Shell ${item.name} promotes the original process`,
    () =>
      Effect.gen(function* () {
        const home = yield* tmpdirScoped()
        const directory = yield* tmpdirScoped()
        const llm = yield* TestLLMServer
        yield* Effect.addFinalizer(() => Effect.promise(() => Bun.write(path.join(directory, "release"), "cleanup")))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(directory, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              toolset: { bash: item.settings },
              permissions: [
                { action: "*", resource: "*", effect: "allow" },
                ...(item.deny ? [{ action: "bash", resource: "*", effect: "deny" }] : []),
              ],
              providers: {
                fixture: {
                  api: {
                    type: "aisdk",
                    package: "@ai-sdk/openai-compatible",
                    url: llm.url,
                    settings: { apiKey: "test" },
                  },
                  models: {
                    model: {
                      name: "Fixture",
                      capabilities: { tools: true, input: ["text"], output: ["text"] },
                      limit: { context: 100000, output: 4096 },
                    },
                  },
                },
              },
            }),
          ),
        )
        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const processes = yield* SessionProcessControl.Service
          const records = yield* SessionProcessStore.Service
          const store = yield* SessionStore.Service
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(directory) },
            agent: AgentV2.ID.make("build"),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          yield* llm.respond(() =>
            reply()
              .tool("bash", {
                command: item.headless
                  ? "printf BEGINEND"
                  : "echo $$ > started; printf BEGIN; while [ ! -f release ]; do sleep 0.02; done; printf END",
                description: "Configured native wait",
                ...(item.input === undefined ? {} : { block_until_ms: item.input }),
              })
              .item(),
          )
          yield* llm.respond(() => reply().text("WAIT_RETURNED").stop().item())
          yield* llm.respond(() => reply().text("COMPLETION_ACK").stop().item())
          yield* sessions.prompt({
            sessionID: parent.id,
            prompt: { text: "Run configured shell" },
            ...(item.headless
              ? { executionPolicy: { mode: "headless" as const, permissions: "reject" as const } }
              : {}),
          })
          if (item.early) {
            yield* Effect.gen(function* () {
              if ((yield* processes.list(parent.id)).length === 0) return yield* Effect.fail("pending")
            }).pipe(Effect.retry({ times: 100, schedule: Schedule.spaced("10 millis") }))
            yield* Effect.promise(() => Bun.write(path.join(directory, "release"), "early"))
          }
          yield* llm.wait(2).pipe(
            Effect.timeout("5 seconds"),
            Effect.tapError(() =>
              Effect.gen(function* () {
                yield* Effect.logError("Shell initial return timeout state", {
                  scenario: item.name,
                  calls: yield* llm.calls,
                  processes: yield* processes.list(parent.id),
                  messages: yield* store.context(parent.id),
                })
              }),
            ),
          )
          yield* sessions.wait(parent.id)
          const listed = yield* processes.list(parent.id)
          if (item.headless) {
            expect(listed).toEqual([])
            expect(JSON.stringify((yield* llm.hits)[1].body)).toContain("BEGINEND")
            return
          }
          if (item.early) {
            expect(listed).toHaveLength(1)
            expect(listed[0].status).toBe("completed")
            expect(listed[0].background).toBe(false)
            expect((yield* records.owned(parent.id, listed[0].id)).request.waitMs).toBe(30000)
            expect(yield* llm.calls).toBe(2)
            return
          }
          if (item.deny) {
            expect(listed).toEqual([])
            expect(yield* Effect.promise(() => Bun.file(path.join(directory, "started")).exists())).toBe(false)
            return
          }
          expect(listed).toHaveLength(1)
          expect(listed[0].status).toBe("running")
          expect(listed[0].background).toBe(true)
          const saved = yield* records.owned(parent.id, listed[0].id)
          expect(saved.request.waitMs).toBe(item.wait)
          expect(saved.request.timeoutMs).toBe(36000000)
          const pid = Number(yield* Effect.promise(() => Bun.file(path.join(directory, "started")).text()))
          process.kill(pid, 0)
          yield* Effect.sleep("50 millis")
          expect((yield* processes.output(parent.id, listed[0].id)).status).toBe("running")
          expect(Number(yield* Effect.promise(() => Bun.file(path.join(directory, "started")).text()))).toBe(pid)
          yield* Effect.promise(() => Bun.write(path.join(directory, "release"), "done"))
          const result = yield* processes.wait(parent.id, listed[0].id, 5000)
          expect(result.process.status).toBe("completed")
          expect(result.process.output).toBe("BEGINEND")
          yield* llm.wait(3).pipe(
            Effect.timeout("5 seconds"),
            Effect.tapError(() =>
              Effect.gen(function* () {
                yield* Effect.logError("Shell completion delivery timeout state", {
                  scenario: item.name,
                  calls: yield* llm.calls,
                  processes: yield* processes.list(parent.id),
                  messages: yield* store.context(parent.id),
                })
              }),
            ),
          )
          yield* sessions.wait(parent.id)
          expect((yield* store.context(parent.id)).filter((message) => message.type === "user")).toHaveLength(1)
          expect(() => process.kill(pid, 0)).toThrow()
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([
                SessionV2.node,
                BackgroundJob.node,
                SessionExecution.node,
                SessionStore.node,
                SessionExecutionLocal.node,
                SessionProcessControl.node,
                SessionProcessStore.node,
              ]),
              [
                [SessionExecution.node, SessionExecutionLocal.node],
                [Global.node, Global.layerWith({ home })],
                [
                  ModelsDev.node,
                  Layer.succeed(ModelsDev.Service, { get: () => Effect.succeed({}), refresh: () => Effect.void }),
                ],
              ],
            ).pipe(
              Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
            ),
          ),
        )
      }),
    20000,
  )

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

const cases: Array<{
  name: string
  timeout?: number
  expected?: number
  foreground?: boolean
  headless?: boolean
  denied?: boolean
  expires?: boolean
}> = [
  { name: "owned omitted lifetime", expected: 36000000 },
  { name: "owned zero lifetime", timeout: 0, expected: 36000000 },
  { name: "owned positive above foreground cap", timeout: 700000, expected: 700000 },
  { name: "owned safety-cap boundary", timeout: 36000000, expected: 36000000 },
  { name: "owned above safety cap rejected", timeout: 36000001, denied: true },
  { name: "owned positive deadline", timeout: 40, expected: 40, expires: true },
  { name: "foreground positive deadline", timeout: 40, foreground: true, expires: true },
  { name: "foreground zero rejected", timeout: 0, foreground: true, denied: true },
  { name: "headless zero rejected", timeout: 0, headless: true, denied: true },
  { name: "foreground above cap rejected", timeout: 700000, foreground: true, denied: true },
]
for (const item of cases)
  it.live(
    `native Shell ${item.name}`,
    () =>
      Effect.gen(function* () {
        const home = yield* tmpdirScoped()
        const directory = yield* tmpdirScoped()
        const llm = yield* TestLLMServer
        yield* Effect.promise(() =>
          Bun.write(
            path.join(directory, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              ...(!item.foreground
                ? { toolset: { bash: { default_block_until_ms: 0, max_timeout_secs: 0.001 } } }
                : {}),
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
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
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(directory) },
            agent: AgentV2.ID.make("build"),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          yield* llm.respond(() =>
            reply()
              .tool("bash", {
                command: "echo $$ > started; printf BEGIN; while :; do sleep 0.02; done",
                description: "Native lifetime probe",
                ...(item.timeout === undefined ? {} : { timeout: item.timeout }),
              })
              .item(),
          )
          yield* llm.respond(() => reply().text("LIFETIME_ACK").stop().item())
          yield* llm.respond(() => reply().text("COMPLETION_ACK").stop().item())
          yield* sessions.prompt({
            sessionID: parent.id,
            prompt: { text: "Run native lifetime probe" },
            ...(item.headless
              ? { executionPolicy: { mode: "headless" as const, permissions: "reject" as const } }
              : {}),
          })
          yield* llm.wait(2).pipe(Effect.timeout("5 seconds"))
          yield* sessions.wait(parent.id)
          const listed = yield* processes.list(parent.id)
          if (item.denied) {
            expect(listed).toEqual([])
            expect(yield* Effect.promise(() => Bun.file(path.join(directory, "started")).exists())).toBe(false)
            return
          }
          if (!item.foreground) {
            const expected = item.expected
            if (expected === undefined) throw new Error("Owned lifetime fixture requires an expected deadline")
            expect(listed).toHaveLength(1)
            expect((yield* records.owned(parent.id, listed[0].id)).request.timeoutMs).toBe(expected)
          }
          if (item.expires) {
            if (item.foreground) expect(listed).toEqual([])
            else expect((yield* processes.wait(parent.id, listed[0].id, 5000)).process.status).toBe("failed")
            // A short deadline includes shell startup, so it can expire before the shell writes this file.
            if (yield* Effect.promise(() => Bun.file(path.join(directory, "started")).exists())) {
              const pid = Number(yield* Effect.promise(() => Bun.file(path.join(directory, "started")).text()))
              expect(() => process.kill(pid, 0)).toThrow()
            }
            return
          }
          yield* Effect.gen(function* () {
            if (!(yield* Effect.promise(() => Bun.file(path.join(directory, "started")).exists())))
              return yield* Effect.fail("pending")
          }).pipe(Effect.retry({ times: 100, schedule: Schedule.spaced("10 millis") }))
          const pid = Number(yield* Effect.promise(() => Bun.file(path.join(directory, "started")).text()))
          yield* Effect.sleep("150 millis")
          process.kill(pid, 0)
          expect((yield* processes.output(parent.id, listed[0].id)).status).toBe("running")
          expect((yield* processes.cancel(parent.id, listed[0].id)).status).toBe("cancelled")
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

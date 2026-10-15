import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Effect, Layer, Schedule, Schema } from "effect"
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
  prefix?: string
  limit?: number
  command: string
  expected?: string
  deny?: boolean
  cancel?: boolean
  headless?: boolean
  global?: number
  sandbox?: boolean
}> = [
  {
    name: "prefix cwd and environment",
    prefix: "mkdir -p nested && cd nested && export OWNED=present",
    command: 'printf \'%s:%s\' "$OWNED" "${PWD##*/}"',
    expected: "present:nested",
  },
  ...(process.platform === "darwin"
    ? [
        {
          name: "prefix stays inside selected read-only sandbox",
          prefix: "touch SHOULD_NOT_EXIST",
          command: "printf SHOULD_NOT_RUN",
          sandbox: true,
        },
      ]
    : []),
  { name: "prefix failure short circuits", prefix: "false", command: "touch SHOULD_NOT_EXIST", expected: "" },
  { name: "empty prefix retains shell syntax", prefix: "", command: "touch SHOULD_NOT_EXIST", expected: "" },
  {
    name: "actual prefixed command denied",
    prefix: "touch PREFIX_EXECUTED",
    command: "touch SHOULD_NOT_EXIST",
    deny: true,
  },
  {
    name: "prefix cancellation joins process",
    prefix: "echo $$ > started; while :; do sleep 0.02; done",
    command: "touch SHOULD_NOT_EXIST",
    cancel: true,
  },
  { name: "unicode head tail", limit: 5, command: "printf '甲😀乙🚀丙丁'", expected: "甲😀" },
  { name: "zero command output retains receipt", limit: 0, command: "printf SECRET_ZERO", expected: "" },
  { name: "foreground unicode limit", limit: 4, command: "printf '甲😀乙🚀丙丁'", expected: "甲😀", headless: true },
  { name: "global byte ceiling remains", limit: 500, command: "printf '%01000d' 0", global: 300 },
]
for (const item of cases)
  it.live(
    `native Shell ${item.name}`,
    () =>
      Effect.gen(function* () {
        const home = yield* tmpdirScoped()
        const directory = yield* tmpdirScoped()
        const llm = yield* TestLLMServer
        const actual = item.prefix === undefined ? item.command : `${item.prefix} && ${item.command}`
        yield* Effect.promise(() =>
          Bun.write(
            path.join(directory, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              toolset: {
                bash: {
                  default_block_until_ms: item.cancel ? 0 : 1000,
                  cmd_prefix: item.prefix,
                  output_byte_limit: item.limit,
                },
              },
              ...(item.global ? { tool_output: { max_bytes: item.global } } : {}),
              permissions: [
                { action: "*", resource: "*", effect: "allow" },
                ...(item.deny ? [{ action: "bash", resource: actual, effect: "deny" }] : []),
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
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(directory) },
            agent: AgentV2.ID.make("build"),
            ...(item.sandbox ? { commandSandbox: "read-only" as const } : {}),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          yield* llm.respond(() =>
            reply().tool("bash", { command: item.command, description: "Configured prefix and output probe" }).item(),
          )
          yield* llm.respond(() => reply().text("ACK").stop().item())
          yield* sessions.prompt({
            sessionID: parent.id,
            prompt: { text: "Run shell probe" },
            ...(item.headless
              ? { executionPolicy: { mode: "headless" as const, permissions: "reject" as const } }
              : {}),
          })
          yield* llm.wait(2).pipe(Effect.timeout("5 seconds"))
          yield* sessions.wait(parent.id)
          const listed = yield* processes.list(parent.id)
          const messages = Schema.decodeUnknownSync(
            Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.Unknown })),
          )((yield* llm.hits)[1].body.messages)
          const content = messages
            .filter((message) => message.role === "tool")
            .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
            .join("")
          if (item.deny) {
            expect(listed).toEqual([])
            expect(yield* Effect.promise(() => Bun.file(path.join(directory, "PREFIX_EXECUTED")).exists())).toBe(false)
            expect(yield* Effect.promise(() => Bun.file(path.join(directory, "SHOULD_NOT_EXIST")).exists())).toBe(false)
            return
          }
          if (item.headless) expect(listed).toEqual([])
          else {
            expect(listed).toHaveLength(1)
            expect((yield* records.owned(parent.id, listed[0].id)).request.command).toBe(actual)
            if (!item.global) expect(content).toContain(listed[0].id)
          }
          if (item.cancel) {
            yield* Effect.gen(function* () {
              if (!(yield* Effect.promise(() => Bun.file(path.join(directory, "started")).exists())))
                return yield* Effect.fail("pending")
            }).pipe(Effect.retry({ times: 100, schedule: Schedule.spaced("10 millis") }))
            const pid = Number(yield* Effect.promise(() => Bun.file(path.join(directory, "started")).text()))
            process.kill(pid, 0)
            const cancelled = yield* processes.cancel(parent.id, listed[0].id)
            expect(cancelled.status).toBe("cancelled")
            expect(() => process.kill(pid, 0)).toThrow()
          }
          if (item.expected !== undefined) expect(content).toContain(item.expected)
          if (item.limit !== undefined) {
            expect(content).not.toContain("SECRET_ZERO")
            expect(content).not.toContain("甲😀乙🚀丙丁")
            if (!item.global) expect(content).toContain("full captured content saved to")
            const match = content.match(/full captured content saved to ([^ ]+) \.\.\./)
            if (!item.global) expect(match).toBeDefined()
            if (match) {
              const retained = yield* Effect.promise(() => Bun.file(match[1]).text())
              expect(retained).toBe(item.limit === 0 ? "SECRET_ZERO" : "甲😀乙🚀丙丁")
            }
            if (item.limit === 5 || item.limit === 4) expect(content).toContain("丙丁")
          }
          if (item.global) expect(Buffer.byteLength(content)).toBeLessThanOrEqual(item.global)
          expect(yield* Effect.promise(() => Bun.file(path.join(directory, "SHOULD_NOT_EXIST")).exists())).toBe(false)
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

import { expect } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { ConfigProvider, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionInputExecution } from "@apexo/core/session/input-execution"
import { SessionSideQuestion } from "@apexo/core/session/side-question"
import { SessionSideQuestionNative } from "@apexo/core/session/side-question-native"
import { SessionMessage } from "@apexo/core/session/message"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { AgentV2 } from "@apexo/core/agent"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
const policy = { mode: "headless", permissions: "reject" } as const
const setup = Effect.gen(function* () {
  const root = yield* tmpdirScoped()
  const llm = yield* TestLLMServer
  yield* Effect.promise(async () => {
    await mkdir(path.join(root, "data"), { recursive: true })
    await Bun.write(
      path.join(root, "apexo.json"),
      JSON.stringify({
        snapshots: false,
        compaction: { auto: false },
        agents: {
          limited: { mode: "primary", steps: 1, permissions: [{ action: "*", resource: "*", effect: "allow" }] },
          operator: { mode: "primary", permissions: [{ action: "*", resource: "*", effect: "allow" }] },
          worker: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] },
          headless: {
            mode: "primary",
            permissions: [
              { action: "*", resource: "*", effect: "ask" },
              { action: "bash", resource: "*DENIED*", effect: "deny" },
            ],
          },
        },
        providers: {
          test: {
            name: "Headless fixture",
            api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url, settings: { apiKey: "fixture" } },
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
  return {
    root,
    llm,
    create: {
      location: { directory: AbsolutePath.make(root) },
      model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("fixture") },
      agent: AgentV2.ID.make("headless"),
    },
    app: AppNodeBuilder.build(
      LayerNode.group([
        SessionV2.node,
        SessionExecutionLocal.node,
        SessionInputExecution.node,
        SessionSideQuestionNative.node,
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
    ).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" })))),
  }
})

it.live(
  "native text lowering preserves admission/retry and side-question snapshots, rejects invalid bytes before provider",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const outcomes = yield* SessionInputExecution.Service
        const side = yield* SessionSideQuestionNative.Service
        const session = yield* sessions.create(f.create)
        const attachment = {
          mime: "text/plain",
          name: "proof.txt",
          description: "source context",
          uri: `data:text/plain;base64,${Buffer.from("NATIVE_TEXT 世界").toString("base64")}`,
        }
        const request = {
          sessionID: session.id,
          id: SessionMessage.ID.create(),
          prompt: { text: "Use attached evidence", files: [attachment] },
          executionPolicy: policy,
        }
        yield* f.llm.text("TEXT_DONE")
        const admitted = yield* sessions.prompt(request)
        expect((yield* outcomes.wait({ sessionID: session.id, inputID: admitted.id }, 10000)).execution.status).toBe(
          "completed",
        )
        const hit = (yield* f.llm.hits)[0]
        const wire = hit.body.messages
        expect(Array.isArray(wire)).toBe(true)
        if (Array.isArray(wire)) {
          const user = wire.find((value) => value.role === "user")
          expect(JSON.stringify(user.content)).toContain("NATIVE_TEXT 世界")
          expect(JSON.stringify(user.content)).toContain("proof.txt")
          expect(JSON.stringify(user.content)).not.toContain("data:text/plain")
        }
        const before = yield* sessions.messages({ sessionID: session.id, order: "asc" })
        expect(before.find((value) => value.type === "user")?.files).toEqual([attachment])
        expect((yield* sessions.prompt(request)).id).toBe(admitted.id)
        expect(yield* f.llm.calls).toBe(1)
        yield* f.llm.text("SIDE_TEXT_DONE")
        const asked = yield* side.ask(session.id, { question: "Read the file evidence" })
        const done = yield* pollWithTimeout(
          side
            .list(session.id)
            .pipe(Effect.map((items) => items.find((item) => item.id === asked.id && item.status === "completed"))),
          "Side text incomplete",
          "10 seconds",
        )
        expect(done.answer).toBe("SIDE_TEXT_DONE")
        expect(yield* sessions.messages({ sessionID: session.id, order: "asc" })).toEqual(before)
        const sideHit = (yield* f.llm.hits)[1]
        expect(JSON.stringify(sideHit.body.messages)).toContain("NATIVE_TEXT 世界")
        expect(yield* f.llm.calls).toBe(2)
        for (const uri of [
          "data:text/plain;base64,/w==",
          "file:///never-read.txt",
          "https://example.invalid/never-fetch.txt",
        ]) {
          const invalid = yield* sessions.create(f.create)
          const input = yield* sessions.prompt({
            sessionID: invalid.id,
            prompt: { text: "Invalid attached input", files: [{ uri }] },
            executionPolicy: policy,
          })
          const result = yield* outcomes.wait({ sessionID: invalid.id, inputID: input.id }, 10000)
          expect(result.execution.status).toBe("failed")
          expect(result.execution.reason).toBe("provider_error")
          expect(yield* f.llm.calls).toBe(2)
          const failed = yield* side.ask(invalid.id, { question: "Must fail before side request" }).pipe(Effect.result)
          expect(failed._tag).toBe("Failure")
          if (failed._tag === "Failure") {
            expect(failed.failure).toBeInstanceOf(SessionSideQuestion.Error)
            if (failed.failure instanceof SessionSideQuestion.Error) expect(failed.failure.code).toBe("invalid")
          }
          expect(yield* side.list(invalid.id)).toEqual([])
          expect(yield* f.llm.calls).toBe(2)
        }
      }).pipe(Effect.provide(f.app))
    }),
  30000,
)

import { expect } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionSideQuestionNative } from "@apexo/core/session/side-question-native"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))

it.live(
  "native snapshot waiting on real Location guard cannot attach to a deleted and reused Session",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const llm = yield* TestLLMServer
      yield* Effect.promise(() => mkdir(path.join(root, "data"), { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(root, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            providers: {
              "side-test": {
                name: "Side lifecycle provider",
                api: {
                  type: "aisdk",
                  package: "@ai-sdk/openai-compatible",
                  url: llm.url,
                  settings: { apiKey: "test" },
                },
                models: {
                  "test-model": {
                    name: "Test",
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 100000, output: 4096 },
                  },
                },
              },
            },
          }),
        ),
      )
      const guard = yield* LocationRuntimeGuard.make
      const snapshot = yield* Deferred.make<void>()
      // Observe entry without replacing the real guard or its blocking/cancellation behavior.
      const observed = LocationRuntimeGuard.Service.of({
        ...guard,
        use: (location, effect) =>
          Deferred.succeed(snapshot, undefined).pipe(Effect.andThen(guard.use(location, effect))),
      })
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const side = yield* SessionSideQuestionNative.Service
        const location = { directory: AbsolutePath.make(root) }
        const model = { providerID: ProviderV2.ID.make("side-test"), id: ModelV2.ID.make("test-model") }
        const session = yield* sessions.create({ location, model })
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
        const reload = yield* guard
          .idle(location, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))
          .pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        const question = yield* side
          .ask(session.id, { question: "Old snapshot must not attach to replacement" })
          .pipe(Effect.result, Effect.forkChild)
        yield* Deferred.await(snapshot).pipe(Effect.timeout("5 seconds"))
        expect(question.pollUnsafe()).toBeUndefined()
        yield* sessions.remove(session.id).pipe(Effect.timeout("5 seconds"))
        yield* sessions.create({ id: session.id, location, model })
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(reload)
        const result = yield* Fiber.join(question)
        expect(result._tag).toBe("Failure")
        if (result._tag === "Failure") expect(result.failure).toMatchObject({ code: "missing" })
        expect(yield* side.list(session.id)).toEqual([])
        expect(yield* sessions.messages({ sessionID: session.id })).toEqual([])
        expect(yield* llm.calls).toBe(0)
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([SessionV2.node, SessionSideQuestionNative.node, SessionExecutionLocal.node]),
            [
              [SessionExecution.node, SessionExecutionLocal.node],
              [LocationRuntimeGuard.node, Layer.succeed(LocationRuntimeGuard.Service)(observed)],
              [
                Global.node,
                Layer.succeed(Global.Service)(
                  Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
                ),
              ],
            ],
          ),
        ),
      )
    }),
  20000,
)

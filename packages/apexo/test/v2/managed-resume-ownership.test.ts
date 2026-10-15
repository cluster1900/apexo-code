import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionSchema } from "@apexo/core/session/schema"
import { WorkflowRole } from "@apexo/core/workflow/role"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"
const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
for (const admission of ["resume", "wake"] as const)
  it.live(
    `unrelated ${admission} cannot consume a prepared Workflow child drain`,
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
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
              agents: { helper: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] } },
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
        const beforeRun = Deferred.makeUnsafe<SessionSchema.ID>()
        const releaseRun = Deferred.makeUnsafe<void>()
        const roles = Layer.effect(
          WorkflowRole.Service,
          Effect.gen(function* () {
            const original = yield* WorkflowRole.Service
            return WorkflowRole.Service.of({
              get: original.get,
              attach: (id, role) =>
                original
                  .attach(id, role)
                  .pipe(Effect.andThen(Deferred.succeed(beforeRun, id)), Effect.andThen(Deferred.await(releaseRun))),
            })
          }),
        ).pipe(Layer.provide(LayerNode.compile(WorkflowRole.node)))
        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const execution = yield* SessionExecution.Service
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(directory) },
            agent: AgentV2.ID.make("build"),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          const releaseProvider = Promise.withResolvers<void>()
          yield* Effect.addFinalizer(() => Effect.sync(() => releaseProvider.resolve()))
          yield* Effect.addFinalizer(() => Deferred.succeed(releaseRun, undefined))
          yield* llm.respond(() =>
            reply()
              .tool("workflow", {
                source: {
                  type: "definition",
                  definition: {
                    name: "owned-run",
                    description: "Ownership probe",
                    stages: [{ name: "child", prompt: "OWNED_CHILD_INPUT", readOnly: true }],
                  },
                },
                agentBudget: 1,
              })
              .item(),
          )
          yield* llm.hold("HELD_CHILD", releaseProvider.promise)
          yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Run the Workflow" } })
          const childID = yield* Deferred.await(beforeRun).pipe(Effect.timeout("10 seconds"))
          expect(yield* llm.calls).toBe(1)
          if (admission === "wake") {
            yield* execution.wake(childID)
            const started = (yield* execution.active).has(childID)
            if (started) {
              yield* llm.wait(2).pipe(Effect.timeout("10 seconds"))
              yield* execution.interrupt(parent.id)
            }
            expect(started).toBe(false)
          }
          if (admission === "resume") {
            const unrelated = yield* sessions.resume(childID).pipe(Effect.result, Effect.forkChild)
            const raced = yield* Effect.race(
              Fiber.join(unrelated).pipe(Effect.map((result) => ({ type: "result" as const, result }))),
              llm.wait(2).pipe(Effect.as({ type: "provider" as const })),
            ).pipe(Effect.timeout("10 seconds"))
            const beforeOwner = yield* llm.calls
            if (raced.type === "provider") {
              // Baseline cleanup preserves the observed premature provider call before failing.
              yield* execution.interrupt(parent.id)
              yield* Fiber.interrupt(unrelated)
              expect(beforeOwner).toBe(1)
              return
            }
            expect(raced.result._tag).toBe("Failure")
            if (raced.result._tag === "Failure") expect(raced.result.failure._tag).toBe("SessionManagedChildFailure")
          }
          yield* execution.wake(childID)
          expect(yield* llm.calls).toBe(1)
          expect((yield* execution.active).has(childID)).toBe(false)
          yield* Deferred.succeed(releaseRun, undefined)
          yield* llm.wait(2).pipe(Effect.timeout("10 seconds"))
          expect((yield* execution.active).has(childID)).toBe(true)
          const joined = yield* sessions.wait(parent.id).pipe(Effect.exit, Effect.forkChild)
          yield* execution.interrupt(parent.id)
          yield* Fiber.join(joined)
          expect((yield* execution.active).has(childID)).toBe(false)
          releaseProvider.resolve()
          yield* sessions.wait(childID)
          expect(yield* llm.calls).toBe(2)
          expect((yield* sessions.resume(childID).pipe(Effect.result))._tag).toBe("Failure")
          yield* execution.wake(childID)
          expect(yield* llm.calls).toBe(2)
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(LayerNode.group([SessionV2.node, SessionExecutionLocal.node]), [
              [SessionExecution.node, SessionExecutionLocal.node],
              [WorkflowRole.node, roles],
              [Global.node, Global.layerWith({ home })],
              [
                ModelsDev.node,
                Layer.succeed(ModelsDev.Service, { get: () => Effect.succeed({}), refresh: () => Effect.void }),
              ],
            ]).pipe(
              Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
            ),
          ),
        )
      }),
    30000,
  )

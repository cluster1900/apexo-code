import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { EventV2 } from "@apexo/core/event"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionStore } from "@apexo/core/session/store"
import { WorkflowControl } from "@apexo/core/workflow/control"
import { WorkflowStore } from "@apexo/core/workflow/store"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

// Regression: the engine records "paused" before it releases its execution claim and the Session drain that ran it.
// Each case holds one side of that window open deterministically and resumes inside it; resume must wait for the
// closing execution instead of failing with busy ("Workflow execution is still closing" / "Session is already executing").
const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

const layer = (home: string) =>
  AppNodeBuilder.build(
    LayerNode.group([
      SessionV2.node,
      SessionStore.node,
      WorkflowControl.node,
      WorkflowStore.node,
      SessionExecutionLocal.node,
      EventV2.node,
    ]),
    [
      [SessionExecution.node, SessionExecutionLocal.node],
      [Global.node, Global.layerWith({ home })],
      [ModelsDev.node, Layer.succeed(ModelsDev.Service, { get: () => Effect.succeed({}), refresh: () => Effect.void })],
    ],
  ).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))))

for (const gap of ["execution claim", "session drain"] as const)
  it.live(
    `resume sent while the paused run's ${gap} is still closing waits instead of failing busy`,
    () =>
      Effect.gen(function* () {
        const home = yield* tmpdirScoped()
        const directory = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(directory, "apexo.json"), JSON.stringify({ snapshots: false })))
        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const control = yield* WorkflowControl.Service
          const store = yield* WorkflowStore.Service
          const execution = yield* SessionExecution.Service
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(directory) },
            agent: AgentV2.ID.make("build"),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          const run = yield* control.start(parent.id, {
            source: {
              type: "script",
              name: "pause-release",
              script: 'await_user("verification", "Hold"); complete(#{resumed: true});',
            },
          })
          const paused = yield* pollWithTimeout(
            control.get(parent.id, run.id).pipe(Effect.map((info) => (info.status === "paused" ? info : undefined))),
            "Workflow did not pause",
            "10 seconds",
          )
          expect(paused.status).toBe("paused")
          yield* sessions.wait(parent.id)

          // Re-open the window the engine leaves between persisting "paused" and releasing.
          const gate = yield* Deferred.make<void>()
          if (gap === "execution claim") {
            expect(store.claim(run.id)).toBe(true)
          } else {
            yield* execution.control(parent.id, Deferred.await(gate)).pipe(Effect.ignore, Effect.forkChild)
            yield* pollWithTimeout(
              execution.active.pipe(Effect.map((active) => (active.has(parent.id) ? true : undefined))),
              "Session drain did not become active",
            )
          }
          const resuming = yield* control.resume(parent.id, run.id).pipe(Effect.exit, Effect.forkChild)
          yield* Effect.sleep("150 millis")
          // Still waiting for the closing execution, not rejected.
          expect(resuming.pollUnsafe()).toBeUndefined()
          if (gap === "execution claim") store.release(run.id)
          else yield* Deferred.succeed(gate, undefined)

          const exit = yield* Fiber.join(resuming)
          expect(exit._tag).toBe("Success")
          const done = yield* pollWithTimeout(
            control
              .get(parent.id, run.id)
              .pipe(Effect.map((info) => (["completed", "failed"].includes(info.status) ? info : undefined))),
            "Resumed workflow did not finish",
            "10 seconds",
          )
          expect(done.status).toBe("completed")
          expect(done.result).toEqual({ resumed: true })
          yield* sessions.wait(parent.id)
        }).pipe(Effect.provide(layer(home)))
      }),
    30000,
  )

import { expect } from "bun:test"
import { ConfigProvider, Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { AbsolutePath } from "@apexo/schema/schema"
import { Model } from "@apexo/schema/model"
import { Provider } from "@apexo/schema/provider"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionScheduleStore } from "@apexo/core/session/schedule-store"
import { SessionScheduleOwner } from "@apexo/core/session/schedule-owner"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionMessage } from "@apexo/core/session/message"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
for (const mode of ["retire", "stop", "manual", "stop-during-retire"] as const)
  it.live(
    `Joined Scheduler ${mode} preserves intended restoration boundary`,
    () =>
      Effect.gen(function* () {
        const home = yield* tmpdirScoped()
        const directory = yield* tmpdirScoped()
        const started = Deferred.makeUnsafe<void>()
        const closing = Deferred.makeUnsafe<void>()
        const release = Deferred.makeUnsafe<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const schedules = yield* SessionScheduleStore.Service
          const owners = yield* SessionScheduleOwner.Service
          const lifecycle = yield* SessionLifecycle.Service
          const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
          const created = (yield* schedules.create({
            sessionID: parent.id,
            messageID: SessionMessage.ID.create(),
            callID: mode,
            request: {
              prompt: "Future occurrence",
              intervalSeconds: 60,
              durable: false,
              fireImmediately: mode === "stop-during-retire",
            },
            authority: {
              parentAgent: AgentV2.ID.make("build"),
              agent: AgentV2.ID.make("general"),
              model: { providerID: Provider.ID.make("fixture"), id: Model.ID.make("model") },
              authority: [],
            },
          })).record
          const claim = yield* lifecycle.capture(parent.id)
          const token = yield* owners.bind(claim, () =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.addFinalizer(() =>
                  Deferred.succeed(closing, undefined).pipe(Effect.andThen(Deferred.await(release))),
                )
                yield* Deferred.succeed(started, undefined)
                yield* Effect.never
              }),
            ),
          )
          const current = owners.checkpoint(claim)
          expect(current()).toBe(true)
          if (mode === "manual") yield* schedules.pause(parent.id, created.id)
          if (mode === "stop") {
            owners.stop(claim)
            yield* owners.joinStop(claim)
          }
          if (mode === "stop-during-retire") {
            yield* Deferred.await(started)
            const close = yield* owners.unbind(claim, token).pipe(Effect.forkChild)
            yield* Deferred.await(closing)
            expect(current()).toBe(false)
            owners.stop(claim)
            yield* Deferred.succeed(release, undefined)
            yield* Fiber.join(close)
          } else yield* owners.unbind(claim, token)
          expect(current()).toBe(false)
          const saved = yield* schedules.owned(parent.id, created.id)
          expect(saved.status).toBe("paused")
          expect(saved.blockedReason).toBe(
            mode === "retire" ? "restart_required" : mode === "manual" ? undefined : "stopped",
          )
          // Ordinary binding alone cannot turn a retired/paused row into an active timer.
          const next = yield* owners.bind(claim, () => Effect.die("Passive bind launched a retired occurrence"))
          expect((yield* schedules.owned(parent.id, created.id)).status).toBe("paused")
          yield* owners.unbind(claim, next)
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([
                SessionV2.node,
                SessionScheduleStore.node,
                SessionScheduleOwner.node,
                SessionLifecycle.node,
              ]),
              [
                [SessionExecution.node, SessionExecution.noopLayer],
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
    30_000,
  )

import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { makeGlobalNode } from "@apexo/core/effect/app-node"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { AbsolutePath } from "@apexo/schema/schema"
import { EventV2 } from "@apexo/core/event"
import { SessionV1 } from "@apexo/core/v1/session"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { SessionTaskControl } from "@apexo/core/session/task-control"
import { SessionScheduleStore } from "@apexo/core/session/schedule-store"
import { SessionScheduleOwner } from "@apexo/core/session/schedule-owner"
import { SessionScheduleRuntime } from "@apexo/core/session/schedule"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionMessage } from "@apexo/core/session/message"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
for (const action of ["delete", "stop", "stop-resume", "claim-stop-resume", "session-delete"] as const) {
  it.live(
    `Scheduler ${action} during admitted child startup preserves exact worker and receipt ownership`,
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
        const parentGate = Promise.withResolvers<void>()
        const childGate = Deferred.makeUnsafe<void>()
        const claiming = Deferred.makeUnsafe<void>()
        const claimGate = Deferred.makeUnsafe<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => parentGate.resolve()))
        yield* Effect.addFinalizer(() => Deferred.succeed(childGate, undefined))
        yield* Effect.addFinalizer(() => Deferred.succeed(claimGate, undefined))
        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const execution = yield* SessionExecution.Service
          const schedules = yield* SessionScheduleStore.Service
          const owners = yield* SessionScheduleOwner.Service
          const tasks = yield* SessionTaskStore.Service
          const lifecycle = yield* SessionLifecycle.Service
          const events = yield* EventV2.Service
          const locations = yield* LocationServiceMap.Service
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(directory) },
            agent: AgentV2.ID.make("build"),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          // Binding is an explicit provider-free control and gives the exact private children capability.
          yield* execution.control(
            parent.id,
            SessionScheduleRuntime.Service.use((runtime) => runtime.bind(parent.id)).pipe(
              Effect.provide(locations.get(parent.location)),
            ),
          )
          expect(yield* llm.calls).toBe(0)
          const claim = yield* lifecycle.capture(parent.id)
          const started = Deferred.makeUnsafe<void>()
          const unsubscribe = yield* events.listen((event) =>
            Effect.gen(function* () {
              if (event.type !== "session.created") return
              const data = yield* Schema.decodeUnknownEffect(Schema.toType(SessionV1.Event.Created.data))(
                event.data,
              ).pipe(Effect.orDie)
              if (data.info.parentID !== parent.id) return
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(childGate)
            }),
          )
          yield* Effect.addFinalizer(() => unsubscribe)
          const isParent = (hit: { body: Record<string, unknown> }) => JSON.stringify(hit.body.tools).includes('"task"')
          if (action !== "delete") {
            yield* llm.respond(() => reply().text("PARENT_HELD").wait(parentGate.promise).stop().item(), isParent)
            yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Hold the active parent" } })
            yield* llm.wait(1).pipe(Effect.timeout("10 seconds"))
          }
          yield* llm.respond(
            () => reply().text("SCHEDULE_CHILD_FINISHED").stop().item(),
            (hit) => !isParent(hit),
          )
          yield* llm.respond(() => reply().text("SCHEDULE_NOTICE_RECEIVED").stop().item(), isParent)
          const schedule = yield* schedules.create({
            sessionID: parent.id,
            messageID: SessionMessage.ID.create(),
            callID: "fixture-create",
            request: { prompt: "Inspect current state", intervalSeconds: 60, durable: true, fireImmediately: true },
            authority: {
              parentAgent: AgentV2.ID.make("build"),
              agent: AgentV2.ID.make("helper"),
              model: parent.model!,
              authority: [],
            },
          })
          yield* owners.changed(claim, true)
          yield* Deferred.await(action === "claim-stop-resume" ? claiming : started).pipe(Effect.timeout("10 seconds"))
          const occurrence = (yield* schedules.occurrences(schedule.record.id))[0]
          expect(occurrence.status).toBe(action === "claim-stop-resume" ? "claimed" : "admitted")
          expect(yield* tasks.launch(occurrence.launchID)).toBeUndefined()
          if (action === "delete") {
            yield* schedules.remove(parent.id, schedule.record.id)
            yield* Deferred.succeed(childGate, undefined)
            yield* llm.wait(2).pipe(Effect.timeout("10 seconds"))
            yield* sessions.wait(parent.id)
            const latest = yield* tasks.latest(parent.id, occurrence.childID)
            expect(latest?.status).toBe("completed")
            expect(latest?.origin?.scheduleID).toBe(schedule.record.id)
            expect((yield* schedules.occurrences(schedule.record.id))[0].status).toBe("completed")
            expect((yield* schedules.owned(parent.id, schedule.record.id)).status).toBe("deleted")
            const messages = yield* sessions.context(parent.id)
            expect(messages.filter((message) => message.type === "user")).toEqual([])
          } else {
            const stopping = yield* (
              action === "session-delete" ? sessions.remove(parent.id) : execution.interrupt(parent.id)
            ).pipe(Effect.forkChild)
            yield* Effect.gen(function* () {
              while (
                action === "session-delete"
                  ? lifecycle.available(claim)
                  : (yield* schedules.owned(parent.id, schedule.record.id)).status !== "paused"
              )
                yield* Effect.sleep("1 millis")
            }).pipe(Effect.timeout("5 seconds"))
            expect(stopping.pollUnsafe()).toBeUndefined()
            const resumed = Deferred.makeUnsafe<void>()
            const resuming = action.endsWith("resume")
              ? yield* execution
                  .control(
                    parent.id,
                    SessionScheduleRuntime.Service.use((runtime) => runtime.resume(parent.id, schedule.record.id)).pipe(
                      Effect.provide(locations.get(parent.location)),
                      Effect.tap(() => Deferred.succeed(resumed, undefined)),
                    ),
                  )
                  .pipe(Effect.forkChild)
              : undefined
            yield* Effect.yieldNow
            expect(yield* Deferred.isDone(resumed)).toBe(false)
            yield* Deferred.succeed(childGate, undefined)
            yield* Deferred.succeed(claimGate, undefined)
            yield* Fiber.join(stopping).pipe(Effect.timeout("10 seconds"))
            if (resuming) yield* Fiber.join(resuming).pipe(Effect.timeout("10 seconds"))
            if (action === "session-delete") {
              expect((yield* sessions.get(parent.id).pipe(Effect.result))._tag).toBe("Failure")
              expect(yield* tasks.read(occurrence.childID)).toBeUndefined()
              expect(yield* llm.calls).toBe(1)
              return
            }
            const intent = yield* schedules.owned(parent.id, schedule.record.id)
            expect(intent.status).toBe(action.endsWith("resume") ? "active" : "paused")
            if (resuming) {
              expect(yield* Deferred.isDone(resumed)).toBe(true)
              expect(intent.nextFireAt).toBeGreaterThan(Date.now() + 50_000)
            }
            expect((yield* schedules.occurrences(schedule.record.id))[0].status).toBe("cancelled")
            if (action === "claim-stop-resume") {
              expect(yield* tasks.read(occurrence.childID)).toBeUndefined()
              expect(yield* Deferred.isDone(started)).toBe(false)
            } else expect((yield* tasks.latest(parent.id, occurrence.childID))?.status).toBe("cancelled")
            expect(yield* llm.calls).toBe(1)
          }
        }).pipe(
          Effect.ensuring(Deferred.succeed(childGate, undefined)),
          Effect.ensuring(Deferred.succeed(claimGate, undefined)),
          Effect.ensuring(Effect.sync(() => parentGate.resolve())),
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([
                SessionV2.node,
                SessionExecutionLocal.node,
                SessionTaskStore.node,
                SessionTaskControl.node,
                SessionScheduleStore.node,
                SessionScheduleOwner.node,
                SessionLifecycle.node,
                EventV2.node,
                LocationServiceMap.node,
              ]),
              [
                [SessionExecution.node, SessionExecutionLocal.node],
                [
                  SessionScheduleStore.node,
                  makeGlobalNode({
                    service: SessionScheduleStore.Service,
                    deps: [Database.node, SessionTaskStore.node],
                    layer: Layer.effect(
                      SessionScheduleStore.Service,
                      Effect.gen(function* () {
                        const database = yield* Database.Service
                        const tasks = yield* SessionTaskStore.Service
                        const store = SessionScheduleStore.make(database.db, tasks.owner)
                        return {
                          ...store,
                          claim: (sessionID, id) =>
                            store
                              .claim(sessionID, id)
                              .pipe(
                                Effect.tap((value) =>
                                  action === "claim-stop-resume" && value
                                    ? Deferred.succeed(claiming, undefined).pipe(
                                        Effect.andThen(Deferred.await(claimGate)),
                                      )
                                    : Effect.void,
                                ),
                              ),
                        } satisfies SessionScheduleStore.Interface
                      }),
                    ),
                  }),
                ],
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
}

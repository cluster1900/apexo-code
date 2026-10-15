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
import { AbsolutePath } from "@apexo/schema/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { SessionScheduleStore } from "@apexo/core/session/schedule-store"
import { SessionScheduleOwner } from "@apexo/core/session/schedule-owner"
import { SessionScheduleRuntime } from "@apexo/core/session/schedule"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionMessage } from "@apexo/core/session/message"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

import { makeLocationNode } from "@apexo/core/effect/app-node"
import { Catalog } from "@apexo/core/catalog"
import { Integration } from "@apexo/core/integration"
import { SessionRunnerModel } from "@apexo/core/session/runner/model"
import { Database } from "@apexo/core/database/database"
import { SessionStore } from "@apexo/core/session/store"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionPlanReceipt } from "@apexo/core/session/plan-receipt"
import { Goal } from "@apexo/schema/goal"
import { Question } from "@apexo/schema/question"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
for (const mode of [
  "goal",
  "plan",
  "delete",
  "pause",
  "permission",
  "headless",
  "stop",
  "foreign-stop",
  "session-delete",
] as const)
  it.live(
    `Explicit restoration rechecks ${mode} after held real model resolution`,
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

        const resolving = Deferred.makeUnsafe<void>()
        const release = Deferred.makeUnsafe<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const schedules = yield* SessionScheduleStore.Service
          const database = yield* Database.Service
          const owners = yield* SessionScheduleOwner.Service
          const tasks = yield* SessionTaskStore.Service
          const sessionStore = yield* SessionStore.Service
          const lifecycle = yield* SessionLifecycle.Service
          const locations = yield* LocationServiceMap.Service
          const goals = yield* SessionGoal.Service
          const plans = yield* SessionPlanReceipt.Service
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(directory) },
            agent: AgentV2.ID.make("build"),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          const creator = mode === "foreign-stop" ? SessionScheduleStore.make(database.db, "prior-process") : schedules
          const schedule = yield* creator.create({
            sessionID: parent.id,
            messageID: SessionMessage.ID.create(),
            callID: "late-authority",
            request: {
              prompt: "Must not execute after authority changes",
              intervalSeconds: 60,
              durable: true,
              fireImmediately: false,
            },
            authority: {
              parentAgent: AgentV2.ID.make("build"),
              agent: AgentV2.ID.make("helper"),
              model: parent.model!,
              authority: [],
            },
          })
          yield* schedules.pause(parent.id, schedule.record.id, "restart_required")
          const restoring = yield* sessions.restore(parent.id).pipe(Effect.exit, Effect.forkChild)
          yield* Deferred.await(resolving).pipe(Effect.timeout("10 seconds"))
          const claim = yield* lifecycle.capture(parent.id)
          expect(yield* schedules.occurrences(schedule.record.id)).toEqual([])
          if (mode === "pause") yield* schedules.pause(parent.id, schedule.record.id)
          if (mode === "permission")
            yield* sessionStore.setPermissions({
              sessionID: parent.id,
              permissions: [{ permission: "task", pattern: "*", action: "deny" }],
            })
          if (mode === "headless")
            yield* sessions.prompt({
              sessionID: parent.id,
              prompt: { text: "Pending headless work must not gain schedules" },
              resume: false,
              executionPolicy: { mode: "headless", permissions: "reject" },
            })
          if (mode === "stop" || mode === "foreign-stop") yield* sessions.interrupt(parent.id)
          if (mode === "session-delete") yield* sessions.remove(parent.id)
          if (mode === "goal")
            yield* goals.create(parent.id, { id: Goal.ID.create(), objective: "New active Goal owns this Session" })
          if (mode === "delete") yield* schedules.remove(parent.id, schedule.record.id)
          if (mode === "plan")
            yield* plans.write({
              sessionID: parent.id,
              created: schedule.record.parentCreated,
              request: { id: Question.ID.create(), sessionID: parent.id, questions: [] },
              assistantMessageID: SessionMessage.ID.create(),
              callID: "late-plan",
              artifact: { path: "plan.md", resource: "plan.md", content: "Pending plan", hash: "fixture" },
              turn: {
                finish: "tool-calls",
                tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
              },
              decision: "pending",
              answers: [],
              settled: false,
            })
          yield* Deferred.succeed(release, undefined)
          const outcome = yield* Fiber.join(restoring)
          if (mode === "stop" || mode === "foreign-stop" || mode === "session-delete") {
            expect(outcome._tag).toBe("Failure")
            expect(owners.checkpoint(claim)()).toBe(false)
          } else {
            expect(outcome._tag).toBe("Success")
            if (outcome._tag === "Success")
              expect(outcome.value.schedules[0]?.reason).toBe(
                mode === "goal"
                  ? "goal_active"
                  : mode === "plan"
                    ? "plan_pending"
                    : mode === "permission"
                      ? "denied"
                      : mode === "headless"
                        ? "headless_input"
                        : "changed",
              )
          }
          expect(yield* llm.calls).toBe(0)
          if (mode === "session-delete") {
            expect(yield* sessionStore.get(parent.id)).toBeUndefined()
            return
          }
          expect(yield* tasks.list(parent.id)).toEqual([])
          expect(yield* schedules.occurrences(schedule.record.id)).toEqual([])
          const intent = yield* schedules.owned(parent.id, schedule.record.id)
          expect(intent.status).toBe(mode === "delete" ? "deleted" : "paused")
          expect(intent.blockedReason).toBe(
            mode === "delete" || mode === "pause"
              ? undefined
              : mode === "stop" || mode === "foreign-stop"
                ? "stopped"
                : "restart_required",
          )
        }).pipe(
          Effect.ensuring(Deferred.succeed(release, undefined)),
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([
                SessionV2.node,
                SessionExecutionLocal.node,
                SessionScheduleStore.node,
                SessionScheduleOwner.node,
                SessionTaskStore.node,
                SessionStore.node,
                Database.node,
                SessionLifecycle.node,
                LocationServiceMap.node,
                SessionGoal.node,
                SessionPlanReceipt.node,
              ]),
              [
                [SessionExecution.node, SessionExecutionLocal.node],
                [Global.node, Global.layerWith({ home })],
                [
                  ModelsDev.node,
                  Layer.succeed(ModelsDev.Service, { get: () => Effect.succeed({}), refresh: () => Effect.void }),
                ],
                [
                  SessionRunnerModel.node,
                  makeLocationNode({
                    service: SessionRunnerModel.Service,
                    deps: [Catalog.node, Integration.node],
                    layer: Layer.effect(
                      SessionRunnerModel.Service,
                      Effect.gen(function* () {
                        const actual = yield* SessionRunnerModel.Service
                        return SessionRunnerModel.Service.of({
                          resolve: (session) =>
                            actual.resolve(session).pipe(
                              Effect.tap(() =>
                                Effect.gen(function* () {
                                  yield* Deferred.succeed(resolving, undefined)
                                  yield* Deferred.await(release)
                                }),
                              ),
                            ),
                        })
                      }),
                    ).pipe(Layer.provide(SessionRunnerModel.locationLayer)),
                  }),
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

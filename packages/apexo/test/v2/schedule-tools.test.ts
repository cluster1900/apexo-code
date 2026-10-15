import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Effect, Layer } from "effect"
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
import { Goal } from "@apexo/schema/goal"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionGoalUsage } from "@apexo/core/session/goal-usage"
import { SessionScheduleRuntime } from "@apexo/core/session/schedule"
import { SessionMessage } from "@apexo/core/session/message"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
for (const config of [
  { mode: "origin", durable: undefined },
  { mode: "origin", durable: true },
  { mode: "scheduler_create", durable: undefined },
  { mode: "task", durable: undefined },
] as const)
  it.live(
    `canonical Scheduler tools enforce ${config.mode} permission and ownership boundaries (durable=${config.durable ?? "omitted"})`,
    () =>
      Effect.gen(function* () {
        const mode = config.mode
        const home = yield* tmpdirScoped()
        const directory = yield* tmpdirScoped()
        const llm = yield* TestLLMServer
        yield* Effect.promise(() =>
          Bun.write(
            path.join(directory, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              permissions: [
                { action: "*", resource: "*", effect: "allow" },
                ...(mode === "origin" ? [] : [{ action: mode, resource: "*", effect: "deny" }]),
              ],
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

        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const schedules = yield* SessionScheduleStore.Service
          const tasks = yield* SessionTaskStore.Service
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(directory) },
            agent: AgentV2.ID.make("build"),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          if (mode !== "origin") {
            yield* llm.respond(() =>
              reply()
                .tool("scheduler_create", { interval: "1s", prompt: "DENIED_SCHEDULE", fire_immediately: true })
                .item(),
            )
            yield* llm.respond((hit) => {
              expect(JSON.stringify(hit.body)).toContain("Native schedule operation failed")
              return reply().text("PERMISSION_DENIED_HANDLED").stop().item()
            })
            yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Attempt the denied schedule" } })
            yield* llm.wait(2).pipe(Effect.timeout("10 seconds"))
            yield* sessions.wait(parent.id)
            expect(yield* schedules.list(parent.id)).toEqual([])
            expect(yield* tasks.list(parent.id)).toEqual([])
            expect(yield* llm.calls).toBe(2)
            return
          }
          const goals = yield* SessionGoal.Service
          const execution = yield* SessionExecution.Service
          const locations = yield* LocationServiceMap.Service
          const goal = yield* goals.create(parent.id, {
            id: Goal.ID.create(),
            objective: "Retain captured Goal authority",
          })
          const goalTarget = { sessionID: parent.id, goalID: goal.id }
          const attempt = yield* goals.begin(goalTarget, "executing")
          yield* goals.pause(goalTarget, "user_paused")
          const denied = yield* execution
            .control(
              parent.id,
              SessionScheduleRuntime.Service.use((runtime) => runtime.bind(parent.id)).pipe(
                Effect.provide(locations.get(parent.location)),
                Effect.provideService(SessionGoalUsage.Current, attempt),
              ),
            )
            .pipe(Effect.result)
          expect(denied._tag).toBe("Failure")
          expect(yield* schedules.list(parent.id)).toEqual([])
          expect(yield* tasks.list(parent.id)).toEqual([])
          expect(yield* llm.calls).toBe(0)
          const sibling = yield* schedules.create({
            sessionID: parent.id,
            messageID: SessionMessage.ID.create(),
            callID: "unrelated-intent",
            request: {
              prompt: "Unrelated future intent",
              intervalSeconds: 3600,
              durable: true,
              fireImmediately: false,
            },
            authority: {
              parentAgent: AgentV2.ID.make("build"),
              agent: AgentV2.ID.make("general"),
              model: parent.model!,
              authority: [],
            },
          })
          const isParent = (hit: { body: Record<string, unknown> }) => JSON.stringify(hit.body.tools).includes('"task"')
          const ownID = (hit: { body: Record<string, unknown> }) => {
            const messages = hit.body.messages
            if (!Array.isArray(messages)) throw new Error("Fixture expects Chat Completions messages")
            const latest = messages.findLast((message) => message.role === "user")
            const id = /sched_[A-Za-z0-9]{26}/.exec(JSON.stringify(latest?.content))?.[0]
            if (!id) throw new Error("Scheduled current user input lacks origin reminder")
            return id
          }
          yield* llm.respond(
            () =>
              reply()
                .tool("scheduler_create", {
                  interval: "1s",
                  prompt: "SCHEDULED_NATIVE_SELF",
                  fire_immediately: true,
                  ...(config.durable === undefined ? {} : { durable: config.durable }),
                })
                .item(),
            isParent,
          )
          yield* llm.respond(() => reply().text("PARENT_ADMITTED").stop().item(), isParent)
          yield* llm.respond(() => reply().text("PARENT_NOTICE").stop().item(), isParent)
          yield* llm.respond(
            () => reply().tool("scheduler_list", {}).item(),
            (hit) => !isParent(hit),
          )
          yield* llm.respond(
            (hit) => {
              expect(JSON.stringify(hit.body)).not.toContain(sibling.record.id)
              return reply().tool("scheduler_delete", { task_id: sibling.record.id }).item()
            },
            (hit) => !isParent(hit),
          )
          yield* llm.respond(
            (hit) => {
              expect(JSON.stringify(hit.body)).toContain("cannot access this intent")
              return reply()
                .tool("scheduler_create", { task_id: ownID(hit), prompt: "Updated own future intent" })
                .item()
            },
            (hit) => !isParent(hit),
          )
          yield* llm.respond(
            (hit) =>
              reply()
                .tool("scheduler_delete", { task_id: ownID(hit) })
                .item(),
            (hit) => !isParent(hit),
          )
          yield* llm.respond(
            () => reply().text("SCHEDULE_SELF_DONE").stop().item(),
            (hit) => !isParent(hit),
          )
          yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Create the native schedule" } })
          yield* llm.wait(8).pipe(Effect.timeout("15 seconds"))
          yield* sessions.wait(parent.id)
          const intents = yield* schedules.list(parent.id)
          expect(intents.length).toBe(2)
          const own = intents.find((item) => item.id !== sibling.record.id)!
          expect(own.status).toBe("deleted")
          expect(own.intervalSeconds).toBe(60)
          expect(own.durable).toBe(config.durable ?? false)
          expect(own.prompt).toBe("Updated own future intent")
          expect((yield* schedules.owned(parent.id, sibling.record.id)).status).toBe("active")
          const occurrence = (yield* schedules.occurrences(own.id))[0]
          expect(occurrence.status).toBe("completed")
          const launch = yield* tasks.latest(parent.id, occurrence.childID)
          expect(launch?.status).toBe("completed")
          expect(launch?.origin?.scheduleID).toBe(own.id)
          expect((yield* schedules.detail(parent.id, own.id)).latestTaskID).toBe(occurrence.childID)
          expect(yield* llm.calls).toBe(8)
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([
                SessionV2.node,
                SessionGoal.node,
                SessionExecutionLocal.node,
                SessionTaskStore.node,
                SessionScheduleStore.node,
                LocationServiceMap.node,
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
    30_000,
  )

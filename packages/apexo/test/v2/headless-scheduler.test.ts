import { expect } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { ConfigProvider, Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionInputExecution } from "@apexo/core/session/input-execution"
import { SessionExecutionPolicy } from "@apexo/core/session/execution-policy"
import { SessionScheduleRuntime } from "@apexo/core/session/schedule"
import { SessionScheduleStore } from "@apexo/core/session/schedule-store"
import { SessionScheduleOwner } from "@apexo/core/session/schedule-owner"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { SessionTaskCompletion } from "@apexo/core/session/task-completion"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { SessionMessage } from "@apexo/core/session/message"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { AgentV2 } from "@apexo/core/agent"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer, reply } from "../lib/llm-server"

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
        SessionTaskStore.node,
        SessionTaskCompletion.node,
        Database.node,
        SessionScheduleStore.node,
        SessionScheduleOwner.node,
        LocationServiceMap.node,
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
  "headless policy rejects direct timer binding while ordinary control retains Scheduler capability",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const execution = yield* SessionExecution.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ ...f.create, agent: AgentV2.ID.make("operator") })
        const bind = SessionScheduleRuntime.Service.use((runtime) => runtime.bind(session.id)).pipe(
          Effect.provide(locations.get(session.location)),
        )
        const rejected = yield* execution
          .control(session.id, SessionExecutionPolicy.provide(session.id, policy, bind))
          .pipe(Effect.result)
        expect(rejected._tag).toBe("Failure")
        if (rejected._tag === "Failure") expect(rejected.failure.message).toContain("Headless")
        const allowed = yield* execution.control(session.id, bind).pipe(Effect.result)
        expect(allowed._tag).toBe("Success")
        expect(yield* f.llm.calls).toBe(0)
      }).pipe(Effect.provide(f.app))
    }),
  20000,
)

it.live(
  "headless input does not activate a saved due timer and later ordinary input retains it",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const schedules = yield* SessionScheduleStore.Service
        const outcomes = yield* SessionInputExecution.Service
        const session = yield* sessions.create({ ...f.create, agent: AgentV2.ID.make("operator") })
        const schedule = yield* schedules.create({
          sessionID: session.id,
          messageID: SessionMessage.ID.create(),
          callID: "saved-timer",
          request: { prompt: "SAVED_TIMER_CHILD", intervalSeconds: 60, durable: true, fireImmediately: true },
          authority: {
            parentAgent: session.agent!,
            agent: AgentV2.ID.make("worker"),
            model: session.model!,
            authority: [],
          },
        })
        yield* f.llm.text("HEADLESS_FINISHED")
        yield* f.llm.text("ORDINARY_OR_CHILD_FINISHED")
        yield* f.llm.text("ORDINARY_OR_CHILD_FINISHED")
        yield* f.llm.text("NOTICE_FINISHED")
        const input = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "HEADLESS_ONLY" },
          executionPolicy: policy,
        })
        expect((yield* outcomes.wait({ sessionID: session.id, inputID: input.id }, 10000)).execution.status).toBe(
          "completed",
        )
        expect(yield* schedules.occurrences(schedule.record.id)).toEqual([])
        expect(yield* f.llm.calls).toBe(1)
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "ORDINARY_NOW" } })
        yield* pollWithTimeout(
          schedules
            .occurrences(schedule.record.id)
            .pipe(Effect.map((items) => (items[0]?.status === "completed" ? items[0] : undefined))),
          "ordinary timer did not complete",
          "10 seconds",
        )
        expect((yield* schedules.occurrences(schedule.record.id))[0].status).toBe("completed")
        expect(yield* f.llm.calls).toBeGreaterThanOrEqual(3)
        yield* sessions.interrupt(session.id)
        const stopped = yield* schedules.owned(session.id, schedule.record.id)
        expect(stopped.status).toBe("paused")
        yield* f.llm.text("HEADLESS_AFTER_STOP")
        const next = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "HEADLESS_AFTER_STOP" },
          executionPolicy: policy,
        })
        expect((yield* outcomes.wait({ sessionID: session.id, inputID: next.id }, 10000)).execution.status).toBe(
          "completed",
        )
        expect((yield* schedules.owned(session.id, schedule.record.id)).status).toBe("paused")
        expect(yield* schedules.occurrences(schedule.record.id)).toHaveLength(1)
      }).pipe(Effect.provide(f.app))
    }),
  30000,
)

import { SessionMemoryOperationTable } from "@apexo/core/session/memory-operation.sql"
import { MemoryDream } from "@apexo/core/memory-dream"
import { Flock } from "@apexo/core/util/flock"
import { MemoryFiles } from "@apexo/core/memory-files"
import { realpath, stat } from "node:fs/promises"
import { ConfigMemory } from "@apexo/core/config/memory"
import { MemoryLegacyNative } from "@apexo/core/memory-legacy-native"
import { MemoryContextNative } from "@apexo/core/memory-context-native"
import { MemoryMaintenance } from "@apexo/core/memory-maintenance"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { MemorySession } from "@apexo/core/memory-session"
import { SystemContext } from "@apexo/core/system-context"
import { mkdir, readdir, readFile } from "node:fs/promises"
import { Goal } from "@apexo/schema/goal"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionGoalUsage } from "@apexo/core/session/goal-usage"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { Database } from "@apexo/core/database/database"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionStore } from "@apexo/core/session/store"
import { SessionExecutionPolicy } from "@apexo/core/session/execution-policy"
import path from "node:path"
import { expect } from "bun:test"
import { ConfigProvider, DateTime, Deferred, Effect, Fiber, Layer, Scope, Schema } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryLifecycleNative } from "@apexo/core/memory-lifecycle-native"
import { Location } from "@apexo/core/location"
import { EventV2 } from "@apexo/core/event"
import { SessionEvent } from "@apexo/core/session/event"
import { SessionMessage } from "@apexo/core/session/message"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { ModelsDev } from "@apexo/core/models-dev"
import { AbsolutePath } from "@apexo/core/schema"
import { AgentV2 } from "@apexo/core/agent"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionMemoryModeNative } from "@apexo/core/session/memory-mode-native"
import { SessionInputAdmission } from "@apexo/core/session/input-admission"
import { SessionMemoryOperation } from "@apexo/core/session/memory-operation"
import { MemoryOperation } from "@apexo/schema/memory-operation"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
const settings = { memory: { enabled: true }, memory_v2: { enabled: false } }
const fixture = <A, E>(
  body: (
    session: SessionV2.Info,
    paths: { home: string; directory: string },
  ) => Effect.Effect<
    A,
    E,
    | SessionV2.Service
    | SessionGoal.Service
    | SessionInputAdmission.Service
    | SessionMemoryOperation.Service
    | SessionMemoryModeNative.Service
    | TestLLMServer
    | Scope.Scope
    | LocationServiceMap.Service
    | EventV2.Service
    | Database.Service
    | Global.Service
    | LocationRuntimeGuard.Service
    | SessionLifecycle.Service
    | SessionStore.Service
  >,
  automatic = false,
  flush: typeof ConfigMemory.Flush.Type = {},
  memory: typeof ConfigMemory.Info.Type = {},
) =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const llm = yield* TestLLMServer
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, "apexo.json"),
        JSON.stringify({
          snapshots: false,
          ...settings,
          memory: { ...settings.memory, ...memory },
          compaction: { memory_flush: flush },
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          agents: { restricted: { mode: "primary", permissions: [{ action: "edit", resource: "*", effect: "deny" }] } },
          providers: {
            fixture: {
              api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url, settings: { apiKey: "test" } },
              models: {
                "memory-model": {
                  name: "Memory flush model",
                  capabilities: { tools: false, input: ["text"], output: ["text"] },
                  limit: { context: 100000, output: 4096 },
                },
                model: {
                  name: "Memory fixture",
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  limit: { context: 100000, output: 4096 },
                },
              },
            },
          },
        }),
      ),
    )
    return yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const session = yield* sessions.create({
        location: { directory: AbsolutePath.make(directory) },
        agent: AgentV2.ID.make("build"),
        model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
      })
      if (!automatic) {
        const modes = yield* SessionMemoryModeNative.Service
        yield* modes.set(session.id, settings, false, false)
      }
      return yield* body(session, { home, directory }).pipe(
        Effect.onError(() =>
          Effect.gen(function* () {
            const hits = yield* llm.hits
            yield* Effect.promise(() =>
              Bun.write(
                `/tmp/apexo-memory-legacy-failed-${session.id}.json`,
                JSON.stringify({ fixtureURL: llm.url, pid: process.pid, hits }),
              ),
            )
          }),
        ),
      )
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(
          LayerNode.group([
            SessionV2.node,
            SessionGoal.node,
            Database.node,
            Global.node,
            LocationRuntimeGuard.node,
            SessionLifecycle.node,
            SessionStore.node,
            EventV2.node,
            SessionExecutionLocal.node,
            SessionInputAdmission.node,
            SessionMemoryOperation.node,
            SessionMemoryModeNative.node,
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
  })
const enable = Effect.fnUntraced(function* (id: SessionV2.Info["id"]) {
  const modes = yield* SessionMemoryModeNative.Service
  yield* modes.set(id, settings, true, false)
})

const settled = (
  operations: SessionMemoryOperation.Service["Service"],
  session: SessionV2.Info,
  id: MemoryOperation.ID,
) =>
  pollWithTimeout(
    operations.get(session.id, id).pipe(Effect.map((info) => (info.state === "finished" ? info : undefined))),
    "Memory operation did not settle",
    "10 seconds",
  )

const local = <A, E, R>(session: SessionV2.Info, action: Effect.Effect<A, E, R>) =>
  LocationServiceMap.Service.use((locations) => action.pipe(Effect.provide(locations.get(session.location))))

const seed = (session: SessionV2.Info, paths: { home: string; directory: string }, name = "other") =>
  Effect.gen(function* () {
    const location = yield* local(session, Location.Service)
    const files = MemoryDream.paths({ ...paths, projectID: location.project.id })
    yield* Effect.promise(async () => {
      await mkdir(files.sessions, { recursive: true })
      await Bun.write(path.join(files.sessions, `2026-10-15-${name}.md`), `## Source\nAUTOMATIC_DREAM_${name}\n`)
    })
    return files
  })
const dreamResult = (operations: SessionMemoryOperation.Service["Service"], session: SessionV2.Info) =>
  pollWithTimeout(
    operations
      .list(session.id)
      .pipe(Effect.map((rows) => rows.find((row) => row.kind === "dream" && row.state === "finished"))),
    "automatic Dream did not settle",
    "5 seconds",
  )
const automaticMemory = { dream: { enabled: true, min_hours: 0, min_sessions: 1, check_interval_secs: 0 } }

it.live(
  "automatic Dream arms after live activity even when automatic flush is disabled",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          const files = yield* seed(session, paths)
          expect(yield* operations.list(session.id)).toHaveLength(0)
          expect(yield* llm.hits).toHaveLength(0)
          yield* llm.text("The live task is complete.")
          yield* llm.text("## Durable knowledge\nAUTOMATIC_DREAM_other")
          const id = SessionMessage.ID.create()
          const prompt = { text: "Complete the live task." }
          yield* sessions.prompt({ sessionID: session.id, id, prompt })
          yield* sessions.wait(session.id)
          const receipt = yield* dreamResult(operations, session)
          expect(receipt.result?.status).toBe("completed")
          expect(yield* llm.hits).toHaveLength(2)
          expect(yield* Effect.promise(() => readFile(files.file, "utf8"))).toContain("AUTOMATIC_DREAM_other")
          yield* sessions.prompt({ sessionID: session.id, id, prompt })
          expect((yield* operations.list(session.id)).filter((row) => row.kind === "dream")).toHaveLength(1)
          expect(yield* llm.hits).toHaveLength(2)
        }),
      true,
      { enabled: false },
      automaticMemory,
    ),
  20000,
)

it.live(
  "automatic Dream periodic check discovers later sources without another user turn",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          const files = yield* seed(session, paths)
          yield* llm.text("The live task is complete.")
          yield* llm.text("## First knowledge\nAUTOMATIC_DREAM_other")
          yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Complete the live task." } })
          yield* sessions.wait(session.id)
          const first = yield* dreamResult(operations, session)
          expect(first.result?.status).toBe("completed")
          yield* seed(session, paths, "later")
          yield* llm.text("## Later knowledge\nAUTOMATIC_DREAM_later")
          const second = yield* pollWithTimeout(
            operations
              .list(session.id)
              .pipe(
                Effect.map((rows) =>
                  rows.find((row) => row.kind === "dream" && row.id !== first.id && row.state === "finished"),
                ),
              ),
            "periodic Dream did not settle",
            "5 seconds",
          )
          expect(second.result?.status).toBe("completed")
          expect(yield* Effect.promise(() => readFile(files.file, "utf8"))).toContain("AUTOMATIC_DREAM_later")
          expect(yield* llm.hits).toHaveLength(3)
        }),
      true,
      { enabled: false },
      { dream: { ...automaticMemory.dream, check_interval_secs: 1 } },
    ),
  20000,
)

for (const delivery of ["steer", "queue"] as const) {
  it.live(
    `new durable ${delivery} cancels and joins automatic Dream before publication`,
    () =>
      fixture(
        (session, paths) =>
          Effect.gen(function* () {
            const sessions = yield* SessionV2.Service
            const operations = yield* SessionMemoryOperation.Service
            const llm = yield* TestLLMServer
            const files = yield* seed(session, paths)
            const release = Promise.withResolvers<void>()
            yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
            yield* llm.text("The live task is complete.")
            yield* llm.hold("## Stale\nThis must not publish.", release.promise)
            yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Complete the live task." } })
            yield* sessions.wait(session.id)
            yield* llm.wait(2)
            yield* sessions.prompt({
              sessionID: session.id,
              resume: false,
              delivery,
              prompt: { text: "New instruction" },
            })
            release.resolve()
            expect((yield* dreamResult(operations, session)).result?.status).toBe("cancelled")
            expect(yield* Effect.promise(() => Bun.file(files.file).exists())).toBe(false)
            expect(yield* llm.hits).toHaveLength(2)
          }),
        true,
        { enabled: false },
        automaticMemory,
      ),
    20000,
  )
}

it.live(
  "zero periodic interval keeps later sources passive until new activity",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          yield* seed(session, paths)
          yield* llm.text("The live task is complete.")
          yield* llm.text("## First\nAUTOMATIC_DREAM_other")
          yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Complete the live task." } })
          yield* sessions.wait(session.id)
          expect((yield* dreamResult(operations, session)).result?.status).toBe("completed")
          yield* seed(session, paths, "later")
          // This is the periodic-disable observation window, not a readiness delay.
          yield* Effect.sleep(1150)
          expect(yield* llm.hits).toHaveLength(2)
          expect((yield* operations.list(session.id)).filter((row) => row.kind === "dream")).toHaveLength(1)
        }),
      true,
      { enabled: false },
      automaticMemory,
    ),
  20000,
)

it.live(
  "failed automatic source is not resampled by periodic checks or new activity",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          yield* seed(session, paths)
          yield* llm.text("The live task is complete.")
          yield* llm.text("invalid Dream output without Markdown headers")
          yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Complete the live task." } })
          yield* sessions.wait(session.id)
          const first = yield* dreamResult(operations, session)
          expect(first.result?.status).toBe("failed")
          yield* Effect.sleep(1150)
          expect(yield* llm.hits).toHaveLength(2)
          yield* llm.text("The next task is complete.")
          yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Complete the next task." } })
          yield* sessions.wait(session.id)
          yield* Effect.sleep(1150)
          expect(yield* llm.hits).toHaveLength(3)
          expect(
            (yield* operations.list(session.id)).filter((row) => row.kind === "dream").map((row) => row.id),
          ).toEqual([first.id])
        }),
      true,
      { enabled: false },
      { dream: { ...automaticMemory.dream, check_interval_secs: 1 } },
    ),
  20000,
)

it.live(
  "periodic ticks preserve an in-flight Dream and new activity joins its old epoch",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const lifecycle = yield* SessionLifecycle.Service
          const llm = yield* TestLLMServer
          const files = yield* seed(session, paths)
          const release = Promise.withResolvers<void>()
          yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
          yield* llm.text("The live task is complete.")
          yield* llm.hold("## Old epoch\nMust not publish", release.promise)
          yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Complete the live task." } })
          yield* sessions.wait(session.id)
          yield* llm.wait(2)
          const original = (yield* operations.list(session.id)).find((row) => row.kind === "dream")!
          yield* Effect.sleep(1150)
          expect((yield* operations.get(session.id, original.id)).state).toBe("running")
          expect(yield* llm.hits).toHaveLength(2)
          const claim = yield* lifecycle.capture(session.id)
          const next = yield* operations.beginAutomaticActivity(claim)
          expect((yield* operations.get(session.id, original.id)).result?.status).toBe("cancelled")
          release.resolve()
          yield* operations.armAutomaticIdle(next, { settled: Effect.void, idle: Effect.succeed(true) })
          yield* Effect.sleep(1150)
          expect(yield* llm.hits).toHaveLength(2)
          expect(yield* Effect.promise(() => Bun.file(files.file).exists())).toBe(false)
        }),
      true,
      { enabled: false },
      { dream: { ...automaticMemory.dream, check_interval_secs: 1 } },
    ),
  20000,
)

for (const winner of ["manual", "automatic"] as const) {
  it.live(
    `${winner} Dream wins the canonical lease and the stale waiting plan does not call the provider`,
    () =>
      fixture(
        (session, paths) =>
          Effect.gen(function* () {
            const sessions = yield* SessionV2.Service
            const operations = yield* SessionMemoryOperation.Service
            const llm = yield* TestLLMServer
            const files = yield* seed(session, paths)
            const release = Promise.withResolvers<void>()
            yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
            const manual = MemoryOperation.ID.create()
            if (winner === "manual") {
              yield* llm.hold("## Winner\nMANUAL_WINNER", release.promise)
              yield* operations.dream(session.id, { id: manual })
              yield* llm.wait(1)
              yield* llm.text("The live task is complete.")
            }
            if (winner === "automatic") {
              yield* llm.text("The live task is complete.")
              yield* llm.hold("## Winner\nAUTOMATIC_WINNER", release.promise)
            }
            yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Complete the live task." } })
            yield* sessions.wait(session.id)
            yield* llm.wait(2)
            const automatic = yield* pollWithTimeout(
              operations
                .list(session.id)
                .pipe(Effect.map((rows) => rows.find((row) => row.kind === "dream" && row.id !== manual))),
              "automatic Dream was not admitted",
              "5 seconds",
            )
            if (winner === "automatic") yield* operations.dream(session.id, { id: manual })
            release.resolve()
            expect(
              (yield* settled(operations, session, winner === "manual" ? manual : automatic.id)).result?.status,
            ).toBe("completed")
            expect(
              (yield* settled(operations, session, winner === "manual" ? automatic.id : manual)).result?.status,
            ).toBe("failed")
            expect(yield* llm.hits).toHaveLength(2)
            expect(yield* Effect.promise(() => readFile(files.file, "utf8"))).toContain(
              winner === "manual" ? "MANUAL_WINNER" : "AUTOMATIC_WINNER",
            )
          }),
        true,
        { enabled: false },
        automaticMemory,
      ),
    20000,
  )
}

it.live(
  "different Sessions serialize automatic Dream on the workspace lease without duplicate inference",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          yield* seed(session, paths)
          const other = yield* sessions.create({
            location: session.location,
            agent: AgentV2.ID.make("build"),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          const release = Promise.withResolvers<void>()
          yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
          yield* llm.text("The first live task is complete.")
          yield* llm.hold("## Winner\nFirst Session consolidation", release.promise)
          yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Complete the first task." } })
          yield* sessions.wait(session.id)
          yield* llm.wait(2)
          yield* llm.text("The second live task is complete.")
          yield* sessions.prompt({ sessionID: other.id, prompt: { text: "Complete the second task." } })
          yield* sessions.wait(other.id)
          yield* pollWithTimeout(
            operations.list(other.id).pipe(Effect.map((rows) => rows.find((row) => row.kind === "dream"))),
            "second Session Dream was not admitted",
            "5 seconds",
          )
          release.resolve()
          expect((yield* dreamResult(operations, session)).result?.status).toBe("completed")
          expect((yield* dreamResult(operations, other)).result?.status).toBe("failed")
          expect(yield* llm.hits).toHaveLength(3)
        }),
      true,
      { enabled: false },
      automaticMemory,
    ),
  20000,
)

for (const change of ["disable", "agent", "clear", "delete"] as const) {
  it.live(
    `automatic Dream held at the provider honors ${change} before publication`,
    () =>
      fixture(
        (session, paths) =>
          Effect.gen(function* () {
            const sessions = yield* SessionV2.Service
            const operations = yield* SessionMemoryOperation.Service
            const modes = yield* SessionMemoryModeNative.Service
            const llm = yield* TestLLMServer
            const files = yield* seed(session, paths)
            const release = Promise.withResolvers<void>()
            yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
            yield* llm.text("The live task is complete.")
            yield* llm.hold("## Stale\nThis must not publish.", release.promise)
            yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Complete the live task." } })
            yield* sessions.wait(session.id)
            yield* llm.wait(2)
            if (change === "disable") yield* modes.set(session.id, settings, false, false)
            if (change === "agent") yield* sessions.switchAgent({ sessionID: session.id, agent: "restricted" })
            if (change === "delete") yield* sessions.remove(session.id)
            if (change === "clear") {
              const location = yield* local(session, Location.Service)
              yield* Effect.promise(() =>
                MemoryMaintenance.clear(
                  WorkspaceMemory.maintenance(paths.directory, paths.home, { projectID: location.project.id }),
                  "workspace",
                  true,
                ),
              )
            }
            release.resolve()
            if (change !== "delete")
              expect((yield* dreamResult(operations, session)).result?.status).not.toBe("completed")
            expect(yield* Effect.promise(() => Bun.file(files.file).exists())).toBe(false)
            expect(yield* llm.hits).toHaveLength(2)
          }),
        true,
        { enabled: false },
        automaticMemory,
      ),
    20000,
  )
}

it.live(
  "new input joins automatic Dream waiting on the actual destination publication lease",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const database = yield* Database.Service
          const llm = yield* TestLLMServer
          const files = yield* seed(session, paths)
          const home = yield* Effect.promise(() => realpath(paths.home))
          const destination = path.join(home, path.relative(paths.home, files.file))
          const lock = yield* Effect.promise(() =>
            Flock.acquire(destination, { dir: path.join(home, ".grok", "memory", ".locks") }),
          )
          const state = { released: false }
          const release = Effect.promise(async () => {
            if (state.released) return
            state.released = true
            await lock.release()
          })
          yield* Effect.addFinalizer(() => release)
          yield* llm.text("The live task is complete.")
          yield* llm.text("## Stale\nThis must not publish.")
          yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Complete the live task." } })
          yield* sessions.wait(session.id)
          yield* llm.wait(2)
          yield* pollWithTimeout(
            Effect.gen(function* () {
              const rows = yield* database.db.select().from(SessionMemoryOperationTable).all()
              return rows.some(
                (row) =>
                  row.session_id === session.id &&
                  typeof row.data === "object" &&
                  row.data !== null &&
                  "legacyDream" in row.data,
              )
                ? true
                : undefined
            }),
            "validated publication receipt was not recorded",
            "5 seconds",
          )
          yield* sessions.prompt({ sessionID: session.id, resume: false, prompt: { text: "New admitted input" } })
          expect((yield* dreamResult(operations, session)).result?.status).toBe("cancelled")
          yield* release
          expect(yield* Effect.promise(() => Bun.file(files.file).exists())).toBe(false)
          expect(yield* llm.hits).toHaveLength(2)
        }),
      true,
      { enabled: false },
      automaticMemory,
    ),
  20000,
)

for (const gate of ["disabled", "too-soon", "too-few", "current-session-only"] as const) {
  it.live(
    `automatic Dream ${gate} gate is passive`,
    () =>
      fixture(
        (session, paths) =>
          Effect.gen(function* () {
            const sessions = yield* SessionV2.Service
            const operations = yield* SessionMemoryOperation.Service
            const llm = yield* TestLLMServer
            const files = yield* seed(session, paths, gate === "current-session-only" ? session.id : "other")
            if (gate === "too-soon")
              yield* Effect.promise(() =>
                Bun.write(files.state, JSON.stringify({ completed: Date.now(), processed: {} })),
              )
            const prepared = yield* local(
              session,
              MemoryLifecycleNative.Service.use((memory) => memory.prepareDream(session.id, false)),
            ).pipe(Effect.result)
            expect(prepared._tag).toBe("Failure")
            yield* llm.text("The live task is complete.")
            yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Complete the live task." } })
            yield* sessions.wait(session.id)
            // Allow a complete configured periodic interval; this asserts absence of provider work.
            yield* Effect.sleep(1150)
            expect(yield* llm.hits).toHaveLength(1)
            expect((yield* operations.list(session.id)).filter((row) => row.kind === "dream")).toHaveLength(0)
          }),
        true,
        { enabled: false },
        {
          dream: {
            ...automaticMemory.dream,
            enabled: gate !== "disabled",
            min_hours: gate === "too-soon" ? 24 : 0,
            min_sessions: gate === "too-few" ? 2 : 1,
            check_interval_secs: 1,
          },
        },
      ),
    20000,
  )
}

it.live(
  "sleeping automatic Dream releases the Location guard and cannot reuse a reloaded runtime",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const guard = yield* LocationRuntimeGuard.Service
          const locations = yield* LocationServiceMap.Service
          const llm = yield* TestLLMServer
          yield* seed(session, paths)
          const original = yield* local(session, MemoryLifecycleNative.Service)
          yield* llm.text("The live task is complete.")
          yield* llm.text("## First\nAUTOMATIC_DREAM_other")
          yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Complete the live task." } })
          yield* sessions.wait(session.id)
          expect((yield* dreamResult(operations, session)).result?.status).toBe("completed")
          const idle = yield* pollWithTimeout(
            guard.idle(session.location, Effect.succeed(true)).pipe(
              Effect.result,
              Effect.map((result) => (result._tag === "Success" ? true : undefined)),
            ),
            "sleeping Dream timer retained the Location runtime guard",
            "2 seconds",
          ).pipe(Effect.result)
          expect(idle._tag).toBe("Success")
          yield* guard.idle(session.location, locations.invalidate(session.location))
          const reloaded = yield* local(session, MemoryLifecycleNative.Service)
          expect(reloaded).not.toBe(original)
          yield* seed(session, paths, "after-reload")
          // Reload retires this runtime's armed timer; passive reconstruction does not arm another.
          yield* Effect.sleep(1150)
          expect(yield* llm.hits).toHaveLength(2)
          expect((yield* operations.list(session.id)).filter((row) => row.kind === "dream")).toHaveLength(1)
          yield* llm.text("The next live task is complete.")
          yield* llm.text("## Reloaded\nAUTOMATIC_DREAM_after-reload")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Complete a new task in the current runtime." },
          })
          yield* sessions.wait(session.id)
          yield* llm.wait(4)
          expect(yield* llm.hits).toHaveLength(4)
        }),
      true,
      { enabled: false },
      { dream: { ...automaticMemory.dream, check_interval_secs: 1 } },
    ),
  20000,
)

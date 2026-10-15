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

it.live(
  "legacy Dream uses native receipts, excludes its current Session and retries publication without inference",
  () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const operations = yield* SessionMemoryOperation.Service
        const llm = yield* TestLLMServer
        const locations = yield* LocationServiceMap.Service
        const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
        const input = { ...paths, projectID: location.project.id }
        const files = MemoryDream.paths(input)
        yield* enable(session.id)
        const empty = MemoryOperation.ID.create()
        expect((yield* operations.dream(session.id, { id: empty })).backend).toBe("legacy")
        expect((yield* settled(operations, session, empty)).result).toMatchObject({ status: "no_work", processed: 0 })
        expect(yield* llm.hits).toHaveLength(0)
        yield* Effect.promise(async () => {
          await mkdir(files.sessions, { recursive: true })
          await Bun.write(files.file, "## Prior\nPRESERVE_PRIOR_FACT\n")
          await Bun.write(path.join(files.sessions, "2026-10-15-other.md"), "## Source\nDURABLE_DREAM_SOURCE\n")
          await Bun.write(path.join(files.sessions, `2026-10-15-${session.id}.md`), "CURRENT_SESSION_MUST_BE_EXCLUDED")
        })
        yield* llm.text("## Decisions\nPRESERVE_PRIOR_FACT and DURABLE_DREAM_SOURCE remain useful.")
        const first = MemoryOperation.ID.create()
        yield* operations.dream(session.id, { id: first })
        expect((yield* settled(operations, session, first)).result).toMatchObject({
          status: "completed",
          processed: 1,
          committed: true,
        })
        const hit = (yield* llm.hits)[0]!
        expect(JSON.stringify(hit)).toContain("PRESERVE_PRIOR_FACT")
        expect(JSON.stringify(hit)).toContain("DURABLE_DREAM_SOURCE")
        expect(JSON.stringify(hit)).not.toContain("CURRENT_SESSION_MUST_BE_EXCLUDED")
        const output = yield* Effect.promise(() => readFile(files.file, "utf8"))
        expect(output).toContain("apexo-native-dream:")
        yield* operations.dream(session.id, { id: first })
        const retry = MemoryOperation.ID.create()
        yield* operations.retry(session.id, { id: retry, retryOf: first })
        expect((yield* settled(operations, session, retry)).result?.status).toBe("completed")
        expect(yield* llm.hits).toHaveLength(1)
        expect(yield* Effect.promise(() => readFile(files.file, "utf8"))).toBe(output)
        yield* Effect.promise(() => Bun.write(files.file, "## Foreign\nDo not overwrite this"))
        const conflict = MemoryOperation.ID.create()
        yield* operations.retry(session.id, { id: conflict, retryOf: retry })
        expect((yield* settled(operations, session, conflict)).result?.status).toBe("failed")
        expect(yield* Effect.promise(() => readFile(files.file, "utf8"))).toContain("Do not overwrite")
        expect(yield* llm.hits).toHaveLength(1)
      }),
    ),
)

it.live("legacy Dream rechecks disabled mode before publishing a held model result", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const modes = yield* SessionMemoryModeNative.Service
      const llm = yield* TestLLMServer
      const locations = yield* LocationServiceMap.Service
      const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
      const files = MemoryDream.paths({ ...paths, projectID: location.project.id })
      yield* Effect.promise(async () => {
        await mkdir(files.sessions, { recursive: true })
        await Bun.write(path.join(files.sessions, "other.md"), "## Source\nKeep this source.")
      })
      yield* enable(session.id)
      const held = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => held.resolve()))
      yield* llm.hold("## Decisions\nMust not publish", held.promise)
      const operation = MemoryOperation.ID.create()
      yield* operations.dream(session.id, { id: operation })
      yield* llm.wait(1)
      yield* modes.set(session.id, settings, false, false)
      yield* Effect.sync(() => held.resolve())
      expect((yield* settled(operations, session, operation)).result?.status).toBe("failed")
      expect(yield* Effect.promise(() => Bun.file(files.file).exists())).toBe(false)
    }),
  ),
)

it.live("legacy Dream denies headless, current permissions and oversized sources before provider work", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const store = yield* SessionStore.Service
      const llm = yield* TestLLMServer
      const locations = yield* LocationServiceMap.Service
      const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
      const files = MemoryDream.paths({ ...paths, projectID: location.project.id })
      yield* enable(session.id)
      const headless = yield* operations
        .dream(session.id, { id: MemoryOperation.ID.create() })
        .pipe(
          Effect.provideService(
            SessionExecutionPolicy.Current,
            new Map([[session.id, { mode: "headless", permissions: "approve_once" }]]),
          ),
          Effect.result,
        )
      expect(headless._tag).toBe("Failure")
      if (headless._tag === "Failure") expect(headless.failure.code).toBe("unsupported")
      yield* store.setPermissions({
        sessionID: session.id,
        permissions: [{ permission: "read", pattern: "*", action: "deny" }],
      })
      const denied = yield* operations.dream(session.id, { id: MemoryOperation.ID.create() }).pipe(Effect.result)
      expect(denied._tag).toBe("Failure")
      if (denied._tag === "Failure") expect(denied.failure.code).toBe("denied")
      yield* store.setPermissions({ sessionID: session.id, permissions: [] })
      yield* Effect.promise(async () => {
        await mkdir(files.sessions, { recursive: true })
        await Bun.write(path.join(files.sessions, "too-large.md"), "x".repeat(64_001))
      })
      expect((yield* operations.dream(session.id, { id: MemoryOperation.ID.create() }).pipe(Effect.result))._tag).toBe(
        "Failure",
      )
      expect(yield* operations.list(session.id)).toEqual([])
      expect(yield* llm.calls).toBe(0)
    }),
  ),
)

it.live("legacy Dream NO_REPLY journals exact versions without replacing existing memory", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const llm = yield* TestLLMServer
      const locations = yield* LocationServiceMap.Service
      const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
      const input = { ...paths, projectID: location.project.id }
      const files = MemoryDream.paths(input)
      yield* Effect.promise(async () => {
        await mkdir(files.sessions, { recursive: true })
        await Bun.write(files.file, "## Existing\nPreserve byte-for-byte.\n")
        await Bun.write(path.join(files.sessions, "other.md"), "Nothing durable")
      })
      yield* enable(session.id)
      yield* llm.text("NO_REPLY")
      const id = MemoryOperation.ID.create()
      yield* operations.dream(session.id, { id })
      expect((yield* settled(operations, session, id)).result?.status).toBe("no_work")
      expect(yield* Effect.promise(() => readFile(files.file, "utf8"))).toBe("## Existing\nPreserve byte-for-byte.\n")
      expect(yield* Effect.promise(() => Bun.file(path.join(files.sessions, "other.md")).exists())).toBe(true)
      const retry = MemoryOperation.ID.create()
      yield* operations.retry(session.id, { id: retry, retryOf: id })
      expect((yield* settled(operations, session, retry)).result?.status).toBe("no_work")
      expect(yield* llm.calls).toBe(1)
    }),
  ),
)

it.live("legacy Dream rejects a late selected Agent replacement before publication and retry", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const sessions = yield* SessionV2.Service
      const llm = yield* TestLLMServer
      const locations = yield* LocationServiceMap.Service
      const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
      const files = MemoryDream.paths({ ...paths, projectID: location.project.id })
      yield* Effect.promise(async () => {
        await mkdir(files.sessions, { recursive: true })
        await Bun.write(path.join(files.sessions, "other.md"), "## Source\nLate authority must still apply")
      })
      yield* enable(session.id)
      const held = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => held.resolve()))
      yield* llm.hold("## Decisions\nMust not publish under replaced authority", held.promise)
      const id = MemoryOperation.ID.create()
      yield* operations.dream(session.id, { id })
      yield* llm.wait(1)
      yield* sessions.switchAgent({ sessionID: session.id, agent: "restricted" })
      yield* Effect.sync(() => held.resolve())
      expect((yield* settled(operations, session, id)).result?.status).toBe("failed")
      expect(yield* Effect.promise(() => Bun.file(files.file).exists())).toBe(false)
      const retry = MemoryOperation.ID.create()
      yield* operations.retry(session.id, { id: retry, retryOf: id })
      expect((yield* settled(operations, session, retry)).result?.status).toBe("failed")
      expect(yield* llm.calls).toBe(1)
    }),
  ),
)

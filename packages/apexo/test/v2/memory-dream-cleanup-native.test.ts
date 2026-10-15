import { MemorySearch } from "@apexo/core/memory-search"
import { MemoryDreamNative } from "@apexo/core/memory-dream-native"
import { utimes, symlink, rm } from "node:fs/promises"
import { MemoryCatalog } from "@apexo/core/memory-catalog"
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

it.live("native Dream removes only old consumed sources after durable publication", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const llm = yield* TestLLMServer
      const location = yield* local(session, Location.Service)
      const input = { ...paths, projectID: location.project.id }
      const files = MemoryDream.paths(input)
      const old = path.join(files.sessions, "a-old.md")
      const recent = path.join(files.sessions, "b-recent.md")
      const current = path.join(files.sessions, `today-${session.id}.md`)
      yield* Effect.promise(async () => {
        await mkdir(files.sessions, { recursive: true })
        await Bun.write(old, "## Source\nOLD_CONSUMED_FACT")
        await utimes(old, new Date(0), new Date(0))
        await Bun.write(recent, "## Source\nRECENT_FACT")
        await Bun.write(current, "CURRENT_MUST_SURVIVE")
      })
      const search = yield* MemorySearch.make({ ...input, watch: false })
      expect((yield* search.search({ query: "OLD_CONSUMED_FACT" })).results.some((item) => item.path === old)).toBe(
        true,
      )
      yield* enable(session.id)
      yield* llm.text("## Consolidated\nOLD_CONSUMED_FACT and RECENT_FACT")
      const id = MemoryOperation.ID.create()
      yield* operations.dream(session.id, { id })
      expect((yield* settled(operations, session, id)).result?.status).toBe("completed")
      expect(yield* Effect.promise(() => Bun.file(files.file).text())).toContain("OLD_CONSUMED_FACT")
      expect(yield* Effect.promise(() => Bun.file(old).exists())).toBe(false)
      expect(yield* Effect.promise(() => Bun.file(recent).exists())).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(current).exists())).toBe(true)
      expect((yield* search.search({ query: "OLD_CONSUMED_FACT" })).results.some((item) => item.path === old)).toBe(
        false,
      )
      const notes = yield* Effect.promise(() => MemoryCatalog.list({ ...input, migrate: false, permitted: () => true }))
      expect(notes.some((note) => note.name === "a-old.md")).toBe(false)
      const retry = MemoryOperation.ID.create()
      yield* operations.retry(session.id, { id: retry, retryOf: id })
      expect((yield* settled(operations, session, retry)).result?.status).toBe("completed")
      expect(yield* llm.calls).toBe(1)
    }),
  ),
)

for (const mode of ["no_reply", "changed", "busy", "agent", "disabled", "symlink", "invalid"] as const)
  it.live(`native cleanup preserves sources when ${mode}`, () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const operations = yield* SessionMemoryOperation.Service
        const sessions = yield* SessionV2.Service
        const modes = yield* SessionMemoryModeNative.Service
        const llm = yield* TestLLMServer
        const location = yield* local(session, Location.Service)
        const files = MemoryDream.paths({ ...paths, projectID: location.project.id })
        const source = path.join(files.sessions, "old.md")
        yield* Effect.promise(async () => {
          await mkdir(files.sessions, { recursive: true })
          await Bun.write(source, "## Source\nRetain authoritative bytes")
          await utimes(source, new Date(0), new Date(0))
        })
        yield* enable(session.id)
        const held = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => held.resolve()))
        yield* llm.hold(
          mode === "no_reply"
            ? "NO_REPLY"
            : mode === "invalid"
              ? "invalid prose"
              : "## Knowledge\nAccepted source knowledge",
          held.promise,
        )
        const id = MemoryOperation.ID.create()
        yield* operations.dream(session.id, { id })
        yield* llm.wait(1)
        if (mode === "changed") yield* Effect.promise(() => Bun.write(source, "## Concurrent edit\nNew source bytes"))
        if (mode === "symlink")
          yield* Effect.promise(async () => {
            const target = path.join(files.sessions, "unrelated.md")
            await Bun.write(target, "UNRELATED_MUST_SURVIVE")
            await rm(source)
            await symlink(target, source)
          })
        if (mode === "busy")
          yield* Flock.effect(
            path.join(yield* Effect.promise(() => realpath(paths.home)), path.relative(paths.home, source)),
            { dir: path.join(paths.home, ".grok", "memory", ".locks") },
          )
        if (mode === "agent") yield* sessions.switchAgent({ sessionID: session.id, agent: "restricted" })
        if (mode === "disabled") yield* modes.set(session.id, settings, false, false)
        yield* Effect.sync(() => held.resolve())
        const result = yield* settled(operations, session, id)
        expect(result.result?.status).toBe(
          mode === "no_reply" ? "no_work" : ["agent", "disabled", "invalid"].includes(mode) ? "failed" : "completed",
        )
        expect(yield* Effect.promise(() => Bun.file(source).exists())).toBe(true)
        expect(yield* llm.calls).toBe(1)
      }),
    ),
  )

it.live("native cleanup leaves unread capped source files", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const llm = yield* TestLLMServer
      const location = yield* local(session, Location.Service)
      const files = MemoryDream.paths({ ...paths, projectID: location.project.id })
      const first = path.join(files.sessions, "a-first.md")
      const unread = path.join(files.sessions, "z-unread.md")
      yield* Effect.promise(async () => {
        await mkdir(files.sessions, { recursive: true })
        await Bun.write(first, "## Long source\n" + "x".repeat(33000))
        await Bun.write(unread, "UNREAD_MUST_SURVIVE")
        await utimes(first, new Date(0), new Date(0))
        await utimes(unread, new Date(0), new Date(0))
      })
      yield* enable(session.id)
      yield* llm.text("## Knowledge\nConsolidated first source")
      const id = MemoryOperation.ID.create()
      yield* operations.dream(session.id, { id })
      expect((yield* settled(operations, session, id)).result).toMatchObject({ status: "completed", processed: 1 })
      expect(yield* Effect.promise(() => Bun.file(first).exists())).toBe(false)
      expect(yield* Effect.promise(() => Bun.file(unread).exists())).toBe(true)
    }),
  ),
)

it.live("old publication receipts retain consumed sources by default", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      const location = yield* local(session, Location.Service)
      const files = MemoryDream.paths({ ...paths, projectID: location.project.id })
      const source = path.join(files.sessions, "old.md")
      yield* Effect.promise(async () => {
        await mkdir(files.sessions, { recursive: true })
        await Bun.write(source, "## Source\nOld receipt contract")
        await utimes(source, new Date(0), new Date(0))
      })
      yield* enable(session.id)
      yield* llm.text("## Knowledge\nOriginal receipt publication")
      yield* local(
        session,
        Effect.gen(function* () {
          const memory = yield* MemoryLifecycleNative.Service
          const plan = yield* memory.prepareDream(session.id, true)
          if (!Schema.is(MemoryDreamNative.Plan)(plan)) return yield* Effect.die("Expected legacy plan")
          const captured = yield* Deferred.make<MemoryDreamNative.Publication>()
          const id = MemoryOperation.ID.create()
          yield* memory
            .executeLegacyDream(plan, {
              operationID: id,
              prepared: (publication) =>
                Deferred.succeed(captured, publication).pipe(Effect.andThen(Effect.fail("stop before publication"))),
            })
            .pipe(Effect.exit)
          const publication = { ...(yield* Deferred.await(captured)) }
          delete publication.cleanup
          expect(
            (yield* memory.executeLegacyDream(plan, {
              operationID: id,
              recover: publication,
              prepared: () => Effect.void,
            })).status,
          ).toBe("completed")
        }),
      )
      expect(yield* Effect.promise(() => Bun.file(source).exists())).toBe(true)
      expect(yield* llm.calls).toBe(1)
    }),
  ),
)

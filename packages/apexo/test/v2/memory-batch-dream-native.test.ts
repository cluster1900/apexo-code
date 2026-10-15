import { mkdir, readFile } from "node:fs/promises"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { ConfigMemory } from "@apexo/core/config/memory"
import { MemoryConsolidation } from "@apexo/core/memory-consolidation"
import { Goal } from "@apexo/schema/goal"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionGoalUsage } from "@apexo/core/session/goal-usage"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { Database } from "@apexo/core/database/database"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionIncarnation } from "@apexo/core/session/incarnation"
import { SessionStore } from "@apexo/core/session/store"
import { SessionExecutionPolicy } from "@apexo/core/session/execution-policy"
import path from "node:path"
import { expect } from "bun:test"
import { ConfigProvider, Deferred, Effect, Fiber, Layer, Scope, Schema } from "effect"
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
import { SessionMemoryOperation } from "@apexo/core/session/memory-operation"
import { MemoryOperation } from "@apexo/schema/memory-operation"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
const settings = { memory_v2: { enabled: true, batch_dream_enabled: true } }
const fixture = <A, E>(
  body: (
    session: SessionV2.Info,
    paths: { home: string; directory: string },
  ) => Effect.Effect<
    A,
    E,
    | SessionV2.Service
    | SessionGoal.Service
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
  configuration: typeof ConfigMemory.V2.Type = {},
) =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped({ git: configuration.enabled === false })
    const llm = yield* TestLLMServer
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, "apexo.json"),
        JSON.stringify({
          snapshots: false,
          agents: { restricted: { mode: "primary", permissions: [{ action: "edit", resource: "*", effect: "deny" }] } },
          ...settings,
          memory_v2: { ...settings.memory_v2, ...configuration },
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          providers: {
            fixture: {
              api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url, settings: { apiKey: "test" } },
              models: {
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
        yield* modes.set(session.id, { memory_v2: { ...settings.memory_v2, ...configuration } }, false, false)
      }
      return yield* body(session, { home, directory })
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

const create = (count = 1, offset = 0) =>
  JSON.stringify({
    actions: null,
    plan: {
      edits: Array.from({ length: count }, (_, i) => ({
        kind: "create",
        id: `E${i + 1}`,
        path: `topics/fact-${i + offset + 1}.md`,
        content: `# Fact ${i + offset + 1}\nDurable fact.\n\n## Knowledge\nThe mascot is an otter.`,
      })),
      outcomes: Array.from({ length: count }, (_, i) => ({
        outcome: "applied",
        note: `N${i + 1}`,
        edits: [`E${i + 1}`],
      })),
    },
  })

it.live("batch Dream uses action replies and exact completed retries cannot claim fresh notes", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const locations = yield* LocationServiceMap.Service
      const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
      const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id })
      const llm = yield* TestLLMServer
      yield* store.remember("The mascot is an otter", () => true)
      yield* enable(session.id)
      yield* llm.text(JSON.stringify({ actions: [{ action: "list", after: null }], plan: null }))
      yield* llm.text(create())
      const id = MemoryOperation.ID.create()
      yield* operations.dream(session.id, { id })
      const info = yield* settled(operations, session, id)
      if (info.result?.status === "failed") throw new Error(JSON.stringify(info))
      expect(info.result).toMatchObject({ status: "completed", processed: 1, topics: 1 })
      expect((yield* store.previewNote("topics/fact-1.md", () => true))?.content).toContain("otter")
      expect(yield* llm.calls).toBe(2)
      yield* store.remember("A fresh note must wait for another operation", () => true)
      expect((yield* operations.dream(session.id, { id })).state).toBe("finished")
      expect(yield* llm.calls).toBe(2)
    }),
  ),
)

it.live("batch Dream partitions 21 observations into bounded durable claims", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const locations = yield* LocationServiceMap.Service
      const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
      const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id })
      const llm = yield* TestLLMServer
      for (let i = 0; i < 21; i++) yield* store.remember(`Distinct durable fact ${i}`, () => true)
      yield* enable(session.id)
      yield* llm.text(create(20))
      yield* llm.text(create(1, 20))
      const id = MemoryOperation.ID.create()
      yield* operations.dream(session.id, { id })
      const info = yield* settled(operations, session, id)
      if (info.result?.status === "failed") throw new Error(JSON.stringify(info))
      expect(info.result).toMatchObject({ status: "completed", processed: 21, topics: 21 })
      expect(yield* llm.calls).toBe(2)
    }),
  ),
)

it.live("mixed applied and deferred outcomes preserve retry status and exact retry counts", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const locations = yield* LocationServiceMap.Service
      const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
      const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id })
      const llm = yield* TestLLMServer
      yield* store.remember("Ready knowledge", () => true)
      yield* store.remember("Needs additional context", () => true)
      yield* enable(session.id)
      const response = JSON.parse(create())
      response.plan.outcomes.push({ outcome: "deferred", note: "N2", reason: "Needs context" })
      yield* llm.text(JSON.stringify(response))
      const id = MemoryOperation.ID.create()
      yield* operations.dream(session.id, { id })
      const result = (yield* settled(operations, session, id)).result
      expect(result).toMatchObject({ status: "retry_required", processed: 1, topics: 1, deferred: 1, unplaceable: 0 })
      const retry = MemoryOperation.ID.create()
      yield* operations.retry(session.id, { id: retry, retryOf: id })
      expect((yield* settled(operations, session, retry)).result).toEqual(result)
      expect(yield* llm.calls).toBe(1)
    }),
  ),
)

it.live("ordinary deferral retains the note twice and archives only the third independent attempt", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const locations = yield* LocationServiceMap.Service
      const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
      const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id })
      const llm = yield* TestLLMServer
      const note = yield* store.remember("Insufficient context to place safely", () => true)
      yield* enable(session.id)
      for (let i = 0; i < 3; i++) {
        yield* llm.text(
          JSON.stringify({
            actions: null,
            plan: { edits: [], outcomes: [{ outcome: "deferred", note: "N1", reason: "Needs context" }] },
          }),
        )
        const id = MemoryOperation.ID.create()
        yield* operations.dream(session.id, { id })
        expect((yield* settled(operations, session, id)).result).toMatchObject({
          status: i < 2 ? "retry_required" : "completed",
          deferred: i < 2 ? 1 : 0,
          unplaceable: i < 2 ? 0 : 1,
          processed: 0,
        })
        expect(yield* llm.calls).toBe(i + 1)
        expect(yield* Effect.promise(() => Bun.file(note.path).exists())).toBe(i < 2)
      }
    }),
  ),
)

for (const change of ["permission", "agent", "disable", "delete"] as const) {
  it.live(`Batch Dream ${change} during inference prevents late publication`, () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const operations = yield* SessionMemoryOperation.Service
        const sessions = yield* SessionV2.Service
        const modes = yield* SessionMemoryModeNative.Service
        const sessionStore = yield* SessionStore.Service
        const locations = yield* LocationServiceMap.Service
        const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
        const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id })
        yield* store.remember("Keep original observation after revocation", () => true)
        const evidence = (yield* store.listNotes("", () => true))
          .filter((note) => note.name.startsWith("observations/_inbox/"))
          .map((note) => note.name)
        yield* enable(session.id)
        const release = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
        const llm = yield* TestLLMServer
        yield* llm.hold(create(), release.promise)
        const id = MemoryOperation.ID.create()
        yield* operations.dream(session.id, { id })
        yield* llm.wait(1)
        if (change === "permission")
          yield* sessionStore.setPermissions({
            sessionID: session.id,
            permissions: [{ permission: "edit", pattern: "*", action: "deny" }],
          })
        if (change === "agent") yield* sessions.switchAgent({ sessionID: session.id, agent: "restricted" })
        if (change === "disable") yield* modes.set(session.id, settings, false, true)
        if (change === "delete") {
          yield* sessions.remove(session.id).pipe(Effect.timeout("3 seconds"))
          yield* sessions.create({ id: session.id, location: session.location, model: session.model })
        }
        release.resolve()
        if (change !== "delete") expect((yield* settled(operations, session, id)).result?.status).not.toBe("completed")
        if (change === "delete") {
          expect(yield* operations.list(session.id)).toEqual([])
          expect(
            (yield* operations.dream(session.id, { id: MemoryOperation.ID.create(), retryOf: id }).pipe(Effect.result))
              ._tag,
          ).toBe("Failure")
        }
        expect((yield* store.previewNote("topics/fact-1.md", () => true).pipe(Effect.result))._tag).toBe("Failure")
        expect(
          (yield* store.listNotes("", () => true)).some((note) => note.name.startsWith("observations/_inbox/")),
        ).toBe(true)
        expect(yield* llm.calls).toBe(1)
      }),
    ),
  )
}

for (const target of ["note", "topic"] as const)
  it.live(`batch refuses a second request after ${target} read permission revocation`, () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const operations = yield* SessionMemoryOperation.Service
        const sessions = yield* SessionStore.Service
        const locations = yield* LocationServiceMap.Service
        const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
        const memory = yield* MemoryCapture.make({ ...paths, projectID: location.project.id })
        const note = yield* memory.remember("Private original note", () => true)
        yield* Effect.promise(() =>
          MemoryV2.publish(
            memory.root,
            "topics/private.md",
            "# Private\nPrivate description.\n\n## Fact\nPrivate knowledge.",
            true,
          ),
        )
        yield* enable(session.id)
        const llm = yield* TestLLMServer
        const release = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
        yield* llm.hold(JSON.stringify({ actions: [{ action: "list", after: null }], plan: null }), release.promise)
        const id = MemoryOperation.ID.create()
        yield* operations.dream(session.id, { id })
        yield* llm.wait(1)
        yield* sessions.setPermissions({
          sessionID: session.id,
          permissions: [
            {
              permission: "read",
              pattern: target === "note" ? note.path : path.join(memory.root.path, "topics/private.md"),
              action: "deny",
            },
          ],
        })
        release.resolve()
        expect((yield* settled(operations, session, id)).result?.status).toBe("retry_required")
        expect(yield* llm.calls).toBe(1)
        expect(yield* Effect.promise(() => Bun.file(note.path).exists())).toBe(true)
      }),
    ),
  )

it.live("automatic batch Dream follows successful live capture only when eligible", () =>
  fixture(
    (session, paths) =>
      Effect.gen(function* () {
        const operations = yield* SessionMemoryOperation.Service
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
        const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id })
        for (let index = 0; index < 20; index++) yield* store.remember(`Eligible durable fact ${index}`, () => true)
        const notes = (yield* store.listNotes("", () => true)).filter((note) =>
          note.name.startsWith("observations/_inbox/"),
        )
        const llm = yield* TestLLMServer
        yield* llm.text("Completed ordinary source")
        yield* llm.text(JSON.stringify({ outcome: "noop", observations: [] }))
        yield* llm.text(create(20))
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Complete this ordinary turn." } })
        yield* sessions.wait(session.id)
        const completed = yield* pollWithTimeout(
          operations
            .list(session.id)
            .pipe(Effect.map((rows) => rows.find((row) => row.kind === "dream" && row.state === "finished"))),
          "Automatic Dream did not settle",
          "10 seconds",
        )
        expect(completed.result?.status).toBe("completed")
        expect(completed.result?.processed).toBe(20)
        expect(yield* llm.calls).toBe(3)
        expect((yield* store.previewNote("topics/fact-1.md", () => true)).content).toContain("otter")
      }),
    true,
  ),
)
it.live("new durable input cancels the owned automatic batch without publishing", () =>
  fixture(
    (session, paths) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const locations = yield* LocationServiceMap.Service
        const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
        const memory = yield* MemoryCapture.make({ ...paths, projectID: location.project.id })
        for (let i = 0; i < 20; i++) yield* memory.remember(`Eligible fact ${i}`, () => true)
        const llm = yield* TestLLMServer
        yield* llm.text("Completed ordinary turn")
        yield* llm.text(JSON.stringify({ outcome: "noop", observations: [] }))
        const held = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => held.resolve()))
        yield* llm.hold(create(20), held.promise)
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Finish an ordinary task" } })
        yield* sessions.wait(session.id)
        yield* llm.wait(3)
        yield* sessions
          .prompt({ sessionID: session.id, resume: false, prompt: { text: "New input owns the next epoch" } })
          .pipe(Effect.timeout("3 seconds"))
        held.resolve()
        const done = yield* pollWithTimeout(
          operations
            .list(session.id)
            .pipe(Effect.map((rows) => rows.find((row) => row.kind === "dream" && row.state === "finished"))),
          "Automatic batch cancellation did not settle",
          "5 seconds",
        )
        expect(done.result?.status).toBe("cancelled")
        expect(yield* Effect.promise(() => Bun.file(path.join(memory.root.path, "topics/fact-1.md")).exists())).toBe(
          false,
        )
        expect(yield* llm.calls).toBe(3)
      }),
    true,
  ),
)
it.live("partial multi-batch retry retains earlier owner proofs and never repeats a completed batch", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const sessions = yield* SessionV2.Service
      const locations = yield* LocationServiceMap.Service
      const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
      const memory = yield* MemoryCapture.make({ ...paths, projectID: location.project.id })
      for (let i = 0; i < 21; i++) yield* memory.remember(`Retry fact ${i}`, () => true)
      yield* enable(session.id)
      const llm = yield* TestLLMServer
      yield* llm.text(create(20))
      const held = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => held.resolve()))
      yield* llm.hold(create(1, 20), held.promise)
      const original = MemoryOperation.ID.create()
      yield* operations.dream(session.id, { id: original })
      yield* llm.wait(2)
      yield* operations.cancel(session.id, original)
      held.resolve()
      expect((yield* memory.listNotes("", () => true)).filter((note) => note.name.startsWith("topics/")).length).toBe(
        20,
      )
      const stranger = yield* sessions.create({
        location: session.location,
        agent: AgentV2.ID.make("build"),
        model: session.model,
      })
      expect(
        (yield* operations
          .retry(stranger.id, { id: MemoryOperation.ID.create(), retryOf: original })
          .pipe(Effect.result))._tag,
      ).toBe("Failure")
      yield* llm.text(create(1, 20))
      const retry = MemoryOperation.ID.create()
      yield* operations.retry(session.id, { id: retry, retryOf: original })
      expect((yield* settled(operations, session, retry)).result).toMatchObject({
        status: "completed",
        processed: 21,
        topics: 21,
      })
      const again = MemoryOperation.ID.create()
      yield* operations.retry(session.id, { id: again, retryOf: retry })
      expect((yield* settled(operations, session, again)).result).toMatchObject({
        status: "completed",
        processed: 21,
        topics: 21,
      })
      expect(yield* llm.calls).toBe(3)
    }),
  ),
)

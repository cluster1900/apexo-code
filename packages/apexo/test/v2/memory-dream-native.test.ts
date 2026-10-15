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
const settings = { memory_v2: { enabled: true } }
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

it.live("manual native Dream consolidates once and exact operation retries remain passive", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const sessions = yield* SessionV2.Service
      const llm = yield* TestLLMServer
      const locations = yield* LocationServiceMap.Service
      const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
      const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id })
      yield* store.remember("The mascot is an otter", () => true)
      yield* enable(session.id)
      const lease = (yield* store.dreamClaim(
        { owner: "fixture-inspection", now: Date.now(), duration: 1000 },
        () => true,
      ))!
      const input = yield* store.dreamInput(lease, Date.now(), () => true)
      yield* store.dreamRelease(lease, Date.now())
      yield* llm.text(
        JSON.stringify({
          operations: [
            {
              action: "create",
              path: "topics/mascot.md",
              content: "The mascot is an otter",
              evidence: input.observations.map((row) => row.path),
            },
          ],
        }),
      )
      const id = MemoryOperation.ID.create()
      const pair = yield* Effect.all([operations.dream(session.id, { id }), operations.dream(session.id, { id })], {
        concurrency: "unbounded",
      })
      expect(pair.map((row) => row.id)).toEqual([id, id])
      const result = yield* settled(operations, session, id)
      expect(result.result).toMatchObject({ status: "completed", processed: 1, topics: 1, shadow: false })
      expect((yield* store.previewNote("topics/mascot.md", () => true))?.content).toContain("otter")
      expect(yield* llm.calls).toBe(1)
      expect((yield* operations.dream(session.id, { id })).state).toBe("finished")
      expect(
        (yield* settled(
          operations,
          session,
          (yield* operations.dream(session.id, { id: MemoryOperation.ID.create() })).id,
        )).result?.status,
      ).toBe("no_work")
      expect(yield* llm.calls).toBe(1)
      expect(yield* sessions.messages({ sessionID: session.id, order: "asc" })).toEqual([])
    }),
  ),
)

it.live("native Dream cancellation joins owned inference and permits a new explicit attempt", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const locations = yield* LocationServiceMap.Service
      const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
      const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id })
      yield* store.remember("Cancellation must preserve this observation", () => true)
      yield* enable(session.id)
      const llm = yield* TestLLMServer
      const release = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
      yield* llm.hold("{}", release.promise)
      const id = MemoryOperation.ID.create()
      yield* operations.dream(session.id, { id })
      yield* llm.wait(1)
      const cancelled = yield* operations.cancel(session.id, id).pipe(Effect.timeout("5 seconds"))
      expect(cancelled.result?.status).toBe("cancelled")
      expect((yield* operations.dream(session.id, { id })).result?.status).toBe("cancelled")
      expect(yield* llm.calls).toBe(1)
      yield* llm.text("invalid Dream output")
      const retry = MemoryOperation.ID.create()
      yield* operations.retry(session.id, { id: retry, retryOf: id })
      expect((yield* settled(operations, session, retry)).result?.status).toBe("failed")
      expect(yield* llm.calls).toBe(2)
      const lease = yield* store.dreamClaim(
        { owner: "after-join", now: Date.now(), duration: 1000, ownership: "explicit" },
        () => true,
      )
      expect(lease).toBeDefined()
      if (lease) yield* store.dreamRelease(lease, Date.now())
    }),
  ),
)

it.live("native migration previews and imports fixed legacy scope with zero provider work", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const locations = yield* LocationServiceMap.Service
      const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
      const source = WorkspaceMemory.file(paths.directory, paths.home, { projectID: location.project.id })
      yield* Effect.promise(() => mkdir(path.dirname(source), { recursive: true }))
      yield* Effect.promise(() => Bun.write(source, "# Memory\n\n## Project\nRetained curated knowledge."))
      yield* enable(session.id)
      const preview = yield* operations.previewMigration(session.id, { kind: "carryover", scope: "workspace" })
      expect(preview.available).toBe(true)
      expect(
        yield* Effect.promise(() =>
          Bun.file(
            path.join(MemoryV2.directory({ ...paths, projectID: location.project.id }), "memory_state.sqlite"),
          ).exists(),
        ),
      ).toBe(false)
      const reordered = {
        available: preview.available,
        generation: preview.generation,
        targetHash: preview.targetHash,
        sourceHash: preview.sourceHash,
        scope: preview.scope,
        kind: preview.kind,
      } satisfies MemoryOperation.MigrationPreview
      expect(Object.keys(reordered)).not.toEqual(Object.keys(preview))
      expect(Schema.toEquivalence(MemoryOperation.MigrationPreview)(preview, reordered)).toBe(true)
      const id = MemoryOperation.ID.create()
      yield* operations.migrate(session.id, { id, preview: reordered })
      expect((yield* settled(operations, session, id)).result?.status).toBe("completed")
      expect((yield* operations.migrate(session.id, { id, preview })).state).toBe("finished")
      const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id })
      const notes = yield* store.listNotes("", () => true)
      const retryID = MemoryOperation.ID.create()
      yield* operations.retry(session.id, { id: retryID, retryOf: id })
      expect((yield* settled(operations, session, retryID)).result).toMatchObject({ status: "no_work", processed: 0 })
      expect((yield* operations.retry(session.id, { id: retryID, retryOf: id })).state).toBe("finished")
      expect(yield* store.listNotes("", () => true)).toEqual(notes)
      expect((yield* store.listNotes("curated", () => true)).length).toBeGreaterThan(0)
      expect(yield* Effect.promise(() => readFile(source, "utf8"))).toContain("Retained curated knowledge")
      const llm = yield* TestLLMServer
      expect(yield* llm.calls).toBe(0)
    }),
  ),
)

it.live("automatic native Dream follows successful live capture only when eligible", () =>
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
        yield* llm.text(
          JSON.stringify({
            operations: [
              {
                action: "create",
                path: "topics/automatic.md",
                content: "Twenty useful facts",
                evidence: notes.map((note) => note.name),
              },
            ],
          }),
        )
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
        expect((yield* store.previewNote("topics/automatic.md", () => true)).content).toContain("Twenty useful facts")
      }),
    true,
  ),
)

it.live("native shadow Dream validates without publishing exposed topics", () =>
  fixture(
    (session, paths) =>
      Effect.gen(function* () {
        const operations = yield* SessionMemoryOperation.Service
        const locations = yield* LocationServiceMap.Service
        const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
        const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id })
        yield* store.enqueue({
          sessionID: "shadow-seed",
          from: 1,
          through: 1,
          sourcePromptIndex: 0,
          source: "shadow fact",
          exposed: false,
        })
        const capture = (yield* store.claim({ owner: "seed", now: Date.now(), duration: 1000 }))!
        yield* store.commit(
          capture,
          MemoryCapture.parse(
            JSON.stringify({ outcome: "observations", observations: [{ type: "project", statement: "Shadow fact" }] }),
            "fixture/model",
            Math.floor(Date.now() / 1000),
          ),
          Date.now(),
        )
        const lease = (yield* store.dreamClaim(
          { owner: "inspect", now: Date.now(), duration: 1000, shadow: true },
          () => true,
        ))!
        const input = yield* store.dreamInput(lease, Date.now(), () => true)
        yield* store.dreamRelease(lease, Date.now())
        yield* enable(session.id)
        const llm = yield* TestLLMServer
        yield* llm.text(
          JSON.stringify({
            operations: [
              {
                action: "create",
                path: "topics/shadow.md",
                content: "Shadow only",
                evidence: input.observations.map((row) => row.path),
              },
            ],
          }),
        )
        const id = MemoryOperation.ID.create()
        yield* operations.dream(session.id, { id })
        expect((yield* settled(operations, session, id)).result).toMatchObject({
          status: "completed",
          shadow: true,
          processed: 1,
        })
        expect(yield* store.listNotes("", () => true)).toEqual([])
        expect(yield* llm.calls).toBe(1)
      }),
    false,
    { rollout: "shadow", capture_enabled: false },
  ),
)

it.live("Dream and migration reject headless and privately managed authority before admission", () =>
  fixture((session) =>
    Effect.gen(function* () {
      const operations = yield* SessionMemoryOperation.Service
      const sessions = yield* SessionV2.Service
      const llm = yield* TestLLMServer
      yield* enable(session.id)
      const work = Effect.gen(function* () {
        const dream = yield* operations.dream(session.id, { id: MemoryOperation.ID.create() }).pipe(Effect.result)
        const migration = yield* operations
          .previewMigration(session.id, { kind: "carryover", scope: "global" })
          .pipe(Effect.result)
        for (const result of [dream, migration]) {
          expect(result._tag).toBe("Failure")
          if (result._tag === "Failure") expect(result.failure.code).toBe("unsupported")
        }
      })
      yield* work.pipe(
        Effect.provideService(
          SessionExecutionPolicy.Current,
          new Map([[session.id, { mode: "headless", permissions: "approve_once" }]]),
        ),
      )
      const child = yield* sessions.create({
        parentID: session.id,
        location: session.location,
        model: session.model,
        metadata: { goalReview: "original managed ownership marker" },
      })
      yield* enable(child.id)
      const denied = yield* operations.dream(child.id, { id: MemoryOperation.ID.create() }).pipe(Effect.result)
      expect(denied._tag).toBe("Failure")
      if (denied._tag === "Failure") expect(denied.failure.code).toBe("unsupported")
      const goals = yield* SessionGoal.Service
      const goal = yield* goals.create(session.id, {
        id: Goal.ID.create(),
        objective: "No auxiliary accounting bypass",
      })
      const target = { sessionID: session.id, goalID: goal.id }
      const attempt = yield* goals.begin(target, "executing")
      yield* goals.pause(target, "user_paused")
      yield* work.pipe(Effect.provideService(SessionGoalUsage.Current, attempt))
      expect(yield* operations.list(session.id)).toEqual([])
      expect(yield* llm.calls).toBe(0)
    }),
  ),
)

for (const change of ["permission", "disable", "delete"] as const) {
  it.live(`Dream ${change} during inference prevents late publication`, () =>
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
        yield* llm.hold(
          JSON.stringify({
            operations: [{ action: "create", path: "topics/late.md", content: "Must not publish", evidence }],
          }),
          release.promise,
        )
        const id = MemoryOperation.ID.create()
        yield* operations.dream(session.id, { id })
        yield* llm.wait(1)
        if (change === "permission")
          yield* sessionStore.setPermissions({
            sessionID: session.id,
            permissions: [{ permission: "edit", pattern: "*", action: "deny" }],
          })
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
        expect((yield* store.previewNote("topics/late.md", () => true).pipe(Effect.result))._tag).toBe("Failure")
        expect(
          (yield* store.listNotes("", () => true)).some((note) => note.name.startsWith("observations/_inbox/")),
        ).toBe(true)
        expect(yield* llm.calls).toBe(1)
      }),
    ),
  )
}

it.live("native legacy relocation applies the exact preview without switching backend or calling a model", () =>
  fixture(
    (session, paths) =>
      Effect.gen(function* () {
        const operations = yield* SessionMemoryOperation.Service
        const modes = yield* SessionMemoryModeNative.Service
        const locations = yield* LocationServiceMap.Service
        const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
        expect(location.project.id).not.toBe("global")
        const source = WorkspaceMemory.file(paths.directory, paths.home)
        yield* Effect.promise(() => mkdir(path.dirname(source), { recursive: true }))
        yield* Effect.promise(() => Bun.write(source, "# Memory\n\nRetained old workspace knowledge"))
        yield* modes.set(session.id, { memory_v2: { enabled: false } }, true, false)
        const preview = yield* operations.previewMigration(session.id, { kind: "relocation", scope: "workspace" })
        expect(preview.available).toBe(true)
        const id = MemoryOperation.ID.create()
        yield* operations.migrate(session.id, { id, preview })
        expect((yield* settled(operations, session, id)).result?.status).toBe("completed")
        expect((yield* modes.get(session.id, settings)).backend).toBe("legacy")
        const target = WorkspaceMemory.file(paths.directory, paths.home, { projectID: location.project.id })
        expect(yield* Effect.promise(() => Bun.file(target).text())).toContain("Retained old workspace knowledge")
        expect(yield* Effect.promise(() => Bun.file(source).text())).toBe(
          "# Memory\n\nRetained old workspace knowledge",
        )
        const llm = yield* TestLLMServer
        expect(yield* llm.calls).toBe(0)
      }),
    false,
    { enabled: false },
  ),
)

it.live("explicit native recovery discards a deleted Session's released plan without inference", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const database = yield* Database.Service
      const operations = yield* SessionMemoryOperation.Service
      const locations = yield* LocationServiceMap.Service
      const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
      yield* enable(session.id)
      const original = yield* sessions.create({
        location: session.location,
        agent: AgentV2.ID.make("build"),
        model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
      })
      const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id }, { recover: false })
      yield* store.remember("Preserved original observation", () => true)
      const lease = (yield* store.dreamClaim(
        {
          owner: "original-deleted",
          now: Date.now(),
          duration: 300000,
          ownership: "explicit",
          provenance: MemoryConsolidation.provenance({
            sessionID: original.id,
            createdEventID: (yield* SessionIncarnation.created(database.db, original.id))!,
            operationID: "original-operation",
            scope: store.root.path,
          }),
        },
        () => true,
      ))!
      const input = yield* store.dreamInput(lease, Date.now(), () => true)
      yield* store.dreamPrepare(
        lease,
        [
          {
            action: "create",
            path: "topics/orphan.md",
            content: "Must never replay",
            evidence: input.observations.map((value) => value.path),
          },
        ],
        Date.now(),
        () => true,
      )
      yield* store.dreamRelease(lease, Date.now())
      yield* sessions.remove(original.id)
      const preview = yield* operations.previewRecovery(session.id, { action: "discard", scope: "workspace" })
      expect(preview.available).toBe(true)
      const id = MemoryOperation.ID.create()
      yield* operations.recover(session.id, { id, preview })
      expect((yield* settled(operations, session, id)).result).toMatchObject({ status: "completed", committed: true })
      expect((yield* operations.recover(session.id, { id, preview })).state).toBe("finished")
      expect((yield* store.previewNote("topics/orphan.md", () => true).pipe(Effect.result))._tag).toBe("Failure")
      expect((yield* store.listNotes("Preserved", () => true)).length).toBe(1)
      const llm = yield* TestLLMServer
      expect(yield* llm.calls).toBe(0)
    }),
  ),
)

it.live("native clear receipts survive exact retry and reject a replaced operator", () =>
  fixture((session, paths) =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const operations = yield* SessionMemoryOperation.Service
      const locations = yield* LocationServiceMap.Service
      const location = yield* Location.Service.pipe(Effect.provide(locations.get(session.location)))
      yield* enable(session.id)
      const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id }, { recover: false })
      yield* store.remember("Clear this observation", () => true)
      const preview = yield* operations.previewRecovery(session.id, { action: "clear", scope: "workspace" })
      const id = MemoryOperation.ID.create()
      yield* operations.recover(session.id, { id, preview })
      expect((yield* settled(operations, session, id)).result).toMatchObject({ status: "completed", committed: true })
      const generation = yield* store.revision
      expect((yield* operations.recover(session.id, { id, preview })).state).toBe("finished")
      const freshNote = yield* store.remember("New note after committed clear", () => true)
      const retryID = MemoryOperation.ID.create()
      yield* operations.retry(session.id, { id: retryID, retryOf: id })
      expect((yield* settled(operations, session, retryID)).result).toMatchObject({
        status: "completed",
        committed: true,
      })
      expect((yield* operations.retry(session.id, { id: retryID, retryOf: id })).state).toBe("finished")
      expect(yield* Effect.promise(() => Bun.file(freshNote.path).exists())).toBe(true)
      expect(yield* store.revision).toBe(generation)
      const stranger = yield* sessions.create({ location: session.location })
      const denied = yield* operations
        .retry(stranger.id, { id: MemoryOperation.ID.create(), retryOf: id })
        .pipe(Effect.result)
      expect(denied._tag).toBe("Failure")
      if (denied._tag === "Failure") expect(denied.failure.code).toBe("missing")
      yield* sessions.remove(session.id)
      const replacement = yield* sessions.create({
        id: session.id,
        location: session.location,
        agent: AgentV2.ID.make("build"),
        model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
      })
      yield* enable(replacement.id)
      const staleRetry = yield* operations
        .retry(replacement.id, { id: MemoryOperation.ID.create(), retryOf: id })
        .pipe(Effect.result)
      expect(staleRetry._tag).toBe("Failure")
      if (staleRetry._tag === "Failure") expect(staleRetry.failure.code).toBe("missing")
      yield* store.remember("New incarnation observation", () => true)
      const fresh = yield* operations.previewRecovery(replacement.id, { action: "clear", scope: "workspace" })
      yield* operations.recover(replacement.id, { id, preview: fresh })
      expect((yield* settled(operations, replacement, id)).result?.status).toBe("failed")
      expect(yield* store.revision).toBe(generation)
      expect((yield* store.listNotes("New incarnation", () => true)).length).toBe(1)
      const llm = yield* TestLLMServer
      expect(yield* llm.calls).toBe(0)
    }),
  ),
)

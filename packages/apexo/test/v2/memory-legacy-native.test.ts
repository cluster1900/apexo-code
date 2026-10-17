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
import { SessionTable } from "@apexo/core/session/sql"
import { eq } from "drizzle-orm"
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
  "legacy explicit flush persists Markdown once and passive/exact reads never sample",
  () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const llm = yield* TestLLMServer
        yield* llm.text("The otter deployment uses port 4173.")
        yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "Remember the otter deployment uses port 4173." },
        })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        yield* llm.text("## Otter deployment\n\nThe deployment uses port 4173.")
        const id = MemoryOperation.ID.create()
        const admitted = yield* operations.start(session.id, { id })
        expect(admitted.backend).toBe("legacy")
        const done = yield* settled(operations, session, id)
        expect(done.result?.status).toBe("completed")
        expect(yield* llm.calls).toBe(2)
        expect((yield* operations.start(session.id, { id })).result).toEqual(done.result)
        expect((yield* operations.list(session.id)).length).toBe(1)
        const retry = MemoryOperation.ID.create()
        yield* operations.retry(session.id, { id: retry, retryOf: id })
        expect((yield* settled(operations, session, retry)).result?.processed).toBe(0)
        expect(yield* llm.calls).toBe(2)
        const next = MemoryOperation.ID.create()
        yield* operations.start(session.id, { id: next })
        expect((yield* settled(operations, session, next)).result?.processed).toBe(0)
        expect(yield* llm.calls).toBe(2)
        const file = yield* local(
          session,
          Effect.gen(function* () {
            const location = yield* Location.Service
            return WorkspaceMemory.file(paths.directory, paths.home, { projectID: location.project.id })
          }),
        )
        const files = yield* Effect.promise(() => readdir(path.join(path.dirname(file), "sessions")))
        const saved = yield* Effect.promise(() =>
          readFile(path.join(path.dirname(file), "sessions", files[0]!), "utf8"),
        )
        expect(saved).toContain("port 4173")
        expect(saved.match(/## Otter deployment/g)).toHaveLength(1)
        expect((yield* llm.hits).at(-1)!.body.tools ?? []).toEqual([])
      }),
    ),
  30000,
)

it.live(
  "legacy exact captured plan retains source and rejects mode, authority and clear changes",
  () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const store = yield* SessionStore.Service
        const modes = yield* SessionMemoryModeNative.Service
        const llm = yield* TestLLMServer
        yield* llm.text("Original fact only.")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Original durable project fact is otter." } })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        yield* local(
          session,
          Effect.gen(function* () {
            const memory = yield* MemoryLifecycleNative.Service
            const prepared = yield* memory.prepareFlush(session.id)
            const plan = yield* Schema.decodeUnknownEffect(MemoryLegacyNative.Plan)(prepared)
            yield* store.setPermissions({
              sessionID: session.id,
              permissions: [{ permission: "edit", pattern: "*", action: "deny" }],
            })
            expect((yield* memory.executeLegacy(plan).pipe(Effect.result))._tag).toBe("Failure")
            expect(yield* llm.calls).toBe(1)
            yield* store.setPermissions({ sessionID: session.id, permissions: [] })
            const location = yield* Location.Service
            yield* Effect.promise(() =>
              MemoryMaintenance.clear(
                WorkspaceMemory.maintenance(paths.directory, paths.home, { projectID: location.project.id }),
                "workspace",
                true,
              ),
            )
            expect((yield* memory.executeLegacy(plan).pipe(Effect.result))._tag).toBe("Failure")
            expect(yield* llm.calls).toBe(1)
            const fresh = yield* Schema.decodeUnknownEffect(MemoryLegacyNative.Plan)(
              yield* memory.prepareFlush(session.id),
            )
            yield* modes.set(session.id, settings, false, false)
            expect((yield* memory.executeLegacy(fresh).pipe(Effect.result))._tag).toBe("Failure")
            expect(yield* llm.calls).toBe(1)
          }),
        )
      }),
    ),
  30000,
)

it.live(
  "legacy recall is passive, epoch-stable and removes revoked content",
  () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        const store = yield* SessionStore.Service
        yield* enable(session.id)
        yield* local(
          session,
          Effect.gen(function* () {
            const location = yield* Location.Service
            const memory = yield* MemoryContextNative.Service
            const file = WorkspaceMemory.file(paths.directory, paths.home, { projectID: location.project.id })
            yield* Effect.promise(() => mkdir(path.dirname(file), { recursive: true }))
            yield* Effect.promise(() =>
              Bun.write(file, "# Project conventions\n\nProject architecture prefers otter deployment conventions.\n"),
            )
            const first = yield* SystemContext.initialize(yield* memory.load(session.id, AgentV2.ID.make("build")))
            expect(first.baseline).toContain("otter deployment")
            yield* Effect.promise(() =>
              Bun.write(file, "# Project conventions\n\nProject architecture uses seal deployment conventions.\n"),
            )
            const next = yield* SystemContext.initialize(yield* memory.load(session.id, AgentV2.ID.make("build")))
            expect(next.baseline).toEqual(first.baseline)
            yield* store.setPermissions({
              sessionID: session.id,
              permissions: [{ permission: "read", pattern: "*", action: "deny" }],
            })
            const removed = yield* SystemContext.reconcile(
              yield* memory.load(session.id, AgentV2.ID.make("build")),
              first.snapshot,
            )
            expect(JSON.stringify(removed)).not.toContain("otter deployment")
            expect(JSON.stringify(removed)).toContain("no longer available")
            expect(yield* llm.calls).toBe(0)
          }),
        )
      }),
    ),
  30000,
)

it.live(
  "legacy retry uses the original captured source after later user turns",
  () =>
    fixture((session) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const llm = yield* TestLLMServer
        yield* llm.text("Original settled fact.")
        yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "ORIGINAL_CAPTURE_FACT otter deploys on 4173." },
        })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        yield* llm.error(400, { error: { message: "fixture failure" } })
        const id = MemoryOperation.ID.create()
        yield* operations.start(session.id, { id })
        expect((yield* settled(operations, session, id)).result?.status).toBe("failed")
        yield* llm.text("Later settled fact.")
        yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "LATER_UNRELATED_FACT seal deploys on 8222." },
        })
        yield* sessions.wait(session.id)
        yield* llm.text("## Original fact\nOtter deploys on 4173.")
        const retry = MemoryOperation.ID.create()
        yield* operations.retry(session.id, { id: retry, retryOf: id })
        expect((yield* settled(operations, session, retry)).result?.status).toBe("completed")
        const request = JSON.stringify((yield* llm.hits).at(-1)!.body)
        expect(request).toContain("ORIGINAL_CAPTURE_FACT")
        expect(request).not.toContain("LATER_UNRELATED_FACT")
        expect(yield* llm.calls).toBe(4)
      }),
    ),
  30000,
)

it.live(
  "legacy flush cancellation joins a held provider and does not publish",
  () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const llm = yield* TestLLMServer
        yield* llm.text("Settled fact for cancel.")
        yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "Remember the project uses otter queue semantics." },
        })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        const release = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
        yield* llm.hold("## Never publish\nHELD_CANCELLED_MEMORY", release.promise)
        const id = MemoryOperation.ID.create()
        yield* operations.start(session.id, { id })
        yield* llm.wait(2)
        expect((yield* operations.cancel(session.id, id)).result?.status).toBe("cancelled")
        release.resolve()
        const files = yield* local(
          session,
          Effect.gen(function* () {
            const location = yield* Location.Service
            const file = WorkspaceMemory.file(paths.directory, paths.home, { projectID: location.project.id })
            return yield* Effect.promise(() =>
              readdir(path.join(path.dirname(file), "sessions")).catch((cause: unknown) => {
                if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") return []
                throw cause
              }),
            )
          }),
        )
        expect(files).toEqual([])
        expect(yield* llm.calls).toBe(2)
      }),
    ),
  30000,
)

it.live(
  "legacy recall refreshes at real compaction without a flush provider call",
  () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const llm = yield* TestLLMServer
        yield* llm.text("First source " + "old context ".repeat(6000))
        yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "Project otter deployment conventions use blue queue." },
        })
        yield* sessions.wait(session.id)
        yield* llm.text("Second source " + "new context ".repeat(6000))
        yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "Project otter deployment conventions use blue queue, confirm it." },
        })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        const baseline = yield* local(
          session,
          Effect.gen(function* () {
            const location = yield* Location.Service
            const memory = yield* MemoryContextNative.Service
            const file = WorkspaceMemory.file(paths.directory, paths.home, { projectID: location.project.id })
            yield* Effect.promise(() => mkdir(path.dirname(file), { recursive: true }))
            yield* Effect.promise(() =>
              Bun.write(file, "# Project otter deployment\n\nProject otter deployment conventions use blue queue.\n"),
            )
            const before = yield* SystemContext.initialize(yield* memory.load(session.id))
            yield* Effect.promise(() =>
              Bun.write(
                file,
                "# Project otter deployment\n\nProject otter deployment conventions now use green queue.\n",
              ),
            )
            return before.baseline
          }),
        )
        expect(baseline).toContain("blue queue")
        yield* llm.text("## Objective\nContinue project.\n## Important Details\nKeep otter deployment conventions.")
        yield* sessions.compact({ sessionID: session.id })
        const after = yield* local(
          session,
          MemoryContextNative.Service.use((memory) =>
            memory.load(session.id).pipe(Effect.flatMap(SystemContext.initialize)),
          ),
        )
        expect(after.baseline).toContain("green queue")
        expect(after.baseline).not.toContain("blue queue")
        expect(yield* llm.calls).toBe(3)
      }),
    ),
  30000,
)

it.live(
  "legacy captured plan rejects a replaced Created identity without transmission",
  () =>
    fixture((session) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const llm = yield* TestLLMServer
        yield* llm.text("A settled source.")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Remember immutable project identity." } })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        const plan = yield* local(
          session,
          MemoryLifecycleNative.Service.use((memory) =>
            memory.prepareFlush(session.id).pipe(Effect.flatMap(Schema.decodeUnknownEffect(MemoryLegacyNative.Plan))),
          ),
        )
        yield* sessions.remove(session.id)
        yield* sessions.create({
          id: session.id,
          location: session.location,
          agent: session.agent,
          model: session.model,
        })
        yield* enable(session.id)
        const modes = yield* SessionMemoryModeNative.Service
        const replacement = yield* modes.get(session.id, settings)
        const result = yield* local(
          session,
          MemoryLifecycleNative.Service.use((memory) =>
            memory.executeLegacy({ ...plan, revision: replacement.revision }),
          ),
        ).pipe(Effect.result)
        expect(result._tag).toBe("Failure")
        expect(yield* llm.calls).toBe(1)
      }),
    ),
  30000,
)

it.live(
  "legacy NO_REPLY receipts deduplicate and Unicode output respects the captured limit",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const llm = yield* TestLLMServer
          yield* llm.text("A settled source.")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Remember the Unicode project convention." },
          })
          yield* sessions.wait(session.id)
          yield* enable(session.id)
          yield* local(
            session,
            Effect.gen(function* () {
              const memory = yield* MemoryLifecycleNative.Service
              const plan = yield* Schema.decodeUnknownEffect(MemoryLegacyNative.Plan)(
                yield* memory.prepareFlush(session.id),
              )
              yield* llm.text("NO_REPLY")
              expect((yield* memory.executeLegacy(plan)).status).toBe("no_work")
              expect((yield* memory.executeLegacy(plan)).processed).toBe(0)
              expect(yield* llm.calls).toBe(2)
            }),
          )
          yield* llm.text("A second source.")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "The new project convention includes emoji." },
          })
          yield* sessions.wait(session.id)
          yield* local(
            session,
            Effect.gen(function* () {
              const memory = yield* MemoryLifecycleNative.Service
              const plan = yield* Schema.decodeUnknownEffect(MemoryLegacyNative.Plan)(
                yield* memory.prepareFlush(session.id),
              )
              yield* llm.text("## " + "😀".repeat(30))
              expect((yield* memory.executeLegacy(plan)).status).toBe("completed")
              const location = yield* Location.Service
              const file = MemorySession.file(
                paths.directory,
                { sessionID: `${session.id}-flush`, captured: plan.flush.captured, content: "" },
                paths.home,
                { projectID: location.project.id },
              )
              const saved = yield* Effect.promise(() => readFile(file, "utf8"))
              expect(saved).toContain("## " + "😀".repeat(5))
              expect(saved).not.toContain("😀".repeat(6))
              expect(saved).not.toContain("�")
            }),
          )
          expect((yield* llm.hits).at(-1)!.body.model).toBe("memory-model")
          expect(yield* llm.calls).toBe(4)
        }),
      false,
      { flush_model: "fixture/memory-model", max_flush_write_chars: 8 },
    ),
  30000,
)

const metadataSource = Effect.fnUntraced(function* (session: SessionV2.Info, count = 3) {
  const sessions = yield* SessionV2.Service
  const llm = yield* TestLLMServer
  for (let index = 0; index < count; index++) {
    yield* llm.text(`Settled project source ${index}.`)
    yield* sessions.prompt({
      sessionID: session.id,
      prompt: { text: `Project convention ${index}: preserve immutable deployment identifiers 😀.` },
    })
    yield* sessions.wait(session.id)
  }
})
const savedMetadata = (session: SessionV2.Info, paths: { directory: string; home: string }) =>
  local(
    session,
    Effect.gen(function* () {
      const location = yield* Location.Service
      const directory = path.join(
        path.dirname(WorkspaceMemory.file(paths.directory, paths.home, { projectID: location.project.id })),
        "sessions",
      )
      const files = yield* Effect.promise(() =>
        readdir(directory).catch((cause: unknown) => {
          if (MemoryFiles.missing(cause)) return []
          throw cause
        }),
      )
      const file = files.find((file) => file.endsWith(`-${session.id}.md`))
      if (!file) return
      const target = path.join(directory, file)
      return {
        file: target,
        content: yield* Effect.promise(() => readFile(target, "utf8")),
        modified: (yield* Effect.promise(() => stat(target))).mtimeMs,
      }
    }),
  )

it.live(
  "legacy activity metadata gates real prompts and repeated checkpoints do not write",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          const events = yield* EventV2.Service
          yield* metadataSource(session, 2)
          expect(yield* savedMetadata(session, paths)).toBeUndefined()
          yield* events.publish(
            SessionEvent.Synthetic,
            {
              sessionID: session.id,
              messageID: SessionMessage.ID.create(),
              timestamp: DateTime.nowUnsafe(),
              text: "SYNTHETIC_TOPIC_SHOULD_NOT_COUNT",
            },
            { location: session.location },
          )
          yield* operations.checkpoint(session.id)
          expect(yield* savedMetadata(session, paths)).toBeUndefined()
          yield* metadataSource(session, 1)
          const first = yield* savedMetadata(session, paths)
          expect(first?.content).toContain("3 user, 3 assistant, 0 tool results")
          expect(first?.content).toContain("😀")
          expect(first?.content).not.toContain("SYNTHETIC_TOPIC")
          yield* operations.capture(session.id)
          yield* operations.checkpoint(session.id)
          expect(yield* savedMetadata(session, paths)).toEqual(first)
          expect(yield* llm.calls).toBe(3)
          expect(yield* operations.list(session.id)).toEqual([])
        }),
      true,
    ),
  30000,
)

it.live(
  "legacy save_on_end false suppresses activity metadata without an auxiliary request",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          yield* metadataSource(session)
          yield* operations.checkpoint(session.id)
          expect(yield* savedMetadata(session, paths)).toBeUndefined()
          expect(yield* llm.calls).toBe(3)
        }),
      true,
      {},
      { session: { save_on_end: false } },
    ),
  30000,
)

it.live(
  "legacy metadata uses actual settled stopped tool state without auxiliary inference",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const llm = yield* TestLLMServer
          yield* metadataSource(session, 2)
          yield* llm.tool("bash", {
            command: `printf ready > metadata-tool-started; while :; do sleep 1; done`,
            description: "Wait for metadata cancellation",
          })
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Run the held tool to verify metadata checkpoint cancellation joins." },
          })
          yield* pollWithTimeout(
            Effect.promise(() => Bun.file(path.join(paths.directory, "metadata-tool-started")).exists()).pipe(
              Effect.map((ready) => ready || undefined),
            ),
            "Metadata tool did not start",
            "10 seconds",
          )
          expect(yield* savedMetadata(session, paths)).toBeUndefined()
          yield* sessions.interrupt(session.id)
          const saved = yield* savedMetadata(session, paths)
          expect(saved?.content).toContain("3 user, 3 assistant, 1 tool results")
          expect(yield* llm.calls).toBe(3)
        }),
      true,
    ),
  30000,
)

it.live(
  "legacy metadata captures source and authority then rejects revoked, cleared and replaced identities",
  () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const store = yield* SessionStore.Service
        const modes = yield* SessionMemoryModeNative.Service
        const llm = yield* TestLLMServer
        yield* metadataSource(session)
        yield* enable(session.id)
        yield* local(
          session,
          Effect.gen(function* () {
            const memory = yield* MemoryLifecycleNative.Service
            const plan = yield* memory.prepareCheckpoint(session.id)
            expect(plan).toBeDefined()
            if (!plan) return
            yield* store.setPermissions({
              sessionID: session.id,
              permissions: [{ permission: "edit", pattern: "*", action: "deny" }],
            })
            expect((yield* memory.executeCheckpoint(plan).pipe(Effect.result))._tag).toBe("Failure")
            yield* store.setPermissions({ sessionID: session.id, permissions: [] })
            const location = yield* Location.Service
            yield* Effect.promise(() =>
              MemoryMaintenance.clear(
                WorkspaceMemory.maintenance(paths.directory, paths.home, { projectID: location.project.id }),
                "workspace",
                true,
              ),
            )
            expect((yield* memory.executeCheckpoint(plan).pipe(Effect.result))._tag).toBe("Failure")
            const fresh = yield* memory.prepareCheckpoint(session.id)
            expect(fresh).toBeDefined()
            if (!fresh) return
            yield* sessions.remove(session.id)
            yield* sessions.create({
              id: session.id,
              location: session.location,
              agent: session.agent,
              model: session.model,
            })
            yield* enable(session.id)
            const replacement = yield* modes.get(session.id, settings)
            expect(
              (yield* memory.executeCheckpoint({ ...fresh, revision: replacement.revision }).pipe(Effect.result))._tag,
            ).toBe("Failure")
          }),
        )
        expect(yield* savedMetadata(session, paths)).toBeUndefined()
        expect(yield* llm.calls).toBe(3)
      }),
    ),
  30000,
)

for (const change of ["deny", "ask", "disable", "delete", "cancel", "clear"] as const) {
  it.live(
    `legacy metadata ${change} while storage is locked cannot publish late`,
    () =>
      fixture((session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const store = yield* SessionStore.Service
          const modes = yield* SessionMemoryModeNative.Service
          const llm = yield* TestLLMServer
          yield* metadataSource(session)
          yield* enable(session.id)
          yield* local(
            session,
            Effect.gen(function* () {
              const memory = yield* MemoryLifecycleNative.Service
              const location = yield* Location.Service
              const plan = yield* memory.prepareCheckpoint(session.id)
              expect(plan).toBeDefined()
              if (!plan) return
              const home = yield* Effect.promise(() => realpath(paths.home))
              const scope = WorkspaceMemory.maintenance(paths.directory, home, { projectID: location.project.id })
              const lock = yield* Effect.promise(() =>
                Flock.acquire(scope.root, { dir: path.join(home, ".grok", "memory", ".locks") }),
              )
              const state = { released: false }
              const release = Effect.promise(async () => {
                if (state.released) return
                state.released = true
                await lock.release()
              })
              yield* Effect.addFinalizer(() => release)
              const writing = yield* memory.executeCheckpoint(plan).pipe(Effect.forkChild)
              yield* Effect.yieldNow
              expect(writing.pollUnsafe()).toBeUndefined()
              if (change === "deny" || change === "ask")
                yield* store.setPermissions({
                  sessionID: session.id,
                  permissions: [{ permission: "edit", pattern: "*", action: change }],
                })
              if (change === "disable") yield* modes.set(session.id, settings, false, false)
              if (change === "delete") yield* sessions.remove(session.id)
              if (change === "cancel") yield* Fiber.interrupt(writing)
              const clearing =
                change === "clear"
                  ? yield* Effect.promise(() => MemoryMaintenance.clear(scope, "workspace", true)).pipe(
                      Effect.forkChild,
                    )
                  : undefined
              yield* release
              const done = yield* Fiber.await(writing)
              if (clearing) yield* Fiber.join(clearing)
              if (change !== "clear") expect(done._tag).toBe("Failure")
              if (change === "delete") {
                const files = yield* Effect.promise(() =>
                  readdir(path.join(scope.root, "sessions")).catch((cause: unknown) => {
                    if (MemoryFiles.missing(cause)) return []
                    throw cause
                  }),
                )
                expect(files).toEqual([])
              }
            }),
          )
          if (change !== "delete") expect(yield* savedMetadata(session, paths)).toBeUndefined()
          expect(yield* llm.calls).toBe(3)
        }),
      ),
    30000,
  )
}

it.live(
  "legacy metadata keeps chronological source counts across actual compaction",
  () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const llm = yield* TestLLMServer
        for (const topic of ["FIRST_METADATA_TOPIC", "SECOND_METADATA_TOPIC", "THIRD_METADATA_TOPIC"]) {
          yield* llm.text("Settled details " + "long context ".repeat(5000))
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: `${topic} preserves project deployment conventions.` },
          })
          yield* sessions.wait(session.id)
        }
        yield* enable(session.id)
        yield* llm.text(
          "## Objective\nContinue project.\n## Important Details\nUse the captured deployment convention.",
        )
        yield* sessions.compact({ sessionID: session.id })
        const first = yield* savedMetadata(session, paths)
        expect(first?.content).toContain("3 user, 3 assistant, 0 tool results")
        expect(first?.content).toContain("1. FIRST_METADATA_TOPIC")
        expect(first?.content).toContain("3. THIRD_METADATA_TOPIC")
        yield* operations.checkpoint(session.id)
        expect(yield* savedMetadata(session, paths)).toEqual(first)
        expect(yield* llm.calls).toBe(4)
      }),
    ),
  30000,
)

it.live(
  "legacy metadata byte gate stays passive until real user content is sufficient",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const llm = yield* TestLLMServer
          for (const text of ["x", "y", "z", "__auto_continue__"]) {
            yield* llm.text("Done.")
            yield* sessions.prompt({ sessionID: session.id, prompt: { text } })
            yield* sessions.wait(session.id)
          }
          expect(yield* savedMetadata(session, paths)).toBeUndefined()
          yield* metadataSource(session, 1)
          const saved = yield* savedMetadata(session, paths)
          expect(saved?.content).toContain("4 user, 5 assistant, 0 tool results")
          expect(saved?.content).not.toContain("__auto_continue__")
          expect(yield* llm.calls).toBe(5)
        }),
      true,
    ),
  30000,
)

it.live(
  "legacy older metadata watermark cannot overwrite a later activity checkpoint",
  () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        yield* metadataSource(session)
        yield* enable(session.id)
        const plan = yield* local(
          session,
          MemoryLifecycleNative.Service.use((memory) => memory.prepareCheckpoint(session.id)),
        )
        expect(plan).toBeDefined()
        if (!plan) return
        yield* metadataSource(session, 1)
        const latest = yield* savedMetadata(session, paths)
        expect(latest?.content).toContain("4 user, 4 assistant, 0 tool results")
        expect(
          yield* local(
            session,
            MemoryLifecycleNative.Service.use((memory) => memory.executeCheckpoint(plan)),
          ),
        ).toBe(false)
        expect(yield* savedMetadata(session, paths)).toEqual(latest)
        expect(yield* llm.calls).toBe(4)
      }),
    ),
  30000,
)

it.live(
  "automatic legacy idle flush uses the owned timer and exact prompt retries preserve its epoch",
  () =>
    fixture(
      (session) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const lifecycle = yield* SessionLifecycle.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          const id = SessionMessage.ID.create()
          const prompt = { text: "The project uses the otter queue with bounded retry ownership." }
          yield* llm.text("Use the otter queue for bounded retries.")
          const original = yield* sessions.prompt({ sessionID: session.id, id, prompt })
          yield* sessions.wait(session.id)
          const claim = yield* lifecycle.capture(session.id)
          const epoch = yield* operations.beginAutomaticActivity(claim)
          const retry = yield* sessions.prompt({ sessionID: session.id, id, prompt })
          expect(retry.admittedSeq).toBe(original.admittedSeq)
          yield* llm.text("## Queue\nUse the otter queue with bounded retries.")
          yield* operations.armAutomaticIdle(epoch, { settled: Effect.void, idle: Effect.succeed(true) })
          yield* llm.wait(2)
          const receipt = yield* pollWithTimeout(
            operations.list(session.id).pipe(Effect.map((items) => items.find((item) => item.state === "finished"))),
            "automatic flush did not settle",
            "10 seconds",
          )
          expect(receipt.result?.status).toBe("completed")
          expect(yield* llm.calls).toBe(2)
          expect(JSON.stringify((yield* llm.hits)[1]!.body.system ?? (yield* llm.hits)[1]!.body.messages)).toContain(
            "memory assistant",
          )
        }),
      true,
      { idle_timeout_secs: 1 },
    ),
  30000,
)

it.live(
  "admit-only prompt cancels and joins a running automatic legacy flush",
  () =>
    fixture(
      (session) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          yield* llm.text("Retain the project queue ownership convention.")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Use bounded queue ownership for every retry in this project." },
          })
          yield* sessions.wait(session.id)
          const release = Promise.withResolvers<void>()
          yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
          yield* llm.hold("## Cancelled\nThis automatic result must never publish.", release.promise)
          yield* llm.wait(2)
          const running = (yield* operations.list(session.id))[0]!
          expect(running.state).toBe("running")
          const admitted = yield* sessions.prompt({
            sessionID: session.id,
            resume: false,
            prompt: { text: "Admit this new instruction without executing a provider turn." },
          })
          expect(admitted.promotedSeq).toBeUndefined()
          expect((yield* operations.get(session.id, running.id)).result?.status).toBe("cancelled")
          release.resolve()
          expect(yield* llm.calls).toBe(2)
        }),
      true,
      { idle_timeout_secs: 1 },
    ),
  30000,
)

it.live(
  "admit-only prompt suppresses an armed idle timer without a provider wake",
  () =>
    fixture(
      (session) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          yield* llm.text("The deployment convention is an otter queue.")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Retain the deployment convention for this workspace." },
          })
          yield* sessions.wait(session.id)
          yield* sessions.prompt({
            sessionID: session.id,
            resume: false,
            prompt: { text: "Pending instruction must suppress automatic work." },
          })
          yield* Effect.sleep(1300)
          expect(yield* llm.calls).toBe(1)
          expect(yield* operations.list(session.id)).toEqual([])
        }),
      true,
      { idle_timeout_secs: 1 },
    ),
  30000,
)

it.live(
  "idle Session Stop remains a no-op for an automatic Memory operation",
  () =>
    fixture(
      (session) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          yield* llm.text("Use bounded queue ownership for project operations.")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Retain bounded queue ownership for project operations." },
          })
          yield* sessions.wait(session.id)
          const release = Promise.withResolvers<void>()
          yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
          yield* llm.hold("## Queue\nUse bounded ownership.", release.promise)
          yield* llm.wait(2)
          const receipt = (yield* operations.list(session.id))[0]!
          yield* sessions.interrupt(session.id)
          expect((yield* operations.get(session.id, receipt.id)).state).toBe("running")
          expect((yield* operations.cancel(session.id, receipt.id)).result?.status).toBe("cancelled")
          release.resolve()
        }),
      true,
      { idle_timeout_secs: 1 },
    ),
  30000,
)

for (const threshold of [0, 100000]) {
  it.live(
    `automatic pre-compaction flush applies actual request headroom ${threshold}`,
    () =>
      fixture(
        (session) =>
          Effect.gen(function* () {
            const sessions = yield* SessionV2.Service
            const operations = yield* SessionMemoryOperation.Service
            const llm = yield* TestLLMServer
            for (const topic of ["FIRST_COMPACTION_SOURCE", "SECOND_COMPACTION_SOURCE"]) {
              yield* llm.text("Preserve this project convention " + "context ".repeat(6000))
              yield* sessions.prompt({ sessionID: session.id, prompt: { text: `${topic} uses bounded ownership.` } })
              yield* sessions.wait(session.id)
            }
            yield* llm.textMatch(
              (hit) => JSON.stringify(hit.body.messages).includes("memory assistant"),
              "## Ownership\nUse the captured bounded ownership convention.",
            )
            yield* llm.textMatch(
              (hit) => !JSON.stringify(hit.body.messages).includes("memory assistant"),
              "## Objective\nContinue.\n## Important Details\nKeep bounded ownership.",
            )
            yield* sessions.compact({ sessionID: session.id })
            if (threshold === 0) {
              expect(yield* operations.list(session.id)).toEqual([])
              expect(yield* llm.calls).toBe(3)
              return
            }
            const receipt = yield* pollWithTimeout(
              operations.list(session.id).pipe(Effect.map((items) => items.find((item) => item.state === "finished"))),
              "pre-compaction flush did not settle",
              "10 seconds",
            )
            expect(receipt.result?.status).toBe("completed")
            const flush = (yield* llm.hits).find((hit) =>
              JSON.stringify(hit.body.messages).includes("memory assistant"),
            )
            expect(JSON.stringify(flush?.body.messages)).toContain("FIRST_COMPACTION_SOURCE")
            expect(JSON.stringify(flush?.body.messages)).toContain("SECOND_COMPACTION_SOURCE")
            expect(yield* llm.calls).toBe(4)
          }),
        true,
        { idle_timeout_secs: 0, soft_threshold_tokens: threshold },
      ),
    30000,
  )
}

it.live(
  "accepted Stop joins compaction and its automatic legacy flush without publication",
  () =>
    fixture(
      (session) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          for (const topic of ["FIRST_STOP_SOURCE", "SECOND_STOP_SOURCE"]) {
            yield* llm.text("Settled source " + "context ".repeat(6000))
            yield* sessions.prompt({
              sessionID: session.id,
              prompt: { text: `${topic} keeps bounded lifecycle ownership.` },
            })
            yield* sessions.wait(session.id)
          }
          const release = Promise.withResolvers<void>()
          yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
          yield* llm.pushMatch(
            (hit) => JSON.stringify(hit.body.messages).includes("memory assistant"),
            reply().text("## Cancelled\nNever publish.").wait(release.promise).stop(),
          )
          yield* llm.pushMatch(
            (hit) => !JSON.stringify(hit.body.messages).includes("memory assistant"),
            reply().text("## Objective\nCancelled summary.").wait(release.promise).stop(),
          )
          const compacting = yield* sessions.compact({ sessionID: session.id }).pipe(Effect.forkChild)
          yield* llm.wait(4)
          const receipt = (yield* operations.list(session.id))[0]!
          expect(receipt.state).toBe("running")
          yield* sessions.interrupt(session.id)
          expect((yield* Fiber.await(compacting))._tag).toBe("Failure")
          expect((yield* operations.get(session.id, receipt.id)).result?.status).toBe("cancelled")
          release.resolve()
          expect(yield* llm.calls).toBe(4)
        }),
      true,
      { idle_timeout_secs: 0, soft_threshold_tokens: 100000 },
    ),
  30000,
)

it.live(
  "durable prompt admission wins a held fence before final idle registration",
  () =>
    fixture(
      (session) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const admission = yield* SessionInputAdmission.Service
          const lifecycle = yield* SessionLifecycle.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          yield* llm.text("A bounded queue is the project convention.")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Retain the bounded queue convention for the project." },
          })
          yield* sessions.wait(session.id)
          const claim = yield* lifecycle.capture(session.id)
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const holder = yield* admission
            .fence(claim, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))
            .pipe(Effect.forkChild)
          yield* Deferred.await(entered)
          const prompting = yield* sessions
            .prompt({
              sessionID: session.id,
              resume: false,
              prompt: { text: "This admitted input must fence automatic inference." },
            })
            .pipe(Effect.forkChild)
          yield* Effect.yieldNow
          yield* Effect.sleep(1300)
          expect(prompting.pollUnsafe()).toBeUndefined()
          expect(yield* llm.calls).toBe(1)
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(holder)
          const accepted = yield* Fiber.join(prompting)
          expect(accepted.promotedSeq).toBeUndefined()
          expect(yield* operations.list(session.id)).toEqual([])
          expect(yield* llm.calls).toBe(1)
        }),
      true,
      { idle_timeout_secs: 1 },
    ),
  30000,
)

for (const change of ["disable", "deny", "clear", "delete"] as const) {
  it.live(
    `automatic idle source is invalidated by ${change} before provider admission`,
    () =>
      fixture(
        (session, paths) =>
          Effect.gen(function* () {
            const sessions = yield* SessionV2.Service
            const store = yield* SessionStore.Service
            const modes = yield* SessionMemoryModeNative.Service
            const operations = yield* SessionMemoryOperation.Service
            const llm = yield* TestLLMServer
            yield* llm.text("Retain bounded retry ownership.")
            yield* sessions.prompt({
              sessionID: session.id,
              prompt: { text: "Retain bounded retry ownership for the project queue." },
            })
            yield* sessions.wait(session.id)
            if (change === "disable") yield* modes.set(session.id, settings, false, false)
            if (change === "deny")
              yield* store.setPermissions({
                sessionID: session.id,
                permissions: [{ permission: "edit", pattern: "*", action: "deny" }],
              })
            if (change === "clear")
              yield* local(
                session,
                Effect.gen(function* () {
                  const location = yield* Location.Service
                  yield* Effect.promise(() =>
                    MemoryMaintenance.clear(
                      WorkspaceMemory.maintenance(paths.directory, paths.home, { projectID: location.project.id }),
                      "workspace",
                      true,
                    ),
                  )
                }),
              )
            if (change === "delete") yield* sessions.remove(session.id)
            yield* Effect.sleep(1150)
            expect(yield* llm.calls).toBe(1)
            if (change !== "delete") {
              const listed = yield* operations.list(session.id)
              const receipts = yield* Effect.forEach(listed, (item) => settled(operations, session, item.id))
              expect(
                receipts.every((item) => item.result?.status === "failed" || item.result?.status === "cancelled"),
              ).toBe(true)
            }
          }),
        true,
        { idle_timeout_secs: 1 },
      ),
    30000,
  )
}

for (const change of ["prompt", "disable", "clear", "deny"] as const) {
  it.live(
    `automatic flush waiting on maintenance lock honors ${change} without stale publication`,
    () =>
      fixture(
        (session, paths) =>
          Effect.gen(function* () {
            const sessions = yield* SessionV2.Service
            const operations = yield* SessionMemoryOperation.Service
            const modes = yield* SessionMemoryModeNative.Service
            const store = yield* SessionStore.Service
            const llm = yield* TestLLMServer
            yield* llm.text("Use the captured bounded retry convention.")
            yield* sessions.prompt({
              sessionID: session.id,
              prompt: { text: "Retain bounded retry ownership for all queue processing." },
            })
            yield* sessions.wait(session.id)
            const scope = yield* local(
              session,
              Effect.gen(function* () {
                const location = yield* Location.Service
                const home = yield* Effect.promise(() => realpath(paths.home))
                return WorkspaceMemory.maintenance(paths.directory, home, { projectID: location.project.id })
              }),
            )
            const lock = yield* Effect.promise(() =>
              Flock.acquire(scope.root, { dir: path.join(paths.home, ".grok", "memory", ".locks") }),
            )
            const state = { released: false }
            const release = Effect.promise(async () => {
              if (state.released) return
              state.released = true
              await lock.release()
            })
            yield* Effect.addFinalizer(() => release)
            yield* llm.text("## Retained ownership\nThis write must respect the maintenance generation.")
            yield* llm.wait(2)
            const receipt = (yield* operations.list(session.id))[0]!
            // The response is already available; the real held lease prevents any publication.
            yield* Effect.sleep(150)
            expect((yield* operations.get(session.id, receipt.id)).state).toBe("running")
            const changing = yield* Effect.gen(function* () {
              if (change === "prompt") {
                yield* sessions.prompt({
                  sessionID: session.id,
                  resume: false,
                  prompt: { text: "A fresh admitted instruction cancels old automatic work." },
                })
                return
              }
              if (change === "disable") {
                yield* modes.set(session.id, settings, false, false)
                return
              }
              if (change === "deny") {
                yield* store.setPermissions({
                  sessionID: session.id,
                  permissions: [{ permission: "edit", pattern: "*", action: "deny" }],
                })
                return
              }
              yield* Effect.promise(() => MemoryMaintenance.clear(scope, "workspace", true))
            }).pipe(Effect.forkChild)
            if (change === "prompt" || change === "disable") {
              const joined = yield* pollWithTimeout(
                Effect.sync(() => changing.pollUnsafe()),
                "cancellation waited for the held maintenance lease",
                "2 seconds",
              ).pipe(Effect.result)
              yield* release
              yield* Fiber.join(changing)
              expect(joined._tag).toBe("Success")
              expect((yield* settled(operations, session, receipt.id)).result?.status).toBe(
                change === "disable" ? "failed" : "cancelled",
              )
            }
            if (change === "clear" || change === "deny") {
              yield* release
              yield* Fiber.join(changing)
              yield* settled(operations, session, receipt.id)
            }
            const files = yield* Effect.promise(() =>
              readdir(path.join(scope.root, "sessions")).catch((error: unknown) => {
                if (MemoryFiles.missing(error)) return []
                throw error
              }),
            )
            expect(files).toEqual([])
            expect(yield* llm.calls).toBe(2)
          }),
        true,
        { idle_timeout_secs: 1 },
      ),
    30000,
  )
}

it.live(
  "automatic failed source is not resampled by another idle candidate or a fresh passive controller",
  () =>
    fixture(
      (session) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const lifecycle = yield* SessionLifecycle.Service
          const llm = yield* TestLLMServer
          yield* llm.text("The original source must have immutable retry identity.")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Remember immutable retry identity for the project queue." },
          })
          yield* sessions.wait(session.id)
          yield* llm.push({
            type: "http-error",
            status: 400,
            body: { error: { message: "intentional automatic failure" } },
          })
          yield* llm.wait(2)
          const receipt = yield* pollWithTimeout(
            operations.list(session.id).pipe(Effect.map((items) => items.find((item) => item.state === "finished"))),
            "automatic failure did not settle",
            "10 seconds",
          )
          expect(receipt.result?.status).toBe("failed")
          const claim = yield* lifecycle.capture(session.id)
          const epoch = yield* operations.beginAutomaticActivity(claim)
          yield* operations.armAutomaticIdle(epoch, { settled: Effect.void, idle: Effect.succeed(true) })
          yield* Effect.sleep(1250)
          expect((yield* operations.list(session.id)).map((item) => item.id)).toEqual([receipt.id])
          yield* Effect.gen(function* () {
            const fresh = yield* SessionMemoryOperation.Service
            expect((yield* fresh.list(session.id))[0]?.result?.status).toBe("failed")
            yield* Effect.sleep(1250)
          }).pipe(Effect.provide(Layer.fresh(SessionMemoryOperation.layer)))
          expect(yield* llm.calls).toBe(2)
        }),
      true,
      { idle_timeout_secs: 1 },
    ),
  30000,
)

it.live(
  "automatic flush enabled false leaves idle work passive",
  () =>
    fixture(
      (session) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          yield* llm.text("Retain project ownership conventions.")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Retain project ownership conventions for future work." },
          })
          yield* sessions.wait(session.id)
          yield* Effect.sleep(1250)
          expect(yield* operations.list(session.id)).toEqual([])
          expect(yield* llm.calls).toBe(1)
        }),
      true,
      { idle_timeout_secs: 1, enabled: false },
    ),
  30000,
)

it.live(
  "durable prompt admission fences completed automatic output before publication",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const admission = yield* SessionInputAdmission.Service
          const lifecycle = yield* SessionLifecycle.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          yield* llm.text("Use the bounded project queue.")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Retain the bounded project queue convention." },
          })
          yield* sessions.wait(session.id)
          const response = Promise.withResolvers<void>()
          yield* Effect.addFinalizer(() => Effect.sync(() => response.resolve()))
          yield* llm.hold("## Old activity\nThis completed response cannot outrun admitted input.", response.promise)
          yield* llm.wait(2)
          const receipt = (yield* operations.list(session.id))[0]!
          const claim = yield* lifecycle.capture(session.id)
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const holder = yield* admission
            .fence(claim, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))
            .pipe(Effect.forkChild)
          yield* Deferred.await(entered)
          const prompting = yield* sessions
            .prompt({
              sessionID: session.id,
              resume: false,
              prompt: { text: "New admitted input takes precedence over old automatic output." },
            })
            .pipe(Effect.forkChild)
          yield* Effect.yieldNow
          response.resolve()
          yield* Effect.sleep(250)
          expect((yield* operations.get(session.id, receipt.id)).state).toBe("running")
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(holder)
          yield* Fiber.join(prompting)
          expect((yield* operations.get(session.id, receipt.id)).result?.status).toBe("cancelled")
          const files = yield* local(
            session,
            Effect.gen(function* () {
              const location = yield* Location.Service
              return yield* Effect.promise(() =>
                readdir(
                  path.join(
                    WorkspaceMemory.maintenance(paths.directory, paths.home, { projectID: location.project.id }).root,
                    "sessions",
                  ),
                ).catch((error: unknown) => {
                  if (MemoryFiles.missing(error)) return []
                  throw error
                }),
              )
            }),
          )
          expect(files).toEqual([])
          expect(yield* llm.calls).toBe(2)
        }),
      true,
      { idle_timeout_secs: 1 },
    ),
  30000,
)

it.live(
  "cancelled prompt caller still joins automatic work after durable admission",
  () =>
    fixture(
      (session) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const admission = yield* SessionInputAdmission.Service
          const lifecycle = yield* SessionLifecycle.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          yield* llm.text("Use the bounded project queue.")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Retain the bounded project queue convention." },
          })
          yield* sessions.wait(session.id)
          const response = Promise.withResolvers<void>()
          yield* Effect.addFinalizer(() => Effect.sync(() => response.resolve()))
          yield* llm.hold("## Cancelled activity\nNever publish after newer admitted input.", response.promise)
          yield* llm.wait(2)
          const receipt = (yield* operations.list(session.id))[0]!
          const joining = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const claim = yield* lifecycle.capture(session.id)
          yield* admission.observe(claim, {}, () =>
            Deferred.succeed(joining, undefined).pipe(Effect.andThen(Deferred.await(release))),
          )
          const input = {
            sessionID: session.id,
            id: SessionMessage.ID.create(),
            resume: false,
            prompt: { text: "The durable instruction survives caller cancellation." },
          }
          const prompting = yield* sessions.prompt(input).pipe(Effect.forkChild)
          yield* Deferred.await(joining)
          const cancelling = yield* Fiber.interrupt(prompting).pipe(Effect.forkChild)
          const cancelled = yield* pollWithTimeout(
            operations
              .get(session.id, receipt.id)
              .pipe(Effect.map((item) => (item.result?.status === "cancelled" ? item : undefined))),
            "cancelled caller skipped automatic join",
            "3 seconds",
          )
          expect(cancelled.result?.status).toBe("cancelled")
          expect(cancelling.pollUnsafe()).toBeUndefined()
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(cancelling)
          const retried = yield* sessions.prompt(input)
          expect(retried.id).toBe(input.id)
          expect(retried.promotedSeq).toBeUndefined()
          response.resolve()
          expect(yield* llm.calls).toBe(2)
        }),
      true,
      { idle_timeout_secs: 1 },
    ),
  30000,
)

it.live(
  "joining an active explicit resume preserves the drain's automatic idle epoch",
  () =>
    fixture(
      (session) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          const response = Promise.withResolvers<void>()
          yield* Effect.addFinalizer(() => Effect.sync(() => response.resolve()))
          yield* llm.hold("Retain the bounded queue convention.", response.promise)
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Retain the bounded queue convention for the project." },
          })
          yield* llm.wait(1)
          const joined = yield* sessions.resume(session.id).pipe(Effect.forkChild)
          yield* Effect.yieldNow
          yield* Effect.sleep(50)
          expect(joined.pollUnsafe()).toBeUndefined()
          yield* llm.text("## Queue\nUse bounded ownership.")
          response.resolve()
          yield* Fiber.join(joined)
          const receipt = yield* pollWithTimeout(
            operations.list(session.id).pipe(Effect.map((items) => items.find((item) => item.state === "finished"))),
            "joined resume lost the automatic epoch",
            "5 seconds",
          )
          expect(receipt.result?.status).toBe("completed")
          expect(yield* llm.calls).toBe(2)
        }),
      true,
      { idle_timeout_secs: 1 },
    ),
  30000,
)

it.live(
  "legacy semantic flush deduplication suppresses >0.92 matches with :duplicate marker, writes <=0.92 boundary and falls back on provider failure",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          yield* llm.reset

          const workspaceFile = yield* local(
            session,
            Effect.gen(function* () {
              const location = yield* Location.Service
              return WorkspaceMemory.file(paths.directory, paths.home, { projectID: location.project.id })
            }),
          )
          yield* Effect.promise(async () => {
            await mkdir(path.dirname(workspaceFile), { recursive: true })
            await Bun.write(workspaceFile, "# Database\n\nPostgreSQL 16 runs on port 5432.\n")
          })

          // 1. Similarity 0.95 (> 0.92): suppress body and write :duplicate marker.
          yield* llm.setEmbed((hit) => {
            const inputs = Array.isArray(hit.body.input) ? (hit.body.input as string[]) : []
            return {
              status: 200,
              body: {
                object: "list",
                data: inputs.map((text, index) => ({
                  object: "embedding",
                  index,
                  embedding: text.includes("5432") ? [0.9, 0, 0, 0] : [1, 0, 0, 0],
                })),
              },
            }
          })
          // Wait: both existing note and flush candidate contain "5432"; make existing [1,0,0,0] and candidate [0.9,0,0,0] (sim = 0.95).
          yield* llm.setEmbed((hit) => {
            const inputs = Array.isArray(hit.body.input) ? (hit.body.input as string[]) : []
            return {
              status: 200,
              body: {
                object: "list",
                data: inputs.map((text, index) => ({
                  object: "embedding",
                  index,
                  embedding: text.startsWith("# Database") ? [1, 0, 0, 0] : [0.9, 0, 0, 0],
                })),
              },
            }
          })

          yield* llm.text("PostgreSQL 16 is configured on port 5432.")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Remember our primary database is PostgreSQL 16 on port 5432." },
          })
          yield* sessions.wait(session.id)
          yield* enable(session.id)

          yield* llm.text("## Database\n\nPrimary database uses PostgreSQL 16 on port 5432.")
          const dupOp = MemoryOperation.ID.create()
          yield* operations.start(session.id, { id: dupOp })
          const dupDone = yield* settled(operations, session, dupOp)
          expect(dupDone.result?.status).toBe("no_work")
          expect(dupDone.result?.processed).toBe(0)
          expect(yield* llm.calls).toBe(2)
          expect(yield* llm.embedCalls).toBe(1)

          const sessionFiles = yield* Effect.promise(() => readdir(path.join(path.dirname(workspaceFile), "sessions")))
          expect(sessionFiles).toHaveLength(1)
          const flushFile = path.join(path.dirname(workspaceFile), "sessions", sessionFiles[0]!)
          const afterDup = yield* Effect.promise(() => readFile(flushFile, "utf8"))
          expect(afterDup).toContain(":duplicate -->")
          expect(afterDup).not.toContain("## Database")

          // Retry of settled duplicate operation must not call LLM or embedding again.
          const retryOp = MemoryOperation.ID.create()
          yield* operations.retry(session.id, { id: retryOp, retryOf: dupOp })
          expect((yield* settled(operations, session, retryOp)).result?.status).toBe("no_work")
          expect(yield* llm.calls).toBe(2)
          expect(yield* llm.embedCalls).toBe(1)

          // 2. Boundary similarity === 0.92 (<= 0.92): [1,0,0,0] vs [0.84,0,0,0] -> L2 = 0.16, sim = 1 - 0.16/2 = 0.92 -> must write!
          yield* llm.setEmbed((hit) => {
            const inputs = Array.isArray(hit.body.input) ? (hit.body.input as string[]) : []
            return {
              status: 200,
              body: {
                object: "list",
                data: inputs.map((text, index) => ({
                  object: "embedding",
                  index,
                  embedding: text.startsWith("## Boundary") ? [0.84, 0, 0, 0] : [1, 0, 0, 0],
                })),
              },
            }
          })

          yield* llm.text("Redis cache runs on port 6379.")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Remember Redis cache runs on port 6379." },
          })
          yield* sessions.wait(session.id)

          yield* llm.text("## Boundary cache\n\nRedis cache runs on port 6379.")
          const boundaryOp = MemoryOperation.ID.create()
          yield* operations.start(session.id, { id: boundaryOp })
          const boundaryDone = yield* settled(operations, session, boundaryOp)
          expect(boundaryDone.result?.status).toBe("completed")
          expect(boundaryDone.result?.processed).toBe(1)
          const afterBoundary = yield* Effect.promise(() => readFile(flushFile, "utf8"))
          expect(afterBoundary).toContain("## Boundary cache")

          // 3. Provider failure during semantic dedup falls back to normal write, never false suppression.
          yield* llm.setEmbed(() => ({ status: 503, body: { error: "embedding unavailable" } }))
          yield* llm.text("Worker queue uses NATS JetStream.")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Remember worker queue uses NATS JetStream." },
          })
          yield* sessions.wait(session.id)

          yield* llm.text("## Queue transport\n\nWorker queue uses NATS JetStream.")
          const fallbackOp = MemoryOperation.ID.create()
          yield* operations.start(session.id, { id: fallbackOp })
          const fallbackDone = yield* settled(operations, session, fallbackOp)
          expect(fallbackDone.result?.status).toBe("completed")
          expect(fallbackDone.result?.processed).toBe(1)
          const afterFallback = yield* Effect.promise(() => readFile(flushFile, "utf8"))
          expect(afterFallback).toContain("## Queue transport")
        }),
      false,
      { semantic_dedup_threshold: 0.92 },
      { embedding: { provider: "api", model: "fixture/model", dimensions: 4 } },
    ),
  30000,
)

it.live(
  "legacy semantic flush durable duplicate receipt recovers without another LLM or embedding request and verifies neighbor hash at commit",
  () =>
    fixture(
      (session, paths) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const llm = yield* TestLLMServer
          yield* llm.reset

          const workspaceFile = yield* local(
            session,
            Effect.gen(function* () {
              const location = yield* Location.Service
              return WorkspaceMemory.file(paths.directory, paths.home, { projectID: location.project.id })
            }),
          )
          yield* Effect.promise(async () => {
            await mkdir(path.dirname(workspaceFile), { recursive: true })
            await Bun.write(workspaceFile, "# Conventions\n\nAll services use structured JSON logging.\n")
          })

          yield* llm.setEmbed((hit) => {
            const inputs = Array.isArray(hit.body.input) ? (hit.body.input as string[]) : []
            return {
              status: 200,
              body: {
                object: "list",
                data: inputs.map((_, index) => ({
                  object: "embedding",
                  index,
                  embedding: [1, 0, 0, 0],
                })),
              },
            }
          })

          yield* llm.text("Structured JSON logging is required.")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "Remember all services use structured JSON logging." },
          })
          yield* sessions.wait(session.id)
          yield* enable(session.id)

          yield* local(
            session,
            Effect.gen(function* () {
              const memory = yield* MemoryLifecycleNative.Service
              const plan = yield* Schema.decodeUnknownEffect(MemoryLegacyNative.Plan)(
                yield* memory.prepareFlush(session.id),
              )
              const opID = MemoryOperation.ID.create()
              const saved: { publication?: MemoryLegacyNative.Publication } = {}

              yield* llm.text("## Logging\n\nAll services use structured JSON logging.")
              const interrupted = yield* memory
                .executeLegacy(plan, {
                  operationID: opID,
                  prepared: (publication) =>
                    Effect.gen(function* () {
                      saved.publication = publication
                      return yield* Effect.fail(new Error("simulated crash after durable receipt save"))
                    }),
                })
                .pipe(Effect.result)

              expect(interrupted._tag).toBe("Failure")
              expect(saved.publication?.status).toBe("duplicate")
              expect(yield* llm.calls).toBe(2)
              expect(yield* llm.embedCalls).toBe(1)

              // Negative control: if neighbor file changes before recovery commits, recovery must reject!
              yield* Effect.promise(() =>
                Bun.write(workspaceFile, "# Conventions\n\nMutated neighbor content before commit.\n"),
              )
              const rejected = yield* memory
                .executeLegacy(plan, {
                  operationID: opID,
                  recover: saved.publication,
                })
                .pipe(Effect.result)
              expect(rejected._tag).toBe("Failure")
              expect(yield* llm.calls).toBe(2)
              expect(yield* llm.embedCalls).toBe(1)

              // Restore exact neighbor content: recovery commits :duplicate marker with 0 extra LLM/embedding requests.
              yield* Effect.promise(() =>
                Bun.write(workspaceFile, "# Conventions\n\nAll services use structured JSON logging.\n"),
              )
              const recovered = yield* memory.executeLegacy(plan, {
                operationID: opID,
                recover: saved.publication,
              })
              expect(recovered).toMatchObject({
                status: "no_work",
                processed: 0,
                committed: true,
              })
              expect(yield* llm.calls).toBe(2)
              expect(yield* llm.embedCalls).toBe(1)
            }),
          )
        }),
      false,
      { semantic_dedup_threshold: 0.92 },
      { embedding: { provider: "api", model: "fixture/model", dimensions: 4 } },
    ),
  30000,
)

for (const change of ["deny_read", "switch_agent", "clear_memory", "mutate_neighbor"] as const) {
  it.live(
    `legacy semantic flush held embedding response rejects ${change} without false suppression or stale commit`,
    () =>
      fixture(
        (session, paths) =>
          Effect.gen(function* () {
            const sessions = yield* SessionV2.Service
            const store = yield* SessionStore.Service
            const database = yield* Database.Service
            const llm = yield* TestLLMServer
            yield* llm.reset

            const workspaceFile = yield* local(
              session,
              Effect.gen(function* () {
                const location = yield* Location.Service
                return WorkspaceMemory.file(paths.directory, paths.home, { projectID: location.project.id })
              }),
            )
            yield* Effect.promise(async () => {
              await mkdir(path.dirname(workspaceFile), { recursive: true })
              await Bun.write(workspaceFile, "# Security\n\nRotate mTLS certificates every 24 hours.\n")
            })

            const release = Promise.withResolvers<void>()
            yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
            yield* llm.setEmbed((hit) => {
              const inputs = Array.isArray(hit.body.input) ? (hit.body.input as string[]) : []
              return {
                status: 200,
                wait: release.promise,
                body: {
                  object: "list",
                  data: inputs.map((_, index) => ({
                    object: "embedding",
                    index,
                    embedding: [1, 0, 0, 0],
                  })),
                },
              }
            })

            yield* llm.text("Rotate mTLS certificates every 24 hours.")
            yield* sessions.prompt({
              sessionID: session.id,
              prompt: { text: "Remember to rotate mTLS certificates every 24 hours." },
            })
            yield* sessions.wait(session.id)
            yield* enable(session.id)

            yield* local(
              session,
              Effect.gen(function* () {
                const memory = yield* MemoryLifecycleNative.Service
                const location = yield* Location.Service
                const plan = yield* Schema.decodeUnknownEffect(MemoryLegacyNative.Plan)(
                  yield* memory.prepareFlush(session.id),
                )
                yield* llm.text("## Security\n\nRotate mTLS certificates every 24 hours.")
                const running = yield* memory.executeLegacy(plan).pipe(Effect.forkChild)
                yield* llm.waitEmbed(1)

                if (change === "deny_read") {
                  yield* store.setPermissions({
                    sessionID: session.id,
                    permissions: [{ permission: "read", pattern: "*", action: "deny" }],
                  })
                }
                if (change === "switch_agent") {
                  yield* database.db
                    .update(SessionTable)
                    .set({ agent: "plan" })
                    .where(eq(SessionTable.id, session.id))
                    .run()
                }
                if (change === "clear_memory") {
                  yield* Effect.promise(() =>
                    MemoryMaintenance.clear(
                      WorkspaceMemory.maintenance(paths.directory, paths.home, { projectID: location.project.id }),
                      "workspace",
                      true,
                    ),
                  )
                }
                if (change === "mutate_neighbor") {
                  yield* Effect.promise(() =>
                    Bun.write(workspaceFile, "# Security\n\nDifferent unrelated policy after edit.\n"),
                  )
                }

                release.resolve()
                const outcome = yield* Fiber.await(running)
                expect(outcome._tag).toBe("Failure")
                expect(yield* llm.embedCalls).toBe(1)

                const files = yield* Effect.promise(() =>
                  readdir(path.join(path.dirname(workspaceFile), "sessions")).catch((cause: unknown) => {
                    if (MemoryFiles.missing(cause)) return []
                    throw cause
                  }),
                )
                expect(files).toEqual([])
              }),
            )
          }),
        false,
        { semantic_dedup_threshold: 0.92 },
        { embedding: { provider: "api", model: "fixture/model", dimensions: 4 } },
      ),
    30000,
  )
}


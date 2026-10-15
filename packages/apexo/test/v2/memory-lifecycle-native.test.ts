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
import { SessionInputAdmission } from "@apexo/core/session/input-admission"
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
        yield* modes.set(session.id, settings, false, false)
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

it.live(
  "native flush captures a completed real turn once and reconciles concurrent exact admission",
  () =>
    fixture((session) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const llm = yield* TestLLMServer
        expect(yield* operations.list(session.id)).toEqual([])
        expect(yield* llm.calls).toBe(0)
        yield* llm.text("I will remember that the project mascot is an otter.")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Our project mascot is an otter." } })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        expect(yield* llm.calls).toBe(1)
        yield* llm.text(
          JSON.stringify({
            outcome: "observations",
            observations: [
              {
                type: "project",
                statement: "The project mascot is an otter.",
                topic_hint: null,
                keywords: ["mascot"],
                aliases: [],
                body: null,
              },
            ],
          }),
        )
        const id = MemoryOperation.ID.create()
        const pair = yield* Effect.all([operations.start(session.id, { id }), operations.start(session.id, { id })], {
          concurrency: 2,
        })
        expect(pair.map((info) => info.id)).toEqual([id, id])
        const done = yield* settled(operations, session, id)
        expect(done.result?.status).toBe("completed")
        expect(done.result?.processed).toBe(1)
        expect(yield* llm.calls).toBe(2)
        const extraction = (yield* llm.hits).at(-1)!
        expect(JSON.stringify(extraction.body)).toContain("project mascot")
        expect(extraction.body.tools ?? []).toEqual([])
        expect((yield* operations.start(session.id, { id })).result).toEqual(done.result)
        const next = MemoryOperation.ID.create()
        yield* operations.start(session.id, { id: next })
        expect((yield* settled(operations, session, next)).result?.processed).toBe(0)
        expect(yield* llm.calls).toBe(2)
      }),
    ),
  30000,
)

it.live(
  "Memory mode change cancels and joins a held worker without holding its commit lease",
  () =>
    fixture((session) =>
      Effect.gen(function* () {
        const modes = yield* SessionMemoryModeNative.Service
        yield* enable(session.id)
        const snapshot = yield* modes.get(session.id, settings)
        const entered = Deferred.makeUnsafe<void>()
        const cancelling = Deferred.makeUnsafe<void>()
        const release = Deferred.makeUnsafe<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
        const work = yield* modes
          .run(
            session.id,
            settings,
            snapshot.revision,
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(cancelling, undefined).pipe(Effect.andThen(Deferred.await(release)))),
            ),
          )
          .pipe(Effect.result, Effect.forkChild)
        yield* Deferred.await(entered)
        const disabled = Deferred.makeUnsafe<void>()
        const disable = yield* modes.set(session.id, settings, false, true).pipe(
          Effect.tap(() => Deferred.succeed(disabled, undefined)),
          Effect.forkChild,
        )
        yield* Deferred.await(cancelling).pipe(Effect.timeout("3 seconds"))
        expect((yield* modes.get(session.id, settings)).info.enabled).toBe(false)
        expect(yield* Deferred.isDone(disabled)).toBe(false)
        yield* Deferred.succeed(release, undefined)
        expect((yield* Fiber.join(work))._tag).toBe("Failure")
        expect((yield* Fiber.join(disable)).info.enabled).toBe(false)
        expect(
          (yield* modes.commit(session.id, settings, snapshot.revision, Effect.succeed("LATE")).pipe(Effect.result))
            ._tag,
        ).toBe("Failure")
      }),
    ),
  20000,
)

it.live(
  "native flush cancellation joins its extraction and exact retry cannot relaunch it",
  () =>
    fixture((session) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const llm = yield* TestLLMServer
        yield* llm.text("Completed source")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Remember the release checklist." } })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        const release = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
        yield* llm.hold(JSON.stringify({ outcome: "noop", observations: [] }), release.promise)
        const id = MemoryOperation.ID.create()
        yield* operations.start(session.id, { id })
        yield* llm.wait(2)
        const cancelled = yield* operations.cancel(session.id, id).pipe(Effect.timeout("5 seconds"))
        expect(cancelled.state).toBe("finished")
        expect(cancelled.result?.status).toBe("cancelled")
        expect((yield* operations.start(session.id, { id })).result?.status).toBe("cancelled")
        expect(yield* llm.calls).toBe(2)
        release.resolve()
      }),
    ),
  30000,
)

it.live(
  "queued terminal sources survive real compaction and passive reads never start extraction",
  () =>
    fixture((session) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const locations = yield* LocationServiceMap.Service
        const llm = yield* TestLLMServer
        yield* llm.text("FIRST_DURABLE_SOURCE " + "old context ".repeat(6000))
        yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "First durable fact: project color is indigo." },
        })
        yield* sessions.wait(session.id)
        expect(yield* operations.list(session.id)).toEqual([])
        expect(yield* llm.calls).toBe(1)
        yield* llm.text("SECOND_DURABLE_SOURCE " + "new context ".repeat(6000))
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Second fact: project animal is an otter." } })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        yield* llm.text("## Objective\nContinue the project.\n## Important Details\nKeep the current task.")
        yield* sessions.compact({ sessionID: session.id })
        const queued = yield* operations.list(session.id)
        expect(queued).toHaveLength(2)
        expect(queued.every((receipt) => receipt.state === "queued" && receipt.ownership === "unverified")).toBe(true)
        const current = yield* MemoryLifecycleNative.Service.use((memory) => memory.prepare(session.id)).pipe(
          Effect.provide(locations.get(session.location)),
        )
        expect(current.sources.some((source) => source.transcript.includes("FIRST_DURABLE_SOURCE"))).toBe(false)
        expect(yield* llm.calls).toBe(3)
        yield* llm.text(JSON.stringify({ outcome: "noop", observations: [] }))
        yield* llm.text(JSON.stringify({ outcome: "noop", observations: [] }))
        const id = MemoryOperation.ID.create()
        yield* operations.start(session.id, { id })
        const done = yield* settled(operations, session, id)
        expect(done.result?.status).toBe("completed")
        expect(done.result?.processed).toBe(2)
        // Receipts created in the same millisecond may be reconciled in ID order.
        const extracted = (yield* llm.hits).slice(3).map((hit) => JSON.stringify(hit.body))
        expect(extracted).toHaveLength(2)
        expect(extracted.filter((body) => body.includes("FIRST_DURABLE_SOURCE"))).toHaveLength(1)
        expect(extracted.filter((body) => body.includes("SECOND_DURABLE_SOURCE"))).toHaveLength(1)
      }),
    ),
  30000,
)

it.live(
  "clear while extraction is held fences publication by the canonical scope generation",
  () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const locations = yield* LocationServiceMap.Service
        const llm = yield* TestLLMServer
        yield* llm.text("Completed source for clear race")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Remember the color teal." } })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        const release = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
        yield* llm.hold(
          JSON.stringify({
            outcome: "observations",
            observations: [
              {
                type: "project",
                statement: "The color is teal",
                topic_hint: null,
                keywords: [],
                aliases: [],
                body: null,
              },
            ],
          }),
          release.promise,
        )
        const id = MemoryOperation.ID.create()
        yield* operations.start(session.id, { id })
        yield* llm.wait(2)
        yield* Effect.gen(function* () {
          const location = yield* Location.Service
          const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id }, { recover: false })
          yield* store.clear
          release.resolve()
          const done = yield* settled(operations, session, id)
          expect(done.result?.status).not.toBe("completed")
          expect(yield* store.listNotes("", () => true)).toEqual([])
          expect(yield* store.jobs(session.id)).toEqual([])
        }).pipe(Effect.scoped, Effect.provide(locations.get(session.location)))
        expect(yield* llm.calls).toBe(2)
      }),
    ),
  30000,
)

it.live(
  "a real Stop admits only the settled stopped source and does not start auxiliary work",
  () =>
    fixture((session) =>
      Effect.gen(function* () {
        yield* enable(session.id)
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const llm = yield* TestLLMServer
        const events = yield* EventV2.Service
        const observed = Deferred.makeUnsafe<SessionMessage.ID>()
        const unsubscribe = yield* events.listen((event) =>
          Effect.gen(function* () {
            if (event.type !== SessionEvent.Text.Delta.type) return
            const data = yield* Schema.decodeUnknownEffect(Schema.toType(SessionEvent.Text.Delta.data))(
              event.data,
            ).pipe(Effect.orDie)
            if (data.sessionID === session.id && data.delta.includes("PARTIAL_STOP_SOURCE"))
              yield* Deferred.succeed(observed, data.assistantMessageID)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        yield* llm.push(reply().text("PARTIAL_STOP_SOURCE").hang())
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "The deployment target is staging." } })
        const partial = yield* Deferred.await(observed).pipe(Effect.timeout("10 seconds"))
        expect(yield* operations.capture(session.id)).toBeUndefined()
        expect(yield* operations.list(session.id)).toEqual([])
        yield* sessions.interrupt(session.id)
        const queued = (yield* operations.list(session.id))[0]
        expect(queued?.kind).toBe("capture")
        expect(yield* operations.capture(session.id, partial)).toEqual(queued)
        expect(queued?.state).toBe("queued")
        expect(yield* llm.calls).toBe(1)
        const id = MemoryOperation.ID.create()
        yield* llm.text(JSON.stringify({ outcome: "noop", observations: [] }))
        yield* operations.start(session.id, { id })
        expect((yield* settled(operations, session, id)).result?.status).toBe("completed")
        expect(yield* llm.calls).toBe(2)
        expect(JSON.stringify((yield* llm.hits)[1]!.body)).toContain("PARTIAL_STOP_SOURCE")
      }),
    ),
  30000,
)

it.live(
  "ordinary terminal capture runs once without a synthetic prompt or auxiliary tools",
  () =>
    fixture(
      (session) =>
        Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const operations = yield* SessionMemoryOperation.Service
          const llm = yield* TestLLMServer
          yield* llm.text("AUTO_CAPTURE_SOURCE: The mascot is an otter.")
          yield* llm.text(JSON.stringify({ outcome: "noop", observations: [] }))
          yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Remember the project mascot." } })
          yield* sessions.wait(session.id)
          const receipt = yield* pollWithTimeout(
            operations.list(session.id).pipe(Effect.map((rows) => rows[0])),
            "Missing automatic capture",
            "10 seconds",
          )
          expect((yield* settled(operations, session, receipt.id)).result?.status).toBe("completed")
          expect(yield* llm.calls).toBe(2)
          expect((yield* llm.hits)[1]!.body.tools ?? []).toEqual([])
          const context = yield* sessions.context(session.id)
          expect(context.filter((message) => message.type === "user")).toHaveLength(1)
          expect(context.filter((message) => message.type === "assistant")).toHaveLength(1)
          yield* llm.text("Explicitly resumed ordinary continuation")
          yield* sessions.resume(session.id)
          const resumed = (yield* operations.list(session.id)).find((row) => row.id !== receipt.id)!
          expect((yield* settled(operations, session, resumed.id)).result?.processed).toBe(0)
          expect(yield* llm.calls).toBe(3)
          expect(yield* operations.list(session.id)).toHaveLength(2)
        }),
      true,
    ),
  30000,
)

it.live(
  "headless policy suppresses observation and explicit auxiliary admission",
  () =>
    fixture((session) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const llm = yield* TestLLMServer
        yield* llm.text("HEADLESS_SOURCE")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "No auxiliary inference" } })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        yield* SessionExecutionPolicy.provide(
          session.id,
          { mode: "headless", permissions: "approve_once" },
          Effect.gen(function* () {
            expect(yield* operations.capture(session.id)).toBeUndefined()
            const result = yield* operations.start(session.id, { id: MemoryOperation.ID.create() }).pipe(Effect.result)
            expect(result._tag).toBe("Failure")
            if (result._tag === "Failure") expect(result.failure.code).toBe("unsupported")
          }),
        )
        expect(yield* operations.list(session.id)).toEqual([])
        expect(yield* llm.calls).toBe(1)
      }),
    ),
  30000,
)

it.live(
  "publication rechecks fresh Session permissions after a held extraction",
  () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const store = yield* SessionStore.Service
        const locations = yield* LocationServiceMap.Service
        const llm = yield* TestLLMServer
        yield* llm.text("PERMISSION_SOURCE")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "The deployment color is teal." } })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        const release = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
        yield* llm.hold(
          JSON.stringify({
            outcome: "observations",
            observations: [
              {
                type: "project",
                statement: "The deployment color is teal",
                topic_hint: null,
                keywords: [],
                aliases: [],
                body: null,
              },
            ],
          }),
          release.promise,
        )
        const id = MemoryOperation.ID.create()
        yield* operations.start(session.id, { id })
        yield* llm.wait(2)
        yield* store.setPermissions({
          sessionID: session.id,
          permissions: [{ permission: "edit", pattern: "*", action: "deny" }],
        })
        release.resolve()
        expect((yield* settled(operations, session, id)).result?.status).not.toBe("completed")
        yield* Effect.gen(function* () {
          const location = yield* Location.Service
          const capture = yield* MemoryCapture.make({ ...paths, projectID: location.project.id }, { recover: false })
          expect(yield* capture.listNotes("", () => true)).toEqual([])
        }).pipe(Effect.scoped, Effect.provide(locations.get(session.location)))
        const denied = yield* operations.start(session.id, { id: MemoryOperation.ID.create() }).pipe(Effect.result)
        expect(denied._tag).toBe("Failure")
        if (denied._tag === "Failure") expect(denied.failure.code).toBe("denied")
        expect(yield* llm.calls).toBe(2)
      }),
    ),
  30000,
)

it.live(
  "Session deletion joins extraction and old operation receipts cannot target a reused ID",
  () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const locations = yield* LocationServiceMap.Service
        const llm = yield* TestLLMServer
        yield* llm.text("DELETE_SOURCE")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Remember the old incarnation" } })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        const release = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
        yield* llm.hold(JSON.stringify({ outcome: "noop", observations: [] }), release.promise)
        const id = MemoryOperation.ID.create()
        yield* operations.start(session.id, { id })
        yield* llm.wait(2)
        yield* sessions.remove(session.id).pipe(Effect.timeout("5 seconds"))
        const replacement = yield* sessions.create({
          id: session.id,
          location: session.location,
          agent: AgentV2.ID.make("build"),
          model: session.model,
        })
        release.resolve()
        expect(replacement.id).toBe(session.id)
        expect(yield* operations.list(session.id)).toEqual([])
        const stale = yield* operations.cancel(session.id, id).pipe(Effect.result)
        expect(stale._tag).toBe("Failure")
        if (stale._tag === "Failure") expect(stale.failure.code).toBe("missing")
        expect(yield* sessions.context(session.id)).toEqual([])
        yield* Effect.gen(function* () {
          const location = yield* Location.Service
          const capture = yield* MemoryCapture.make({ ...paths, projectID: location.project.id }, { recover: false })
          expect(yield* capture.listNotes("", () => true)).toEqual([])
        }).pipe(Effect.scoped, Effect.provide(locations.get(session.location)))
        expect(yield* llm.calls).toBe(2)
      }),
    ),
  30000,
)

it.live(
  "controller scope shutdown joins work and persists cancellation before a fresh owner reads",
  () =>
    fixture((session) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const outer = yield* SessionMemoryOperation.Service
        const llm = yield* TestLLMServer
        yield* llm.text("HOST_SHUTDOWN_SOURCE")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Remember the stopped host" } })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        const release = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
        yield* llm.hold(JSON.stringify({ outcome: "noop", observations: [] }), release.promise)
        const id = MemoryOperation.ID.create()
        yield* Effect.gen(function* () {
          const local = yield* SessionMemoryOperation.Service
          yield* local.start(session.id, { id })
          yield* llm.wait(2)
          expect((yield* outer.get(session.id, id)).ownership).toBe("unverified")
          const foreignCancel = yield* outer.cancel(session.id, id).pipe(Effect.result)
          expect(foreignCancel._tag).toBe("Failure")
          if (foreignCancel._tag === "Failure") expect(foreignCancel.failure.code).toBe("busy")
        }).pipe(Effect.provide(Layer.fresh(SessionMemoryOperation.layer)), Effect.timeout("5 seconds"))
        expect((yield* outer.get(session.id, id)).result?.status).toBe("cancelled")
        expect((yield* outer.start(session.id, { id })).result?.status).toBe("cancelled")
        expect(yield* llm.calls).toBe(2)
        release.resolve()
      }),
    ),
  30000,
)

it.live(
  "exact capture claim recovery preserves foreign owners, tokens and recycled Session proofs",
  () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const locations = yield* LocationServiceMap.Service
        yield* Effect.gen(function* () {
          const location = yield* Location.Service
          const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id }, { recover: false })
          yield* store.adopt(session.id, "original-created")
          yield* store.admit({
            sessionID: session.id,
            promptID: "prompt",
            sourcePromptIndex: 0,
            source: "immutable source",
            createdAt: Date.now(),
            exposed: true,
          })
          const now = Date.now()
          const old = (yield* store.claim({ owner: "foreign-live", sessionID: session.id, now, duration: 1000 }))!
          const proof = {
            jobID: old.job.job_id,
            owner: old.owner,
            token: old.token,
            sourceHash: MemoryV2.hash(old.job.source),
          }
          expect(
            yield* store.claim({
              owner: "native",
              sessionID: session.id,
              now: now + 2000,
              duration: 1000,
              expired: false,
            }),
          ).toBeUndefined()
          expect(yield* store.releaseClaim(session.id, "original-created", { ...proof, owner: "different" })).toBe(
            false,
          )
          expect(yield* store.releaseClaim(session.id, "original-created", { ...proof, token: "different" })).toBe(
            false,
          )
          expect(yield* store.releaseClaim(session.id, "replacement-created", proof)).toBe(false)
          expect(yield* store.releaseClaim(session.id, "original-created", { ...proof, sourceHash: "different" })).toBe(
            false,
          )
          expect(yield* store.releaseClaim(session.id, "original-created", proof)).toBe(true)
          const fresh = (yield* store.claim({
            owner: "native",
            sessionID: session.id,
            now,
            duration: 1000,
            expired: false,
          }))!
          expect(fresh.job.attempt).toBe(2)
          expect((yield* store.commit(old, { outcome: "noop", observations: [] }, now).pipe(Effect.result))._tag).toBe(
            "Failure",
          )
          expect(yield* store.releaseClaim(session.id, "original-created", proof)).toBe(false)
          yield* store.commit(fresh, { outcome: "noop", observations: [] }, now)
        }).pipe(Effect.scoped, Effect.provide(locations.get(session.location)))
      }),
    ),
  20000,
)

it.live(
  "native flush never steals an unreceipted foreign capture lease even after its deadline",
  () =>
    fixture((session, paths) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const locations = yield* LocationServiceMap.Service
        const llm = yield* TestLLMServer
        yield* llm.text("FOREIGN_SOURCE")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Keep this durable source." } })
        yield* sessions.wait(session.id)
        yield* enable(session.id)
        yield* Effect.gen(function* () {
          const memory = yield* MemoryLifecycleNative.Service
          const location = yield* Location.Service
          const plan = yield* memory.prepare(session.id)
          const source = plan.sources[0]!
          const store = yield* MemoryCapture.make({ ...paths, projectID: location.project.id }, { recover: false })
          yield* store.adopt(session.id, plan.createdEventID)
          yield* store.admit({
            sessionID: session.id,
            promptID: source.promptID,
            sourcePromptIndex: 0,
            source: JSON.stringify(source),
            createdAt: source.createdAt,
            exposed: true,
          })
          const foreign = (yield* store.claim({
            owner: "unreceipted-owner",
            sessionID: session.id,
            now: 1,
            duration: 1000,
          }))!
          const id = MemoryOperation.ID.create()
          yield* operations.start(session.id, { id })
          const finished = yield* settled(operations, session, id)
          expect(finished).toMatchObject({ state: "finished", ownership: "settled" })
          expect(finished.result?.status).toBe("retry_required")
          const retry = MemoryOperation.ID.create()
          // A published terminal result permits immediate retry, including while its worker finishes cleanup.
          yield* operations.start(session.id, { id: retry, retryOf: id })
          expect((yield* settled(operations, session, retry)).result?.status).toBe("retry_required")
          const row = (yield* store.jobs(session.id))[0]!
          expect(row.status).toBe("running")
          expect(row.attempt).toBe(1)
          expect(yield* llm.calls).toBe(1)
          yield* store.fail(foreign, "Fixture cleanup", false)
          expect((yield* store.jobs(session.id))[0]!.status).toBe("failed")
        }).pipe(Effect.scoped, Effect.provide(locations.get(session.location)))
      }),
    ),
  30000,
)

it.live(
  "managed children and captured Goal attempts reject auxiliary admission before provider work",
  () =>
    fixture((session) =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMemoryOperation.Service
        const goals = yield* SessionGoal.Service
        const llm = yield* TestLLMServer
        yield* enable(session.id)
        const child = yield* sessions.create({
          parentID: session.id,
          location: session.location,
          metadata: { goalReview: "historical managed marker" },
          model: session.model,
        })
        yield* enable(child.id)
        const childResult = yield* operations.start(child.id, { id: MemoryOperation.ID.create() }).pipe(Effect.result)
        expect(childResult._tag).toBe("Failure")
        if (childResult._tag === "Failure") expect(childResult.failure.code).toBe("unsupported")
        const goal = yield* goals.create(session.id, { id: Goal.ID.create(), objective: "Own auxiliary accounting" })
        const target = { sessionID: session.id, goalID: goal.id }
        const attempt = yield* goals.begin(target, "executing")
        const active = yield* operations.start(session.id, { id: MemoryOperation.ID.create() }).pipe(Effect.result)
        expect(active._tag).toBe("Failure")
        yield* goals.pause(target, "user_paused")
        const paused = yield* operations
          .start(session.id, { id: MemoryOperation.ID.create() })
          .pipe(Effect.provideService(SessionGoalUsage.Current, attempt), Effect.result)
        expect(paused._tag).toBe("Failure")
        if (paused._tag === "Failure") expect(paused.failure.code).toBe("unsupported")
        expect(yield* operations.list(session.id)).toEqual([])
        expect(yield* operations.list(child.id)).toEqual([])
        expect(yield* llm.calls).toBe(0)
      }),
    ),
  30000,
)

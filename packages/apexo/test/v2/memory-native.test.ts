import { symlink } from "node:fs/promises"
import { eq } from "drizzle-orm"
import { Database } from "@apexo/core/database/database"
import { EventV2 } from "@apexo/core/event"
import { EventTable } from "@apexo/core/event/sql"
import { SessionV1 } from "@apexo/core/v1/session"
import { SessionIncarnation } from "@apexo/core/session/incarnation"
import { SessionManagedChild } from "@apexo/core/session/managed-child"
import { SessionCommandSandbox } from "@apexo/core/session/command-sandbox"
import { Workflow } from "@apexo/schema/workflow"
import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Effect, Fiber, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { PermissionV2 } from "@apexo/core/permission"
import { MemoryV2Catalog } from "@apexo/core/memory-v2-catalog"
import { Location } from "@apexo/core/location"
import { MemoryNative } from "@apexo/core/memory-native"
import { MemoryMaintenance } from "@apexo/core/memory-maintenance"
import { ModelsDev } from "@apexo/core/models-dev"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionMemoryModeNative } from "@apexo/core/session/memory-mode-native"
import { SessionMessage } from "@apexo/core/session/message"
import { AgentV2 } from "@apexo/core/agent"
import { ToolRegistry } from "@apexo/core/tool/registry"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const fixture = <A, E>(
  body: (input: {
    home: string
    directory: string
    session: SessionV2.Info
  }) => Effect.Effect<
    A,
    E,
    | MemoryNative.Service
    | ToolRegistry.Service
    | SessionV2.Service
    | SessionMemoryModeNative.Service
    | SessionLifecycle.Service
    | PermissionV2.Service
    | Location.Service
    | Database.Service
    | EventV2.Service
    | SessionManagedChild.Service
    | SessionCommandSandbox.Service
  >,
  config: Record<string, unknown> = {},
  git = false,
) =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped({ git })
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, "apexo.json"),
        JSON.stringify({ permissions: [{ action: "*", resource: "*", effect: "allow" }], ...config }),
      ),
    )
    return yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const locations = yield* LocationServiceMap.Service
      const session = yield* sessions.create({
        location: { directory: AbsolutePath.make(directory) },
        agent: AgentV2.ID.make("build"),
      })
      return yield* body({ home, directory, session }).pipe(Effect.provide(locations.get(session.location)))
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(
          LayerNode.group([
            SessionV2.node,
            LocationServiceMap.node,
            SessionMemoryModeNative.node,
            SessionLifecycle.node,
            Database.node,
            EventV2.node,
            SessionManagedChild.node,
            SessionCommandSandbox.node,
          ]),
          [
            [SessionExecution.node, SessionExecution.noopLayer],
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

it.live(
  "native Memory defaults off, toggles without provider work, and settles canonical legacy tools",
  () =>
    fixture(({ session }) =>
      Effect.gen(function* () {
        const memory = yield* MemoryNative.Service
        const registry = yield* ToolRegistry.Service
        expect((yield* memory.status(session.id)).info).toMatchObject({ enabled: false, source: "default" })
        const unavailable = yield* memory.materialize(session.id, yield* registry.materialize())
        expect(unavailable.definitions.some((tool) => tool.name === "memory")).toBe(false)
        expect((yield* memory.toggle(session.id, true)).info.enabled).toBe(true)
        const tools = yield* memory.materialize(session.id, yield* registry.materialize())
        expect(
          tools.definitions
            .filter((tool) => tool.name.startsWith("memory"))
            .map((tool) => tool.name)
            .sort(),
        ).toEqual(["memory", "memory_get", "memory_search"])
        const execute = (name: string, input: unknown) =>
          tools.settle({
            sessionID: session.id,
            agent: AgentV2.ID.make("build"),
            assistantMessageID: SessionMessage.ID.make("msg_nativeMemory"),
            call: { type: "tool-call", id: name, name, input },
          })
        const saved = yield* execute("memory", { operation: "remember", content: "NATIVE_DURABLE_RETRIEVAL_FACT" })
        expect(saved.result.type).not.toBe("error")
        const notes = yield* memory.list(session.id)
        expect(notes).toHaveLength(1)
        const selected = yield* memory.preview(session.id, notes[0]!.path)
        expect(selected.content).toContain("NATIVE_DURABLE_RETRIEVAL_FACT")
        expect(
          (yield* execute("memory_search", { query: "NATIVE_DURABLE_RETRIEVAL_FACT", min_score: 0 })).result.type,
        ).not.toBe("error")
        expect((yield* execute("memory_get", { path: selected.path, from: 1, lines: 2 })).result.type).not.toBe("error")
        expect(
          (yield* memory.forget(session.id, { path: selected.path, hash: "0".repeat(64) }).pipe(Effect.result))._tag,
        ).toBe("Failure")
        expect(yield* memory.forget(session.id, { path: selected.path, hash: selected.hash! })).toBe(true)
        expect(yield* memory.list(session.id)).toEqual([])
        yield* memory.toggle(session.id, false)
        expect(
          (yield* execute("memory", { operation: "remember", content: "STALE_ADVERTISED_TOOL" })).result.type,
        ).toBe("error")
      }),
    ),
  20000,
)

it.live(
  "native Memory refuses configured read/edit denial",
  () =>
    fixture(
      ({ session, home, directory }) =>
        Effect.gen(function* () {
          const memory = yield* MemoryNative.Service
          const registry = yield* ToolRegistry.Service
          yield* memory.toggle(session.id, true)
          const file = WorkspaceMemory.file(directory, home)
          yield* Effect.promise(() => Bun.write(file, "# Memory\nPRIVATE_NOTE"))
          const tools = yield* registry.materialize()
          const result = yield* tools.settle({
            sessionID: session.id,
            agent: AgentV2.ID.make("build"),
            assistantMessageID: SessionMessage.ID.make("msg_nativeDenied"),
            call: {
              type: "tool-call",
              id: "denied",
              name: "memory",
              input: { operation: "remember", content: "MUST_NOT_WRITE" },
            },
          })
          expect(result.result.type).toBe("error")
          expect(yield* memory.list(session.id)).toEqual([])
          expect((yield* memory.preview(session.id, file).pipe(Effect.result))._tag).toBe("Failure")
          expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("# Memory\nPRIVATE_NOTE")
        }),
      {
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: "deny" },
          { action: "edit", resource: "*", effect: "deny" },
        ],
      },
    ),
  20000,
)

it.live(
  "V2 selection is durable and never exposes legacy tool writes",
  () =>
    fixture(
      ({ session }) =>
        Effect.gen(function* () {
          const memory = yield* MemoryNative.Service
          const registry = yield* ToolRegistry.Service
          expect((yield* memory.status(session.id)).backend).toBe("v2")
          expect(
            (yield* memory.materialize(session.id, yield* registry.materialize())).definitions.some((tool) =>
              tool.name.startsWith("memory"),
            ),
          ).toBe(false)
          const result = yield* memory
            .note(
              { operation: "remember", content: "NO_LEGACY_WRITE" },
              {
                sessionID: session.id,
                agent: AgentV2.ID.make("build"),
                assistantMessageID: SessionMessage.ID.make("msg_nativeV2"),
                toolCallID: "v2",
              },
            )
            .pipe(Effect.result)
          expect(result._tag).toBe("Failure")
          if (result._tag === "Failure") expect(result.failure.code).toBe("unsupported")
        }),
      { memory_v2: { enabled: true } },
    ),
  20000,
)

it.live(
  "native mode revisions fence delayed commits across disable and same-ID deletion",
  () =>
    fixture(({ session }) =>
      Effect.gen(function* () {
        const memory = yield* MemoryNative.Service
        const mode = yield* SessionMemoryModeNative.Service
        const sessions = yield* SessionV2.Service
        const lifecycle = yield* SessionLifecycle.Service
        const first = yield* memory.toggle(session.id, true)
        yield* memory.toggle(session.id, false)
        yield* memory.toggle(session.id, true)
        const writes: string[] = []
        expect(
          (yield* mode
            .commit(
              session.id,
              {},
              first.revision,
              Effect.sync(() => writes.push("old")),
            )
            .pipe(Effect.result))._tag,
        ).toBe("Failure")
        const claim = yield* lifecycle.capture(session.id)
        yield* sessions.remove(session.id)
        yield* sessions.create({ id: session.id, location: session.location })
        expect((yield* lifecycle.owned(claim, mode.get(session.id, {})).pipe(Effect.result))._tag).toBe("Failure")
        expect((yield* memory.status(session.id)).info.enabled).toBe(false)
        expect(writes).toEqual([])
      }),
    ),
  20000,
)

it.live(
  "Memory clear fences a write held at real native permission approval",
  () =>
    fixture(
      ({ session, directory, home }) =>
        Effect.gen(function* () {
          const memory = yield* MemoryNative.Service
          const permission = yield* PermissionV2.Service
          yield* memory.toggle(session.id, true)
          const file = WorkspaceMemory.file(directory, home)
          yield* Effect.promise(() => Bun.write(file, "# Memory\nOLD_NOTE"))
          const writer = yield* memory
            .note(
              { operation: "remember", content: "MUST_NOT_RETURN_AFTER_CLEAR" },
              {
                sessionID: session.id,
                agent: AgentV2.ID.make("build"),
                assistantMessageID: SessionMessage.ID.make("msg_memoryClear"),
                toolCallID: "clear",
              },
            )
            .pipe(Effect.result, Effect.forkChild)
          const pending = yield* pollWithTimeout(
            permission.forSession(session.id).pipe(Effect.map((items) => items.find((item) => item.action === "edit"))),
            "Memory edit permission did not arrive",
            "3 seconds",
          )
          yield* Effect.promise(() => MemoryMaintenance.clear({ home, root: path.dirname(file) }, "workspace", true))
          yield* permission.reply({ requestID: pending.id, reply: "once" })
          expect((yield* Fiber.join(writer))._tag).toBe("Failure")
          expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
        }),
      {
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "edit", resource: "*", effect: "ask" },
        ],
      },
    ),
  20000,
)

it.live(
  "deletion joins a Memory permission wait and same-ID recreation cannot receive its write",
  () =>
    fixture(
      ({ session, directory, home }) =>
        Effect.gen(function* () {
          const memory = yield* MemoryNative.Service
          const permission = yield* PermissionV2.Service
          const sessions = yield* SessionV2.Service
          yield* memory.toggle(session.id, true)
          const writer = yield* memory
            .note(
              { operation: "remember", content: "STALE_DELETED_NOTE" },
              {
                sessionID: session.id,
                agent: AgentV2.ID.make("build"),
                assistantMessageID: SessionMessage.ID.make("msg_memoryDelete"),
                toolCallID: "delete",
              },
            )
            .pipe(Effect.exit, Effect.forkChild)
          yield* pollWithTimeout(
            permission.forSession(session.id).pipe(Effect.map((items) => items.find((item) => item.action === "edit"))),
            "Memory edit permission did not arrive",
            "3 seconds",
          )
          yield* sessions.remove(session.id)
          expect((yield* Fiber.join(writer))._tag).toBe("Failure")
          yield* sessions.create({ id: session.id, location: session.location })
          expect((yield* memory.status(session.id)).info.enabled).toBe(false)
          expect(yield* Effect.promise(() => Bun.file(WorkspaceMemory.file(directory, home)).exists())).toBe(false)
        }),
      {
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "edit", resource: "*", effect: "ask" },
        ],
      },
    ),
  20000,
)

it.live(
  "native catalog does not import old fallback notes and remember preserves them",
  () =>
    fixture(
      ({ session, directory, home }) =>
        Effect.gen(function* () {
          const memory = yield* MemoryNative.Service
          const location = yield* Location.Service
          yield* memory.toggle(session.id, true)
          const old = WorkspaceMemory.file(directory, home)
          const target = WorkspaceMemory.file(directory, home, { projectID: location.project.id })
          expect(target).not.toBe(old)
          yield* Effect.promise(() => Bun.write(old, "# Memory\nOLDER_UNMIGRATED_KNOWLEDGE"))
          expect(yield* memory.list(session.id)).toEqual([])
          expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
          expect(
            (yield* memory
              .note(
                { operation: "remember", content: "NEW_NOTE" },
                {
                  sessionID: session.id,
                  agent: AgentV2.ID.make("build"),
                  assistantMessageID: SessionMessage.ID.make("msg_memoryMigration"),
                  toolCallID: "migration",
                },
              )
              .pipe(Effect.result))._tag,
          ).toBe("Failure")
          expect(yield* Effect.promise(() => Bun.file(old).text())).toContain("OLDER_UNMIGRATED_KNOWLEDGE")
          expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
        }),
      {},
      true,
    ),
  20000,
)

it.live(
  "native V2 passive catalog selects V2 roots and forget uses the reviewed hash",
  () =>
    fixture(
      ({ session, directory, home }) =>
        Effect.gen(function* () {
          const memory = yield* MemoryNative.Service
          const location = yield* Location.Service
          const saved = yield* MemoryV2Catalog.remember(
            { home, directory, projectID: location.project.id, permitted: () => true },
            { content: "V2_CATALOG_FACT", scope: "workspace" },
          )
          expect((yield* memory.list(session.id)).some((note) => note.path === saved.path)).toBe(true)
          const note = yield* memory.preview(session.id, saved.path)
          expect(note.content).toContain("V2_CATALOG_FACT")
          expect(yield* memory.forget(session.id, { path: note.path, hash: note.hash! })).toBe(true)
        }),
      { memory_v2: { enabled: true } },
    ),
  20000,
)

it.live(
  "Memory public management cannot recover managed-child authority from editable metadata",
  () =>
    fixture(({ session }) =>
      Effect.gen(function* () {
        const memory = yield* MemoryNative.Service
        const database = yield* Database.Service
        const events = yield* EventV2.Service
        const managed = yield* SessionManagedChild.Service
        const sandbox = yield* SessionCommandSandbox.Service
        const created = yield* SessionIncarnation.created(database.db, session.id)
        const event = yield* database.db
          .select()
          .from(EventTable)
          .where(eq(EventTable.id, EventV2.ID.make(created!)))
          .get()
        const original = yield* Schema.decodeUnknownEffect(SessionV1.Event.Created.data)(event!.data)
        const owner: SessionManagedChild.Owner = { kind: "workflow", runID: Workflow.ID.create(), key: "memory" }
        const authority = yield* managed.capture(session.id, owner)
        const policy = yield* sandbox.capture(session.id)
        const id = SessionV2.ID.create()
        const prepared = yield* sandbox.prepareChild(policy, id)
        const info = { ...original.info, id, parentID: session.id, metadata: {} }
        yield* events.publish(
          SessionV1.Event.Created,
          { sessionID: id, info },
          {
            id: prepared.eventID,
            location: session.location,
            commit: () =>
              prepared.commit.pipe(
                Effect.andThen(managed.commitCreated(authority, id, prepared.eventID)),
                Effect.orDie,
              ),
          },
        )
        yield* events.publish(
          SessionV1.Event.Updated,
          { sessionID: id, info: { ...info, metadata: { memory: "allowed" } } },
          { location: session.location },
        )
        for (const operation of [
          memory.status(id).pipe(Effect.asVoid),
          memory.toggle(id, true).pipe(Effect.asVoid),
          memory.list(id).pipe(Effect.asVoid),
        ]) {
          const result = yield* operation.pipe(Effect.result)
          expect(result._tag).toBe("Failure")
          if (result._tag === "Failure") expect(result.failure.code).toBe("unsupported")
        }
        expect((yield* memory.toggle(session.id, true)).info.enabled).toBe(true)
      }),
    ),
  20000,
)

it.live(
  "Memory tool execution preserves captured parent hard denial even when child permits writes",
  () =>
    fixture(
      ({ session, home, directory }) =>
        Effect.gen(function* () {
          const memory = yield* MemoryNative.Service
          const permission = yield* PermissionV2.Service
          const sessions = yield* SessionV2.Service
          const parent = yield* sessions.create({ location: session.location, agent: AgentV2.ID.make("restricted") })
          const inherited = yield* permission.capture(parent.id)
          yield* memory.toggle(session.id, true)
          const result = yield* memory
            .note(
              { operation: "remember", content: "MUST_NOT_SAVE" },
              {
                sessionID: session.id,
                agent: AgentV2.ID.make("build"),
                assistantMessageID: SessionMessage.ID.make("msg_memoryInherited"),
                toolCallID: "inherited",
              },
            )
            .pipe(Effect.provideService(PermissionV2.Inherited, new Map([[session.id, inherited]])), Effect.result)
          expect(result._tag).toBe("Failure")
          expect(yield* permission.forSession(session.id)).toEqual([])
          expect(yield* Effect.promise(() => Bun.file(WorkspaceMemory.file(directory, home)).exists())).toBe(false)
        }),
      { agents: { restricted: { permissions: [{ action: "edit", resource: "*", effect: "deny" }] } } },
    ),
  20000,
)

it.live(
  "disabling Memory during approval rejects the eventual write without clearing existing notes",
  () =>
    fixture(
      ({ session, directory, home }) =>
        Effect.gen(function* () {
          const memory = yield* MemoryNative.Service
          const permission = yield* PermissionV2.Service
          yield* memory.toggle(session.id, true)
          const file = WorkspaceMemory.file(directory, home)
          yield* Effect.promise(() => Bun.write(file, "# Memory\nPRESERVED_BEFORE_DISABLE"))
          const writer = yield* memory
            .note(
              { operation: "remember", content: "STALE_AFTER_DISABLE" },
              {
                sessionID: session.id,
                agent: AgentV2.ID.make("build"),
                assistantMessageID: SessionMessage.ID.make("msg_memoryDisable"),
                toolCallID: "disable",
              },
            )
            .pipe(Effect.result, Effect.forkChild)
          const pending = yield* pollWithTimeout(
            permission.forSession(session.id).pipe(Effect.map((items) => items.find((item) => item.action === "edit"))),
            "Memory edit approval did not arrive",
            "3 seconds",
          )
          yield* memory.toggle(session.id, false)
          yield* permission.reply({ requestID: pending.id, reply: "once" })
          const result = yield* Fiber.join(writer)
          expect(result._tag).toBe("Failure")
          if (result._tag === "Failure") expect(result.failure.code).toBe("changed")
          expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("# Memory\nPRESERVED_BEFORE_DISABLE")
        }),
      {
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "edit", resource: "*", effect: "ask" },
        ],
      },
    ),
  20000,
)

it.live(
  "passive Memory catalog uses the specific workspace external-directory denial",
  () =>
    fixture(
      ({ session, home, directory }) =>
        Effect.gen(function* () {
          const memory = yield* MemoryNative.Service
          const location = yield* Location.Service
          yield* memory.toggle(session.id, true)
          const workspace = WorkspaceMemory.file(directory, home, { projectID: location.project.id })
          const global = WorkspaceMemory.file(directory, home, { scope: "global" })
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(workspace, "# Memory\nWORKSPACE_MUST_STAY_PRIVATE"),
              Bun.write(global, "# Memory\nGLOBAL_IS_ALLOWED"),
            ]),
          )
          const notes = yield* memory.list(session.id)
          expect(notes.map((note) => note.path)).toEqual([global])
          const denied = yield* memory.preview(session.id, workspace).pipe(Effect.result)
          expect(denied._tag).toBe("Failure")
          if (denied._tag === "Failure") expect(denied.failure.code).toBe("forbidden")
          expect((yield* memory.preview(session.id, global)).content).toContain("GLOBAL_IS_ALLOWED")
        }),
      {
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "external_directory", resource: "**/project-*/*", effect: "deny" },
        ],
      },
      true,
    ),
  20000,
)

it.live(
  "non-migrating Memory appends through a validated home alias",
  () =>
    fixture(({ home, directory }) =>
      Effect.gen(function* () {
        const alias = path.join(directory, "home-alias")
        yield* Effect.promise(() => symlink(home, alias, "dir"))
        yield* Effect.promise(() =>
          WorkspaceMemory.update(
            directory,
            { operation: "remember", content: "FIRST_ALIAS_NOTE" },
            alias,
            {},
            { migrate: false },
          ),
        )
        const second = yield* Effect.promise(() =>
          WorkspaceMemory.update(
            directory,
            { operation: "remember", content: "SECOND_ALIAS_NOTE" },
            alias,
            {},
            { migrate: false },
          ),
        )
        expect(second).toContain("FIRST_ALIAS_NOTE")
        expect(second).toContain("SECOND_ALIAS_NOTE")
      }),
    ),
  20000,
)

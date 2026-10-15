import { expect } from "bun:test"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import path from "node:path"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Config } from "@apexo/core/config"
import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { Location } from "@apexo/core/location"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { MemoryContextNative } from "@apexo/core/memory-context-native"
import { MemoryV2Catalog } from "@apexo/core/memory-v2-catalog"
import { ModelsDev } from "@apexo/core/models-dev"
import { PermissionV2 } from "@apexo/core/permission"
import { AgentV2 } from "@apexo/core/agent"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionStore } from "@apexo/core/session/store"
import { SessionMemoryModeTable } from "@apexo/core/session/sql"
import { SystemContext } from "@apexo/core/system-context"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

it.live("native memory keeps its selection and withdraws it when session authority or mode changes", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, "apexo.json"),
        JSON.stringify(
          Schema.decodeUnknownSync(Config.Info)({
            memory_v2: { enabled: true },
            agents: {
              reader: {
                permissions: [{ action: "read", resource: "*", effect: "allow" }],
              },
              blocked: {
                permissions: [{ action: "read", resource: "*", effect: "deny" }],
              },
              undecided: {
                permissions: [{ action: "read", resource: "*", effect: "ask" }],
              },
            },
          }),
        ),
      ),
    )
    return yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* SessionStore.Service
      const locations = yield* LocationServiceMap.Service
      const database = yield* Database.Service
      const session = yield* sessions.create({
        location: { directory: AbsolutePath.make(directory) },
        agent: AgentV2.ID.make("reader"),
      })
      yield* Effect.gen(function* () {
        const location = yield* Location.Service
        const memory = yield* MemoryContextNative.Service
        const permission = yield* PermissionV2.Service
        const input = {
          home,
          directory,
          projectID: location.project.id,
          permitted: () => true,
        }
        const firstNote = yield* MemoryV2Catalog.remember(input, {
          content: "NATIVE_FIRST_MEMORY",
          scope: "workspace",
        })
        const first = yield* SystemContext.initialize(yield* memory.load(session.id))
        expect(first.baseline).toContain(path.basename(firstNote.path))
        const laterNote = yield* MemoryV2Catalog.remember(input, {
          content: "NATIVE_LATER_MEMORY",
          scope: "workspace",
        })
        const second = yield* SystemContext.initialize(yield* memory.load(session.id))
        expect(second.baseline).toBe(first.baseline)
        expect(second.baseline).not.toContain(path.basename(laterNote.path))

        yield* store.setPermissions({
          sessionID: session.id,
          permissions: [{ permission: "read", pattern: "*", action: "deny" }],
        })
        const revoked = yield* SystemContext.reconcile(yield* memory.load(session.id), first.snapshot)
        expect(revoked._tag).toBe("Updated")
        if (revoked._tag === "Updated") expect(revoked.text).toContain("Do not rely")
        expect(yield* permission.forSession(session.id)).toEqual([])

        yield* store.setPermissions({
          sessionID: session.id,
          permissions: [],
        })
        yield* database.db
          .insert(SessionMemoryModeTable)
          .values({ session_id: session.id, enabled: false, revision: "off" })
          .run()
          .pipe(Effect.orDie)
        expect((yield* SystemContext.initialize(yield* memory.load(session.id))).baseline).toBe("")

        const denied = yield* sessions.create({
          location: session.location,
          agent: AgentV2.ID.make("blocked"),
        })
        yield* store.setPermissions({
          sessionID: denied.id,
          permissions: [{ permission: "read", pattern: "*", action: "allow" }],
        })
        expect((yield* SystemContext.initialize(yield* memory.load(denied.id))).baseline).toBe("")
        const undecided = yield* sessions.create({
          location: session.location,
          agent: AgentV2.ID.make("undecided"),
        })
        expect((yield* SystemContext.initialize(yield* memory.load(undecided.id))).baseline).toBe("")
        expect(yield* permission.forSession(undecided.id)).toEqual([])

        const fresh = yield* sessions.create({ location: session.location, agent: AgentV2.ID.make("reader") })
        expect((yield* SystemContext.initialize(yield* memory.load(fresh.id))).baseline).toContain(
          path.basename(firstNote.path),
        )
        const preview = yield* MemoryV2Catalog.preview(input, firstNote.path)
        yield* MemoryV2Catalog.forget(input, { path: firstNote.path, hash: preview.hash! })
        const forgotten = yield* SystemContext.initialize(yield* memory.load(fresh.id))
        expect(forgotten.baseline).not.toContain(path.basename(firstNote.path))
        expect(forgotten.baseline).toContain(path.basename(laterNote.path))
      }).pipe(Effect.provide(locations.get(session.location)))
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(
          LayerNode.group([SessionV2.node, SessionStore.node, LocationServiceMap.node, Database.node]),
          [
            [SessionExecution.node, SessionExecution.noopLayer],
            [Global.node, Global.layerWith({ home })],
            [
              ModelsDev.node,
              Layer.succeed(ModelsDev.Service, { get: () => Effect.succeed({}), refresh: () => Effect.void }),
            ],
          ],
        ).pipe(
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                APEXO_RUNTIME_PROFILE: "grok-build",
              }),
            ),
          ),
        ),
      ),
    )
  }),
)

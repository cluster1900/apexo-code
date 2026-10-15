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
import { ModelsDev } from "@apexo/core/models-dev"
import { PermissionV2 } from "@apexo/core/permission"
import { AgentV2 } from "@apexo/core/agent"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionStore } from "@apexo/core/session/store"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

import { PermissionSaved } from "@apexo/core/permission/saved"
const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

it.live("native inherited authority preserves wildcard exceptions and scopes child always consent", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, "apexo.json"),
        JSON.stringify(
          Schema.decodeUnknownSync(Config.Info)({
            agents: {
              parent: {
                permissions: [
                  { action: "read", resource: "*", effect: "deny" },
                  { action: "read", resource: "public/*", effect: "allow" },
                ],
              },
              child: {
                permissions: [
                  { action: "read", resource: "*", effect: "allow" },
                  { action: "read", resource: "public/private", effect: "deny" },
                ],
              },
              asks: { permissions: [{ action: "read", resource: "*", effect: "ask" }] },
            },
          }),
        ),
      ),
    )
    return yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* SessionStore.Service
      const locations = yield* LocationServiceMap.Service
      const saved = yield* PermissionSaved.Service
      const parent = yield* sessions.create({
        location: { directory: AbsolutePath.make(directory) },
        agent: AgentV2.ID.make("parent"),
      })
      const child = yield* sessions.create({
        location: parent.location,
        agent: AgentV2.ID.make("child"),
        parentID: parent.id,
      })
      const sibling = yield* sessions.create({
        location: parent.location,
        agent: AgentV2.ID.make("child"),
        parentID: parent.id,
      })
      const asks = yield* sessions.create({ location: parent.location, agent: AgentV2.ID.make("asks") })
      return yield* Effect.gen(function* () {
        const permission = yield* PermissionV2.Service
        const location = yield* Location.Service
        yield* store.setPermissions({
          sessionID: parent.id,
          permissions: [{ permission: "read", pattern: "*", action: "allow" }],
        })
        const captured = yield* permission.capture(parent.id)
        const decoded = Schema.decodeUnknownSync(Schema.Array(PermissionV2.Authority))(
          JSON.parse(JSON.stringify(captured)),
        )
        yield* Effect.gen(function* () {
          expect((yield* permission.ask({ sessionID: child.id, action: "read", resources: ["secret"] })).effect).toBe(
            "deny",
          )
          expect(
            (yield* permission.ask({ sessionID: child.id, action: "read", resources: ["public/ok"] })).effect,
          ).toBe("allow")
          expect(
            (yield* permission.ask({ sessionID: child.id, action: "read", resources: ["public/private"] })).effect,
          ).toBe("deny")
          expect(yield* permission.forSession(child.id)).toEqual([])
        }).pipe(Effect.provideService(PermissionV2.Inherited, new Map([[child.id, decoded]])))
        const inherited = yield* permission.capture(asks.id)
        const pending = yield* Effect.gen(function* () {
          const first = yield* permission.ask({
            sessionID: child.id,
            action: "read",
            resources: ["public/ok"],
            save: ["public/*"],
          })
          const second = yield* permission.ask({
            sessionID: sibling.id,
            action: "read",
            resources: ["public/ok"],
            save: ["public/*"],
          })
          expect(first.effect).toBe("ask")
          expect(second.effect).toBe("ask")
          return { first, second }
        }).pipe(
          Effect.provideService(
            PermissionV2.Inherited,
            new Map([
              [child.id, inherited],
              [sibling.id, inherited],
            ]),
          ),
        )
        // Reply executes outside the caller's inherited context, as the real HTTP reply does.
        yield* permission.reply({ requestID: pending.first.id, reply: "always" })
        expect(yield* permission.get(pending.first.id)).toBeUndefined()
        expect(yield* permission.get(pending.second.id)).toBeDefined()
        expect(yield* saved.list({ projectID: location.project.id })).toEqual([])
        yield* Effect.gen(function* () {
          expect(
            (yield* permission.ask({ sessionID: child.id, action: "read", resources: ["public/other"] })).effect,
          ).toBe("allow")
          expect(
            (yield* permission.ask({ sessionID: sibling.id, action: "read", resources: ["public/other"] })).effect,
          ).toBe("ask")
          expect(
            (yield* permission.ask({ sessionID: child.id, action: "read", resources: ["public/private"] })).effect,
          ).toBe("deny")
        }).pipe(
          Effect.provideService(
            PermissionV2.Inherited,
            new Map([
              [child.id, inherited],
              [sibling.id, inherited],
            ]),
          ),
        )
      }).pipe(Effect.provide(locations.get(parent.location)))
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(
          LayerNode.group([
            SessionV2.node,
            SessionStore.node,
            LocationServiceMap.node,
            Database.node,
            PermissionSaved.node,
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
  }),
)

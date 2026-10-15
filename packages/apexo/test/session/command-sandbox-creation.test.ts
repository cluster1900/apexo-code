import { expect } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { EventV2 } from "@apexo/core/event"
import { SessionV1 } from "@apexo/core/v1/session"
import { SessionV2 } from "@apexo/core/session"
import { SessionCommandSandbox } from "@apexo/core/session/command-sandbox"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { AbsolutePath } from "@apexo/schema/schema"
import { Session } from "@/session/session"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Session.node,
      SessionV2.node,
      SessionCommandSandbox.node,
      EventV2.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [SessionExecution.node, SessionExecutionLocal.node],
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

it.instance(
  "legacy Created observers see explicit policy and native compatibility children inherit it atomically",
  () =>
    Effect.gen(function* () {
      const legacy = yield* Session.Service
      const native = yield* SessionV2.Service
      const policies = yield* SessionCommandSandbox.Service
      const events = yield* EventV2.Service
      const seen: string[] = []
      yield* events.listen((event) =>
        event.type !== SessionV1.Event.Created.type
          ? Effect.void
          : Effect.gen(function* () {
              seen.push(
                (yield* policies.get(
                  (yield* Schema.decodeUnknownEffect(Schema.toType(SessionV1.Event.Created.data))(event.data))
                    .sessionID,
                )).profile,
              )
            }).pipe(Effect.orDie),
      )
      const parent = yield* legacy.create({})
      expect(seen).toEqual(["off"])
      const child = yield* legacy.create({ parentID: parent.id })
      const nativeHost = yield* native.create({
        parentID: parent.id,
        location: { directory: AbsolutePath.make(parent.directory) },
      })
      expect(seen).toEqual(["off", "off", "off"])
      const created = (yield* policies.inspect(parent.id)).created
      expect((yield* policies.inspect(child.id)).parent?.createdEventID).toBe(created)
      expect((yield* policies.inspect(nativeHost.id)).parent?.createdEventID).toBe(created)
      const fork = yield* legacy.fork({ sessionID: parent.id })
      expect((yield* policies.get(fork.id)).profile).toBe("off")
    }),
)

if (process.platform === "darwin")
  it.instance("compatibility fork refuses a confined source before copying any Session", () =>
    Effect.gen(function* () {
      const legacy = yield* Session.Service
      const native = yield* SessionV2.Service
      const parent = yield* legacy.create({})
      const confined = yield* native.create({
        commandSandbox: "workspace",
        location: { directory: AbsolutePath.make(parent.directory) },
      })
      const before = yield* native.list({ directory: AbsolutePath.make(parent.directory) })
      const result = yield* legacy.fork({ sessionID: confined.id }).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      const after = yield* native.list({ directory: AbsolutePath.make(parent.directory) })
      expect(after.map((session) => session.id)).toEqual(before.map((session) => session.id))
    }),
  )

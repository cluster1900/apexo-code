import { emptyHookPreferences } from "../fixture/hook-preferences"
import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { SessionProjector } from "@apexo/core/session/projector"
import { SessionStore } from "@apexo/core/session/store"
import { AbsolutePath } from "@apexo/schema/schema"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Session.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
      SessionExecution.node,
      SessionStore.node,
      SessionHookSnapshot.node,
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

it.instance("Session deletion waits for native control cleanup before removing rows and snapshots", () =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const executions = yield* SessionExecution.Service
    const store = yield* SessionStore.Service
    const snapshots = yield* SessionHookSnapshot.Service
    const info = yield* session.create({})
    const owner = yield* snapshots.registerLocation(
      { directory: AbsolutePath.make(info.directory) },
      () => Effect.succeed({ sources: [], diagnostics: [], projectTrusted: false }),
      emptyHookPreferences,
    )
    yield* snapshots.capture(owner, info.id)
    const entered = yield* Deferred.make<void>()
    const closing = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const state = { closed: false }
    const control = yield* executions
      .control(
        info.id,
        Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.gen(function* () {
                yield* Deferred.succeed(closing, undefined)
                yield* Deferred.await(release)
                expect(yield* store.get(info.id)).toBeDefined()
                expect(yield* snapshots.get(info.id)).toBeDefined()
                state.closed = true
              }),
            )
            yield* Deferred.succeed(entered, undefined)
            return yield* Effect.never
          }),
        ),
      )
      .pipe(Effect.exit, Effect.forkChild)
    yield* Deferred.await(entered)
    yield* Effect.gen(function* () {
      const removal = yield* session.remove(info.id).pipe(Effect.forkChild)
      const first = yield* Effect.raceFirst(
        Deferred.await(closing).pipe(Effect.as("closing")),
        Fiber.join(removal).pipe(Effect.as("removed")),
      )
      expect(first).toBe("closing")
      expect(yield* store.get(info.id)).toBeDefined()
      expect(yield* snapshots.get(info.id)).toBeDefined()
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(removal)
      yield* Fiber.join(control)
      expect(state.closed).toBe(true)
      expect(yield* store.get(info.id)).toBeUndefined()
      expect(yield* snapshots.get(info.id)).toBeUndefined()
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined).pipe(Effect.andThen(executions.interrupt(info.id)))))
  }),
)

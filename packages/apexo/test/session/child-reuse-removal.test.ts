import { expect } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Deferred, Effect, Fiber, Layer, Queue } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionIncarnation } from "@apexo/core/session/incarnation"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionStore } from "@apexo/core/session/store"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

it.live(
  "parent deletion never removes an unrelated Session reusing an enumerated child ID",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      yield* Effect.promise(() => mkdir(path.join(root, "data"), { recursive: true }))
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const lifecycle = yield* SessionLifecycle.Service
        const store = yield* SessionStore.Service
        const database = yield* Database.Service
        const location = { directory: AbsolutePath.make(root) }
        const parent = yield* sessions.create({ location })
        const children = yield* Effect.all([
          sessions.create({ location, parentID: parent.id }),
          sessions.create({ location, parentID: parent.id }),
        ])
        const stopping = yield* Queue.unbounded<SessionSchema.ID>()
        const workers = yield* Effect.forEach(children, (child) =>
          Effect.gen(function* () {
            const entered = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            const fiber = yield* lifecycle
              .run(
                child.id,
                Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.ensuring(Queue.offer(stopping, child.id).pipe(Effect.andThen(Deferred.await(release)))),
                ),
              )
              .pipe(Effect.exit, Effect.forkChild)
            yield* Deferred.await(entered)
            return { id: child.id, release, fiber }
          }),
        )
        yield* Effect.gen(function* () {
          const deletion = yield* sessions.remove(parent.id).pipe(Effect.forkChild)
          // The implementation's child enumeration order is deliberately not assumed.
          const firstID = yield* Queue.take(stopping).pipe(Effect.timeout("5 seconds"))
          const held = workers.find((worker) => worker.id === firstID)!
          const reused = workers.find((worker) => worker.id !== firstID)!
          expect(deletion.pollUnsafe()).toBeUndefined()
          expect((yield* store.get(reused.id))?.parentID).toBe(parent.id)
          const original = yield* SessionIncarnation.created(database.db, reused.id)
          yield* Deferred.succeed(reused.release, undefined)
          yield* sessions.remove(reused.id).pipe(Effect.timeout("5 seconds"))
          yield* Fiber.join(reused.fiber)
          const replacement = yield* sessions.create({ id: reused.id, location })
          expect(replacement.parentID).toBeUndefined()
          const stamp = yield* SessionIncarnation.created(database.db, replacement.id)
          expect(stamp).toBeDefined()
          expect(stamp).not.toBe(original)
          yield* Deferred.succeed(held.release, undefined)
          yield* Fiber.join(deletion).pipe(
            Effect.timeoutOrElse({
              duration: "5 seconds",
              orElse: () => Effect.fail(new Error("parent deletion did not finish after child finalizer release")),
            }),
          )
          yield* Fiber.join(held.fiber)
          expect(yield* store.get(parent.id)).toBeUndefined()
          expect(yield* store.get(held.id)).toBeUndefined()
          expect((yield* store.get(replacement.id))?.id).toBe(replacement.id)
          expect((yield* store.get(replacement.id))?.parentID).toBeUndefined()
          expect(yield* SessionIncarnation.created(database.db, replacement.id)).toBe(stamp)
          expect(yield* sessions.messages({ sessionID: replacement.id })).toEqual([])
        }).pipe(
          Effect.ensuring(
            Effect.forEach(workers, (worker) => Deferred.succeed(worker.release, undefined), { discard: true }),
          ),
        )
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([
              SessionV2.node,
              SessionLifecycle.node,
              SessionStore.node,
              Database.node,
              SessionExecutionLocal.node,
            ]),
            [
              [SessionExecution.node, SessionExecutionLocal.node],
              [
                Global.node,
                Layer.succeed(Global.Service)(
                  Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
                ),
              ],
            ],
          ),
        ),
      )
    }),
  20000,
)

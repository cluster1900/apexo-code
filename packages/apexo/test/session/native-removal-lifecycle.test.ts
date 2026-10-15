import { emptyHookPreferences } from "../fixture/hook-preferences"
import { expect } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionStore } from "@apexo/core/session/store"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

it.live("native removal deletes admitted input, descendants and hook snapshot before allowing exact ID reuse", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    yield* Effect.promise(() => mkdir(path.join(root, "data"), { recursive: true }))
    yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* SessionLifecycle.Service
      const store = yield* SessionStore.Service
      const snapshots = yield* SessionHookSnapshot.Service
      const location = { directory: AbsolutePath.make(root) }
      const parent = yield* sessions.create({ location })
      const child = yield* sessions.create({ location, parentID: parent.id })
      const other = yield* sessions.create({ location })
      const messageID = SessionMessage.ID.create()
      yield* sessions.prompt({ sessionID: parent.id, id: messageID, prompt: { text: "admit only" }, resume: false })
      const late = yield* lifecycle.bind(
        parent.id,
        sessions.prompt({ sessionID: parent.id, prompt: { text: "stale" }, resume: false }),
      )
      const owner = yield* snapshots.registerLocation(
        location,
        () => Effect.succeed({ sources: [], diagnostics: [], projectTrusted: false }),
        emptyHookPreferences,
      )
      yield* snapshots.capture(owner, parent.id)
      yield* sessions.remove(parent.id)
      expect(yield* store.get(parent.id)).toBeUndefined()
      expect(yield* store.get(child.id)).toBeUndefined()
      expect(yield* store.get(other.id)).toBeDefined()
      expect(yield* snapshots.get(parent.id)).toBeUndefined()
      yield* sessions.remove(parent.id)
      const replacement = yield* sessions.create({ id: parent.id, location })
      expect(replacement.id).toBe(parent.id)
      expect(yield* sessions.messages({ sessionID: replacement.id })).toEqual([])
      expect((yield* late.pipe(Effect.flip))._tag).toBe("SessionLifecycle.Closed")
      // Removed aggregate/inbox IDs must not reconcile against the previous incarnation.
      yield* sessions.prompt({
        sessionID: replacement.id,
        id: messageID,
        prompt: { text: "replacement" },
        resume: false,
      })
      expect((yield* sessions.history({ sessionID: replacement.id, limit: 100 })).events.length).toBeGreaterThan(0)
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(
          LayerNode.group([
            SessionV2.node,
            SessionExecutionLocal.node,
            SessionStore.node,
            SessionHookSnapshot.node,
            SessionLifecycle.node,
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
)

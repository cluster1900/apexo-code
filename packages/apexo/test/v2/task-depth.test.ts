import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { SessionTaskTable } from "@apexo/core/session/task.sql"
import { SessionInputTable } from "@apexo/core/session/sql"
import { ConfigProvider, Effect, Layer, Result } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionTaskControl } from "@apexo/core/session/task-control"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { SessionIncarnation } from "@apexo/core/session/incarnation"
import { SessionMessage } from "@apexo/core/session/message"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
it.live("Task depth lineage persists, rejects forged widening and historical parent delegation", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    return yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const database = yield* Database.Service
      const tasks = yield* SessionTaskStore.Service
      const root = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
      const child = yield* sessions.create({ location: root.location, parentID: root.id })
      const rootCreated = (yield* SessionIncarnation.created(database.db, root.id))!
      const record: SessionTaskStore.Record = {
        sessionID: child.id,
        parentID: root.id,
        parentCreated: rootCreated,
        childCreated: (yield* SessionIncarnation.created(database.db, child.id))!,
        agent: AgentV2.ID.make("general"),
        authority: [],
        createdAt: Date.now(),
        delegation: { rootID: root.id, rootCreated, depth: 1, maxDepth: 2 },
      }
      yield* tasks.create(record)
      const grandchild = yield* sessions.create({ location: root.location, parentID: child.id })
      const nested: SessionTaskStore.Record = {
        ...record,
        sessionID: grandchild.id,
        parentID: child.id,
        parentCreated: record.childCreated,
        childCreated: (yield* SessionIncarnation.created(database.db, grandchild.id))!,
        delegation: { rootID: root.id, rootCreated, depth: 2, maxDepth: 2 },
      }
      for (const delegation of [
        undefined,
        { ...nested.delegation!, maxDepth: 3 },
        { ...nested.delegation!, depth: 1 },
        { ...nested.delegation!, rootCreated: "forged" },
      ]) {
        const result = yield* tasks.create({ ...nested, delegation }).pipe(Effect.result)
        expect(result._tag).toBe("Failure")
        expect(yield* tasks.read(grandchild.id)).toBeUndefined()
      }
      yield* tasks.create(nested)
      const reopened = SessionTaskStore.make(database.db)
      expect((yield* reopened.owned(child.id, grandchild.id)).delegation).toEqual(nested.delegation)
      expect((yield* reopened.owned(root.id, grandchild.id).pipe(Effect.result))._tag).toBe("Failure")
      const deeper = yield* sessions.create({ location: root.location, parentID: grandchild.id })
      expect(
        (yield* tasks
          .create({
            ...nested,
            sessionID: deeper.id,
            parentID: grandchild.id,
            parentCreated: nested.childCreated,
            childCreated: (yield* SessionIncarnation.created(database.db, deeper.id))!,
            delegation: { ...nested.delegation!, depth: 3 },
          })
          .pipe(Effect.result))._tag,
      ).toBe("Failure")
      // Simulate a historical first-level record with no captured delegation policy.
      yield* database.db
        .update(SessionTaskTable)
        .set({ data: { ...record, delegation: undefined } })
        .where(eq(SessionTaskTable.session_id, child.id))
      const historical = yield* sessions.create({ location: root.location, parentID: child.id })
      expect(
        (yield* tasks
          .create({
            ...nested,
            sessionID: historical.id,
            childCreated: (yield* SessionIncarnation.created(database.db, historical.id))!,
          })
          .pipe(Effect.result))._tag,
      ).toBe("Failure")
      yield* database.db.update(SessionTaskTable).set({ data: record }).where(eq(SessionTaskTable.session_id, child.id))
      yield* database.db
        .update(SessionTaskTable)
        .set({ data: { ...nested, delegation: { ...nested.delegation!, rootCreated: "stale" } } })
        .where(eq(SessionTaskTable.session_id, grandchild.id))
      const stale = yield* tasks.owned(child.id, grandchild.id).pipe(Effect.result)
      expect(stale._tag).toBe("Failure")
      if (stale._tag === "Failure") expect(stale.failure.code).toBe("stale")
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(
          LayerNode.group([SessionV2.node, Database.node, SessionTaskStore.node, SessionTaskControl.node]),
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

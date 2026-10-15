import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionManagedChild } from "@apexo/core/session/managed-child"
import { SessionManagedChildTable } from "@apexo/core/session/managed-child.sql"
import { SessionCommandSandbox } from "@apexo/core/session/command-sandbox"
import { SessionCommandSandboxTable } from "@apexo/core/session/command-sandbox.sql"
import { SessionTable } from "@apexo/core/session/sql"
import { SessionSchema } from "@apexo/core/session/schema"
import { Workflow } from "@apexo/schema/workflow"
import { EventV2 } from "@apexo/core/event"
import { EventTable, EventSequenceTable } from "@apexo/core/event/sql"
import { SessionV1 } from "@apexo/core/v1/session"
import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { SessionInputTable } from "@apexo/core/session/sql"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionIncarnation } from "@apexo/core/session/incarnation"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
it.live("managed child authority preserves rollback, stale refusal, historical quarantine and ordinary ID reuse", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    return yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const execution = yield* SessionExecution.Service
      const database = yield* Database.Service
      const managed = yield* SessionManagedChild.Service
      const sandbox = yield* SessionCommandSandbox.Service
      const events = yield* EventV2.Service
      const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
      const createdID = yield* SessionIncarnation.created(database.db, parent.id)
      const event = yield* database.db
        .select()
        .from(EventTable)
        .where(eq(EventTable.id, EventV2.ID.make(createdID!)))
        .get()
      const original = yield* Schema.decodeUnknownEffect(SessionV1.Event.Created.data)(event!.data)
      const owner: SessionManagedChild.Owner = { kind: "workflow", runID: Workflow.ID.create(), key: "stage:0" }
      const authority = yield* managed.capture(parent.id, owner)
      const policy = yield* sandbox.capture(parent.id)
      const publish = (id: SessionSchema.ID, fail = false, historical = false) =>
        Effect.gen(function* () {
          const prepared = yield* sandbox.prepareChild(policy, id)
          yield* events.publish(
            SessionV1.Event.Created,
            {
              sessionID: id,
              info: {
                ...original.info,
                id,
                parentID: parent.id,
                metadata: { workflowChild: JSON.stringify({ runID: owner.runID, key: owner.key }) },
              },
            },
            {
              id: prepared.eventID,
              location: parent.location,
              commit: () =>
                prepared.commit.pipe(
                  Effect.andThen(historical ? Effect.void : managed.commitCreated(authority, id, prepared.eventID)),
                  Effect.andThen(fail ? Effect.fail(new Error("Deliberate transaction rollback")) : Effect.void),
                  Effect.orDie,
                ),
            },
          )
        })
      const childID = SessionSchema.ID.create()
      yield* publish(childID)
      const record = yield* managed.require(childID, parent.id, owner)
      expect(yield* SessionIncarnation.created(database.db, childID)).toBe(EventV2.ID.make(record.childCreated))
      const rebuilt = yield* SessionManagedChild.make
      expect(yield* rebuilt.owned(childID)).toEqual(record)
      expect((yield* rebuilt.require(childID, parent.id, { ...owner, key: "other" }).pipe(Effect.result))._tag).toBe(
        "Failure",
      )
      for (const field of ["parentCreated", "childCreated"]) {
        yield* database.db
          .update(SessionManagedChildTable)
          .set({ data: { ...record, [field]: "stale-proof" } })
          .where(eq(SessionManagedChildTable.session_id, childID))
        const rejected = yield* managed.managed(childID).pipe(Effect.result)
        expect(rejected._tag).toBe("Failure")
        if (rejected._tag === "Failure") expect(rejected.failure.code).toBe("stale")
        expect(
          (yield* sessions
            .prompt({ sessionID: childID, prompt: { text: "UNOWNED" }, resume: false })
            .pipe(Effect.result))._tag,
        ).toBe("Failure")
      }
      yield* database.db
        .update(SessionManagedChildTable)
        .set({ data: { invalid: true } })
        .where(eq(SessionManagedChildTable.session_id, childID))
      const malformed = yield* managed.managed(childID).pipe(Effect.result)
      expect(malformed._tag).toBe("Failure")
      if (malformed._tag === "Failure") expect(malformed.failure.code).toBe("storage")
      yield* database.db
        .update(SessionManagedChildTable)
        .set({ data: record })
        .where(eq(SessionManagedChildTable.session_id, childID))
      const rejectedID = SessionSchema.ID.create()
      expect((yield* publish(rejectedID, true).pipe(Effect.exit))._tag).toBe("Failure")
      expect(yield* managed.read(rejectedID)).toBeUndefined()
      expect(yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, rejectedID))).toEqual([])
      expect(
        yield* database.db
          .select()
          .from(SessionCommandSandboxTable)
          .where(eq(SessionCommandSandboxTable.session_id, rejectedID)),
      ).toEqual([])
      expect(yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, rejectedID))).toEqual([])
      expect(
        yield* database.db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, rejectedID)),
      ).toEqual([])
      // Explicit synthetic pre-upgrade publication: immutable marker but no private ownership row.
      const oldID = SessionSchema.ID.create()
      yield* publish(oldID, false, true)
      expect(yield* managed.read(oldID)).toBeUndefined()
      expect(yield* rebuilt.managed(oldID)).toBe(true)
      const resumed = yield* execution.resume(oldID).pipe(Effect.result)
      expect(resumed._tag).toBe("Failure")
      if (resumed._tag === "Failure") expect(resumed.failure._tag).toBe("SessionManagedChildFailure")
      yield* execution.wake(oldID)
      expect((yield* execution.active).has(oldID)).toBe(false)
      expect((yield* rebuilt.owned(oldID).pipe(Effect.result))._tag).toBe("Failure")
      yield* events.publish(
        SessionV1.Event.Updated,
        { sessionID: oldID, info: { ...original.info, id: oldID, parentID: parent.id, metadata: {} } },
        { location: parent.location },
      )
      expect(yield* managed.managed(oldID)).toBe(true)
      expect(
        (yield* sessions.prompt({ sessionID: oldID, prompt: { text: "UNOWNED" }, resume: false }).pipe(Effect.result))
          ._tag,
      ).toBe("Failure")
      expect(
        yield* database.db.select().from(SessionInputTable).where(eq(SessionInputTable.session_id, oldID)),
      ).toEqual([])
      yield* sessions.remove(parent.id)
      expect(yield* managed.read(childID)).toBeUndefined()
      const recreated = yield* sessions.create({ id: childID, location: parent.location })
      expect(yield* managed.managed(recreated.id)).toBe(false)
      expect(
        (yield* sessions
          .prompt({ sessionID: recreated.id, prompt: { text: "ORDINARY" }, resume: false })
          .pipe(Effect.result))._tag,
      ).toBe("Success")
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(
          LayerNode.group([
            SessionV2.node,
            SessionExecutionLocal.node,
            Database.node,
            SessionManagedChild.node,
            SessionCommandSandbox.node,
            EventV2.node,
            SessionLifecycle.node,
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
  }),
)

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
it.live("native Task private receipts preserve exact retries, ownership, terminal settlement and restart refusal", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    return yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const database = yield* Database.Service
      const tasks = yield* SessionTaskStore.Service
      const control = yield* SessionTaskControl.Service
      const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
      const child = yield* sessions.create({ location: parent.location, parentID: parent.id })
      const unrelated = yield* sessions.create({ location: parent.location })
      const record: SessionTaskStore.Record = {
        sessionID: child.id,
        parentID: parent.id,
        parentCreated: (yield* SessionIncarnation.created(database.db, parent.id))!,
        childCreated: (yield* SessionIncarnation.created(database.db, child.id))!,
        agent: AgentV2.ID.make("general"),
        authority: [{ rules: [{ action: "read", resource: "secret", effect: "deny" }], all: [] }],
        createdAt: Date.now(),
      }
      yield* tasks.create(record)
      expect(yield* tasks.managed(unrelated.id)).toBe(false)
      for (const field of ["parentCreated", "childCreated"]) {
        yield* database.db
          .update(SessionTaskTable)
          .set({ data: { ...record, [field]: "stale-proof" } })
          .where(eq(SessionTaskTable.session_id, child.id))
        const managed = yield* tasks.managed(child.id).pipe(Effect.result)
        expect(managed._tag).toBe("Failure")
        if (managed._tag === "Failure") expect(managed.failure.code).toBe("stale")
        const admission = yield* sessions
          .prompt({ sessionID: child.id, prompt: { text: "MUST_NOT_ADMIT" }, resume: false })
          .pipe(Effect.result)
        expect(admission._tag).toBe("Failure")
        if (admission._tag === "Failure") expect(admission.failure._tag).toBe("Session.ManagedInputError")
        expect(
          yield* database.db.select().from(SessionInputTable).where(eq(SessionInputTable.session_id, child.id)),
        ).toEqual([])
      }
      yield* database.db.update(SessionTaskTable).set({ data: record }).where(eq(SessionTaskTable.session_id, child.id))

      const request: SessionTaskStore.Request = { description: "fixture", prompt: "work", agent: record.agent }
      const first = { id: "launch-one", sessionID: child.id, parentID: parent.id, request }
      expect((yield* tasks.begin(first)).status).toBe("running")
      // The launch is durable while its worker has not yet registered with BackgroundJob.
      const beforeSettlement = yield* control.cancel(parent.id, child.id).pipe(Effect.result)
      yield* control.settlement(first.id)
      const beforeStart = yield* control.cancel(parent.id, child.id).pipe(Effect.timeout("1 second"), Effect.result)
      const rejection = (value: Result.Result<unknown, unknown>) =>
        value._tag === "Failure" && value.failure instanceof SessionTaskStore.Failure ? value.failure.code : value._tag
      expect([rejection(beforeSettlement), rejection(beforeStart)]).toEqual(["busy", "busy"])
      expect((yield* tasks.launch(first.id))?.status).toBe("running")
      const absentReceipt = yield* Effect.scoped(
        Effect.gen(function* () {
          const settlement = yield* control.settlement("missing-receipt")
          yield* settlement.finish
          return yield* settlement.wait.pipe(Effect.result)
        }),
      )
      expect(rejection(absentReceipt)).toBe("stale")
      const closedOwner = yield* Effect.scoped(control.settlement("closed-owner"))
      expect(rejection(yield* closedOwner.wait.pipe(Effect.result))).toBe("stale")
      expect((yield* tasks.begin(first).pipe(Effect.result))._tag).toBe("Failure")
      expect((yield* tasks.owned(unrelated.id, child.id).pipe(Effect.result))._tag).toBe("Failure")
      const restarted = SessionTaskStore.make(database.db)
      const blocked = yield* restarted.begin(first).pipe(Effect.result)
      expect(blocked._tag).toBe("Failure")
      if (blocked._tag === "Failure") expect(blocked.failure.code).toBe("restart")
      const replyID = SessionMessage.ID.create()
      yield* tasks.finish({ ...first, status: "completed", replyID })
      expect((yield* restarted.begin(first)).replyID).toBe(replyID)
      expect((yield* tasks.finish({ ...first, status: "cancelled" })).status).toBe("completed")
      expect(
        (yield* tasks.begin({ ...first, request: { ...request, prompt: "changed" } }).pipe(Effect.result))._tag,
      ).toBe("Failure")
      expect((yield* restarted.read(child.id))?.authority).toEqual(record.authority)
      const followup = { ...first, id: "launch-two", request: { ...request, prompt: "follow up", taskID: child.id } }
      expect((yield* restarted.begin(followup)).status).toBe("running")
      expect((yield* tasks.finish({ ...followup, status: "completed" }).pipe(Effect.result))._tag).toBe("Failure")
      yield* restarted.finish({ ...followup, status: "failed", message: "fixture failure" })
      expect((yield* tasks.latest(parent.id, child.id))?.status).toBe("failed")
      yield* sessions.remove(parent.id)
      expect(yield* tasks.read(child.id)).toBeUndefined()
      expect(yield* tasks.launch(first.id)).toBeUndefined()
      const replacement = yield* sessions.create({ id: parent.id, location: parent.location })
      expect(yield* SessionIncarnation.created(database.db, replacement.id)).not.toBe(record.parentCreated)
      expect(yield* tasks.managed(replacement.id)).toBe(false)
      expect((yield* tasks.owned(replacement.id, child.id).pipe(Effect.result))._tag).toBe("Failure")
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

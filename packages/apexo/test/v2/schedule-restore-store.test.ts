import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { AbsolutePath } from "@apexo/schema/schema"
import { Model } from "@apexo/schema/model"
import { Provider } from "@apexo/schema/provider"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionScheduleStore } from "@apexo/core/session/schedule-store"
import { SessionScheduleTable } from "@apexo/core/session/schedule.sql"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionInputExecution } from "@apexo/core/session/input-execution"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
it.live(
  "Explicit restoration preserves future phase, pauses, foreign unfinished work and durable headless admission",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const database = yield* Database.Service
        const schedules = yield* SessionScheduleStore.Service
        const inputs = yield* SessionInputExecution.Service
        const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const input = {
          sessionID: parent.id,
          messageID: SessionMessage.ID.create(),
          callID: "restore-future",
          request: { prompt: "Check future state", intervalSeconds: 60, durable: false, fireImmediately: false },
          authority: {
            parentAgent: AgentV2.ID.make("build"),
            agent: AgentV2.ID.make("general"),
            model: { providerID: Provider.ID.make("fixture"), id: Model.ID.make("model") },
            authority: [],
          },
        }
        const future = (yield* schedules.create(input)).record
        const restarted = SessionScheduleStore.make(database.db, "restored-process")
        expect(restarted.state(future, Date.now()).blockedReason).toBe("restart_required")
        expect(yield* restarted.claim(parent.id, future.id)).toBeUndefined()
        expect(yield* restarted.restore(future, () => true)).toBe("restored")
        const restored = yield* restarted.owned(parent.id, future.id)
        expect(restored.nextFireAt).toBe(future.nextFireAt)
        expect(yield* restarted.restore(restored, () => true)).toBe("already_active")
        expect((yield* restarted.owned(parent.id, future.id)).revision).toBe(restored.revision)
        expect(yield* restarted.claim(parent.id, future.id)).toBeUndefined()

        const overdue = (yield* schedules.create({ ...input, callID: "restore-overdue" })).record
        const due = { ...overdue, nextFireAt: Date.now() - 145_000 }
        yield* database.db.update(SessionScheduleTable).set({ data: due }).where(eq(SessionScheduleTable.id, due.id))
        const before = Date.now()
        expect(yield* restarted.restore(due, () => true)).toBe("restored")
        const advanced = yield* restarted.owned(parent.id, due.id)
        expect(advanced.nextFireAt).toBeGreaterThan(before)
        expect((advanced.nextFireAt - due.nextFireAt) % 60_000).toBe(0)
        expect(advanced.nextFireAt).toBeLessThanOrEqual(Date.now() + 60_000)
        expect(yield* restarted.claim(parent.id, due.id)).toBeUndefined()

        for (const reason of [undefined, "stopped"] as const) {
          const created = (yield* schedules.create({ ...input, callID: `pause-${reason}` })).record
          const paused = yield* schedules.pause(parent.id, created.id, reason)
          expect(restarted.state(paused, Date.now())).toEqual({ status: "paused", blockedReason: reason })
          expect(yield* restarted.restore(paused, () => true)).toBe(reason === "stopped" ? "stopped" : "paused")
          expect((yield* restarted.owned(parent.id, created.id)).owner).toBe(schedules.owner)
          expect(yield* restarted.stopRestoration(created)).toBe(false)
          expect((yield* restarted.owned(parent.id, created.id)).blockedReason).toBe(reason)
        }
        const retired = (yield* schedules.create({ ...input, callID: "retired" })).record
        const inactive = yield* schedules.pause(parent.id, retired.id, "restart_required")
        expect(yield* restarted.restore(inactive, () => true)).toBe("restored")

        const held = (yield* schedules.create({
          ...input,
          callID: "unfinished",
          request: { ...input.request, fireImmediately: true },
        })).record
        const occurrence = yield* schedules.claim(parent.id, held.id)
        expect(occurrence?.status).toBe("claimed")
        expect(yield* restarted.restore(yield* schedules.owned(parent.id, held.id), () => true)).toBe(
          "unfinished_owner",
        )
        expect(yield* schedules.occurrences(held.id)).toEqual([occurrence!])
        const heldSnapshot = yield* schedules.owned(parent.id, held.id)
        expect(yield* restarted.stopRestoration(heldSnapshot)).toBe(true)
        expect(yield* schedules.occurrences(held.id)).toEqual([occurrence!])
        expect((yield* schedules.owned(parent.id, held.id)).blockedReason).toBe("stopped")
        expect((yield* schedules.owned(parent.id, held.id)).owner).toBe(schedules.owner)
        expect(yield* restarted.stopRestoration(heldSnapshot)).toBe(false)

        const stale = (yield* schedules.create({ ...input, callID: "stale" })).record
        yield* schedules.pause(parent.id, stale.id)
        expect(yield* restarted.restore(stale, () => true)).toBe("changed")
        const fenced = (yield* schedules.create({ ...input, callID: "fenced" })).record
        expect(yield* restarted.restore(fenced, () => false)).toBe("changed")
        const headless = yield* sessions.prompt({
          sessionID: parent.id,
          prompt: { text: "headless admission only" },
          executionPolicy: { mode: "headless", permissions: "reject" },
          resume: false,
        })
        expect(yield* restarted.restorationBlock(parent.id)).toBe("headless_input")
        expect(yield* restarted.restore(fenced, () => true)).toBe("headless_input")
        expect((yield* inputs.get({ sessionID: parent.id, inputID: headless.id })).status).toBe("admitted")
        yield* inputs.withdraw({ sessionID: parent.id, inputID: headless.id })
        expect(yield* restarted.restore(fenced, () => true)).toBe("restored")
        expect(yield* sessions.messages({ sessionID: parent.id, order: "asc" })).toEqual([])
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([SessionV2.node, Database.node, SessionScheduleStore.node, SessionInputExecution.node]),
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
  30_000,
)

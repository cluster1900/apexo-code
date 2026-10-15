import { expect } from "bun:test"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
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
import { Goal } from "@apexo/schema/goal"
import { Question } from "@apexo/schema/question"
import { SessionSchedule } from "@apexo/schema/session-schedule"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionPlanReceipt } from "@apexo/core/session/plan-receipt"
import { SessionTaskOrigin } from "@apexo/core/session/task-origin"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { SessionScheduleStore } from "@apexo/core/session/schedule-store"
import { SessionScheduleAdmission } from "@apexo/core/session/schedule-admission"
import { SessionScheduleRecord } from "@apexo/core/session/schedule-record"
import { SessionScheduleTable } from "@apexo/core/session/schedule.sql"
import { SessionMessage } from "@apexo/core/session/message"
import { EventV2 } from "@apexo/core/event"
import { EventTable } from "@apexo/core/event/sql"
import { SessionV1 } from "@apexo/core/v1/session"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
for (const durable of [false, true])
  it.live(
    `Scheduler intent, atomic Task origin, late Goal/Plan and restart boundaries use real native storage (durable=${durable})`,
    () =>
      Effect.gen(function* () {
        const home = yield* tmpdirScoped()
        const directory = yield* tmpdirScoped()
        return yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const database = yield* Database.Service
          const tasks = yield* SessionTaskStore.Service
          const schedules = yield* SessionScheduleStore.Service
          const events = yield* EventV2.Service
          const goals = yield* SessionGoal.Service
          const plans = yield* SessionPlanReceipt.Service
          const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
          const foreign = yield* sessions.create({ location: parent.location })
          const input = {
            sessionID: parent.id,
            messageID: SessionMessage.ID.create(),
            callID: "schedule-create",
            request: { prompt: "Inspect current state", intervalSeconds: 60, durable, fireImmediately: true },
            authority: {
              parentAgent: AgentV2.ID.make("build"),
              agent: AgentV2.ID.make("general"),
              model: { providerID: Provider.ID.make("fixture"), id: Model.ID.make("model") },
              authority: [],
            },
          }
          const first = yield* schedules.create(input)
          expect(first.created).toBe(true)
          expect(Schema.is(SessionSchedule.ID)(first.record.id)).toBe(true)
          expect((yield* schedules.create(input)).created).toBe(false)
          expect(
            (yield* schedules
              .create({ ...input, request: { ...input.request, prompt: "different" } })
              .pipe(Effect.result))._tag,
          ).toBe("Failure")
          expect((yield* schedules.owned(foreign.id, first.record.id).pipe(Effect.result))._tag).toBe("Failure")
          const occurrence = yield* schedules.claim(parent.id, first.record.id)
          expect(occurrence?.status).toBe("claimed")
          if (!occurrence) return yield* Effect.die("Expected immediate occurrence")
          expect(yield* schedules.claim(parent.id, first.record.id)).toBeUndefined()
          const admission = yield* schedules.admission(occurrence.id)
          const bind = () =>
            database.db
              .transaction(
                () =>
                  SessionScheduleAdmission.bind(
                    database.db,
                    admission.origin,
                    tasks.owner,
                    parent.id,
                    occurrence.childID,
                    occurrence.launchID,
                  ),
                { behavior: "immediate" },
              )
              .pipe(
                Effect.provideService(SessionTaskOrigin.Current, { occurrenceID: occurrence.id, current: () => true }),
              )
          const updated = yield* schedules.update(parent.id, first.record.id, { prompt: "Updated intent" })
          expect(updated.nextFireAt).toBe((yield* schedules.owned(parent.id, first.record.id)).nextFireAt)
          expect(updated.createdAt).toBe(first.record.createdAt)
          expect((yield* bind().pipe(Effect.result))._tag).toBe("Failure")
          const absent = yield* sessions.get(occurrence.childID).pipe(Effect.result)
          expect(absent._tag).toBe("Failure")
          if (absent._tag === "Failure") expect(absent.failure._tag).toBe("Session.NotFoundError")

          const fresh = yield* schedules.create({ ...input, callID: "goal-race" })
          const pending = yield* schedules.claim(parent.id, fresh.record.id)
          if (!pending) return yield* Effect.die("Expected claimed occurrence")
          const late = yield* schedules.admission(pending.id)
          const blockedBind = () =>
            database.db
              .transaction(
                () =>
                  SessionScheduleAdmission.bind(
                    database.db,
                    late.origin,
                    tasks.owner,
                    parent.id,
                    pending.childID,
                    pending.launchID,
                  ),
                { behavior: "immediate" },
              )
              .pipe(Effect.provideService(SessionTaskOrigin.Current, { occurrenceID: pending.id, current: () => true }))
          const goalCadence = yield* schedules.create({ ...input, callID: "goal-cadence" })
          const planCadence = yield* schedules.create({ ...input, callID: "plan-cadence" })
          const goal = yield* goals.create(parent.id, { id: Goal.ID.create(), objective: "Own current Session" })
          expect(yield* schedules.claim(parent.id, goalCadence.record.id)).toBeUndefined()
          const skippedGoal = yield* schedules.owned(parent.id, goalCadence.record.id)
          expect(skippedGoal.status).toBe("paused")
          expect(skippedGoal.blockedReason).toBe("goal_active")
          expect(skippedGoal.nextFireAt).toBeGreaterThan(Date.now() + 50_000)
          const goalBlocked = yield* blockedBind().pipe(Effect.result)
          expect(goalBlocked._tag).toBe("Failure")
          if (goalBlocked._tag === "Failure") expect(String(goalBlocked.failure)).toContain("Goal")
          yield* goals.pause({ sessionID: parent.id, goalID: goal.id }, "user_paused")
          const plan: SessionPlanReceipt.Record = {
            sessionID: parent.id,
            created: pending.parentCreated,
            request: { id: Question.ID.create(), sessionID: parent.id, questions: [] },
            assistantMessageID: SessionMessage.ID.create(),
            callID: "plan-race",
            artifact: { path: "plan.md", resource: "plan.md", content: "Plan", hash: "fixture" },
            turn: { finish: "tool-calls", tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } },
            decision: "pending",
            answers: [],
            settled: false,
          }
          yield* plans.write(plan)
          expect(yield* schedules.claim(parent.id, planCadence.record.id)).toBeUndefined()
          const skippedPlan = yield* schedules.owned(parent.id, planCadence.record.id)
          expect(skippedPlan.status).toBe("active")
          expect(skippedPlan.blockedReason).toBe("plan_pending")
          expect(skippedPlan.nextFireAt).toBeGreaterThan(Date.now() + 50_000)
          const planBlocked = yield* blockedBind().pipe(Effect.result)
          expect(planBlocked._tag).toBe("Failure")
          if (planBlocked._tag === "Failure") expect(String(planBlocked.failure)).toContain("Plan")
          expect((yield* SessionScheduleAdmission.occurrence(database.db, pending.id)).status).toBe("claimed")
          yield* plans.write({ ...plan, decision: "cancelled", settled: true })

          const originalRow = yield* database.db
            .select()
            .from(EventTable)
            .where(eq(EventTable.id, EventV2.ID.make(pending.parentCreated)))
            .get()
          const original = yield* Schema.decodeUnknownEffect(SessionV1.Event.Created.data)(originalRow!.data)
          const childCreated = EventV2.ID.make("evt_" + randomUUID())
          const record: SessionTaskStore.Record = {
            sessionID: pending.childID,
            parentID: parent.id,
            parentCreated: pending.parentCreated,
            childCreated,
            scheduleID: pending.scheduleID,
            agent: input.authority.agent,
            model: input.authority.model,
            authority: [],
            createdAt: Date.now(),
          }
          expect((yield* tasks.create(record).pipe(Effect.result))._tag).toBe("Failure")
          yield* events.publish(
            SessionV1.Event.Created,
            {
              sessionID: pending.childID,
              info: { ...original.info, id: pending.childID, parentID: parent.id },
            },
            {
              id: childCreated,
              location: parent.location,
              commit: () =>
                tasks
                  .commitCreated(record, { origin: late.origin, launchID: pending.launchID })
                  .pipe(
                    Effect.provideService(SessionTaskOrigin.Current, { occurrenceID: pending.id, current: () => true }),
                    Effect.orDie,
                  ),
            },
          )
          expect((yield* SessionScheduleAdmission.occurrence(database.db, pending.id)).status).toBe("admitted")
          yield* schedules.remove(parent.id, pending.scheduleID)
          const launch = {
            id: pending.launchID,
            parentID: parent.id,
            sessionID: pending.childID,
            origin: late.origin,
            request: {
              description: pending.description,
              prompt: pending.prompt,
              agent: pending.agent,
              background: true,
            },
          }
          expect(
            (yield* tasks
              .begin(launch)
              .pipe(
                Effect.provideService(SessionTaskOrigin.Current, { occurrenceID: pending.id, current: () => true }),
              )).status,
          ).toBe("running")
          expect((yield* tasks.begin({ ...launch, origin: undefined }).pipe(Effect.result))._tag).toBe("Failure")
          expect(
            (yield* tasks
              .begin({ ...launch, origin: { ...late.origin, scheduleID: first.record.id } })
              .pipe(Effect.result))._tag,
          ).toBe("Failure")
          const orphanReader = SessionScheduleStore.make(database.db, "other-process-reader")
          const orphan = yield* orphanReader.detail(parent.id, pending.scheduleID)
          expect(orphan.occurrenceStatus).toBe("interrupted")
          expect(orphan.latestTaskID).toBe(pending.childID)
          expect((yield* orphanReader.admission(pending.id).pipe(Effect.result))._tag).toBe("Failure")
          expect(yield* orphanReader.claim(parent.id, pending.scheduleID)).toBeUndefined()
          yield* tasks.finish({ ...launch, status: "completed", summary: "Done" })
          expect((yield* SessionScheduleAdmission.occurrence(database.db, pending.id)).status).toBe("completed")
          expect(
            (yield* tasks
              .begin(launch)
              .pipe(
                Effect.provideService(SessionTaskOrigin.Current, { occurrenceID: pending.id, current: () => true }),
              )).status,
          ).toBe("completed")
          expect((yield* schedules.owned(parent.id, pending.scheduleID)).status).toBe("deleted")

          const chain = yield* schedules.create({ ...input, callID: "bounded-continuation" })
          const children: string[] = []
          for (let index = 0; index < 11; index++) {
            const current = yield* schedules.owned(parent.id, chain.record.id)
            // Advance the persisted due deadline only; claim/bind/settle are the real production paths.
            yield* database.db
              .update(SessionScheduleTable)
              .set({ data: { ...current, nextFireAt: 0 } })
              .where(eq(SessionScheduleTable.id, current.id))
            const item = yield* schedules.claim(parent.id, current.id)
            if (!item) return yield* Effect.die("Expected a due chain occurrence")
            children.push(item.childID)
            expect(item.followup).toBe(index > 0 && index < 10)
            if (index === 10) {
              expect(item.prompt).toContain("Prior occurrence summary: " + "x".repeat(600))
              expect(item.prompt).not.toContain("x".repeat(601))
            }
            const source = (yield* schedules.admission(item.id)).origin
            const fence = { occurrenceID: item.id, current: () => true }
            if (!item.followup) {
              const created = EventV2.ID.make("evt_" + randomUUID())
              yield* events.publish(
                SessionV1.Event.Created,
                {
                  sessionID: item.childID,
                  info: { ...original.info, id: item.childID, parentID: parent.id },
                },
                {
                  id: created,
                  location: parent.location,
                  commit: () =>
                    tasks
                      .commitCreated(
                        {
                          ...record,
                          sessionID: item.childID,
                          childCreated: created,
                          scheduleID: item.scheduleID,
                        },
                        { origin: source, launchID: item.launchID },
                      )
                      .pipe(Effect.provideService(SessionTaskOrigin.Current, fence), Effect.orDie),
                },
              )
            }
            const turn = {
              id: item.launchID,
              parentID: parent.id,
              sessionID: item.childID,
              origin: source,
              request: {
                description: item.description,
                prompt: item.prompt,
                agent: item.agent,
                background: true,
                taskID: item.followup ? item.childID : undefined,
              },
            }
            yield* tasks.begin(turn).pipe(Effect.provideService(SessionTaskOrigin.Current, fence))
            const busy = yield* schedules.owned(parent.id, current.id)
            yield* database.db
              .update(SessionScheduleTable)
              .set({ data: { ...busy, nextFireAt: 0 } })
              .where(eq(SessionScheduleTable.id, current.id))
            expect(yield* schedules.claim(parent.id, current.id)).toBeUndefined()
            expect((yield* schedules.owned(parent.id, current.id)).blockedReason).toBe("busy")
            yield* tasks.finish({ ...turn, status: "completed", summary: "x".repeat(900) })
          }
          expect(new Set(children.slice(0, 10)).size).toBe(1)
          expect(children[10]).not.toBe(children[0])
          expect((yield* schedules.occurrences(chain.record.id)).length).toBe(11)
          expect((yield* schedules.owned(parent.id, chain.record.id)).summary.length).toBe(600)

          const restarted = SessionScheduleStore.make(database.db, "new-process")
          expect(restarted.state(updated, Date.now())).toEqual({ status: "paused", blockedReason: "restart_required" })
          expect(yield* restarted.claim(parent.id, updated.id)).toBeUndefined()
          const beforeResume = Date.now()
          const resumed = yield* restarted.resume(parent.id, updated.id)
          expect(resumed.nextFireAt).toBeGreaterThanOrEqual(beforeResume + 60_000)
          expect(resumed.childID).toBeUndefined()
          expect(yield* restarted.claim(parent.id, updated.id)).toBeUndefined()
          yield* schedules.pause(parent.id, resumed.id, "stopped")
          expect((yield* schedules.owned(parent.id, resumed.id)).blockedReason).toBe("stopped")
          yield* sessions.remove(parent.id)
          expect(
            yield* database.db
              .select()
              .from(SessionScheduleTable)
              .where(eq(SessionScheduleTable.session_id, parent.id)),
          ).toEqual([])
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([
                SessionV2.node,
                Database.node,
                EventV2.node,
                SessionTaskStore.node,
                SessionScheduleStore.node,
                SessionGoal.node,
                SessionPlanReceipt.node,
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

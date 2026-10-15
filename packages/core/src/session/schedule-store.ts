export * as SessionScheduleStore from "./schedule-store"

import { createHash } from "node:crypto"
import { and, desc, eq, isNull, isNotNull, or } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { SessionSchedule } from "@apexo/schema/session-schedule"
import { descending } from "@apexo/schema/identifier"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionSchema } from "./schema"
import { SessionIncarnation } from "./incarnation"
import { SessionMessage } from "./message"
import { SessionScheduleAdmission } from "./schedule-admission"
import { SessionScheduleRecord } from "./schedule-record"
import { SessionScheduleTable, SessionScheduleOccurrenceTable } from "./schedule.sql"
import { SessionTaskOrigin } from "./task-origin"
import { SessionTaskTable } from "./task.sql"
import { SessionTaskStore } from "./task-store"
import { SessionInputTable } from "./sql"

export function make(db: Database.Interface["db"], owner: string) {
  const safe = <A, E>(body: Effect.Effect<A, E>) =>
    body.pipe(
      Effect.mapError((error) =>
        error instanceof SessionScheduleRecord.Failure
          ? error
          : new SessionScheduleRecord.Failure({ code: "storage", message: "Schedule state is unavailable" }),
      ),
    )
  const transaction = <A, E>(body: Effect.Effect<A, E>) => safe(db.transaction(() => body, { behavior: "immediate" }))
  const owned = (sessionID: SessionSchema.ID, id: SessionSchedule.ID) =>
    safe(
      Effect.gen(function* () {
        const value = yield* SessionScheduleAdmission.intent(db, id)
        if (value.sessionID !== sessionID)
          return yield* new SessionScheduleRecord.Failure({
            code: "missing",
            message: "Schedule does not belong to this Session",
          })
        return value
      }),
    )
  const save = (value: SessionScheduleRecord.Intent) =>
    db.update(SessionScheduleTable).set({ data: value }).where(eq(SessionScheduleTable.id, value.id))
  const occurrences = (id: SessionSchedule.ID) =>
    Effect.gen(function* () {
      const rows = yield* db
        .select()
        .from(SessionScheduleOccurrenceTable)
        .where(eq(SessionScheduleOccurrenceTable.schedule_id, id))
      return yield* Effect.forEach(rows, (row) => SessionScheduleAdmission.occurrence(db, row.id))
    })
  const invalidate = (id: SessionSchedule.ID, now: number) =>
    Effect.gen(function* () {
      for (const item of yield* occurrences(id)) {
        if (item.status !== "claimed") continue
        yield* db
          .update(SessionScheduleOccurrenceTable)
          .set({ data: { ...item, status: "cancelled", completedAt: now } })
          .where(eq(SessionScheduleOccurrenceTable.id, item.id))
      }
    })
  const list = (sessionID: SessionSchema.ID) =>
    safe(
      Effect.gen(function* () {
        const created = yield* SessionIncarnation.created(db, sessionID)
        if (!created)
          return yield* new SessionScheduleRecord.Failure({
            code: "missing",
            message: "Schedule parent does not exist",
          })
        const rows = yield* db
          .select()
          .from(SessionScheduleTable)
          .where(eq(SessionScheduleTable.session_id, sessionID))
          .orderBy(desc(SessionScheduleTable.time_created))
        return yield* Effect.forEach(rows, (row) => owned(sessionID, row.id))
      }),
    )
  const state = (value: SessionScheduleRecord.Intent, now: number) => {
    if (value.status === "deleted" || value.status === "expired")
      return { status: value.status, blockedReason: undefined }
    // Session resource persistence applies to both durability values. Only the TTL expires intent.
    if (value.expiresAt <= now) return { status: "expired" as const, blockedReason: undefined }
    if (value.status === "paused") return { status: value.status, blockedReason: value.blockedReason }
    if (value.owner !== owner) return { status: "paused" as const, blockedReason: "restart_required" as const }
    return { status: value.status, blockedReason: value.blockedReason }
  }
  const restorationBlock = (sessionID: SessionSchema.ID) =>
    Effect.gen(function* () {
      const headless = yield* db
        .select({ id: SessionInputTable.id })
        .from(SessionInputTable)
        .where(
          and(
            eq(SessionInputTable.session_id, sessionID),
            isNotNull(SessionInputTable.execution_policy),
            isNull(SessionInputTable.execution_ended_seq),
            or(isNull(SessionInputTable.promoted_seq), eq(SessionInputTable.execution_status, "active")),
          ),
        )
        .get()
      if (headless) return "headless_input" as const
      return yield* SessionScheduleAdmission.blocked(db, sessionID)
    })
  const restorationReason = (
    previous: SessionScheduleRecord.Intent,
    now: number,
  ): SessionSchedule.RestoreReason | undefined => {
    if (previous.status === "deleted") return "deleted"
    if (previous.status === "expired" || previous.expiresAt <= now) return "expired"
    if (previous.status === "paused" && previous.blockedReason !== "restart_required")
      return previous.blockedReason === "stopped" ? "stopped" : "paused"
    if (previous.owner === owner && previous.status === "active") return "already_active"
  }
  return {
    owner,
    restorationBlock: (sessionID: SessionSchema.ID) => safe(restorationBlock(sessionID)),
    restorationReason,
    restore: (expected: SessionScheduleRecord.Intent, current: () => boolean) =>
      transaction(
        Effect.gen(function* () {
          const previous = yield* owned(expected.sessionID, expected.id)
          const now = yield* Clock.currentTimeMillis
          if (
            !current() ||
            previous.parentCreated !== expected.parentCreated ||
            previous.owner !== expected.owner ||
            previous.revision !== expected.revision ||
            previous.generation !== expected.generation
          )
            return "changed" as const
          const reason = restorationReason(previous, now)
          if (reason) return reason
          const blocked = yield* restorationBlock(previous.sessionID)
          if (blocked) return blocked
          // Foreign nonterminal receipts are not proof of a dead process. Do not mutate or replay them.
          if (
            (yield* occurrences(previous.id)).some(
              (item) => item.owner !== owner && (item.status === "claimed" || item.status === "admitted"),
            )
          )
            return "unfinished_owner" as const
          const interval = previous.intervalSeconds * 1000
          const nextFireAt =
            previous.nextFireAt > now
              ? previous.nextFireAt
              : previous.nextFireAt + (Math.floor((now - previous.nextFireAt) / interval) + 1) * interval
          const record: SessionScheduleRecord.Intent = {
            ...previous,
            owner,
            status: "active",
            blockedReason: undefined,
            revision: previous.revision + 1,
            nextFireAt,
            ...(previous.owner !== owner
              ? {
                  generation: previous.generation + 1,
                  childID: undefined,
                  childGeneration: undefined,
                  chainCount: 0,
                  summary: "",
                }
              : {}),
          }
          yield* save(record)
          // Stop can revoke its in-memory epoch while the database operation is suspended.
          if (!current())
            return yield* new SessionScheduleRecord.Failure({
              code: "stale",
              message: "Session restoration was interrupted",
            })
          return "restored" as const
        }),
      ),
    stopRestoration: (expected: SessionScheduleRecord.Intent) =>
      transaction(
        Effect.gen(function* () {
          const previous = yield* owned(expected.sessionID, expected.id)
          if (
            previous.parentCreated !== expected.parentCreated ||
            previous.owner !== expected.owner ||
            previous.revision !== expected.revision ||
            previous.generation !== expected.generation ||
            restorationReason(previous, yield* Clock.currentTimeMillis) !== undefined
          )
            return false
          // The exact interrupted restoration owns future intent only. Foreign unfinished
          // occurrence/Task receipts remain untouched and never become proof of settlement.
          yield* save({ ...previous, status: "paused", blockedReason: "stopped", revision: previous.revision + 1 })
          return true
        }),
      ).pipe(
        Effect.catchTag("SessionScheduleFailure", (error) =>
          error.code === "missing" ? Effect.succeed(false) : Effect.fail(error),
        ),
      ),
    owned,
    list,
    state,
    occurrences: (id: SessionSchedule.ID) => safe(occurrences(id)),
    detail: (sessionID: SessionSchema.ID, id: SessionSchedule.ID) =>
      safe(
        Effect.gen(function* () {
          const value = yield* owned(sessionID, id)
          const latest = (yield* occurrences(id)).sort((a, b) => b.ordinal - a.ordinal)[0]
          const effective = state(value, yield* Clock.currentTimeMillis)
          const childRow = latest
            ? yield* db.select().from(SessionTaskTable).where(eq(SessionTaskTable.session_id, latest.childID)).get()
            : undefined
          const child = childRow ? yield* Schema.decodeUnknownEffect(SessionTaskStore.Record)(childRow.data) : undefined
          const childOwned =
            child &&
            latest &&
            child.scheduleID === id &&
            child.parentID === sessionID &&
            child.parentCreated === value.parentCreated &&
            child.sessionID === latest.childID &&
            child.childCreated === (yield* SessionIncarnation.created(db, child.sessionID))
          const occurrenceStatus =
            latest &&
            (latest.owner !== owner && (latest.status === "claimed" || latest.status === "admitted")
              ? "interrupted"
              : latest.status === "admitted"
                ? "running"
                : latest.status)
          return {
            id: value.id,
            sessionID,
            prompt: value.prompt,
            promptPreview: value.prompt.slice(0, 256),
            intervalSeconds: value.intervalSeconds,
            durable: value.durable,
            ...effective,
            createdAt: value.createdAt,
            expiresAt: value.expiresAt,
            nextFireAt: value.nextFireAt,
            ...(childOwned ? { latestTaskID: child.sessionID } : {}),
            ...(occurrenceStatus ? { occurrenceStatus } : {}),
          } satisfies SessionSchedule.Detail
        }),
      ),
    failClaim: (id: SessionTaskOrigin.OccurrenceID, cancelled: boolean) =>
      transaction(
        Effect.gen(function* () {
          const item = yield* SessionScheduleAdmission.occurrence(db, id)
          if (item.owner !== owner || (item.status !== "claimed" && item.status !== "admitted")) return
          yield* db
            .update(SessionScheduleOccurrenceTable)
            .set({
              data: {
                ...item,
                status: cancelled ? "cancelled" : "failed",
                completedAt: yield* Clock.currentTimeMillis,
              },
            })
            .where(eq(SessionScheduleOccurrenceTable.id, id))
          if (!cancelled && item.status === "claimed") {
            const current = yield* owned(item.parentID, item.scheduleID)
            if (
              current.owner === owner &&
              current.status === "active" &&
              current.revision === item.revision &&
              current.generation === item.generation
            ) {
              const blockedReason = (yield* SessionScheduleAdmission.blocked(db, item.parentID)) ?? "unavailable"
              yield* save({
                ...current,
                blockedReason,
                status: blockedReason === "plan_pending" ? "active" : "paused",
                revision: current.revision + 1,
              })
            }
          }
        }),
      ),
    admission: (id: SessionTaskOrigin.OccurrenceID) => safe(SessionScheduleAdmission.admission(db, id, owner)),
    create: (input: {
      sessionID: SessionSchema.ID
      messageID: SessionMessage.ID
      callID: string
      request: SessionScheduleRecord.Request
      authority: SessionScheduleRecord.Authority
    }) =>
      transaction(
        Effect.gen(function* () {
          const parentCreated = yield* SessionIncarnation.created(db, input.sessionID)
          if (!parentCreated)
            return yield* new SessionScheduleRecord.Failure({
              code: "missing",
              message: "Schedule parent does not exist",
            })
          const request = yield* Schema.decodeUnknownEffect(SessionScheduleRecord.Request)(input.request)
          const authority = yield* Schema.decodeUnknownEffect(SessionScheduleRecord.Authority)(input.authority)
          const invocation = JSON.stringify([input.messageID, input.callID])
          const previous = yield* db
            .select()
            .from(SessionScheduleTable)
            .where(
              and(
                eq(SessionScheduleTable.session_id, input.sessionID),
                eq(SessionScheduleTable.invocation, invocation),
              ),
            )
            .get()
          if (previous) {
            const item = yield* owned(input.sessionID, previous.id)
            if (
              item.initial.prompt !== request.prompt ||
              item.initial.intervalSeconds !== request.intervalSeconds ||
              item.initial.durable !== request.durable ||
              item.initial.fireImmediately !== request.fireImmediately
            )
              return yield* new SessionScheduleRecord.Failure({
                code: "invalid",
                message: "Schedule invocation was reused with different input",
              })
            return { record: item, created: false }
          }
          yield* SessionScheduleAdmission.available(db, input.sessionID)
          const now = yield* Clock.currentTimeMillis
          if (
            (yield* list(input.sessionID)).filter((item) => ["active", "paused"].includes(state(item, now).status))
              .length >= SessionScheduleRecord.MAX_TASKS
          )
            return yield* new SessionScheduleRecord.Failure({
              code: "invalid",
              message: "Maximum 50 active or paused schedules per Session",
            })
          const record: SessionScheduleRecord.Intent = {
            ...authority,
            id: SessionSchedule.ID.create(),
            sessionID: input.sessionID,
            parentCreated,
            invocation,
            initial: request,
            prompt: request.prompt,
            intervalSeconds: request.intervalSeconds,
            durable: request.durable,
            owner,
            revision: 0,
            generation: 0,
            status: "active",
            createdAt: now,
            expiresAt: now + SessionScheduleRecord.TTL_MS,
            nextFireAt: now + (request.fireImmediately ? 0 : request.intervalSeconds * 1000),
            ordinal: 0,
            chainCount: 0,
            summary: "",
          }
          yield* db
            .insert(SessionScheduleTable)
            .values({ id: record.id, session_id: record.sessionID, invocation, data: record, time_created: now })
          return { record, created: true }
        }),
      ),
    update: (
      sessionID: SessionSchema.ID,
      id: SessionSchedule.ID,
      input: { prompt?: string; intervalSeconds?: number },
    ) =>
      transaction(
        Effect.gen(function* () {
          const previous = yield* owned(sessionID, id)
          const now = yield* Clock.currentTimeMillis
          const effective = state(previous, now)
          if (effective.status === "deleted" || effective.status === "expired")
            return yield* new SessionScheduleRecord.Failure({
              code: "invalid",
              message: "Schedule is no longer active",
            })
          const request = yield* Schema.decodeUnknownEffect(SessionScheduleRecord.Request)({
            ...previous.initial,
            prompt: input.prompt ?? previous.prompt,
            intervalSeconds: input.intervalSeconds ?? previous.intervalSeconds,
          })
          if (input.prompt === undefined && input.intervalSeconds === undefined)
            return yield* new SessionScheduleRecord.Failure({
              code: "invalid",
              message: "Schedule update requires a prompt or interval",
            })
          const changedPrompt = request.prompt !== previous.prompt
          const record: SessionScheduleRecord.Intent = {
            ...previous,
            ...effective,
            prompt: request.prompt,
            intervalSeconds: request.intervalSeconds,
            revision: previous.revision + 1,
            generation: previous.generation + (changedPrompt ? 1 : 0),
            nextFireAt:
              input.intervalSeconds === undefined
                ? previous.nextFireAt
                : (previous.lastFireAt ?? previous.createdAt) + request.intervalSeconds * 1000,
            childID: changedPrompt ? undefined : previous.childID,
            childGeneration: changedPrompt ? undefined : previous.childGeneration,
            chainCount: changedPrompt ? 0 : previous.chainCount,
            summary: changedPrompt ? "" : previous.summary,
          }
          yield* invalidate(id, now)
          yield* save(record)
          return record
        }),
      ),
    pause: (sessionID: SessionSchema.ID, id: SessionSchedule.ID, reason?: SessionSchedule.BlockedReason) =>
      transaction(
        Effect.gen(function* () {
          const previous = yield* owned(sessionID, id)
          if (previous.status === "deleted" || previous.status === "expired") return previous
          const now = yield* Clock.currentTimeMillis
          yield* invalidate(id, now)
          const record: SessionScheduleRecord.Intent = {
            ...previous,
            status: "paused",
            revision: previous.revision + 1,
            blockedReason: reason,
          }
          yield* save(record)
          return record
        }),
      ),
    resume: (sessionID: SessionSchema.ID, id: SessionSchedule.ID) =>
      transaction(
        Effect.gen(function* () {
          const previous = yield* owned(sessionID, id)
          const now = yield* Clock.currentTimeMillis
          if (["deleted", "expired"].includes(state(previous, now).status))
            return yield* new SessionScheduleRecord.Failure({ code: "invalid", message: "Schedule cannot be resumed" })
          yield* SessionScheduleAdmission.available(db, sessionID)
          yield* invalidate(id, now)
          const record: SessionScheduleRecord.Intent = {
            ...previous,
            owner,
            status: "active",
            blockedReason: undefined,
            revision: previous.revision + 1,
            nextFireAt: now + previous.intervalSeconds * 1000,
            ...(previous.owner !== owner
              ? { childID: undefined, childGeneration: undefined, chainCount: 0, generation: previous.generation + 1 }
              : {}),
          }
          yield* save(record)
          return record
        }),
      ),
    remove: (sessionID: SessionSchema.ID, id: SessionSchedule.ID) =>
      transaction(
        Effect.gen(function* () {
          const previous = yield* owned(sessionID, id)
          if (previous.status === "deleted") return previous
          yield* invalidate(id, yield* Clock.currentTimeMillis)
          const record: SessionScheduleRecord.Intent = {
            ...previous,
            status: "deleted",
            revision: previous.revision + 1,
            blockedReason: undefined,
          }
          yield* save(record)
          return record
        }),
      ),
    claim: (sessionID: SessionSchema.ID, id: SessionSchedule.ID) =>
      transaction(
        Effect.gen(function* () {
          const previous = yield* owned(sessionID, id)
          const now = yield* Clock.currentTimeMillis
          if (previous.owner !== owner || state(previous, now).status !== "active" || previous.nextFireAt > now) return
          const advanced = { ...previous, lastFireAt: now, nextFireAt: now + previous.intervalSeconds * 1000 }
          const running = (yield* occurrences(id)).some(
            (item) => item.owner === owner && (item.status === "claimed" || item.status === "admitted"),
          )
          if (running) {
            yield* save({ ...advanced, blockedReason: "busy" })
            return
          }
          const blockedReason = yield* SessionScheduleAdmission.blocked(db, sessionID)
          if (blockedReason) {
            yield* save({
              ...advanced,
              blockedReason,
              ...(blockedReason === "goal_active" ? { status: "paused", revision: previous.revision + 1 } : {}),
            })
            return
          }
          const ordinal = previous.ordinal + 1
          const occurrenceID = SessionTaskOrigin.OccurrenceID.make("schedocc_" + descending())
          const launchID = createHash("sha256")
            .update(JSON.stringify([previous.parentCreated, id, occurrenceID]))
            .digest("hex")
          const followup =
            previous.childID !== undefined &&
            previous.childGeneration === previous.generation &&
            previous.chainCount < 10
          const item: SessionScheduleRecord.Occurrence = {
            parentAgent: previous.parentAgent,
            agent: previous.agent,
            model: previous.model,
            authority: previous.authority,
            permissionSource: previous.permissionSource,
            id: occurrenceID,
            scheduleID: id,
            parentID: sessionID,
            parentCreated: previous.parentCreated,
            owner,
            revision: previous.revision,
            generation: previous.generation,
            ordinal,
            launchID,
            childID: followup ? previous.childID! : SessionSchema.ID.make(`ses_${launchID}`),
            followup,
            description: previous.prompt.slice(0, 256),
            prompt: `${previous.prompt}\n\n[Scheduled occurrence of ${id}. You may update or delete only this originating schedule.]${!followup && previous.summary ? `\nPrior occurrence summary: ${previous.summary}` : ""}`,
            status: "claimed",
            createdAt: now,
          }
          yield* db
            .insert(SessionScheduleOccurrenceTable)
            .values({ id: item.id, schedule_id: id, ordinal, data: item, time_created: now })
          yield* save({
            ...advanced,
            ordinal,
            blockedReason: undefined,
            chainCount: followup ? previous.chainCount : 0,
          })
          return item
        }),
      ),
  }
}
export type Interface = ReturnType<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionScheduleStore") {}
export const node = makeGlobalNode({
  service: Service,
  deps: [Database.node, SessionTaskStore.node],
  layer: Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const tasks = yield* SessionTaskStore.Service
      return make(database.db, tasks.owner)
    }),
  ),
})

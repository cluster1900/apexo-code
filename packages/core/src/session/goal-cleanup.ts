export * as SessionGoalCleanup from "./goal-cleanup"

import { createHash } from "node:crypto"
import { and, asc, eq, gt } from "drizzle-orm"
import { Cause, Context, Effect, Layer, Schema } from "effect"
import { Goal } from "@apexo/schema/goal"
import { SessionID } from "@apexo/schema/session-id"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { Global } from "../global"
import { GoalCleanupTable, GoalAttemptTable, GoalTable } from "../goal/sql"
import { SessionGoal } from "./goal"
import { SessionGoalReports } from "./goal-reports"
import { SessionGoalCleanupOwner } from "./goal-cleanup-owner"
import { SessionTable } from "./sql"

const Snapshot = Schema.Struct({
  ids: Schema.Array(Goal.ReportID),
  info: Schema.optional(Goal.Info),
  after: Schema.optional(Schema.Number),
  owner: Schema.optional(Schema.Struct({ pid: Schema.Number, token: Schema.String })),
})
type Reason = typeof GoalCleanupTable.$inferSelect.reason

export function make(db: Database.Interface["db"], data: string) {
  const goals = SessionGoal.make(db)
  const prepare = Effect.fn("SessionGoalCleanup.prepare")(function* (
    target: SessionGoal.Target,
    reason: Reason,
    info?: Goal.Info,
  ) {
    const reports = SessionGoalReports.make({ data, ...target, info })
    yield* Effect.tryPromise(reports.prepareCleanup)
    const ids = (yield* Effect.tryPromise(reports.ids)).sort()
    if (!ids.length) return
    const id = createHash("sha256")
      .update(JSON.stringify([target, reason, info?.createdAt, ids]))
      .digest("hex")
    yield* db
      .insert(GoalCleanupTable)
      .values({
        id,
        session_id: target.sessionID,
        goal_id: target.goalID,
        reason,
        data: { ids, info },
        time_updated: Date.now(),
      })
      .onConflictDoNothing()
      .run()
  })
  const prepareSession = Effect.fn("SessionGoalCleanup.prepareSession")(function* (sessionID: SessionID) {
    const owner = yield* db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
    if (!owner) return
    const info = yield* goals
      .get(sessionID)
      .pipe(
        Effect.catchTag("GoalStorageError", (error) =>
          Effect.logWarning("Cleanup can only recover scoped reports for an invalid Goal", { sessionID, error }).pipe(
            Effect.as(undefined),
          ),
        ),
      )
    const ids = yield* Effect.tryPromise(() => SessionGoalReports.owners(data, sessionID))
    for (const goalID of new Set([...ids, ...(info ? [info.id] : [])]))
      yield* prepare({ sessionID, goalID }, "session_deleted", info?.id === goalID ? info : undefined)
  })
  const discovery = { after: undefined as Goal.ID | undefined }
  const discover = Effect.fn("SessionGoalCleanup.discover")(function* (sessionID?: SessionID) {
    const rows = yield* db
      .select({ sessionID: GoalTable.session_id, goalID: GoalTable.id })
      .from(GoalTable)
      .where(
        sessionID
          ? eq(GoalTable.session_id, sessionID)
          : discovery.after
            ? gt(GoalTable.id, discovery.after)
            : undefined,
      )
      .orderBy(asc(GoalTable.id))
      .limit(100)
      .all()
    if (!sessionID) discovery.after = rows.length === 100 ? rows.at(-1)!.goalID : undefined
    const result = { discovered: 0, unverified: 0, scheduled: 0 }
    for (const row of rows) {
      yield* Effect.gen(function* () {
        const target = { sessionID: row.sessionID, goalID: row.goalID }
        const candidate = yield* goals.terminalReportCandidate(target)
        if (!candidate) return
        const ids =
          candidate.recovery?.ids ??
          (yield* Effect.tryPromise(SessionGoalReports.make({ data, ...target, info: candidate.info }).ids))
        const found = yield* goals.discoverTerminalReports({ ...target, revision: candidate.info.revision }, ids)
        if (found.status === "unverified") result.unverified++
        if (found.status === "scheduled") result.scheduled++
        if (found.changed) result.discovered++
      }).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterrupts(cause),
          (cause) => Effect.logWarning("Legacy Goal report discovery deferred", { ...row, cause }),
        ),
      )
    }
    return result
  })
  const drain = Effect.fn("SessionGoalCleanup.drain")(function* (sessionID?: SessionID) {
    // Live owners must not occupy a fixed first page and starve later crashed summary claims.
    const summaries = yield* db
      .select({ sessionID: GoalTable.session_id, goalID: GoalTable.id, attemptID: GoalAttemptTable.id })
      .from(GoalAttemptTable)
      .innerJoin(GoalTable, eq(GoalTable.id, GoalAttemptTable.goal_id))
      .where(
        and(
          eq(GoalAttemptTable.kind, "summarizing"),
          eq(GoalAttemptTable.state, "running"),
          sessionID ? eq(GoalTable.session_id, sessionID) : undefined,
        ),
      )
      .orderBy(asc(GoalAttemptTable.time_created))
      .all()
    for (const summary of summaries) yield* goals.reconcileSummary(summary)

    yield* discover(sessionID)

    const pending = yield* db
      .select()
      .from(GoalCleanupTable)
      .where(sessionID ? eq(GoalCleanupTable.session_id, sessionID) : undefined)
      .orderBy(asc(GoalCleanupTable.time_updated), asc(GoalCleanupTable.id))
      .limit(100)
      .all()
    for (const job of pending) {
      yield* Effect.gen(function* () {
        // Retry oldest first, including blocked jobs, so one failure cannot starve the rest of the queue.
        yield* db
          .update(GoalCleanupTable)
          .set({ time_updated: Date.now() })
          .where(eq(GoalCleanupTable.id, job.id))
          .run()
        if (job.reason === "session_deleted") {
          const owner = yield* db
            .select({ id: SessionTable.id })
            .from(SessionTable)
            .where(eq(SessionTable.id, job.session_id))
            .get()
          if (owner) return
        }
        const snapshot = yield* Schema.decodeUnknownEffect(Snapshot)(job.data)
        if (snapshot.after !== undefined && snapshot.after > Date.now()) return
        if (snapshot.owner && SessionGoalCleanupOwner.alive(snapshot.owner.pid)) return
        // Clear/delete jobs cannot bypass a terminal executor that has not released its teardown barrier.
        const barriers = yield* db
          .select()
          .from(GoalCleanupTable)
          .where(and(eq(GoalCleanupTable.session_id, job.session_id), eq(GoalCleanupTable.goal_id, job.goal_id)))
          .all()
        for (const barrier of barriers) {
          if (barrier.reason !== "terminal" && barrier.reason !== "retention") continue
          const owner = (yield* Schema.decodeUnknownEffect(Snapshot)(barrier.data)).owner
          if (owner && SessionGoalCleanupOwner.alive(owner.pid)) return
        }
        const current = yield* goals.get(job.session_id)
        if (
          current?.id === job.goal_id &&
          ((job.reason === "goal_cleared" && current.createdAt === snapshot.info?.createdAt) ||
            !["complete", "budget_limited"].includes(current.status))
        )
          return
        const reports = SessionGoalReports.make({
          data,
          sessionID: job.session_id,
          goalID: job.goal_id,
          info: snapshot.info,
        })
        const result = yield* Effect.tryPromise(() =>
          job.reason === "terminal" ? reports.pruneScratch(snapshot.ids) : reports.cleanup(snapshot.ids),
        )
        if (result.failed.length) {
          yield* Effect.logWarning("Goal cleanup will retry", { jobID: job.id, failed: result.failed })
          return
        }
        yield* db.delete(GoalCleanupTable).where(eq(GoalCleanupTable.id, job.id)).run()
      }).pipe(Effect.catchCause((cause) => Effect.logWarning("Goal cleanup will retry", { jobID: job.id, cause })))
    }
  })
  const backfill = Effect.fn("SessionGoalCleanup.backfill")(function* (
    target: SessionGoal.Target,
    reportRetentionDays?: number,
  ) {
    const info = yield* goals.get(target.sessionID)
    if (!info || info.id !== target.goalID || info.status !== "active") return
    const reports = SessionGoalReports.make({ data, ...target, info })
    yield* goals.registerReports(target, yield* Effect.tryPromise(reports.ids), reportRetentionDays)
  })
  const terminal = Effect.fn("SessionGoalCleanup.terminal")(function* (sessionID: SessionID) {
    yield* discover(sessionID)
    // Only the executor in this process may release its teardown barrier. Other live processes remain protected.
    const pending = yield* db.select().from(GoalCleanupTable).where(eq(GoalCleanupTable.session_id, sessionID)).all()
    for (const job of pending) {
      if (job.reason !== "terminal" && job.reason !== "retention") continue
      const snapshot = yield* Schema.decodeUnknownEffect(Snapshot)(job.data)
      if (
        snapshot.owner &&
        snapshot.owner.token !== SessionGoalCleanupOwner.current.token &&
        SessionGoalCleanupOwner.alive(snapshot.owner.pid)
      )
        return
      if (snapshot.owner?.token !== SessionGoalCleanupOwner.current.token) continue
      yield* db
        .update(GoalCleanupTable)
        .set({ data: { ids: snapshot.ids, info: snapshot.info, after: snapshot.after } })
        .where(eq(GoalCleanupTable.id, job.id))
        .run()
    }
    const info = yield* goals.get(sessionID)
    if (!info || !["complete", "budget_limited"].includes(info.status)) {
      yield* drain(sessionID)
      return
    }
    if (
      !(yield* goals.terminalReportRecovery({ sessionID, goalID: info.id })) &&
      !pending.some(
        (job) =>
          job.reason === "terminal" &&
          job.goal_id === info.id &&
          Schema.decodeUnknownSync(Snapshot)(job.data).info?.createdAt === info.createdAt,
      )
    )
      yield* prepare({ sessionID, goalID: info.id }, "terminal", info)
    yield* drain(sessionID)
  })
  return { prepare, prepareSession, drain, terminal, backfill, discover }
}

export class Service extends Context.Service<Service, ReturnType<typeof make>>()("@apexo/SessionGoalCleanup") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const global = yield* Global.Service
    const cleanup = make(database.db, global.data)
    // Recover only persisted ownership from this database, never infer orphans by scanning a shared data root.
    yield* cleanup.drain().pipe(
      Effect.catchCause((cause) => Effect.logWarning("Goal cleanup recovery failed", { cause })),
      Effect.andThen(Effect.sleep("1 minute")),
      Effect.forever,
      Effect.forkScoped,
    )
    return cleanup
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, Global.node] })

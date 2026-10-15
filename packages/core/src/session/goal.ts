export * as SessionGoal from "./goal"

import { randomUUID, createHash } from "node:crypto"
import path from "node:path"
import { and, eq, ne } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { Goal } from "@apexo/schema/goal"
import { NonNegativeInt, optional } from "@apexo/schema/schema"
import { SessionID } from "@apexo/schema/session-id"
import { SessionMessage } from "@apexo/schema/session-message"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { GoalAttemptTable, GoalCleanupTable, GoalTable, GoalUsageTable } from "../goal/sql"
import { SessionTable } from "./sql"
import { SessionGoalProgress } from "./goal-progress"
import { SessionGoalEvaluation } from "./goal-evaluation"
import { SessionGoalVerification } from "./goal-verification"
import { SessionGoalCleanupOwner } from "./goal-cleanup-owner"

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("GoalConflict", {
  code: Schema.Literals(["missing", "exists", "stale", "inactive", "busy", "budget", "invalid"]),
  message: Schema.String,
}) {}

export class StorageError extends Schema.TaggedErrorClass<StorageError>()("GoalStorageError", {
  message: Schema.String,
}) {}

const TerminalReportRecovery = Schema.Struct({
  ids: Schema.Array(Goal.ReportID).check(Schema.isMaxLength(10_000)),
  status: Schema.Literals(["unverified", "scheduled"]),
})
const TeardownProof = Schema.Struct({
  info: Goal.Info,
  owner: Schema.Struct({ pid: NonNegativeInt, token: Schema.String.check(Schema.isMinLength(1)) }),
})

const State = Schema.Struct({
  info: Goal.Info,
  reportIDs: optional(Schema.Array(Goal.ReportID)),
  terminalReportRecovery: optional(TerminalReportRecovery),
  reportRetentionDays: optional(NonNegativeInt.check(Schema.isLessThanOrEqualTo(36_500))),
  generation: NonNegativeInt,
  activeSince: optional(NonNegativeInt),
  attemptID: optional(Schema.String),
  summaryAttemptID: optional(Schema.String),
  summaryOwner: optional(Schema.Struct({ pid: NonNegativeInt, token: Schema.String })),
  completion: optional(Schema.String),
  pendingEvaluation: optional(Schema.Boolean),
  pendingBlocker: optional(Schema.String),
  blockerKey: optional(Schema.String),
  blockerStreak: NonNegativeInt,
  unverifiedRounds: NonNegativeInt,
  verificationAttempts: NonNegativeInt,
  lastGaps: optional(Schema.String),
  stalled: NonNegativeInt,
})
type State = typeof State.Type
const Stored = Schema.Struct({
  ...State.fields,
  info: Schema.Struct({ ...Goal.Info.fields, status: Schema.String }),
})
const Note = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32_768))
const Finish = Schema.Struct({
  plan: optional(Note),
  plannerSessionID: optional(SessionID),
  plannerExecution: optional(Goal.RoleExecution),
  plannerFiles: optional(Goal.ReviewFiles),
  blocker: optional(Note),
  message: optional(Note),
  failure: optional(Note),
  verify: optional(Schema.Boolean),
  evaluate: optional(Schema.Boolean),
})

export type Target = { readonly sessionID: SessionID; readonly goalID: Goal.ID }
export type Attempt = Target & { readonly attemptID: string }
export type Pause = "user_paused" | "infra_paused" | "back_off_paused"
export type Work = "planning" | "executing" | "evaluating" | "verifying"
export type Error = Conflict | StorageError

/** Durable state only. The Session executor owns model calls, cancellation and process-local ownership. */
export function make(db: Database.Interface["db"]) {
  const storage = <A, E>(body: Effect.Effect<A, E>) =>
    body.pipe(
      Effect.mapError((error) =>
        error instanceof Conflict || error instanceof StorageError
          ? error
          : new StorageError({ message: String(error) }),
      ),
    )
  const transaction = <A, E>(body: Effect.Effect<A, E>) =>
    storage(db.transaction(() => body, { behavior: "immediate" }))

  const read = Effect.fn("SessionGoal.read")(function* (sessionID: SessionID) {
    const row = yield* db.select().from(GoalTable).where(eq(GoalTable.session_id, sessionID)).get()
    if (!row) return
    const stored = yield* Schema.decodeUnknownEffect(Stored)(row.data).pipe(
      Effect.mapError((error) => new StorageError({ message: `Invalid goal state: ${error}` })),
    )
    if (stored.info.sessionID !== row.session_id || stored.info.id !== row.id)
      return yield* new StorageError({ message: "Goal state has conflicting session ownership" })
    const invalidProgress = SessionGoalProgress.invalid(stored.info)
    if (invalidProgress) return yield* new StorageError({ message: invalidProgress })
    if (Schema.is(Goal.Status)(stored.info.status)) return stored as State
    // Forward-version/corrupt status must not resurrect an autonomous run.
    return {
      ...stored,
      generation: stored.generation + 1,
      activeSince: undefined,
      attemptID: undefined,
      completion: undefined,
      pendingEvaluation: undefined,
      pendingBlocker: undefined,
      info: { ...stored.info, status: "user_paused" as const, phase: "idle" as const },
    }
  })

  const requireState = Effect.fnUntraced(function* (input: Target) {
    const state = yield* read(input.sessionID)
    if (!state) return yield* new Conflict({ code: "missing", message: "No goal exists in this session" })
    if (state.info.id !== input.goalID)
      return yield* new Conflict({ code: "stale", message: "The goal has been replaced or cleared" })
    return state
  })

  const requireAttempt = Effect.fnUntraced(function* (state: State, input: Attempt, kind?: Work) {
    if (state.info.status !== "active")
      return yield* new Conflict({ code: "inactive", message: "The goal is not active" })
    const attempt = yield* db
      .select()
      .from(GoalAttemptTable)
      .where(and(eq(GoalAttemptTable.id, input.attemptID), eq(GoalAttemptTable.goal_id, input.goalID)))
      .get()
    if (
      !attempt ||
      attempt.state !== "running" ||
      attempt.generation !== state.generation ||
      state.attemptID !== attempt.id ||
      (kind && attempt.kind !== kind)
    )
      return yield* new Conflict({ code: "stale", message: "The goal attempt is no longer current" })
    return attempt
  })

  const save = Effect.fnUntraced(function* (
    state: State,
    next: State,
    now: number,
    event?: Goal.History["event"],
    message?: string,
  ) {
    if (next === state) return state.info
    const info = {
      ...next.info,
      updatedAt: now,
      revision: state.info.revision + 1,
      elapsedMs: state.info.elapsedMs + (state.activeSince === undefined ? 0 : Math.max(0, now - state.activeSince)),
      history: event
        ? [...next.info.history, { at: now, event, message, tokensUsed: next.info.tokensUsed }].slice(-64)
        : next.info.history,
    }
    yield* db
      .update(GoalTable)
      .set({
        data: Schema.encodeSync(State)({
          ...next,
          info,
          activeSince: next.info.status === "active" ? now : undefined,
        }),
      })
      .where(eq(GoalTable.id, state.info.id))
      .run()
    if (
      ["complete", "budget_limited"].includes(info.status) &&
      !["complete", "budget_limited"].includes(state.info.status)
    )
      yield* db
        .insert(GoalCleanupTable)
        .values({
          id: randomUUID(),
          session_id: info.sessionID,
          goal_id: info.id,
          reason: "terminal",
          data: { ids: next.reportIDs ?? [], info, owner: SessionGoalCleanupOwner.current },
          time_updated: now,
        })
        .run()
    if (
      next.reportRetentionDays !== undefined &&
      ["complete", "budget_limited"].includes(info.status) &&
      !["complete", "budget_limited"].includes(state.info.status)
    ) {
      const protectedIDs = [
        info.plannerFiles,
        info.strategy?.files,
        ...(info.verification?.results.map((result) => result.files) ?? []),
        info.verification?.previous?.files,
      ].flatMap((files) => (files ? [path.basename(files.directory)] : []))
      const ids = (next.reportIDs ?? []).filter((id) => !protectedIDs.includes(id))
      if (ids.length)
        yield* db
          .insert(GoalCleanupTable)
          .values({
            id: randomUUID(),
            session_id: info.sessionID,
            goal_id: info.id,
            reason: "retention",
            data: {
              ids,
              info,
              after: now + next.reportRetentionDays * 86_400_000,
              owner: SessionGoalCleanupOwner.current,
            },
            time_updated: now,
          })
          .run()
    }
    if (next.info.status !== "active" || next.generation !== state.generation)
      yield* db
        .update(GoalAttemptTable)
        .set({ state: "invalidated", time_finished: now })
        .where(
          and(
            eq(GoalAttemptTable.goal_id, state.info.id),
            eq(GoalAttemptTable.state, "running"),
            next.info.status === "complete" &&
              next.generation === state.generation &&
              next.info.summary?.status === "running" &&
              next.summaryAttemptID
              ? ne(GoalAttemptTable.id, next.summaryAttemptID)
              : undefined,
          ),
        )
        .run()
    return info
  })

  const change = <A>(input: Target, body: (state: State, now: number) => Effect.Effect<A, unknown>) =>
    transaction(
      Effect.gen(function* () {
        const state = yield* requireState(input)
        return yield* body(state, yield* Clock.currentTimeMillis)
      }),
    )

  return {
    get: (sessionID: SessionID) => storage(read(sessionID).pipe(Effect.map((state) => state?.info))),

    terminalReportCandidate: (input: Target) =>
      storage(
        requireState(input).pipe(
          Effect.map((state) =>
            ["complete", "budget_limited"].includes(state.info.status) &&
            (state.reportIDs === undefined || state.terminalReportRecovery)
              ? { info: state.info, recovery: state.terminalReportRecovery }
              : undefined,
          ),
        ),
      ),

    terminalReportRecovery: (input: Target) =>
      storage(requireState(input).pipe(Effect.map((state) => state.terminalReportRecovery))),

    /** Discovery records ownership gaps; it never treats terminal age or local idleness as teardown proof. */
    discoverTerminalReports: (input: Target & { revision: number }, ids: readonly string[]) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          if (state.info.revision !== input.revision)
            return yield* new Conflict({ code: "stale", message: "Goal changed during terminal report discovery" })
          if (!["complete", "budget_limited"].includes(state.info.status))
            return yield* new Conflict({ code: "inactive", message: "Only terminal Goal reports can be discovered" })
          // Durable report IDs were introduced with atomic terminal intents. A missing queue entry
          // for an already tracked lifetime can mean successful cleanup, not an unowned legacy lifetime.
          if (state.reportIDs !== undefined && !state.terminalReportRecovery)
            return { status: "managed" as const, changed: false }
          const jobs = yield* db
            .select()
            .from(GoalCleanupTable)
            .where(and(eq(GoalCleanupTable.session_id, input.sessionID), eq(GoalCleanupTable.goal_id, input.goalID)))
            .all()
          const sameLifetime = (info: Goal.Info) =>
            info.id === state.info.id &&
            info.sessionID === state.info.sessionID &&
            info.createdAt === state.info.createdAt &&
            info.status === state.info.status
          // An existing terminal intent already owns its recovery policy, even after its barrier was released.
          for (const job of jobs) {
            if (job.reason !== "terminal") continue
            const snapshot = yield* Schema.decodeUnknownEffect(Schema.Struct({ info: Goal.Info }))(job.data).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            )
            if (snapshot && sameLifetime(snapshot.info)) return { status: "managed" as const, changed: false }
          }
          if (state.terminalReportRecovery?.status === "scheduled")
            return { status: "scheduled" as const, changed: false }
          const frozen = state.terminalReportRecovery?.ids ?? [...new Set(ids)].sort()
          yield* Schema.decodeUnknownEffect(TerminalReportRecovery.fields.ids)(frozen)
          if (!frozen.length) return { status: "empty" as const, changed: false }
          const proofs = []
          for (const job of jobs) {
            if (job.reason !== "retention") continue
            const proof = yield* Schema.decodeUnknownEffect(TeardownProof)(job.data).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            )
            if (proof && sameLifetime(proof.info)) proofs.push(proof.owner)
          }
          // Distinct owner claims cannot be collapsed into one barrier without proving both have released.
          const owner = proofs[0]
          const proven = owner && proofs.every((proof) => proof.pid === owner.pid && proof.token === owner.token)
          const recovery = { ids: frozen, status: proven ? ("scheduled" as const) : ("unverified" as const) }
          if (state.terminalReportRecovery?.status === recovery.status)
            return { status: recovery.status, changed: false }
          // This private migration metadata does not alter public revision, usage, plan or transcript.
          yield* db
            .update(GoalTable)
            .set({ data: Schema.encodeSync(State)({ ...state, terminalReportRecovery: recovery }) })
            .where(eq(GoalTable.id, state.info.id))
            .run()
          if (proven)
            yield* db
              .insert(GoalCleanupTable)
              .values({
                id: createHash("sha256")
                  .update(
                    JSON.stringify(["legacy-terminal", input.sessionID, input.goalID, state.info.createdAt, frozen]),
                  )
                  .digest("hex"),
                session_id: input.sessionID,
                goal_id: input.goalID,
                reason: "terminal",
                data: { ids: frozen, info: state.info, owner },
                time_updated: now,
              })
              .onConflictDoNothing()
              .run()
          return { status: recovery.status, changed: true }
        }),
      ),

    /** Backfill only a currently owned Goal before its executor starts. */
    registerReports: (input: Target, ids: readonly string[], reportRetentionDays?: number) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          const valid = yield* Schema.decodeUnknownEffect(Schema.Array(Goal.ReportID))(ids)
          if (reportRetentionDays !== undefined)
            yield* Schema.decodeUnknownEffect(State.fields.reportRetentionDays)(reportRetentionDays)
          return yield* save(
            state,
            { ...state, reportIDs: [...new Set([...(state.reportIDs ?? []), ...valid])], reportRetentionDays },
            now,
          )
        }),
      ),

    /** Reserve durable ownership before creating any report or worker directory. */
    reserveReport: (input: Attempt) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          yield* requireAttempt(state, input)
          const id = `review-${randomUUID().replaceAll("-", "")}`
          yield* save(state, { ...state, reportIDs: [...(state.reportIDs ?? []), id] }, now)
          return id
        }),
      ),

    next: (input: Target, planning = true) =>
      storage(
        Effect.gen(function* () {
          const state = yield* requireState(input)
          if (state.info.status !== "active" || state.attemptID) return
          return state.pendingEvaluation
            ? ("evaluating" as const)
            : state.completion !== undefined
              ? ("verifying" as const)
              : planning && !state.info.plan
                ? ("planning" as const)
                : ("executing" as const)
        }),
      ),

    check: (input: Attempt) =>
      storage(
        Effect.gen(function* () {
          const state = yield* requireState(input)
          yield* requireAttempt(state, input)
          return state.info
        }),
      ),

    create: (sessionID: SessionID, input: Goal.Create, changesBaselineCommit?: string) =>
      transaction(
        Effect.gen(function* () {
          const valid = yield* Schema.decodeUnknownEffect(Schema.toType(Goal.Create))(input).pipe(
            Effect.mapError((error) => new Conflict({ code: "invalid", message: String(error) })),
          )
          if (!valid.objective.trim())
            return yield* new Conflict({ code: "invalid", message: "A goal requires an objective" })
          const current = yield* read(sessionID)
          if (current?.info.id === valid.id) {
            if (current.info.objective === valid.objective && current.info.tokenBudget === valid.tokenBudget)
              return current.info
            return yield* new Conflict({ code: "exists", message: "Goal ID was reused with different content" })
          }
          if (current && current.info.status !== "complete")
            return yield* new Conflict({ code: "exists", message: "Clear the unfinished goal before replacing it" })
          if (
            !(yield* db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
          )
            return yield* new Conflict({ code: "missing", message: "Session does not exist" })
          const duplicate = yield* db
            .select({ id: GoalTable.id })
            .from(GoalTable)
            .where(eq(GoalTable.id, valid.id))
            .get()
          if (duplicate) return yield* new Conflict({ code: "exists", message: "Goal ID belongs to another session" })
          if (current) yield* db.delete(GoalTable).where(eq(GoalTable.session_id, sessionID)).run()
          const now = yield* Clock.currentTimeMillis
          const info = Goal.Info.make({
            ...valid,
            ...(changesBaselineCommit ? { changesBaselineCommit } : {}),
            sessionID,
            status: "active",
            phase: "idle",
            tokensUsed: 0,
            elapsedMs: 0,
            createdAt: now,
            updatedAt: now,
            revision: 0,
            workerRounds: 0,
            verificationRounds: 0,
            unmet: [],
            history: [{ at: now, event: "created", tokensUsed: 0 }],
          })
          yield* db
            .insert(GoalTable)
            .values({
              session_id: sessionID,
              id: valid.id,
              data: Schema.encodeSync(State)({
                info,
                generation: 0,
                activeSince: now,
                blockerStreak: 0,
                unverifiedRounds: 0,
                verificationAttempts: 0,
                stalled: 0,
              }),
            })
            .run()
          return info
        }),
      ),

    prepareStart: (input: Target, selection: Goal.Start) =>
      change(input, (state, now) => {
        if (!Schema.is(Goal.Start)(selection))
          return Effect.fail(
            new Conflict({ code: "invalid", message: "A goal requires a valid model and agent selection" }),
          )
        const previous = state.info.launch
        if (previous) {
          if (
            previous.agent === selection.agent &&
            previous.model.id === selection.model.id &&
            previous.model.providerID === selection.model.providerID &&
            previous.model.variant === selection.model.variant
          )
            return Effect.succeed(state.info)
          return Effect.fail(
            new Conflict({ code: "exists", message: "Goal start was retried with a different model or agent" }),
          )
        }
        if (state.info.status !== "active" || state.info.phase !== "idle" || state.info.workerRounds > 0)
          return Effect.fail(
            new Conflict({ code: "inactive", message: "Only an unstarted active goal can select its initial model" }),
          )
        return save(
          state,
          {
            ...state,
            info: { ...state.info, launch: { ...selection, messageID: SessionMessage.ID.create() } },
          },
          now,
        )
      }),

    pause: (input: Target, reason: Pause, message?: string) =>
      change(input, (state, now) => {
        if (state.info.status !== "active") return Effect.succeed(state.info)
        return save(state, stop(state, reason, message), now, "paused", message)
      }),

    resume: (input: Target) =>
      change(input, (state, now) => {
        if (state.info.status === "complete")
          return Effect.fail(new Conflict({ code: "inactive", message: "The goal is already complete" }))
        if (exhausted(state.info))
          return Effect.fail(new Conflict({ code: "budget", message: "The goal token budget is exhausted" }))
        if (state.info.status === "active") return Effect.succeed(state.info)
        return save(
          state,
          {
            ...state,
            generation: state.generation + 1,
            attemptID: undefined,
            completion: undefined,
            pendingEvaluation: undefined,
            pendingBlocker: undefined,
            blockerKey: undefined,
            blockerStreak: 0,
            lastGaps: undefined,
            stalled: 0,
            verificationAttempts: 0,
            unverifiedRounds: 0,
            info: { ...state.info, status: "active", phase: "idle", message: undefined },
          },
          now,
          "resumed",
        )
      }),

    clear: (input: Target) =>
      change(input, () => db.delete(GoalTable).where(eq(GoalTable.id, input.goalID)).run().pipe(Effect.asVoid)),

    /** Invoke only after the executor establishes there is no live local drain. Never from get(). */
    recover: (input: Target, revision: number) =>
      change(input, (state, now) => {
        if (state.info.revision !== revision)
          return Effect.fail(new Conflict({ code: "stale", message: "Goal changed while recovering" }))
        if (state.info.status !== "active") return Effect.succeed(state.info)
        // Do not count the interval when the process was offline as active work.
        return save(
          { ...state, activeSince: undefined },
          stop(
            { ...state, info: { ...state.info, ...(state.attemptID ? { usageIncomplete: true } : {}) } },
            "user_paused",
            "Execution interrupted; resume explicitly",
          ),
          now,
          "recovered",
        )
      }),

    begin: (input: Target, kind: Work) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          if (state.info.status !== "active")
            return yield* new Conflict({ code: "inactive", message: "The goal is not active" })
          if (state.attemptID)
            return yield* new Conflict({ code: "busy", message: "A goal attempt is already running" })
          if (kind === "evaluating" && !state.pendingEvaluation)
            return yield* new Conflict({ code: "invalid", message: "No worker round is awaiting evaluation" })
          if (kind !== "evaluating" && state.pendingEvaluation)
            return yield* new Conflict({ code: "busy", message: "The worker round must be evaluated first" })
          if (kind === "verifying" && state.completion === undefined)
            return yield* new Conflict({ code: "invalid", message: "No completion request is pending" })
          if (kind !== "verifying" && state.completion !== undefined)
            return yield* new Conflict({ code: "busy", message: "Completion must be verified before more work" })
          const attemptID = randomUUID()
          yield* db
            .insert(GoalAttemptTable)
            .values({
              id: attemptID,
              goal_id: input.goalID,
              generation: state.generation,
              kind,
              state: "running",
              time_created: now,
            })
            .run()
          const info = yield* save(
            state,
            {
              ...state,
              attemptID,
              verificationAttempts: state.verificationAttempts + Number(kind === "verifying"),
              info: {
                ...state.info,
                phase: kind,
                workerRounds: state.info.workerRounds + Number(kind === "executing"),
                verificationRounds: state.info.verificationRounds + Number(kind === "verifying"),
              },
            },
            now,
            kind === "planning"
              ? "planning_started"
              : kind === "executing"
                ? "worker_started"
                : kind === "evaluating"
                  ? "evaluation_started"
                  : "verification_started",
          )
          return { ...input, attemptID, info }
        }),
      ),

    claimSummary: (input: Target, childID: SessionID, enabled: boolean) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          if (state.info.status !== "complete" || state.info.summary) return
          if (!enabled || exhausted(state.info) || state.info.usageIncomplete) {
            yield* save(
              state,
              {
                ...state,
                info: {
                  ...state.info,
                  summary: {
                    status: enabled && state.info.usageIncomplete ? "failed" : "skipped",
                    reason: !enabled ? "disabled" : state.info.usageIncomplete ? "usage" : "budget",
                    tokensUsed: 0,
                    finishedAt: now,
                  },
                },
              },
              now,
            )
            return
          }
          const attemptID = randomUUID()
          yield* db
            .insert(GoalAttemptTable)
            .values({
              id: attemptID,
              goal_id: input.goalID,
              generation: state.generation,
              kind: "summarizing",
              state: "running",
              time_created: now,
            })
            .run()
          const info = yield* save(
            state,
            {
              ...state,
              summaryAttemptID: attemptID,
              summaryOwner: SessionGoalCleanupOwner.current,
              info: {
                ...state.info,
                summary: { status: "running", sessionID: childID, tokensUsed: 0, startedAt: now },
              },
            },
            now,
          )
          return { ...input, attemptID, info }
        }),
      ),

    checkSummary: (input: Attempt, beforeRequest = false) =>
      transaction(
        Effect.gen(function* () {
          const state = yield* requireState(input)
          const attempt = yield* db
            .select()
            .from(GoalAttemptTable)
            .where(eq(GoalAttemptTable.id, input.attemptID))
            .get()
          if (
            state.info.status !== "complete" ||
            state.info.summary?.status !== "running" ||
            state.summaryAttemptID !== input.attemptID ||
            attempt?.kind !== "summarizing" ||
            attempt.goal_id !== input.goalID ||
            attempt.generation !== state.generation ||
            attempt.state !== "running"
          )
            return yield* new Conflict({ code: "stale", message: "The terminal summary no longer owns this Goal" })
          if (beforeRequest && state.info.usageIncomplete)
            return yield* new Conflict({
              code: "invalid",
              message: "Goal usage is incomplete before the closing summary",
            })
          if (beforeRequest && exhausted(state.info))
            return yield* new Conflict({ code: "budget", message: "No Goal budget remains for a closing summary" })
          return state.info
        }),
      ),

    finishSummary: (
      input: Attempt,
      result: { text?: string; reason?: Goal.Summary["reason"]; model?: Goal.RoleExecution["model"] },
    ) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          if (
            state.info.status !== "complete" ||
            state.info.summary?.status !== "running" ||
            state.summaryAttemptID !== input.attemptID
          )
            return yield* new Conflict({ code: "stale", message: "The terminal summary result is no longer current" })
          const text = result.text?.trim()
          const summary = yield* Schema.decodeUnknownEffect(Schema.toType(Goal.Summary))({
            ...state.info.summary,
            status: text ? "completed" : result.reason === "budget" ? "skipped" : "failed",
            ...(text ? { text: [...text].slice(0, 1200).join("") } : { reason: result.reason ?? "output" }),
            ...(result.model ? { model: result.model } : {}),
            finishedAt: now,
          }).pipe(Effect.mapError((error) => new Conflict({ code: "invalid", message: String(error) })))
          yield* db
            .update(GoalAttemptTable)
            .set({ state: "finished", time_finished: now })
            .where(eq(GoalAttemptTable.id, input.attemptID))
            .run()
          return yield* save(state, { ...state, info: { ...state.info, summary } }, now)
        }),
      ),

    reconcileSummary: (input: Attempt) =>
      change(input, (state, now) => {
        if (
          state.info.status !== "complete" ||
          state.info.summary?.status !== "running" ||
          state.summaryAttemptID !== input.attemptID ||
          !state.summaryOwner ||
          SessionGoalCleanupOwner.alive(state.summaryOwner.pid)
        )
          return Effect.void
        return save(
          state,
          {
            ...state,
            info: {
              ...state.info,
              usageIncomplete: true,
              summary: { ...state.info.summary, status: "failed", reason: "interrupted", finishedAt: now },
            },
          },
          now,
        ).pipe(Effect.asVoid)
      }),

    /** Claim before dispatch so interruption or explicit recovery cannot duplicate an adviser at this cadence. */
    claimStrategy: (input: Attempt, every: number) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          yield* requireAttempt(state, input, "executing")
          if (!Number.isSafeInteger(every) || every < 1)
            return yield* new Conflict({ code: "invalid", message: "Strategy cadence must be a positive integer" })
          if (
            !state.info.plan ||
            !state.info.unmet.length ||
            state.info.verificationRounds < (state.info.strategy?.round ?? 0) + every
          )
            return { claimed: false, info: state.info }
          const info = yield* save(
            state,
            {
              ...state,
              info: {
                ...state.info,
                strategy: {
                  round: state.info.verificationRounds,
                  workerRound: state.info.workerRounds,
                  status: "running",
                },
              },
            },
            now,
          )
          return { claimed: true, info }
        }),
      ),

    recordStrategy: (input: Attempt, result: Goal.Strategy) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          yield* requireAttempt(state, input, "executing")
          const valid = yield* Schema.decodeUnknownEffect(Schema.toType(Goal.Strategy))(result).pipe(
            Effect.mapError((error) => new Conflict({ code: "invalid", message: String(error) })),
          )
          if (
            state.info.strategy?.status !== "running" ||
            valid.round !== state.info.strategy.round ||
            valid.workerRound !== state.info.workerRounds ||
            valid.status === "running" ||
            (valid.status === "advised" && !valid.recommendation?.trim())
          )
            return yield* new Conflict({ code: "stale", message: "Strategy result does not match its live claim" })
          return yield* save(state, { ...state, info: { ...state.info, strategy: valid } }, now)
        }),
      ),

    /** Finalizers belong to an attempt, not to whichever run now owns the goal. */
    pauseAttempt: (input: Attempt, reason: Pause, message?: string) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          yield* requireAttempt(state, input)
          return yield* save(state, stop(state, reason, message), now, "paused", message)
        }),
      ),

    pauseRevision: (input: Target, revision: number, reason: Pause, message?: string) =>
      change(input, (state, now) => {
        if (state.info.revision !== revision)
          return Effect.fail(new Conflict({ code: "stale", message: "Goal changed before the pause was applied" }))
        if (state.info.status !== "active") return Effect.succeed(state.info)
        return save(state, stop(state, reason, message), now, "paused", message)
      }),

    /** A call's cumulative usage can be corrected upward; duplicate or out-of-order reports add nothing. */
    usage: (input: Attempt, callID: string, tokens: number) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          if (!callID || !Number.isSafeInteger(tokens) || tokens < 0)
            return yield* new Conflict({
              code: "invalid",
              message: "Usage needs a call ID and nonnegative safe integer",
            })
          const attempt = yield* db
            .select()
            .from(GoalAttemptTable)
            .where(and(eq(GoalAttemptTable.id, input.attemptID), eq(GoalAttemptTable.goal_id, input.goalID)))
            .get()
          if (!attempt) return yield* new Conflict({ code: "stale", message: "Unknown goal attempt" })
          const current = yield* db
            .select()
            .from(GoalUsageTable)
            .where(and(eq(GoalUsageTable.attempt_id, input.attemptID), eq(GoalUsageTable.id, callID)))
            .get()
          if (current && current.tokens >= tokens) return state.info
          const total = state.info.tokensUsed + tokens - (current?.tokens ?? 0)
          if (!Number.isSafeInteger(total))
            return yield* new Conflict({ code: "invalid", message: "Goal usage exceeds safe integer range" })
          yield* db
            .insert(GoalUsageTable)
            .values({ attempt_id: input.attemptID, id: callID, tokens })
            .onConflictDoUpdate({ target: [GoalUsageTable.attempt_id, GoalUsageTable.id], set: { tokens } })
            .run()
          const next = {
            ...state,
            info: {
              ...state.info,
              tokensUsed: total,
              ...(attempt.kind === "summarizing" && state.summaryAttemptID === input.attemptID && state.info.summary
                ? {
                    summary: {
                      ...state.info.summary,
                      tokensUsed: (state.info.summary.tokensUsed ?? 0) + tokens - (current?.tokens ?? 0),
                    },
                  }
                : {}),
            },
          }
          const limited = exhausted(next.info) && !["complete", "budget_limited"].includes(next.info.status)
          return yield* save(
            state,
            limited ? stop(next, "budget_limited", "Token budget exhausted") : next,
            now,
            limited ? "budget_exceeded" : undefined,
          )
        }),
      ),

    usageMissing: (input: Attempt) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          const attempt = yield* db
            .select({ id: GoalAttemptTable.id })
            .from(GoalAttemptTable)
            .where(and(eq(GoalAttemptTable.id, input.attemptID), eq(GoalAttemptTable.goal_id, input.goalID)))
            .get()
          if (!attempt) return yield* new Conflict({ code: "stale", message: "Unknown goal attempt" })
          if (state.info.usageIncomplete) return state.info
          return yield* save(
            state,
            { ...state, info: { ...state.info, usageIncomplete: true } },
            now,
            "usage_incomplete",
            "A model request ended without complete usage; recorded tokens are a lower bound",
          )
        }),
      ),

    update: (input: Attempt, update: Goal.Update) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          yield* requireAttempt(state, input, "executing")
          const valid = yield* Schema.decodeUnknownEffect(Schema.toType(Goal.Update))(update).pipe(
            Effect.mapError((error) => new Conflict({ code: "invalid", message: String(error) })),
          )
          if (
            (valid.completed && (valid.blocked_reason || state.pendingBlocker)) ||
            (valid.blocked_reason && state.completion)
          )
            return yield* new Conflict({
              code: "invalid",
              message: "Completion and blocking cannot be reported together",
            })
          const progress = valid.plan_progress
            ? SessionGoalProgress.update(state.info, valid.plan_progress)
            : { value: state.info.planProgress }
          if (progress.error)
            return yield* new Conflict({
              code: "invalid",
              message: progress.error,
            })
          const changed = progress.value !== state.info.planProgress
          if (valid.completed && state.completion !== undefined && !changed) return state.info
          if (!valid.completed && !valid.message && !valid.blocked_reason && !changed) return state.info
          return yield* save(
            state,
            {
              ...state,
              completion: valid.completed ? (valid.message ?? "Completion requested") : state.completion,
              pendingBlocker: valid.blocked_reason ?? state.pendingBlocker,
              info: {
                ...state.info,
                planProgress: progress.value,
                message: valid.message ?? valid.blocked_reason ?? state.info.message,
              },
            },
            now,
            valid.completed ? "completion_requested" : "progress",
            valid.message,
          )
        }),
      ),

    finish: (
      input: Attempt,
      result: {
        plan?: string
        plannerSessionID?: SessionID
        plannerExecution?: Goal.RoleExecution
        plannerFiles?: Goal.ReviewFiles
        blocker?: string
        message?: string
        failure?: string
        verify?: boolean
        evaluate?: boolean
      },
    ) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          const attempt = yield* requireAttempt(state, input)
          yield* Schema.decodeUnknownEffect(Schema.toType(Finish))(result).pipe(
            Effect.mapError((error) => new Conflict({ code: "invalid", message: String(error) })),
          )
          if (attempt.kind === "verifying" || attempt.kind === "evaluating")
            return yield* new Conflict({ code: "invalid", message: "An independent reviewer must provide a verdict" })
          if (result.evaluate && (attempt.kind !== "executing" || result.verify))
            return yield* new Conflict({ code: "invalid", message: "Worker evaluation must precede verification" })
          if (result.verify && attempt.kind !== "executing")
            return yield* new Conflict({ code: "invalid", message: "Only worker rounds can request verification" })
          if (
            result.plan !== undefined &&
            (attempt.kind !== "planning" || (state.info.plan !== undefined && state.info.plan !== result.plan))
          )
            return yield* new Conflict({
              code: "invalid",
              message: "The original Goal plan is immutable",
            })
          if (attempt.kind === "planning" && !result.failure && !result.plan?.trim())
            return yield* new Conflict({ code: "invalid", message: "Planning did not produce a plan" })
          yield* db
            .update(GoalAttemptTable)
            .set({ state: "finished", time_finished: now })
            .where(eq(GoalAttemptTable.id, attempt.id))
            .run()
          if (result.evaluate && !result.failure)
            return yield* save(
              state,
              {
                ...state,
                attemptID: undefined,
                pendingEvaluation: true,
                completion: undefined,
                pendingBlocker: undefined,
                info: { ...state.info, phase: "idle" },
              },
              now,
              "worker_completed",
              result.message,
            )
          const blocker = result.blocker ?? state.pendingBlocker
          const blockerKey = !result.failure && blocker?.trim() ? fingerprint([blocker]) : undefined
          const blockerStreak = blockerKey ? (blockerKey === state.blockerKey ? state.blockerStreak + 1 : 1) : 0
          const completion = blocker
            ? undefined
            : result.verify
              ? (result.message ?? "Worker round requires independent verification")
              : state.completion
          const next: State = {
            ...state,
            attemptID: undefined,
            pendingBlocker: undefined,
            completion,
            blockerKey,
            blockerStreak,
            unverifiedRounds: state.unverifiedRounds + Number(attempt.kind === "executing" && completion === undefined),
            info: {
              ...state.info,
              phase: "idle",
              plan: result.plan ?? state.info.plan,
              ...(result.plannerSessionID ? { plannerSessionID: result.plannerSessionID } : {}),
              ...(result.plannerExecution ? { plannerExecution: result.plannerExecution } : {}),
              ...(result.plannerFiles ? { plannerFiles: result.plannerFiles } : {}),
              message: result.message ?? blocker ?? state.info.message,
            },
          }
          const ended = result.failure
            ? stop(next, "infra_paused", result.failure)
            : blockerStreak >= 3
              ? stop(next, "blocked", blocker)
              : next.unverifiedRounds >= 3 && next.completion === undefined
                ? stop(next, "back_off_paused", "Three worker rounds ended without a completion request")
                : next
          return yield* save(
            state,
            ended,
            now,
            ended.info.status !== "active"
              ? "paused"
              : attempt.kind === "planning"
                ? "planning_completed"
                : "worker_completed",
            result.failure ?? result.message,
          )
        }),
      ),

    evaluate: (input: Attempt, result: Goal.Evaluation) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          yield* requireAttempt(state, input, "evaluating")
          const valid = yield* Schema.decodeUnknownEffect(SessionGoalEvaluation.Verdict, { onExcessProperty: "error" })(
            result,
          ).pipe(Effect.mapError((error) => new Conflict({ code: "invalid", message: String(error) })))
          yield* db
            .update(GoalAttemptTable)
            .set({ state: "finished", time_finished: now })
            .where(eq(GoalAttemptTable.id, input.attemptID))
            .run()
          const blockerStreak =
            valid.decision === "blocked" ? (valid.blocker_key === state.blockerKey ? state.blockerStreak + 1 : 1) : 0
          const next: State = {
            ...state,
            attemptID: undefined,
            pendingEvaluation: undefined,
            completion: valid.decision === "candidate_complete" ? valid.evidence : undefined,
            pendingBlocker: undefined,
            blockerKey: valid.decision === "blocked" ? valid.blocker_key : undefined,
            blockerStreak,
            unverifiedRounds: 0,
            info: { ...state.info, phase: "idle", evaluation: valid, message: valid.evidence },
          }
          return yield* save(
            state,
            blockerStreak >= 3 ? stop(next, "blocked", valid.evidence) : next,
            now,
            "evaluation_completed",
            valid.evidence,
          )
        }),
      ),

    prepareVerification: (
      input: Attempt,
      count: number,
      evidenceSha256: string,
      models: ReadonlyArray<Goal.RoleModel> = [],
    ) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          yield* requireAttempt(state, input, "verifying")
          const previous = state.info.verification
          if (previous?.round === state.info.verificationRounds) {
            if (previous.count === count && previous.evidenceSha256 === evidenceSha256) return state.info
            return yield* new Conflict({
              code: "exists",
              message: "Verification panel was retried with different inputs",
            })
          }
          const prior =
            count > 1 && previous?.count !== 1
              ? (previous?.results.find((result) => result.index === 0) ?? previous?.previous)
              : undefined
          const panel = yield* Schema.decodeUnknownEffect(Goal.Panel)({
            count,
            round: state.info.verificationRounds,
            evidenceSha256,
            results: [],
            ...(prior ? { previous: prior } : {}),
          }).pipe(Effect.mapError((error) => new Conflict({ code: "invalid", message: String(error) })))
          const existing = state.info.skepticModels ?? []
          const assignment = models.length
            ? [
                ...existing,
                ...Array.from(
                  { length: Math.max(0, count - existing.length) },
                  (_, index) => models[(existing.length + index) % models.length]!,
                ),
              ]
            : existing
          const skepticModels = yield* Schema.decodeUnknownEffect(
            Schema.Array(Goal.RoleModel).check(Schema.isMaxLength(5)),
          )(assignment).pipe(Effect.mapError((error) => new Conflict({ code: "invalid", message: String(error) })))
          return yield* save(
            state,
            {
              ...state,
              info: { ...state.info, verification: panel, ...(skepticModels.length ? { skepticModels } : {}) },
            },
            now,
          )
        }),
      ),

    recordVerification: (input: Attempt, result: Goal.Reviewer) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          yield* requireAttempt(state, input, "verifying")
          const valid = yield* Schema.decodeUnknownEffect(Goal.Reviewer)(result).pipe(
            Effect.mapError((error) => new Conflict({ code: "invalid", message: String(error) })),
          )
          const panel = state.info.verification
          if (
            !panel ||
            panel.round !== state.info.verificationRounds ||
            valid.index >= panel.count ||
            !valid.evidence.trim() ||
            valid.unmet.some((item) => !item.trim()) ||
            valid.achieved !== (valid.unmet.length === 0) ||
            (valid.achieved && valid.blocking !== "none")
          )
            return yield* new Conflict({ code: "invalid", message: "Invalid verification panel result" })
          const recorded = panel.results.find((item) => item.index === valid.index)
          if (recorded) {
            if (JSON.stringify(recorded) === JSON.stringify(valid)) return state.info
            return yield* new Conflict({ code: "exists", message: "Verifier index already has a result" })
          }
          if (panel.results.some((item) => item.callID === valid.callID))
            return yield* new Conflict({ code: "exists", message: "Verifier call ID was reused" })
          return yield* save(
            state,
            {
              ...state,
              info: {
                ...state.info,
                verification: { ...panel, results: [...panel.results, valid].toSorted((a, b) => a.index - b.index) },
              },
            },
            now,
          )
        }),
      ),

    verify: (input: Attempt, result?: Goal.Verification, maxAttempts = 10) =>
      change(input, (state, now) =>
        Effect.gen(function* () {
          yield* requireAttempt(state, input, "verifying")
          const panel =
            state.info.verification?.round === state.info.verificationRounds ? state.info.verification : undefined
          const aggregate = panel ? SessionGoalVerification.aggregate(panel) : undefined
          if (panel && !aggregate)
            return yield* new Conflict({ code: "busy", message: "Verification panel is not complete" })
          const valid = yield* Schema.decodeUnknownEffect(Goal.Verification)(aggregate ?? result).pipe(
            Effect.mapError((error) => new Conflict({ code: "invalid", message: String(error) })),
          )
          if (
            !valid.evidence.trim() ||
            (valid.achieved && valid.unmet.length) ||
            (!valid.achieved && !valid.unmet.length) ||
            !Number.isSafeInteger(maxAttempts) ||
            maxAttempts < 1
          )
            return yield* new Conflict({
              code: "invalid",
              message: "Verification requires consistent evidence and unmet requirements",
            })
          yield* db
            .update(GoalAttemptTable)
            .set({ state: "finished", time_finished: now })
            .where(eq(GoalAttemptTable.id, input.attemptID))
            .run()
          const gaps = fingerprint(valid.unmet)
          const stalled = !valid.achieved && state.lastGaps === gaps ? state.stalled + 1 : 1
          const next: State = {
            ...state,
            attemptID: undefined,
            completion: undefined,
            lastGaps: gaps,
            stalled,
            unverifiedRounds: 0,
            info: { ...state.info, phase: "idle", message: valid.evidence, unmet: valid.unmet },
          }
          const ended = valid.achieved
            ? stop(next, "complete", valid.evidence)
            : aggregate?.blocked
              ? stop(next, "blocked", valid.evidence)
              : stalled >= 2
                ? stop(next, "no_progress_paused", valid.evidence)
                : state.verificationAttempts >= maxAttempts
                  ? stop(next, "back_off_paused", valid.evidence)
                  : next
          return yield* save(state, ended, now, valid.achieved ? "completed" : "verification_rejected", valid.evidence)
        }),
      ),
  }
}

function exhausted(info: Goal.Info) {
  return info.tokenBudget !== undefined && info.tokensUsed >= info.tokenBudget
}

function stop(state: State, status: Goal.Status, message?: string): State {
  return {
    ...state,
    generation: state.generation + 1,
    attemptID: undefined,
    completion: undefined,
    pendingEvaluation: undefined,
    pendingBlocker: undefined,
    info: { ...state.info, status, phase: "idle", message },
  }
}

function fingerprint(values: readonly string[]) {
  return createHash("sha256")
    .update(JSON.stringify([...new Set(values.map((value) => value.trim().replace(/\s+/g, " ")))].sort()))
    .digest("hex")
}

export type Interface = ReturnType<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionGoal") {}
const layer = Layer.effect(Service, Database.Service.pipe(Effect.map((database) => make(database.db))))
export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })

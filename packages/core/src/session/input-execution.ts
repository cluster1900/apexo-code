export * as SessionInputExecution from "./input-execution"

import { and, desc, eq, isNull } from "drizzle-orm"
import { Clock, Context, DateTime, Effect, Layer, Schema } from "effect"
import { SessionInput } from "@apexo/schema/session-input"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"
import { SessionEvent } from "./event"
import { SessionSchema } from "./schema"
import { SessionMessage } from "./message"
import { SessionInputTable } from "./sql"
import { SessionLifecycle } from "./lifecycle"
import type { SessionExecution } from "./execution"
import { SessionInputExecutionOwner } from "./input-execution-owner"

export class Failure extends Schema.TaggedErrorClass<Failure>()("SessionInputExecution.Failure", {
  code: Schema.Literals(["missing", "conflict", "storage"]),
  message: Schema.String,
}) {}
export class SettlementConflict extends Schema.TaggedErrorClass<SettlementConflict>()(
  "SessionInputExecution.SettlementConflict",
  {},
) {}

type DB = Database.Interface["db"]
export type Target = { readonly sessionID: SessionSchema.ID; readonly inputID: SessionMessage.ID }
export type Settlement = Target & {
  readonly status: "completed" | "failed" | "interrupted" | "superseded"
  readonly reason: SessionInput.ExecutionReason
  readonly finish?: string
  readonly usageIncomplete: boolean
}

export function make(db: DB, events: EventV2.Interface, lifecycle: SessionLifecycle.Interface) {
  const row = (target: Target) =>
    db
      .select()
      .from(SessionInputTable)
      .where(and(eq(SessionInputTable.id, target.inputID), eq(SessionInputTable.session_id, target.sessionID)))
      .get()
      .pipe(Effect.orDie)
  const get = Effect.fn("SessionInputExecution.get")(function* (target: Target) {
    const value = yield* row(target)
    if (!value?.execution_policy || !value.execution_status)
      return yield* new Failure({ code: "missing", message: "Headless input not found" })
    const lost = value.execution_status === "active" && SessionInputExecutionOwner.dead(value.execution_owner)
    return SessionInput.Execution.make({
      id: target.inputID,
      sessionID: target.sessionID,
      policy: value.execution_policy,
      status: lost ? "interrupted" : value.execution_status,
      admittedSeq: value.admitted_seq,
      ...(value.promoted_seq === null ? {} : { promotedSeq: value.promoted_seq }),
      ...(value.execution_started_seq === null ? {} : { startedSeq: value.execution_started_seq }),
      ...(value.execution_ended_seq === null ? {} : { endedSeq: value.execution_ended_seq }),
      ...(lost
        ? { reason: "process_restart" as const }
        : value.execution_reason === null
          ? {}
          : { reason: value.execution_reason }),
      ...(value.execution_finish === null ? {} : { finish: value.execution_finish }),
      usageIncomplete: lost || value.execution_usage_incomplete === true,
    })
  })
  const settle = Effect.fn("SessionInputExecution.settle")(function* (input: Settlement) {
    const value = yield* get(input)
    if (terminal(value)) return value
    yield* events
      .publish(SessionEvent.InputExecutionSettled, {
        sessionID: input.sessionID,
        messageID: input.inputID,
        timestamp: yield* DateTime.now,
        status: input.status,
        reason: input.reason,
        finish: input.finish,
        usageIncomplete: input.usageIncomplete,
      })
      .pipe(Effect.catchDefect((error) => (error instanceof SettlementConflict ? Effect.void : Effect.die(error))))
    return yield* get(input)
  })
  const withdraw = Effect.fn("SessionInputExecution.withdraw")(function* (target: Target) {
    const current = yield* get(target)
    if (terminal(current)) return current
    if (current.promotedSeq !== undefined)
      return yield* new Failure({
        code: "conflict",
        message: "The input is active; conditional owned interruption is required",
      })
    const result = yield* settle({ ...target, status: "interrupted", reason: "withdrawn", usageIncomplete: false })
    if (!terminal(result))
      return yield* new Failure({
        code: "conflict",
        message: "Input promotion won withdrawal; conditional owned interruption is required",
      })
    return result
  })
  return {
    get,
    settle,
    withdraw,
    interrupt: Effect.fn("SessionInputExecution.interrupt")(function* (
      target: Target,
      interrupt: SessionExecution.Interface["interrupt"],
    ) {
      const before = yield* get(target)
      if (terminal(before)) return before
      if (before.promotedSeq === undefined)
        return yield* lifecycle
          .use(target.sessionID, withdraw(target))
          .pipe(
            Effect.catchTag("SessionLifecycle.Closed", () =>
              Effect.fail(new Failure({ code: "conflict", message: "Input Session incarnation has been retired" })),
            ),
          )
      const claim = yield* lifecycle.find(target.sessionID)
      const predicate = claim && SessionInputExecutionOwner.predicate(claim, target.inputID)
      if (!claim || !predicate || !lifecycle.available(claim))
        return yield* new Failure({ code: "conflict", message: "Input has no registered local execution owner" })
      let accepted = false
      yield* interrupt(target.sessionID, () => {
        accepted = lifecycle.available(claim) && predicate()
        return accepted
      })
      const after = yield* get(target)
      if (terminal(after)) return after
      return yield* new Failure({
        code: accepted ? "storage" : "conflict",
        message: accepted
          ? "Owned interruption ended without a terminal input receipt"
          : "Input ownership changed before interruption",
      })
    }),
    wait: Effect.fn("SessionInputExecution.wait")(function* (target: Target, timeoutMs = 1000) {
      if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30_000)
        return yield* new Failure({
          code: "conflict",
          message: "Input wait timeout must be between 0 and 30000 milliseconds",
        })
      const until = (yield* Clock.currentTimeMillis) + timeoutMs
      const claim = yield* SessionLifecycle.current(target.sessionID)
      while (true) {
        if (claim && !lifecycle.available(claim))
          return yield* new Failure({ code: "conflict", message: "Input Session incarnation has been retired" })
        const execution = yield* get(target)
        if (claim && !lifecycle.available(claim))
          return yield* new Failure({ code: "conflict", message: "Input Session incarnation has been retired" })
        if (terminal(execution)) return { execution, timedOut: false }
        const remaining = until - (yield* Clock.currentTimeMillis)
        if (remaining <= 0) return { execution, timedOut: true }
        // Passive bounded storage reads cannot miss an already committed terminal receipt.
        yield* Effect.sleep(Math.min(remaining, 25))
      }
    }),
    selected: Effect.fn("SessionInputExecution.selected")(function* (sessionID: SessionSchema.ID) {
      const value = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, sessionID))
        .orderBy(desc(SessionInputTable.promoted_seq))
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      return value?.execution_policy && value.promoted_seq !== null
        ? yield* get({ sessionID, inputID: value.id })
        : undefined
    }),
    pending: Effect.fn("SessionInputExecution.pending")(function* (sessionID: SessionSchema.ID) {
      const rows = yield* db
        .select()
        .from(SessionInputTable)
        .where(
          and(
            eq(SessionInputTable.session_id, sessionID),
            isNull(SessionInputTable.promoted_seq),
            isNull(SessionInputTable.execution_ended_seq),
            isNull(SessionInputTable.withdrawn_seq),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      return rows.filter((row) => row.execution_policy !== null).map((row) => ({ sessionID, inputID: row.id }))
    }),
    current: Effect.fn("SessionInputExecution.current")(function* (sessionID: SessionSchema.ID) {
      const value = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, sessionID))
        .orderBy(desc(SessionInputTable.promoted_seq))
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      if (!value || value.promoted_seq === null || !value.execution_policy || value.execution_ended_seq !== null) return
      if (value.execution_owner !== SessionInputExecutionOwner.stamp)
        return yield* new Failure({
          code: "conflict",
          message: "Headless input has no live execution owner; submit a new input to continue",
        })
      return { inputID: value.id, sessionID, policy: value.execution_policy }
    }),
  }
}

export function terminal(input: SessionInput.Execution) {
  return input.status !== "admitted" && input.status !== "active"
}

export const projectSettlement = Effect.fn("SessionInputExecution.projectSettlement")(function* (
  db: DB,
  event: SessionEvent.InputExecutionSettled,
) {
  if (event.durable === undefined) return yield* Effect.die("Input settlement requires a durable sequence")
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(and(eq(SessionInputTable.id, event.data.messageID), eq(SessionInputTable.session_id, event.data.sessionID)))
    .get()
    .pipe(Effect.orDie)
  if (!row?.execution_policy) return yield* Effect.die(new SettlementConflict())
  if (row.execution_ended_seq !== null) return yield* Effect.die(new SettlementConflict())
  if (event.data.reason === "withdrawn" && row.promoted_seq !== null) return yield* Effect.die(new SettlementConflict())
  yield* db
    .update(SessionInputTable)
    .set({
      execution_status: event.data.status,
      execution_reason: event.data.reason,
      execution_finish: event.data.finish ?? null,
      execution_usage_incomplete: event.data.usageIncomplete,
      execution_ended_seq: event.durable.seq,
    })
    .where(and(eq(SessionInputTable.id, event.data.messageID), isNull(SessionInputTable.execution_ended_seq)))
    .run()
    .pipe(Effect.orDie)
})

export type Interface = ReturnType<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionInputExecution") {}
export const node = makeGlobalNode({
  service: Service,
  deps: [Database.node, EventV2.node, SessionLifecycle.node],
  layer: Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const events = yield* EventV2.Service
      const lifecycle = yield* SessionLifecycle.Service
      return make(database.db, events, lifecycle)
    }),
  ),
})

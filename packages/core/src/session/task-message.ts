export * as SessionTaskMessage from "./task-message"

import { and, asc, eq, isNull } from "drizzle-orm"
import { Context, DateTime, Deferred, Effect, Layer, Option, Schema } from "effect"
import { Task } from "@apexo/schema/task"
import { optional } from "@apexo/schema/schema"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"
import { SessionEvent } from "./event"
import { SessionExecutionPolicy } from "./execution-policy"
import { SessionIncarnation } from "./incarnation"
import { SessionInput } from "./input"
import { SessionGoal } from "./goal"
import { SessionManagedChild } from "./managed-child"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionInputTable, SessionTable } from "./sql"
import { SessionTaskLaunchTable, SessionTaskMessageTable } from "./task.sql"
import { SessionTaskStore } from "./task-store"
import { SessionTaskRole } from "./task-role"

export const validText = (text: string) => text.trim().length > 0 && Buffer.byteLength(text, "utf8") <= 32768

export const SenderSource = Schema.Literals(["tool", "operator"])
export type SenderSource = typeof SenderSource.Type

const StoredBinding = Schema.Struct({
  parentCreated: Schema.String,
  senderID: SessionSchema.ID,
  senderCreated: Schema.String,
  source: optional(SenderSource),
})
type StoredBinding = typeof StoredBinding.Type
const decodeStoredBinding = Schema.decodeUnknownOption(Schema.fromJsonString(StoredBinding))

const decodeBinding = (raw: string, record: SessionTaskStore.Record): StoredBinding => {
  if (!raw.startsWith("{"))
    return {
      parentCreated: raw,
      senderID: record.parentID,
      senderCreated: raw,
      source: undefined,
    }
  const parsed = decodeStoredBinding(raw)
  return Option.isSome(parsed)
    ? parsed.value
    : {
        parentCreated: raw,
        senderID: record.parentID,
        senderCreated: raw,
        source: undefined,
      }
}

const encodeBinding = (binding: StoredBinding) =>
  binding.source === undefined &&
  binding.senderID === undefined
    ? binding.parentCreated
    : JSON.stringify(binding)

const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const db = database.db
  const events = yield* EventV2.Service
  const tasks = yield* SessionTaskStore.Service
  const roles = yield* SessionTaskRole.Service
  const goals = yield* SessionGoal.Service
  const signals = new Map<string, Deferred.Deferred<void>>()
  const pending = (launchID: string) =>
    db
      .select({ input: SessionInputTable, binding: SessionTaskMessageTable })
      .from(SessionTaskMessageTable)
      .innerJoin(SessionInputTable, eq(SessionTaskMessageTable.input_id, SessionInputTable.id))
      .where(
        and(
          eq(SessionTaskMessageTable.launch_id, launchID),
          isNull(SessionTaskMessageTable.terminal),
          isNull(SessionInputTable.promoted_seq),
          isNull(SessionInputTable.withdrawn_seq),
          isNull(SessionInputTable.execution_ended_seq),
        ),
      )
      .orderBy(asc(SessionInputTable.admitted_seq))
      .all()
      .pipe(Effect.orDie)
  const active = (launchID: string) =>
    Effect.gen(function* () {
      const launch = yield* tasks.launch(launchID)
      if (
        !launch ||
        launch.status !== "running" ||
        launch.owner !== tasks.owner ||
        !launch.request.activeMessages ||
        launch.request.executionPolicy
      )
        return yield* new SessionTaskStore.Failure({ code: "stale", message: "Active Task delivery is unavailable" })
      const record = yield* tasks.owned(launch.parentID, launch.sessionID)
      const gate = yield* db
        .select()
        .from(SessionTaskLaunchTable)
        .where(eq(SessionTaskLaunchTable.id, launchID))
        .get()
        .pipe(Effect.orDie)
      const role = roles.get(launch.sessionID)
      if (
        !gate?.admission_open ||
        gate.admission_closed ||
        role?.launchID !== launchID ||
        role.record.parentCreated !== record.parentCreated ||
        role.record.childCreated !== record.childCreated
      )
        return yield* new SessionTaskStore.Failure({ code: "busy", message: "Task delivery admission is closed" })
      for (const attempt of [role.attempt, roles.get(launch.parentID)?.attempt]) {
        if (attempt)
          yield* goals
            .check(attempt)
            .pipe(
              Effect.mapError(
                () =>
                  new SessionTaskStore.Failure({ code: "stale", message: "Task Goal attempt is no longer eligible" }),
              ),
            )
      }
      return { launch, record }
    })
  const receiptWithBinding = (viewerID: SessionSchema.ID, childID: SessionSchema.ID, inputID: SessionMessage.ID) =>
    Effect.gen(function* () {
      const record = yield* tasks.descendant(viewerID, childID)
      const row = yield* db
        .select()
        .from(SessionTaskMessageTable)
        .where(eq(SessionTaskMessageTable.input_id, inputID))
        .get()
        .pipe(Effect.orDie)
      const input = yield* SessionInput.find(db, inputID)
      const launch = row ? yield* tasks.launch(row.launch_id) : undefined
      if (!row || !input || !launch)
        return yield* new SessionTaskStore.Failure({ code: "missing", message: "Task message is unavailable" })
      const binding = decodeBinding(row.parent_created, record)
      const senderCreated = yield* SessionIncarnation.created(db, binding.senderID).pipe(Effect.orDie)
      if (
        input.sessionID !== childID ||
        launch.parentID !== record.parentID ||
        launch.sessionID !== childID ||
        binding.parentCreated !== record.parentCreated ||
        row.child_created !== record.childCreated ||
        !senderCreated ||
        binding.senderCreated !== senderCreated
      )
        return yield* new SessionTaskStore.Failure({ code: "missing", message: "Task message is unavailable" })
      const value: Task.MessageReceipt = {
        inputID,
        taskID: childID,
        delivery: row.delivery,
        status:
          input.promotedSeq !== undefined
            ? "promoted"
            : (row.terminal ?? (input.withdrawnSeq !== undefined ? "interrupted" : "admitted")),
        admittedAt: DateTime.toEpochMillis(input.timeCreated),
        ...(row.promoted_at === null ? {} : { promotedAt: row.promoted_at }),
      }
      return { receipt: value, binding, structured: row.parent_created.startsWith("{") }
    })
  const receipt = (viewerID: SessionSchema.ID, childID: SessionSchema.ID, inputID: SessionMessage.ID) =>
    receiptWithBinding(viewerID, childID, inputID).pipe(Effect.map((item) => item.receipt))
  const open = (launchID: string) =>
    Effect.gen(function* () {
      const launch = yield* tasks.launch(launchID)
      if (!launch?.request.activeMessages || launch.request.executionPolicy) return
      if (
        launch.owner !== tasks.owner ||
        launch.status !== "running" ||
        roles.get(launch.sessionID)?.launchID !== launchID
      )
        return yield* new SessionTaskStore.Failure({ code: "stale", message: "Task delivery owner is unavailable" })
      signals.set(launchID, Deferred.makeUnsafe<void>())
      const opened = yield* db
        .update(SessionTaskLaunchTable)
        .set({ admission_open: true })
        .where(and(eq(SessionTaskLaunchTable.id, launchID), eq(SessionTaskLaunchTable.admission_closed, false)))
        .returning()
        .get()
        .pipe(Effect.orDie)
      if (!opened)
        return yield* new SessionTaskStore.Failure({
          code: "stale",
          message: "Task delivery was closed before registration",
        })
    })
  // Exact retries reconcile the canonical input and sender attribution before inspecting a later launch.
  const retry = (
    senderID: SessionSchema.ID,
    childID: SessionSchema.ID,
    input: Task.MessageInput,
  ) =>
    Effect.gen(function* () {
      const delivery = input.delivery ?? "steer"
      const existing = yield* SessionInput.find(db, input.inputID)
      if (existing) {
        const previous = yield* receiptWithBinding(senderID, existing.sessionID, input.inputID)
        if (
          previous.binding.senderID !== senderID ||
          previous.receipt.delivery !== delivery ||
          !SessionInput.equivalent(existing, {
            sessionID: childID,
            prompt: { text: input.text },
            delivery: delivery === "queue" ? "queue" : "steer",
          })
        )
          return yield* new SessionTaskStore.Failure({
            code: "invalid",
            message: "Task message ID was reused with different input",
          })
        return previous.receipt
      }
    })
  const initial = (
    launchID: string,
    input: Task.MessageInput,
    check: () => Effect.Effect<void>,
    source?: SenderSource,
  ) =>
    Effect.gen(function* () {
      if (!validText(input.text))
        return yield* new SessionTaskStore.Failure({ code: "invalid", message: "Invalid initial Task message" })
      const launch = yield* tasks.launch(launchID)
      if (!launch)
        return yield* new SessionTaskStore.Failure({ code: "missing", message: "Task launch is unavailable" })
      yield* events
        .publish(
          SessionEvent.PromptAdmitted,
          {
            sessionID: launch.sessionID,
            messageID: input.inputID,
            timestamp: yield* DateTime.now,
            prompt: { text: input.text },
            delivery: input.delivery === "queue" ? "queue" : "steer",
          },
          {
            commit: () =>
              Effect.gen(function* () {
                yield* check()
                const current = yield* tasks.launch(launchID)
                const record = yield* tasks.owned(launch.parentID, launch.sessionID)
                const gate = yield* db
                  .select()
                  .from(SessionTaskLaunchTable)
                  .where(eq(SessionTaskLaunchTable.id, launchID))
                  .get()
                  .pipe(Effect.orDie)
                if (
                  !current ||
                  current.owner !== tasks.owner ||
                  current.status !== "running" ||
                  !current.request.activeMessages ||
                  current.request.executionPolicy ||
                  current.request.prompt !== input.text ||
                  !gate ||
                  gate.admission_open ||
                  gate.admission_closed
                )
                  return yield* new SessionTaskStore.Failure({
                    code: "stale",
                    message: "Task wake admission is unavailable",
                  })
                yield* db
                  .insert(SessionTaskMessageTable)
                  .values({
                    input_id: input.inputID,
                    launch_id: launchID,
                    parent_created: encodeBinding({
                      parentCreated: record.parentCreated,
                      senderID: record.parentID,
                      senderCreated: record.parentCreated,
                      source,
                    }),
                    child_created: record.childCreated,
                    delivery: input.delivery ?? "steer",
                    bytes: Buffer.byteLength(input.text, "utf8"),
                  })
                  .run()
                  .pipe(Effect.orDie)
              }).pipe(Effect.orDie),
          },
        )
        .pipe(
          Effect.catchDefect((error) =>
            error instanceof SessionTaskStore.Failure ? Effect.fail(error) : Effect.die(error),
          ),
        )
    })
  const send = (
    senderID: SessionSchema.ID,
    childID: SessionSchema.ID,
    input: Task.MessageInput,
    options?: {
      readonly agent?: SessionSchema.Info["agent"]
      readonly source?: SenderSource
    },
  ) =>
    Effect.gen(function* () {
      const bytes = Buffer.byteLength(input.text, "utf8")
      if (!validText(input.text))
        return yield* new SessionTaskStore.Failure({
          code: "invalid",
          message: "Task message must contain 1 to 32768 UTF-8 bytes",
        })
      if (yield* SessionExecutionPolicy.forSession(senderID))
        return yield* new SessionTaskStore.Failure({
          code: "denied",
          message: "Active Task delivery is unavailable to headless inputs",
        })
      const senderTask = yield* tasks.read(senderID)
      const senderManaged = yield* SessionManagedChild.managed(db, senderID).pipe(
        Effect.mapError(() => new SessionTaskStore.Failure({ code: "denied", message: "Sender authority is invalid" })),
      )
      if (senderManaged && !senderTask)
        return yield* new SessionTaskStore.Failure({
          code: "denied",
          message: "Active Task delivery is unavailable to this managed child",
        })
      if (senderTask) {
        yield* tasks.owned(senderTask.parentID, senderID)
        const senderRole = roles.get(senderID)
        if (!senderRole || senderRole.record.childCreated !== senderTask.childCreated)
          return yield* new SessionTaskStore.Failure({
            code: "stale",
            message: "Sender Task has no live capability",
          })
      }
      const record = yield* tasks.descendant(senderID, childID)
      const senderCreated = yield* SessionIncarnation.created(db, senderID).pipe(Effect.orDie)
      if (!senderCreated)
        return yield* new SessionTaskStore.Failure({ code: "missing", message: "Sender Session is unavailable" })
      const delivery = input.delivery ?? "steer"
      const previous = yield* retry(senderID, childID, input)
      if (previous) return previous
      const latest = yield* tasks.latest(record.parentID, childID)
      if (!latest) return yield* new SessionTaskStore.Failure({ code: "missing", message: "Task has no launch" })
      yield* active(latest.id)
      yield* events
        .publish(
          SessionEvent.PromptAdmitted,
          {
            sessionID: childID,
            messageID: input.inputID,
            timestamp: yield* DateTime.now,
            prompt: { text: input.text },
            delivery: delivery === "queue" ? "queue" : "steer",
          },
          {
            commit: () =>
              Effect.gen(function* () {
                const current = yield* active(latest.id)
                const currentRecord = yield* tasks.descendant(senderID, childID)
                const currentSenderCreated = yield* SessionIncarnation.created(db, senderID).pipe(Effect.orDie)
                if (
                  !currentSenderCreated ||
                  currentSenderCreated !== senderCreated ||
                  currentRecord.parentCreated !== current.record.parentCreated ||
                  currentRecord.childCreated !== current.record.childCreated
                )
                  return yield* new SessionTaskStore.Failure({
                    code: "stale",
                    message: "Sender incarnation changed during message admission",
                  })
                if (senderTask) {
                  const senderRole = roles.get(senderID)
                  if (!senderRole || senderRole.record.childCreated !== senderTask.childCreated)
                    return yield* new SessionTaskStore.Failure({
                      code: "stale",
                      message: "Sender Task lost its live capability during admission",
                    })
                  if (senderRole.attempt)
                    yield* goals
                      .check(senderRole.attempt)
                      .pipe(
                        Effect.mapError(
                          () =>
                            new SessionTaskStore.Failure({
                              code: "stale",
                              message: "Task Goal attempt is no longer eligible",
                            }),
                        ),
                      )
                }
                if (options && "agent" in options) {
                  const parent = yield* db
                    .select({ agent: SessionTable.agent })
                    .from(SessionTable)
                    .where(eq(SessionTable.id, senderID))
                    .get()
                    .pipe(Effect.orDie)
                  // Operator consent belongs to the persisted selection captured before permission evaluation.
                  if (!parent || (parent.agent ?? undefined) !== options.agent)
                    return yield* new SessionTaskStore.Failure({
                      code: "stale",
                      message: "Operator agent changed during message permission evaluation",
                    })
                }
                const rows = yield* pending(latest.id)
                const total = yield* db
                  .select()
                  .from(SessionTaskMessageTable)
                  .where(eq(SessionTaskMessageTable.launch_id, latest.id))
                  .all()
                  .pipe(Effect.orDie)
                const decodedPending = rows.map((row) => ({
                  bytes: row.binding.bytes,
                  binding: decodeBinding(row.binding.parent_created, current.record),
                }))
                const decodedTotal = total.map((row) => decodeBinding(row.parent_created, current.record))
                const sameBucket = (binding: StoredBinding) =>
                  binding.senderID === senderID && binding.source === options?.source
                const bucketPending = decodedPending.filter((item) => sameBucket(item.binding))
                const bucketTotal = decodedTotal.filter(sameBucket)
                const hasOtherBucketPending = decodedPending.some((item) => !sameBucket(item.binding))
                const hasOtherBucketTotal = decodedTotal.some((item) => !sameBucket(item))
                const narrowQuota = senderID !== current.record.parentID || hasOtherBucketPending || hasOtherBucketTotal
                const maxSenderPending = narrowQuota ? 16 : 32
                const maxSenderPendingBytes = narrowQuota ? 524_288 : 1_048_576
                const maxSenderTotal = narrowQuota ? 64 : 128
                if (
                  rows.length >= 32 ||
                  rows.reduce((sum, row) => sum + row.binding.bytes, 0) + bytes > 1048576 ||
                  total.length >= 128 ||
                  bucketPending.length >= maxSenderPending ||
                  bucketPending.reduce((sum, item) => sum + item.bytes, 0) + bytes > maxSenderPendingBytes ||
                  bucketTotal.length >= maxSenderTotal
                )
                  return yield* new SessionTaskStore.Failure({
                    code: "busy",
                    message: "Task message admission limit reached",
                  })
                yield* db
                  .insert(SessionTaskMessageTable)
                  .values({
                    input_id: input.inputID,
                    launch_id: latest.id,
                    parent_created: encodeBinding({
                      parentCreated: current.record.parentCreated,
                      senderID,
                      senderCreated,
                      source: options?.source,
                    }),
                    child_created: current.record.childCreated,
                    delivery,
                    bytes,
                  })
                  .run()
                  .pipe(Effect.orDie)
              }).pipe(Effect.orDie),
          },
        )
        .pipe(
          Effect.asVoid,
          Effect.catchDefect((error) =>
            Effect.gen(function* () {
              if (error instanceof SessionTaskStore.Failure) return yield* Effect.fail(error)
              if (!(error instanceof SessionInput.LifecycleConflict)) return yield* Effect.die(error)
              const stored = yield* SessionInput.find(db, input.inputID)
              const previous = yield* receiptWithBinding(senderID, childID, input.inputID)
              if (
                !stored ||
                previous.binding.senderID !== senderID ||
                previous.receipt.delivery !== delivery ||
                !SessionInput.equivalent(stored, {
                  sessionID: childID,
                  prompt: { text: input.text },
                  delivery: delivery === "queue" ? "queue" : "steer",
                })
              )
                return yield* new SessionTaskStore.Failure({
                  code: "invalid",
                  message: "Task message ID was reused with different input",
                })
            }),
          ),
        )
      if (delivery === "interject") {
        const signal = signals.get(latest.id)
        if (signal) yield* Deferred.succeed(signal, undefined)
      }
      return yield* receipt(senderID, childID, input.inputID)
    })
  const promote = (launchID: string, delivery: "steer" | "queue") =>
    Effect.gen(function* () {
      const current = yield* active(launchID)
      const cutoff = yield* EventV2.latestSequence(db, current.launch.sessionID)
      const rows = (yield* pending(launchID)).filter((row) => row.input.admitted_seq <= cutoff)
      const selected =
        delivery === "queue"
          ? rows.filter((row) => row.binding.delivery === "queue").slice(0, 1)
          : [
              ...rows.filter((row) => row.binding.delivery === "interject"),
              ...rows.filter((row) => row.binding.delivery === "steer"),
            ]
      const counts = yield* Effect.forEach(selected, (row) =>
        SessionInput.promoteOwned(db, events, current.launch.sessionID, SessionMessage.ID.make(row.input.id), () =>
          Effect.gen(function* () {
            yield* active(launchID)
            const binding = yield* db
              .select()
              .from(SessionTaskMessageTable)
              .where(eq(SessionTaskMessageTable.input_id, row.input.id))
              .get()
              .pipe(Effect.orDie)
            if (!binding || binding.launch_id !== launchID || binding.terminal)
              return yield* Effect.die(new SessionInput.Withdrawn({ id: SessionMessage.ID.make(row.input.id) }))
            yield* db
              .update(SessionTaskMessageTable)
              .set({ promoted_at: Date.now() })
              .where(eq(SessionTaskMessageTable.input_id, row.input.id))
              .run()
              .pipe(Effect.orDie)
          }).pipe(Effect.orDie),
        ),
      )
      if (!(yield* pending(launchID)).some((row) => row.binding.delivery === "interject"))
        signals.set(launchID, Deferred.makeUnsafe<void>())
      return counts.reduce((sum, count) => sum + count, 0)
    })
  // Read-only eligibility leaves admission open while a completion hook is held.
  const next = (launchID: string) =>
    Effect.gen(function* () {
      yield* active(launchID)
      const rows = yield* pending(launchID)
      return rows.some((row) => row.binding.delivery !== "queue")
        ? ("steer" as const)
        : rows.length
          ? ("queue" as const)
          : undefined
    })
  // The last idle decision serializes against admission in the same SQLite write transaction.
  const continueOrClose = (launchID: string) =>
    db
      .transaction(
        () =>
          Effect.gen(function* () {
            yield* active(launchID)
            const rows = yield* pending(launchID)
            if (rows.some((row) => row.binding.delivery !== "queue")) return "steer" as const
            if (rows.length) return "queue" as const
            yield* db
              .update(SessionTaskLaunchTable)
              .set({ admission_open: false, admission_closed: true })
              .where(eq(SessionTaskLaunchTable.id, launchID))
              .run()
              .pipe(Effect.orDie)
            return undefined
          }),
        { behavior: "immediate" },
      )
      .pipe(Effect.orDie)
  const close = (launchID: string, status: "cancelled" | "interrupted") =>
    Effect.gen(function* () {
      yield* db
        .update(SessionTaskLaunchTable)
        .set({ admission_open: false, admission_closed: true })
        .where(eq(SessionTaskLaunchTable.id, launchID))
        .run()
        .pipe(Effect.orDie)
      for (const row of yield* pending(launchID)) {
        yield* events.publish(
          SessionEvent.PromptWithdrawn,
          { sessionID: row.input.session_id, messageID: row.input.id, timestamp: yield* DateTime.now },
          {
            commit: () =>
              db
                .update(SessionTaskMessageTable)
                .set({ terminal: status })
                .where(
                  and(eq(SessionTaskMessageTable.input_id, row.input.id), isNull(SessionTaskMessageTable.terminal)),
                )
                .run()
                .pipe(Effect.orDie, Effect.asVoid),
          },
        )
      }
      signals.delete(launchID)
    })
  const interruptWait = <A, E, R>(sessionID: SessionSchema.ID, wait: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const role = roles.get(sessionID)
      const signal = role?.launchID ? signals.get(role.launchID) : undefined
      if (!signal || !role?.launchID) return yield* wait.pipe(Effect.map((value) => ({ value })))
      const launchID = role.launchID
      return yield* Effect.raceFirst(
        wait.pipe(Effect.map((value) => ({ value }))),
        Effect.gen(function* () {
          while (true) {
            const current = signals.get(launchID)
            if (!current) return yield* Effect.never
            const owner = yield* active(launchID).pipe(Effect.result)
            if (owner._tag === "Failure" || roles.get(sessionID)?.launchID !== launchID) return yield* Effect.never
            const rows = yield* pending(launchID)
            if (rows.some((row) => row.binding.delivery === "interject")) return { interruptedByMessage: true as const }
            yield* Deferred.await(current)
            // A consumed hint must rearm against the current durable inbox, not strand this waiter on an old signal.
            if (signals.get(launchID) === current) signals.set(launchID, Deferred.makeUnsafe<void>())
          }
        }),
      )
    })
  return { open, send, retry, initial, receipt, promote, next, continueOrClose, close, interruptWait }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/SessionTaskMessage") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Database.node, EventV2.node, SessionTaskStore.node, SessionTaskRole.node, SessionGoal.node],
})

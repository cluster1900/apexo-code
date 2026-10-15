export * as SessionMemoryOperation from "./memory-operation"

import path from "node:path"
import { randomUUID } from "node:crypto"
import { and, asc, desc, eq } from "drizzle-orm"
import { Cause, Clock, Context, Deferred, Effect, Exit, Fiber, FiberSet, Layer, Schema } from "effect"
import { MemoryOperation } from "@apexo/schema/memory-operation"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { Global } from "../global"
import { LocationRuntimeGuard } from "../location-runtime-guard"
import { LocationServiceMap } from "../location-service-map"
import { MemoryDreamNative } from "../memory-dream-native"
import { MemoryLegacyNative } from "../memory-legacy-native"
import { MemoryLifecycleNative } from "../memory-lifecycle-native"
import { MemoryConsolidation } from "../memory-consolidation"
import { MemoryCapture } from "../memory-capture"
import { MemoryV2 } from "../memory-v2"
import { Flock } from "../util/flock"
import type { SessionCompaction } from "./compaction"
import { SessionInputAdmission } from "./input-admission"
import { SessionInput } from "./input"
import { SessionExecutionPolicy } from "./execution-policy"
import { SessionIncarnation } from "./incarnation"
import { SessionLifecycle } from "./lifecycle"
import { SessionMessage } from "./message"
import { SessionMemoryOperationTable } from "./memory-operation.sql"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"

export class Failure extends Schema.TaggedErrorClass<Failure>()("MemoryOperationFailure", {
  code: Schema.Literals(["missing", "invalid", "busy", "conflict", "denied", "unsupported", "storage"]),
  message: Schema.String,
}) {}
const DreamLease = Schema.Struct({
  id: Schema.String,
  owner: Schema.String,
  token: Schema.String,
  expires: Schema.Number,
  shadow: Schema.Boolean,
  planned: Schema.Boolean,
})
const Record = Schema.Struct({
  ...MemoryOperation.Info.fields,
  owner: Schema.String,
  token: Schema.String,
  launch: Schema.Boolean,
  createdEventID: Schema.String,
  plan: Schema.Unknown,
  legacyDream: Schema.optionalKey(MemoryDreamNative.Publication),
  dreamClaim: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      owner: Schema.String,
      token: Schema.String,
      expires: Schema.Number,
      shadow: Schema.Boolean,
      planned: Schema.Boolean,
    }),
  ),
  batchClaims: Schema.optionalKey(Schema.Array(DreamLease)),
  claims: Schema.Array(
    Schema.Struct({ jobID: Schema.String, owner: Schema.String, token: Schema.String, sourceHash: Schema.String }),
  ),
})
type Record = Omit<typeof Record.Type, "plan"> & {
  plan:
    | MemoryLegacyNative.Plan
    | MemoryLifecycleNative.Plan
    | MemoryLifecycleNative.DreamPlan
    | MemoryDreamNative.Plan
    | MemoryLifecycleNative.MigrationPlan
    | MemoryLifecycleNative.RecoveryPlan
}
const error = (cause: unknown) =>
  cause instanceof Failure
    ? cause
    : cause instanceof SessionLifecycle.Closed
      ? new Failure({ code: "missing", message: "Session no longer exists" })
      : cause instanceof MemoryLifecycleNative.Failure
        ? new Failure({
            code:
              cause.code === "missing"
                ? "missing"
                : cause.code === "forbidden"
                  ? "denied"
                  : cause.code === "unsupported"
                    ? "unsupported"
                    : cause.code === "disabled" || cause.code === "changed"
                      ? "conflict"
                      : "storage",
            message: cause.message,
          })
        : new Failure({ code: "storage", message: "Memory operation state is unavailable" })
export type AutomaticEpoch = { readonly claim: SessionLifecycle.Claim; readonly token: object }
type AutomaticEntry = {
  readonly workers: Set<Fiber.Fiber<void>>
  registered: boolean
  token?: object
  stopping: readonly Fiber.Fiber<void>[]
}
const make = Effect.gen(function* () {
  const inputAdmission = yield* SessionInputAdmission.Service
  const database = yield* Database.Service
  const lifecycle = yield* SessionLifecycle.Service
  const sessions = yield* SessionStore.Service
  const locations = yield* LocationServiceMap.Service
  const guard = yield* LocationRuntimeGuard.Service
  const global = yield* Global.Service
  const owner = randomUUID()
  const active = new Map<MemoryOperation.ID, { claim: SessionLifecycle.Claim; fiber: Fiber.Fiber<void> }>()
  const fork = yield* FiberSet.makeRuntime<never, void, never>()
  const automatic = new Map<SessionLifecycle.Claim, AutomaticEntry>()
  const entry = (claim: SessionLifecycle.Claim) => {
    const current = automatic.get(claim)
    if (current) return current
    const value: AutomaticEntry = { workers: new Set(), stopping: [], registered: false }
    automatic.set(claim, value)
    return value
  }
  const isCurrent = (epoch: AutomaticEpoch) =>
    lifecycle.available(epoch.claim) && automatic.get(epoch.claim)?.token === epoch.token
  const stopAutomatic = (claim: SessionLifecycle.Claim) => {
    const value = automatic.get(claim)
    if (!value) return
    value.token = undefined
    value.stopping = [...new Set([...value.stopping, ...value.workers])]
  }
  const joinWorkers = (workers: readonly Fiber.Fiber<void>[]) =>
    Effect.forEach(workers, Fiber.interrupt, { discard: true, concurrency: "unbounded" })
  const joinAutomaticStop = (claim: SessionLifecycle.Claim) =>
    Effect.suspend(() => {
      const value = automatic.get(claim)
      if (!value) return Effect.void
      const workers = value.stopping
      return joinWorkers(workers).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (value.stopping === workers) value.stopping = []
          }),
        ),
      )
    })
  const trackAutomatic = (claim: SessionLifecycle.Claim) =>
    Effect.gen(function* () {
      const value = entry(claim)
      if (value.registered) return
      yield* lifecycle.register(
        claim,
        value,
        Effect.suspend(() => {
          stopAutomatic(claim)
          return joinAutomaticStop(claim).pipe(Effect.ensuring(Effect.sync(() => automatic.delete(claim))))
        }),
      )
      yield* inputAdmission.observe(claim, value, () => {
        stopAutomatic(claim)
        const workers = value.stopping
        value.stopping = []
        return joinWorkers(workers)
      })
      value.registered = true
    })
  const beginAutomaticActivity = (claim: SessionLifecycle.Claim) =>
    Effect.gen(function* () {
      yield* trackAutomatic(claim)
      const value = entry(claim)
      const started = yield* inputAdmission.fence(
        claim,
        Effect.sync(() => {
          const workers = [...value.workers]
          const token = {}
          value.token = token
          return { workers, epoch: { claim, token } }
        }),
      )
      yield* joinWorkers(started.workers)
      return started.epoch
    }).pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.interrupt))
  const pendingInput = (claim: SessionLifecycle.Claim) =>
    Effect.gen(function* () {
      if (!lifecycle.available(claim)) return true
      return (
        (yield* SessionInput.hasPending(database.db, claim.sessionID, "steer")) ||
        (yield* SessionInput.hasPending(database.db, claim.sessionID, "queue"))
      )
    })
  const read = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, id: MemoryOperation.ID) {
    const row = yield* database.db
      .select()
      .from(SessionMemoryOperationTable)
      .where(and(eq(SessionMemoryOperationTable.id, id), eq(SessionMemoryOperationTable.session_id, sessionID)))
      .get()
    if (!row) return
    const saved = yield* Schema.decodeUnknownEffect(Record)(row.data)
    // Structurally overlapping union members may discard variant fields. The
    // durable operation kind selects exactly one private plan codec.
    const plan = yield* Effect.gen(function* () {
      if (saved.kind === "flush" && saved.backend === "legacy")
        return yield* Schema.decodeUnknownEffect(MemoryLegacyNative.Plan, { onExcessProperty: "error" })(saved.plan)
      if (saved.kind === "dream" && saved.backend === "legacy")
        return yield* Schema.decodeUnknownEffect(MemoryDreamNative.Plan, { onExcessProperty: "error" })(saved.plan)
      if (saved.kind === "dream")
        return yield* Schema.decodeUnknownEffect(MemoryLifecycleNative.DreamPlan, { onExcessProperty: "error" })(
          saved.plan,
        )
      if (saved.kind === "recovery")
        return yield* Schema.decodeUnknownEffect(MemoryLifecycleNative.RecoveryPlan, { onExcessProperty: "error" })(
          saved.plan,
        )
      if (saved.kind === "migration")
        return yield* Schema.decodeUnknownEffect(MemoryLifecycleNative.MigrationPlan, { onExcessProperty: "error" })(
          saved.plan,
        )
      return yield* Schema.decodeUnknownEffect(MemoryLifecycleNative.Plan, { onExcessProperty: "error" })(saved.plan)
    })
    const record: Record = { ...saved, plan }
    if (
      record.id !== row.id ||
      record.sessionID !== row.session_id ||
      record.token !== row.token ||
      record.createdEventID !== row.created_event_id ||
      record.createdEventID !== (yield* SessionIncarnation.created(database.db, sessionID))
    )
      return yield* new Failure({ code: "conflict", message: "Memory operation belongs to a retired Session" })
    if (record.legacyDream && record.legacyDream.operationID !== record.id) {
      const origin = yield* database.db
        .select()
        .from(SessionMemoryOperationTable)
        .where(
          and(
            eq(SessionMemoryOperationTable.id, record.legacyDream.operationID),
            eq(SessionMemoryOperationTable.session_id, sessionID),
          ),
        )
        .get()
      const proof = origin ? yield* Schema.decodeUnknownEffect(Record)(origin.data) : undefined
      if (
        !proof ||
        proof.id !== origin?.id ||
        proof.token !== origin?.token ||
        proof.createdEventID !== origin?.created_event_id ||
        proof.createdEventID !== record.createdEventID ||
        proof.kind !== "dream" ||
        proof.backend !== "legacy" ||
        proof.legacyDream?.operationID !== proof.id ||
        JSON.stringify(proof.legacyDream) !== JSON.stringify(record.legacyDream)
      )
        return yield* new Failure({ code: "conflict", message: "Legacy Dream publication owner cannot be proven" })
    }
    return record
  })
  const info = (record: Record): MemoryOperation.Info => ({
    id: record.id,
    sessionID: record.sessionID,
    kind: record.kind,
    backend: record.backend,
    ...(record.kind === "recovery" && Schema.is(MemoryLifecycleNative.RecoveryPlan)(record.plan)
      ? { recovery: { action: record.plan.recovery.preview.action, scope: record.plan.recovery.preview.scope } }
      : {}),
    state: record.state,
    ownership: record.state === "finished" ? "settled" : active.has(record.id) ? "local" : "unverified",
    ...(record.retryOf ? { retryOf: record.retryOf } : {}),
    createdAt: record.createdAt,
    ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
    ...(record.result ? { result: record.result } : {}),
  })
  const save = (record: Record) =>
    database.db
      .update(SessionMemoryOperationTable)
      .set({ data: record })
      .where(
        and(
          eq(SessionMemoryOperationTable.id, record.id),
          eq(SessionMemoryOperationTable.session_id, record.sessionID),
          eq(SessionMemoryOperationTable.token, record.token),
          eq(SessionMemoryOperationTable.created_event_id, record.createdEventID),
        ),
      )
      .returning({ id: SessionMemoryOperationTable.id })
      .get()
      .pipe(
        Effect.flatMap((row) =>
          row
            ? Effect.void
            : Effect.fail(new Failure({ code: "conflict", message: "Memory operation was retired before settlement" })),
        ),
      )
  const get = Effect.fn("SessionMemoryOperation.get")(
    function* (sessionID: SessionSchema.ID, id: MemoryOperation.ID) {
      if (!(yield* sessions.get(sessionID)))
        return yield* new Failure({ code: "missing", message: "Session not found" })
      const record = yield* read(sessionID, id)
      if (!record) return yield* new Failure({ code: "missing", message: "Memory operation not found" })
      return info(record)
    },
    (effect, sessionID) => lifecycle.read(sessionID, effect).pipe(Effect.mapError(error)),
  )
  const list = Effect.fn("SessionMemoryOperation.list")(
    function* (sessionID: SessionSchema.ID) {
      if (!(yield* sessions.get(sessionID)))
        return yield* new Failure({ code: "missing", message: "Session not found" })
      const rows = yield* database.db
        .select({ id: SessionMemoryOperationTable.id })
        .from(SessionMemoryOperationTable)
        .where(eq(SessionMemoryOperationTable.session_id, sessionID))
        .orderBy(desc(SessionMemoryOperationTable.time_created), desc(SessionMemoryOperationTable.id))
        .limit(100)
        .all()
      return yield* Effect.forEach(rows, (row) => get(sessionID, row.id))
    },
    (effect, sessionID) => lifecycle.read(sessionID, effect).pipe(Effect.mapError(error)),
  )
  const admit: (
    sessionID: SessionSchema.ID,
    input: MemoryOperation.Input | MemoryOperation.MigrationInput | MemoryOperation.RecoveryInput,
    kind: "capture" | "flush" | "dream" | "migration" | "recovery",
    launch: boolean,
    prepared?:
      | MemoryLegacyNative.Plan
      | MemoryLifecycleNative.Plan
      | MemoryLifecycleNative.DreamPlan
      | MemoryDreamNative.Plan
      | MemoryLifecycleNative.MigrationPlan
      | MemoryLifecycleNative.RecoveryPlan,
    automaticEpoch?: AutomaticEpoch,
  ) => Effect.Effect<MemoryOperation.Info, unknown> = Effect.fnUntraced(function* (
    sessionID: SessionSchema.ID,
    input: MemoryOperation.Input | MemoryOperation.MigrationInput | MemoryOperation.RecoveryInput,
    kind: "capture" | "flush" | "dream" | "migration" | "recovery",
    launch: boolean,
    prepared?:
      | MemoryLegacyNative.Plan
      | MemoryLifecycleNative.Plan
      | MemoryLifecycleNative.DreamPlan
      | MemoryDreamNative.Plan
      | MemoryLifecycleNative.MigrationPlan
      | MemoryLifecycleNative.RecoveryPlan,
    automaticEpoch?: AutomaticEpoch,
  ) {
    const claim = yield* lifecycle.capture(sessionID)
    const existing = yield* read(sessionID, input.id)
    if (existing) {
      if (existing.kind !== kind || existing.retryOf !== input.retryOf)
        return yield* new Failure({ code: "conflict", message: "Memory operation ID was used for a different request" })
      if (
        kind === "migration" &&
        (!Schema.is(MemoryOperation.MigrationInput)(input) ||
          !Schema.is(MemoryLifecycleNative.MigrationPlan)(existing.plan) ||
          !Schema.toEquivalence(MemoryOperation.MigrationPreview)(existing.plan.migration.preview, input.preview))
      )
        return yield* new Failure({ code: "conflict", message: "Migration operation ID has a different preview" })
      if (
        kind === "recovery" &&
        (!Schema.is(MemoryOperation.RecoveryInput)(input) ||
          !Schema.is(MemoryLifecycleNative.RecoveryPlan)(existing.plan) ||
          !Schema.toEquivalence(MemoryOperation.RecoveryPreview)(existing.plan.recovery.preview, input.preview))
      )
        return yield* new Failure({ code: "conflict", message: "Recovery operation ID has a different preview" })
      return info(existing)
    }
    const session = yield* sessions.get(sessionID)
    if (!session) return yield* new Failure({ code: "missing", message: "Session not found" })
    const previous = input.retryOf ? yield* read(sessionID, input.retryOf) : undefined
    if (input.retryOf && !previous)
      return yield* new Failure({ code: "missing", message: "Original Memory operation not found" })
    if (previous && previous.kind !== kind)
      return yield* new Failure({
        code: "conflict",
        message: "Memory retry kind does not match its original operation",
      })
    const previousWorker = previous && active.get(previous.id)
    if (previous && previousWorker) {
      if (previous.state !== "finished")
        return yield* new Failure({ code: "busy", message: "Original Memory operation is still running" })
      // The durable result can precede lock/scope cleanup. Join outside the admission mutation lease.
      yield* Fiber.await(previousWorker.fiber)
    }
    if (
      kind === "migration" &&
      (!Schema.is(MemoryOperation.MigrationInput)(input) ||
        (previous &&
          (!Schema.is(MemoryLifecycleNative.MigrationPlan)(previous.plan) ||
            !Schema.toEquivalence(MemoryOperation.MigrationPreview)(previous.plan.migration.preview, input.preview))))
    )
      return yield* new Failure({ code: "conflict", message: "Migration retry does not match its original preview" })
    if (
      kind === "recovery" &&
      (!Schema.is(MemoryOperation.RecoveryInput)(input) ||
        (previous &&
          (!Schema.is(MemoryLifecycleNative.RecoveryPlan)(previous.plan) ||
            !Schema.toEquivalence(MemoryOperation.RecoveryPreview)(previous.plan.recovery.preview, input.preview))))
    )
      return yield* new Failure({ code: "conflict", message: "Recovery retry does not match its original preview" })
    const current =
      previous?.plan ??
      prepared ??
      (yield* MemoryLifecycleNative.Service.use((memory) =>
        Effect.gen(function* () {
          if (kind === "recovery" && Schema.is(MemoryOperation.RecoveryInput)(input))
            return yield* memory.prepareRecovery(sessionID, input)
          if (kind === "dream") return yield* memory.prepareDream(sessionID, true)
          if (kind === "migration" && Schema.is(MemoryOperation.MigrationInput)(input))
            return yield* memory.prepareMigration(sessionID, input.preview)
          if (kind === "flush") return yield* memory.prepareFlush(sessionID)
          return yield* memory.prepare(sessionID)
        }),
      ).pipe(Effect.provide(locations.get(session.location)), (effect) => guard.use(session.location, effect)))
    const sourcePlans: MemoryLifecycleNative.Plan[] = []
    if (!previous && kind === "flush" && current.backend === "v2") {
      const receipts = yield* database.db
        .select({ id: SessionMemoryOperationTable.id })
        .from(SessionMemoryOperationTable)
        .where(eq(SessionMemoryOperationTable.session_id, sessionID))
        .orderBy(asc(SessionMemoryOperationTable.time_created), asc(SessionMemoryOperationTable.id))
        .limit(1001)
        .all()
      if (receipts.length > 1000)
        return yield* new Failure({
          code: "busy",
          message: "Memory operation history exceeds the supported flush reconciliation bound",
        })
      for (const receipt of receipts) {
        const saved = yield* read(sessionID, receipt.id)
        if (
          saved &&
          saved.plan.createdEventID === current.createdEventID &&
          saved.plan.generation === current.generation &&
          saved.plan.revision === current.revision
        )
          if (Schema.is(MemoryLifecycleNative.Plan)(saved.plan)) sourcePlans.push(saved.plan)
      }
    }
    const sources = new Map<string, MemoryLifecycleNative.Plan["sources"][number]>()
    for (const source of [...sourcePlans, current].flatMap((plan) => plan.sources)) {
      // First terminal capture owns a source. A resumed assistant cannot rewrite a previously admitted stopped turn.
      if (!sources.has(source.promptID)) sources.set(source.promptID, source)
    }
    const plan = previous ? current : { ...current, sources: [...sources.values()] }
    if (Buffer.byteLength(JSON.stringify(plan)) > 4 * 1024 * 1024)
      return yield* new Failure({
        code: "invalid",
        message: "Memory source snapshot exceeds the supported operation bound",
      })
    // Retry retains the exact target and original source authority. It never adds later turns.
    const record: Record = {
      id: input.id,
      sessionID,
      kind,
      backend: plan.backend,
      state: "queued",
      ownership: "unverified",
      owner,
      token: randomUUID(),
      launch,
      createdEventID: plan.createdEventID,
      plan,
      claims: [],
      createdAt: yield* Clock.currentTimeMillis,
      ...(input.retryOf ? { retryOf: input.retryOf } : {}),
      ...(previous?.legacyDream ? { legacyDream: previous.legacyDream } : {}),
    }
    return yield* lifecycle.use(
      sessionID,
      Effect.uninterruptibleMask(() =>
        Effect.gen(function* () {
          if ((yield* SessionIncarnation.created(database.db, sessionID)) !== record.createdEventID)
            return yield* new Failure({ code: "conflict", message: "Session changed before Memory admission" })
          if (automaticEpoch && !isCurrent(automaticEpoch)) return yield* Effect.interrupt
          const inserted = yield* database.db
            .insert(SessionMemoryOperationTable)
            .values({
              id: record.id,
              session_id: sessionID,
              token: record.token,
              created_event_id: record.createdEventID,
              data: record,
              time_created: record.createdAt,
            })
            .onConflictDoNothing()
            .returning({ id: SessionMemoryOperationTable.id })
            .get()
          const admitted = yield* read(sessionID, input.id)
          if (!admitted || admitted.kind !== kind || admitted.retryOf !== input.retryOf)
            return yield* new Failure({
              code: "conflict",
              message: "Memory operation ID was used for a different request",
            })
          if (inserted && automaticEpoch && !isCurrent(automaticEpoch)) {
            const cancelled: Record = {
              ...record,
              state: "finished",
              finishedAt: Date.now(),
              result: { status: "cancelled" },
            }
            yield* save(cancelled)
            return info(cancelled)
          }
          // Only the transaction that inserted this receipt may launch its worker.
          if (!inserted || !launch) return info(admitted)
          const ready = Deferred.makeUnsafe<void>()
          const registration = { release: () => {} }
          const claims: MemoryCapture.ClaimProof[] = []
          const dreamClaim: { value?: MemoryConsolidation.Lease } = { value: previous?.dreamClaim }
          const batchClaims = [...(previous?.batchClaims ?? [])]
          const captureToken = automatic.get(claim)?.token
          const legacyDream: { value?: MemoryDreamNative.Publication } = { value: previous?.legacyDream }
          const settlement = { done: false, committed: false }
          const finish = (result: MemoryOperation.Result) =>
            save({
              ...record,
              claims: [...claims],
              ...(dreamClaim.value ? { dreamClaim: dreamClaim.value } : {}),
              ...(legacyDream.value ? { legacyDream: legacyDream.value } : {}),
              ...(batchClaims.length ? { batchClaims: [...batchClaims] } : {}),
              state: "finished",
              ownership: "settled",
              finishedAt: Date.now(),
              result,
            }).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  settlement.done = true
                }),
              ),
              Effect.uninterruptible,
            )
          const fiber = fork(
            lifecycle.owned(
              claim,
              Effect.interruptible(
                Deferred.await(ready).pipe(
                  Effect.andThen(
                    Effect.scoped(
                      Effect.gen(function* () {
                        // A live owner is never stolen due to an elapsed heartbeat. Explicit recovery may reclaim a proven dead PID.
                        const result = yield* MemoryLifecycleNative.Service.use((memory) =>
                          memory.owned(
                            plan,
                            Effect.gen(function* () {
                              yield* Flock.effect(`native-memory:${sessionID}`, {
                                dir: path.join(global.state, "memory-operation-locks"),
                                timeoutMs: 300000,
                                deadOwnerOnly: true,
                                reclaimDeadOwner: true,
                              })
                              if (!lifecycle.available(claim) || (automaticEpoch && !isCurrent(automaticEpoch)))
                                return yield* Effect.interrupt
                              yield* save({
                                ...record,
                                ...(dreamClaim.value ? { dreamClaim: dreamClaim.value } : {}),
                                ...(legacyDream.value ? { legacyDream: legacyDream.value } : {}),
                                state: "running",
                                ownership: "local",
                              })
                              const recover: MemoryCapture.ClaimProof[] = []
                              if (kind === "flush" && plan.backend === "v2") {
                                const rows = yield* database.db
                                  .select({ id: SessionMemoryOperationTable.id })
                                  .from(SessionMemoryOperationTable)
                                  .where(eq(SessionMemoryOperationTable.session_id, sessionID))
                                  .limit(1001)
                                  .all()
                                if (rows.length > 1000)
                                  return yield* new Failure({
                                    code: "busy",
                                    message: "Memory recovery history exceeds its supported bound",
                                  })
                                for (const row of rows) {
                                  const previous = yield* read(sessionID, row.id)
                                  if (!previous || previous.createdEventID !== record.createdEventID) continue
                                  for (const proof of previous.claims) {
                                    if (proof.owner !== `${previous.owner}:${previous.id}`)
                                      return yield* new Failure({
                                        code: "storage",
                                        message: "Memory lease receipt identity is invalid",
                                      })
                                    recover.push(proof)
                                  }
                                }
                              }
                              if (Schema.is(MemoryDreamNative.Plan)(plan))
                                return yield* memory.executeLegacyDream(plan, {
                                  operationID: record.id,
                                  ...(automaticEpoch
                                    ? {
                                        automatic: {
                                          claim: automaticEpoch.claim,
                                          valid: () => isCurrent(automaticEpoch),
                                        },
                                      }
                                    : {}),
                                  ...(previous?.legacyDream ? { recover: previous.legacyDream } : {}),
                                  prepared: (publication) =>
                                    Effect.gen(function* () {
                                      legacyDream.value = publication
                                      yield* save({
                                        ...record,
                                        legacyDream: publication,
                                        state: "running",
                                        ownership: "local",
                                      })
                                    }),
                                })
                              if (Schema.is(MemoryLegacyNative.Plan)(plan))
                                return yield* memory.executeLegacy(
                                  plan,
                                  automaticEpoch
                                    ? { claim: automaticEpoch.claim, valid: () => isCurrent(automaticEpoch) }
                                    : undefined,
                                )
                              if (Schema.is(MemoryLifecycleNative.RecoveryPlan)(plan))
                                return yield* memory.executeRecovery(
                                  plan,
                                  Effect.sync(() => {
                                    settlement.committed = true
                                  }),
                                )
                              if (Schema.is(MemoryLifecycleNative.MigrationPlan)(plan))
                                return yield* memory.executeMigration(plan)
                              if (Schema.is(MemoryLifecycleNative.DreamPlan)(plan)) {
                                if (
                                  previous?.dreamClaim &&
                                  previous.dreamClaim.owner !== `${previous.owner}:${previous.id}`
                                )
                                  return yield* new Failure({
                                    code: "storage",
                                    message: "Dream receipt owner is invalid",
                                  })
                                if (previous?.batchClaims?.length) {
                                  const owners = new Set<string>()
                                  const seen = new Set<MemoryOperation.ID>()
                                  let ancestor: Record | undefined = previous
                                  while (ancestor) {
                                    if (seen.has(ancestor.id) || seen.size >= 1000)
                                      return yield* new Failure({
                                        code: "storage",
                                        message: "Invalid batch retry ancestry",
                                      })
                                    seen.add(ancestor.id)
                                    owners.add(`${ancestor.owner}:${ancestor.id}`)
                                    if (previous.batchClaims.every((lease) => owners.has(lease.owner))) break
                                    ancestor = ancestor.retryOf ? yield* read(sessionID, ancestor.retryOf) : undefined
                                  }
                                  if (previous.batchClaims.some((lease) => !owners.has(lease.owner)))
                                    return yield* new Failure({
                                      code: "storage",
                                      message: "Batch Dream receipt owner is invalid",
                                    })
                                }
                                return yield* memory.executeDream(plan, `${owner}:${record.id}`, {
                                  operationID: record.id,
                                  ...(previous?.dreamClaim ? { recover: previous.dreamClaim } : {}),
                                  ...(previous?.batchClaims ? { batchClaims: previous.batchClaims } : {}),
                                  batchComplete:
                                    previous?.result?.status === "completed" || previous?.result?.status === "no_work",
                                  ...(automaticEpoch
                                    ? {
                                        automatic: {
                                          claim: automaticEpoch.claim,
                                          valid: () => isCurrent(automaticEpoch),
                                        },
                                      }
                                    : {}),
                                  batchClaimed: (leases) =>
                                    Effect.gen(function* () {
                                      batchClaims.splice(0, batchClaims.length, ...leases)
                                      yield* save({
                                        ...record,
                                        batchClaims: [...batchClaims],
                                        state: "running",
                                        ownership: "local",
                                      })
                                    }),
                                  claimed: (lease) =>
                                    Effect.gen(function* () {
                                      dreamClaim.value = lease
                                      yield* save({
                                        ...record,
                                        dreamClaim: lease,
                                        state: "running",
                                        ownership: "local",
                                      })
                                    }),
                                })
                              }
                              if (!Schema.is(MemoryLifecycleNative.Plan)(plan))
                                return yield* new Failure({
                                  code: "storage",
                                  message: "Invalid capture operation plan",
                                })
                              return yield* memory.execute(plan, `${owner}:${record.id}`, kind === "flush", {
                                recover,
                                claimed: (proof) =>
                                  Effect.gen(function* () {
                                    claims.push(proof)
                                    yield* save({
                                      ...record,
                                      claims: [...claims],
                                      state: "running",
                                      ownership: "local",
                                    })
                                  }),
                              })
                            }),
                          ),
                        ).pipe(Effect.provide(locations.get(session.location)), (effect) =>
                          guard.use(session.location, effect),
                        )
                        yield* finish(result)
                        if (kind === "capture" && result.status === "completed") {
                          const next = yield* MemoryLifecycleNative.Service.use((memory) =>
                            memory.prepareDream(sessionID, false),
                          ).pipe(
                            Effect.provide(locations.get(session.location)),
                            (effect) => guard.use(session.location, effect),
                            Effect.result,
                          )
                          if (
                            next._tag === "Success" &&
                            Schema.is(MemoryLifecycleNative.DreamPlan)(next.success) &&
                            next.success.dream.batch
                          ) {
                            if (captureToken)
                              yield* inputAdmission
                                .fence(
                                  claim,
                                  Effect.gen(function* () {
                                    const epoch = { claim, token: captureToken }
                                    if (!isCurrent(epoch) || (yield* pendingInput(claim))) return
                                    yield* admit(
                                      sessionID,
                                      { id: MemoryOperation.ID.make(`mop_${MemoryV2.hash(`dream:${record.id}`)}`) },
                                      "dream",
                                      true,
                                      next.success,
                                      epoch,
                                    )
                                  }),
                                )
                                .pipe(Effect.ignore)
                          } else if (next._tag === "Success")
                            yield* admit(
                              sessionID,
                              { id: MemoryOperation.ID.make(`mop_${MemoryV2.hash(`dream:${record.id}`)}`) },
                              "dream",
                              true,
                              next.success,
                            ).pipe(Effect.ignore)
                        }
                      }),
                    ),
                  ),
                  Effect.onExit((exit) =>
                    Exit.isSuccess(exit) || settlement.done
                      ? Effect.void
                      : finish(
                          settlement.committed
                            ? { status: "retry_required", committed: true }
                            : { status: Cause.hasInterrupts(exit.cause) ? "cancelled" : "failed" },
                        ).pipe(Effect.ignore),
                  ),
                  Effect.catchCause(() => Effect.void),
                  Effect.ensuring(
                    Effect.sync(() => {
                      active.delete(record.id)
                      if (automaticEpoch) automatic.get(automaticEpoch.claim)?.workers.delete(fiber)
                      registration.release()
                    }),
                  ),
                ),
              ),
            ),
          )
          active.set(record.id, { claim, fiber })
          if (automaticEpoch) entry(automaticEpoch.claim).workers.add(fiber)
          registration.release = yield* lifecycle
            .register(claim, fiber, Fiber.interrupt(fiber))
            .pipe(Effect.onError(() => Fiber.interrupt(fiber)))
          yield* Deferred.succeed(ready, undefined)
          return info(record)
        }),
      ),
    )
  })
  const automaticPlan = (epoch: AutomaticEpoch, boundary?: SessionCompaction.MemoryBoundary) =>
    Effect.gen(function* () {
      if (!isCurrent(epoch)) return
      const session = yield* sessions.get(epoch.claim.sessionID)
      if (!session) return
      return yield* MemoryLifecycleNative.Service.use((memory) => memory.prepareAutomatic(session.id, boundary)).pipe(
        Effect.provide(locations.get(session.location)),
        (work) => guard.use(session.location, work),
      )
    })
  const launchAutomatic = (epoch: AutomaticEpoch, plan: MemoryLegacyNative.Plan, idle?: Effect.Effect<boolean>) =>
    inputAdmission.fence(
      epoch.claim,
      Effect.gen(function* () {
        if (!isCurrent(epoch) || (yield* pendingInput(epoch.claim)) || (idle && !(yield* idle))) return
        const id = MemoryOperation.ID.make(
          `mop_${MemoryV2.hash(JSON.stringify(["automatic", plan.createdEventID, plan.revision, plan.generation, plan.sources]))}`,
        )
        yield* admit(plan.sessionID, { id }, "flush", true, plan, epoch)
      }),
    )
  const registerAutomatic = (epoch: AutomaticEpoch, work: Effect.Effect<void, unknown>) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        if (!isCurrent(epoch)) return
        const ready = Deferred.makeUnsafe<void>()
        const registration = { release: () => {} }
        const fiber = fork(
          lifecycle.owned(
            epoch.claim,
            Deferred.await(ready).pipe(
              Effect.andThen(Effect.suspend(() => (isCurrent(epoch) ? work : Effect.void))),
              Effect.interruptible,
              Effect.catchCause(() => Effect.void),
              Effect.ensuring(
                Effect.sync(() => {
                  automatic.get(epoch.claim)?.workers.delete(fiber)
                  registration.release()
                }),
              ),
            ),
          ),
        )
        entry(epoch.claim).workers.add(fiber)
        registration.release = yield* lifecycle
          .register(epoch.claim, fiber, Fiber.interrupt(fiber))
          .pipe(Effect.onError(() => Fiber.interrupt(fiber)))
        yield* Deferred.succeed(ready, undefined)
      }),
    ).pipe(Effect.catchCause(() => Effect.void))
  const armAutomaticDream = (
    epoch: AutomaticEpoch,
    gate: { settled: Effect.Effect<void>; idle: Effect.Effect<boolean> },
  ) =>
    Effect.gen(function* () {
      if (!isCurrent(epoch)) return
      const session = yield* sessions.get(epoch.claim.sessionID)
      if (!session) return
      const armed = yield* MemoryLifecycleNative.Service.use((memory) =>
        Effect.gen(function* () {
          return { memory, schedule: yield* memory.scheduleLegacyDream(session.id) }
        }),
      ).pipe(Effect.provide(locations.get(session.location)), (work) => guard.use(session.location, work))
      yield* registerAutomatic(
        epoch,
        armed.memory.owned(
          armed.schedule,
          Effect.gen(function* () {
            yield* gate.settled
            while (isCurrent(epoch)) {
              if (!(yield* gate.idle) || (yield* pendingInput(epoch.claim))) return
              const checked = yield* MemoryLifecycleNative.Service.use((memory) =>
                Effect.gen(function* () {
                  // Reload retires the old timer; a passive new Location runtime never inherits it.
                  if (memory !== armed.memory) return { current: false } as const
                  const current = yield* memory.scheduleLegacyDream(session.id)
                  if (current.generation !== armed.schedule.generation || current.revision !== armed.schedule.revision)
                    return { current: false } as const
                  const prepared = yield* memory.prepareDream(session.id, false).pipe(Effect.result)
                  if (prepared._tag !== "Success" || !Schema.is(MemoryDreamNative.Plan)(prepared.success))
                    return { current: true } as const
                  const plan = prepared.success
                  if (plan.generation !== armed.schedule.generation || plan.revision !== armed.schedule.revision)
                    return { current: false } as const
                  if (!plan.dream.files.length) return { current: true } as const
                  const receipt = yield* inputAdmission.fence(
                    epoch.claim,
                    Effect.gen(function* () {
                      if (!isCurrent(epoch) || (yield* pendingInput(epoch.claim)) || !(yield* gate.idle)) return
                      return yield* admit(
                        session.id,
                        {
                          id: MemoryOperation.ID.make(
                            `mop_${MemoryV2.hash(
                              JSON.stringify([
                                "automatic-dream",
                                plan.sessionID,
                                plan.createdEventID,
                                plan.revision,
                                plan.generation,
                                plan.dream.agent,
                                plan.dream.model,
                                plan.dream.files.map((file) => [file.path, file.signature]),
                              ]),
                            )}`,
                          ),
                        },
                        "dream",
                        true,
                        plan,
                        epoch,
                      )
                    }),
                  )
                  return { current: true, worker: receipt && active.get(receipt.id)?.fiber } as const
                }),
              ).pipe(Effect.provide(locations.get(session.location)), (work) => guard.use(session.location, work))
              if (!checked.current) return
              // The canonical worker owns its own guard; sleeping timers must leave reload available.
              if ("worker" in checked && checked.worker) yield* Fiber.join(checked.worker)
              if (!armed.schedule.interval) return
              yield* Effect.sleep(armed.schedule.interval)
            }
          }),
        ),
      )
    }).pipe(Effect.catchCause(() => Effect.void))
  const armAutomaticIdle = (
    epoch: AutomaticEpoch,
    gate: { settled: Effect.Effect<void>; idle: Effect.Effect<boolean> },
  ) =>
    Effect.gen(function* () {
      // Dream eligibility is independent of whether automatic flush is enabled or has new transcript work.
      yield* armAutomaticDream(epoch, gate)
      // Capture generation and source at the completed live activity boundary, before returning to callers.
      const prepared = yield* automaticPlan(epoch)
      if (!prepared) return
      const session = yield* sessions.get(epoch.claim.sessionID)
      if (!session) return
      yield* registerAutomatic(
        epoch,
        MemoryLifecycleNative.Service.use((memory) =>
          memory.owned(
            prepared.plan,
            Effect.gen(function* () {
              yield* gate.settled
              if (!isCurrent(epoch) || !(yield* gate.idle) || (yield* pendingInput(epoch.claim))) return
              yield* Effect.sleep(prepared.delay)
              yield* launchAutomatic(epoch, prepared.plan, gate.idle)
            }),
          ),
        ).pipe(Effect.provide(locations.get(session.location)), (work) => guard.use(session.location, work)),
      )
    }).pipe(Effect.catchCause(() => Effect.void))
  const prepareAutomaticCompaction = (epoch: AutomaticEpoch, boundary: SessionCompaction.MemoryBoundary) =>
    Effect.gen(function* () {
      if (boundary.sessionID !== epoch.claim.sessionID) return
      const prepared = yield* automaticPlan(epoch, boundary)
      if (!prepared) return
      // Capture before projection changes; provider work is owned outside the compaction callback.
      yield* registerAutomatic(epoch, launchAutomatic(epoch, prepared.plan))
    }).pipe(Effect.catchCause(() => Effect.void))
  const start = Effect.fn("SessionMemoryOperation.start")(
    function* (sessionID: SessionSchema.ID, input: MemoryOperation.Input) {
      yield* Schema.decodeUnknownEffect(MemoryOperation.Input)(input)
      return yield* admit(sessionID, input, "flush", true)
    },
    (effect, sessionID) => lifecycle.read(sessionID, effect).pipe(Effect.mapError(error)),
  )
  const dream = Effect.fn("SessionMemoryOperation.dream")(
    function* (sessionID: SessionSchema.ID, input: MemoryOperation.Input) {
      yield* Schema.decodeUnknownEffect(MemoryOperation.Input)(input)
      return yield* admit(sessionID, input, "dream", true)
    },
    (effect, sessionID) => lifecycle.read(sessionID, effect).pipe(Effect.mapError(error)),
  )
  const previewMigration = Effect.fn("SessionMemoryOperation.previewMigration")(
    function* (sessionID: SessionSchema.ID, input: MemoryOperation.MigrationQuery) {
      yield* Schema.decodeUnknownEffect(MemoryOperation.MigrationQuery)(input)
      const session = yield* sessions.get(sessionID)
      if (!session) return yield* new Failure({ code: "missing", message: "Session not found" })
      return yield* MemoryLifecycleNative.Service.use((memory) => memory.previewMigration(sessionID, input)).pipe(
        Effect.provide(locations.get(session.location)),
        (effect) => guard.use(session.location, effect),
      )
    },
    (effect, sessionID) => lifecycle.read(sessionID, effect).pipe(Effect.mapError(error)),
  )
  const migrate = Effect.fn("SessionMemoryOperation.migrate")(
    function* (sessionID: SessionSchema.ID, input: MemoryOperation.MigrationInput) {
      yield* Schema.decodeUnknownEffect(MemoryOperation.MigrationInput)(input)
      return yield* admit(sessionID, input, "migration", true)
    },
    (effect, sessionID) => lifecycle.read(sessionID, effect).pipe(Effect.mapError(error)),
  )
  const previewRecovery = Effect.fn("SessionMemoryOperation.previewRecovery")(
    function* (sessionID: SessionSchema.ID, input: MemoryOperation.RecoveryQuery) {
      yield* Schema.decodeUnknownEffect(MemoryOperation.RecoveryQuery)(input)
      const session = yield* sessions.get(sessionID)
      if (!session) return yield* new Failure({ code: "missing", message: "Session not found" })
      return yield* MemoryLifecycleNative.Service.use((memory) => memory.previewRecovery(sessionID, input)).pipe(
        Effect.provide(locations.get(session.location)),
        (work) => guard.use(session.location, work),
      )
    },
    (work, sessionID) => lifecycle.read(sessionID, work).pipe(Effect.mapError(error)),
  )
  const recover = Effect.fn("SessionMemoryOperation.recover")(
    function* (sessionID: SessionSchema.ID, input: MemoryOperation.RecoveryInput) {
      yield* Schema.decodeUnknownEffect(MemoryOperation.RecoveryInput)(input)
      return yield* admit(sessionID, input, "recovery", true)
    },
    (work, sessionID) => lifecycle.read(sessionID, work).pipe(Effect.mapError(error)),
  )
  const retry = Effect.fn("SessionMemoryOperation.retry")(
    function* (sessionID: SessionSchema.ID, input: MemoryOperation.RetryInput) {
      yield* Schema.decodeUnknownEffect(MemoryOperation.RetryInput)(input)
      const previous = yield* read(sessionID, input.retryOf)
      if (!previous) return yield* new Failure({ code: "missing", message: "Original Memory operation not found" })
      // Only the Created-bound private receipt supplies the original preview.
      // A fresh preview may represent different content after a committed action.
      if (previous.kind === "migration") {
        if (!Schema.is(MemoryLifecycleNative.MigrationPlan)(previous.plan))
          return yield* new Failure({ code: "storage", message: "Original migration receipt is invalid" })
        return yield* admit(sessionID, { ...input, preview: previous.plan.migration.preview }, previous.kind, true)
      }
      if (previous.kind === "recovery") {
        if (!Schema.is(MemoryLifecycleNative.RecoveryPlan)(previous.plan))
          return yield* new Failure({ code: "storage", message: "Original recovery receipt is invalid" })
        return yield* admit(sessionID, { ...input, preview: previous.plan.recovery.preview }, previous.kind, true)
      }
      return yield* admit(sessionID, input, previous.kind, true)
    },
    (work, sessionID) => lifecycle.read(sessionID, work).pipe(Effect.mapError(error)),
  )
  const observe = Effect.fnUntraced(function* (
    sessionID: SessionSchema.ID,
    stopped: SessionMessage.ID | undefined,
    launch: boolean,
    all: boolean,
  ) {
    if (yield* SessionExecutionPolicy.forSession(sessionID)) return []
    const session = yield* sessions.get(sessionID)
    if (!session) return []
    const checkpointed = yield* MemoryLifecycleNative.Service.use((memory) =>
      memory.checkpointLegacy(sessionID, stopped),
    ).pipe(Effect.provide(locations.get(session.location)), (effect) => guard.use(session.location, effect))
    if (checkpointed) return []
    const plan = yield* MemoryLifecycleNative.Service.use((memory) => memory.prepare(sessionID, stopped)).pipe(
      Effect.provide(locations.get(session.location)),
    )
    const sources = all ? plan.sources : plan.sources.slice(-1)
    return yield* Effect.forEach(
      sources.filter((source) => !stopped || source.assistantID === stopped),
      (source) => {
        const id = MemoryOperation.ID.make(
          `mop_${MemoryV2.hash(`${plan.createdEventID}:${source.promptID}:${source.assistantID}`)}`,
        )
        return admit(sessionID, { id }, "capture", launch && stopped === undefined, { ...plan, sources: [source] })
      },
    )
  })
  const capture = Effect.fn("SessionMemoryOperation.capture")(
    function* (sessionID: SessionSchema.ID, stopped?: SessionMessage.ID, launch = true) {
      return (yield* observe(sessionID, stopped, launch, false)).at(-1)
    },
    (effect, sessionID, _stopped, _launch) => lifecycle.read(sessionID, effect).pipe(Effect.mapError(error)),
  )
  const checkpoint = Effect.fn("SessionMemoryOperation.checkpoint")(
    function* (sessionID: SessionSchema.ID) {
      yield* observe(sessionID, undefined, false, true)
    },
    (effect, sessionID) => lifecycle.read(sessionID, effect).pipe(Effect.mapError(error)),
  )
  const cancel = Effect.fn("SessionMemoryOperation.cancel")(
    function* (sessionID: SessionSchema.ID, id: MemoryOperation.ID) {
      const record = yield* read(sessionID, id)
      if (!record) return yield* new Failure({ code: "missing", message: "Memory operation not found" })
      if (record.state === "finished") return info(record)
      const running = active.get(id)
      if (!running && !record.launch && record.state === "queued") {
        yield* lifecycle.use(
          sessionID,
          save({ ...record, state: "finished", finishedAt: Date.now(), result: { status: "cancelled" } }),
        )
        return yield* get(sessionID, id)
      }
      if (!running)
        return yield* new Failure({
          code: "busy",
          message: "Memory operation ownership is not local; no live worker was cancelled",
        })
      yield* Fiber.interrupt(running.fiber)
      const settled = yield* get(sessionID, id)
      if (settled.state !== "finished")
        return yield* new Failure({
          code: "storage",
          message: "Memory cancellation settled but its receipt could not be persisted",
        })
      return settled
    },
    (effect, sessionID) => lifecycle.read(sessionID, effect).pipe(Effect.mapError(error)),
  )
  return {
    beginAutomaticActivity,
    stopAutomatic,
    joinAutomaticStop,
    pendingInput,
    armAutomaticIdle,
    prepareAutomaticCompaction,
    retry,
    previewRecovery,
    recover,
    previewMigration,
    migrate,
    dream,
    start,
    get,
    list,
    cancel,
    capture,
    checkpoint,
  }
})
export interface Interface {
  readonly beginAutomaticActivity: (claim: SessionLifecycle.Claim) => Effect.Effect<AutomaticEpoch>
  readonly stopAutomatic: (claim: SessionLifecycle.Claim) => void
  readonly joinAutomaticStop: (claim: SessionLifecycle.Claim) => Effect.Effect<void>
  readonly pendingInput: (claim: SessionLifecycle.Claim) => Effect.Effect<boolean>
  readonly armAutomaticIdle: (
    epoch: AutomaticEpoch,
    gate: { settled: Effect.Effect<void>; idle: Effect.Effect<boolean> },
  ) => Effect.Effect<void>
  readonly prepareAutomaticCompaction: (
    epoch: AutomaticEpoch,
    boundary: SessionCompaction.MemoryBoundary,
  ) => Effect.Effect<void>

  readonly retry: (
    sessionID: SessionSchema.ID,
    input: MemoryOperation.RetryInput,
  ) => Effect.Effect<MemoryOperation.Info, Failure>
  readonly previewRecovery: (
    sessionID: SessionSchema.ID,
    input: MemoryOperation.RecoveryQuery,
  ) => Effect.Effect<MemoryOperation.RecoveryPreview, Failure>
  readonly recover: (
    sessionID: SessionSchema.ID,
    input: MemoryOperation.RecoveryInput,
  ) => Effect.Effect<MemoryOperation.Info, Failure>
  readonly previewMigration: (
    sessionID: SessionSchema.ID,
    input: MemoryOperation.MigrationQuery,
  ) => Effect.Effect<MemoryOperation.MigrationPreview, Failure>
  readonly migrate: (
    sessionID: SessionSchema.ID,
    input: MemoryOperation.MigrationInput,
  ) => Effect.Effect<MemoryOperation.Info, Failure>
  readonly dream: (
    sessionID: SessionSchema.ID,
    input: MemoryOperation.Input,
  ) => Effect.Effect<MemoryOperation.Info, Failure>
  readonly checkpoint: (sessionID: SessionSchema.ID) => Effect.Effect<void, Failure>
  readonly start: (
    sessionID: SessionSchema.ID,
    input: MemoryOperation.Input,
  ) => Effect.Effect<MemoryOperation.Info, Failure>
  readonly get: (sessionID: SessionSchema.ID, id: MemoryOperation.ID) => Effect.Effect<MemoryOperation.Info, Failure>
  readonly list: (sessionID: SessionSchema.ID) => Effect.Effect<MemoryOperation.Info[], Failure>
  readonly cancel: (sessionID: SessionSchema.ID, id: MemoryOperation.ID) => Effect.Effect<MemoryOperation.Info, Failure>
  readonly capture: (
    sessionID: SessionSchema.ID,
    stopped?: SessionMessage.ID,
    launch?: boolean,
  ) => Effect.Effect<MemoryOperation.Info | undefined, Failure>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionMemoryOperation") {}
export const layer = Layer.effect(Service, make)
export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [
    SessionInputAdmission.node,
    Database.node,
    SessionLifecycle.node,
    SessionStore.node,
    LocationServiceMap.node,
    LocationRuntimeGuard.node,
    Global.node,
  ],
})

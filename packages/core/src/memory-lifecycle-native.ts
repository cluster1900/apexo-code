export * as MemoryLifecycleNative from "./memory-lifecycle-native"

import path from "node:path"
import { realpath } from "node:fs/promises"
import { LLM, LLMClient, Message, SystemPart } from "@apexo/llm"
import { Model } from "@apexo/schema/model"
import { PermissionAuthority } from "./permission/authority"
import { MemoryDreamNative } from "./memory-dream-native"
import { MemoryLegacyNative } from "./memory-legacy-native"
import { MemoryRecovery } from "./memory-recovery"
import { MemoryBatchDream } from "./memory-batch-dream"
import { Ripgrep } from "./ripgrep"
import { SessionInputAdmission } from "./session/input-admission"
import { MemoryConsolidation } from "./memory-consolidation"
import { WorkspaceMemory } from "./workspace-memory"
import { Flock } from "./util/flock"
import { MemoryOperation } from "@apexo/schema/memory-operation"
import { Clock, Context, Effect, Layer, Schema, Stream } from "effect"
import { AgentV2 } from "./agent"
import { Config } from "./config"
import { Database } from "./database/database"
import { makeLocationNode } from "./effect/app-node"
import { llmClient } from "./effect/app-node-platform"
import { Global } from "./global"
import { Location } from "./location"
import { LocationMutation } from "./location-mutation"
import { MemoryCapture } from "./memory-capture"
import { ModelV2 } from "./model"
import { ProviderV2 } from "./provider"
import { MemoryPolicy } from "./memory-policy"
import { MemoryTranscriptNative } from "./memory-transcript-native"
import { MemoryV2 } from "./memory-v2"
import { PermissionV2 } from "./permission"
import { SessionExecutionPolicy } from "./session/execution-policy"
import { SessionGoal } from "./session/goal"
import { SessionGoalUsage } from "./session/goal-usage"
import { SessionIncarnation } from "./session/incarnation"
import { SessionLifecycle } from "./session/lifecycle"
import { SessionManagedChild } from "./session/managed-child"
import { SessionMemoryModeNative } from "./session/memory-mode-native"
import { SessionMessage } from "./session/message"
import { SessionRunnerModel } from "./session/runner/model"
import { SessionSchema } from "./session/schema"
import { SessionStore } from "./session/store"

export const Failure = SessionMemoryModeNative.Failure
export type Failure = SessionMemoryModeNative.Failure
export const Plan = Schema.Struct({
  sessionID: SessionSchema.ID,
  createdEventID: Schema.String,
  revision: Schema.String,
  generation: Schema.String,
  backend: Schema.Literal("v2"),
  sources: Schema.Array(MemoryTranscriptNative.Source),
})
export type Plan = typeof Plan.Type
export const DreamPlan = Schema.Struct({
  ...Plan.fields,
  dream: Schema.Struct({
    manual: Schema.Boolean,
    agent: Schema.String,
    model: Model.Ref,
    authority: Schema.Array(PermissionAuthority.Snapshot),
    shadow: Schema.Boolean,
    batch: Schema.optionalKey(MemoryBatchDream.Policy),
  }),
})
export type DreamPlan = typeof DreamPlan.Type
export const MigrationPlan = Schema.Struct({
  ...Plan.fields,
  backend: Schema.Literals(["legacy", "v2"]),
  migration: Schema.Struct({
    preview: MemoryOperation.MigrationPreview,
    agent: Schema.String,
    authority: Schema.Array(PermissionAuthority.Snapshot),
  }),
})
export type MigrationPlan = typeof MigrationPlan.Type
export const RecoveryPlan = Schema.Struct({
  ...Plan.fields,
  recovery: Schema.Struct({
    id: MemoryOperation.ID,
    preview: MemoryOperation.RecoveryPreview,
    agent: Schema.String,
    authority: Schema.Array(PermissionAuthority.Snapshot),
  }),
})
export type RecoveryPlan = typeof RecoveryPlan.Type
const failure = (error: unknown) =>
  error instanceof Failure
    ? error
    : error instanceof MemoryRecovery.Failure
      ? new Failure({
          code: error.code === "forbidden" ? "forbidden" : error.code === "storage" ? "storage" : "changed",
          message: error.message,
        })
      : error instanceof SessionLifecycle.Closed
        ? new Failure({ code: "missing", message: "Session no longer exists" })
        : new Failure({ code: "storage", message: "Memory lifecycle storage is unavailable" })
const make = Effect.gen(function* () {
  const admission = yield* SessionInputAdmission.Service
  const ripgrep = yield* Ripgrep.Service
  const legacy = yield* MemoryLegacyNative.Service
  const legacyDream = yield* MemoryDreamNative.Service
  const config = yield* Config.Service
  const global = yield* Global.Service
  const location = yield* Location.Service
  const database = yield* Database.Service
  const sessions = yield* SessionStore.Service
  const lifecycle = yield* SessionLifecycle.Service
  const managed = yield* SessionManagedChild.Service
  const goals = yield* SessionGoal.Service
  const mode = yield* SessionMemoryModeNative.Service
  const permission = yield* PermissionV2.Service
  const mutation = yield* LocationMutation.Service
  const models = yield* SessionRunnerModel.Service
  const agents = yield* AgentV2.Service
  const llm = yield* LLMClient.Service
  const documents = (yield* config.entries()).filter((entry) => entry.type === "document")
  const settings: SessionMemoryModeNative.Settings = {
    memory: documents.reduce((value, entry) => ({ ...value, ...entry.info.memory }), {}),
    memory_v2: documents.reduce((value, entry) => ({ ...value, ...entry.info.memory_v2 }), {}),
  }
  const placement = Effect.fn("MemoryLifecycleNative.placement")(function* (id: SessionSchema.ID) {
    const session = yield* sessions.get(id)
    if (
      !session ||
      session.location.directory !== location.directory ||
      session.location.workspaceID !== location.workspaceID
    )
      return yield* new Failure({ code: "missing", message: "Session not found in this Location" })
    if (
      (yield* SessionExecutionPolicy.forSession(id)) ||
      (yield* SessionGoalUsage.Current) ||
      (yield* managed.managed(id)) ||
      (yield* goals.get(id))?.status === "active"
    )
      return yield* new Failure({
        code: "unsupported",
        message: "Auxiliary Memory work is unavailable to headless inputs, managed children and active Goal attempts",
      })
    return session
  })
  const enabled = Effect.fn("MemoryLifecycleNative.enabled")(function* (id: SessionSchema.ID) {
    yield* placement(id)
    const snapshot = yield* mode.get(id, settings)
    if (!snapshot.info.enabled)
      return yield* new Failure({ code: "disabled", message: "Memory is disabled for this Session" })
    if (snapshot.backend !== "v2")
      return yield* new Failure({ code: "unsupported", message: "Native legacy Memory flush is not available yet" })
    const policy = yield* MemoryPolicy.backend(database.db, id, { ...settings, profile: true })
    if (!policy.capture) return yield* new Failure({ code: "disabled", message: "Memory capture is disabled" })
    return { ...snapshot, expose: policy.expose }
  })
  const access = Effect.fn("MemoryLifecycleNative.access")(function* (id: SessionSchema.ID, agent?: string) {
    const selected = yield* agents.select(agent === undefined ? undefined : AgentV2.ID.make(agent))
    const inspect = yield* permission.inspect(id, selected.id)
    const input = { home: global.home, directory: location.directory, projectID: location.project.id }
    const alias = MemoryV2.directory(input)
    const target = yield* mutation.resolve({ path: alias, kind: "directory" })
    if (target.externalDirectory && inspect("external_directory", [target.externalDirectory.resource]) !== "allow")
      return yield* new Failure({ code: "forbidden", message: "Memory scope access is not allowed" })
    const permitted = (relative: string, action: "read" | "edit") =>
      [alias, target.canonical].every((root) => {
        const file = path.join(root, relative)
        const local = path.relative(location.directory, file)
        return inspect(action, [file, local.startsWith("..") || path.isAbsolute(local) ? file : local]) === "allow"
      })
    if (
      !["memory_state.sqlite", "memory_state.sqlite-wal", "memory_state.sqlite-shm", "MEMORY.md"].every(
        (file) => permitted(file, "read") && permitted(file, "edit"),
      )
    )
      return yield* new Failure({ code: "forbidden", message: "Memory storage read/write is not allowed" })
    return { input, permitted }
  })
  const prepare = Effect.fn("MemoryLifecycleNative.prepare")(
    function* (id: SessionSchema.ID, stopped?: SessionMessage.ID) {
      const snapshot = yield* enabled(id)
      const session = yield* placement(id)
      const created = yield* SessionIncarnation.created(database.db, id)
      if (!created) return yield* new Failure({ code: "changed", message: "Session creation proof is unavailable" })
      const turns = MemoryTranscriptNative.turns(yield* sessions.context(id), stopped)
      const sources = yield* Effect.forEach(turns, (turn) =>
        Effect.gen(function* () {
          const authority = yield* permission.capture(id, AgentV2.ID.make(turn.agent))
          return MemoryTranscriptNative.Source.make({
            version: 2,
            sessionID: id,
            createdEventID: created,
            authority,
            ...turn,
          })
        }),
      )
      const scope = yield* access(id, sources.at(-1)?.agent ?? session.agent)
      const store = yield* MemoryCapture.make(scope.input, {
        recover: false,
        compactIndex: settings.memory_v2?.compact_index_enabled,
      })
      return Plan.make({
        sessionID: id,
        createdEventID: created,
        revision: snapshot.revision,
        generation: yield* store.revision,
        backend: "v2",
        sources,
      })
    },
    Effect.scoped,
    Effect.mapError(failure),
  )
  const dreamPolicy = Effect.fn("MemoryLifecycleNative.dreamPolicy")(function* (id: SessionSchema.ID, manual: boolean) {
    yield* placement(id)
    const snapshot = yield* mode.get(id, settings)
    if (!snapshot.info.enabled) return yield* new Failure({ code: "disabled", message: "Memory is disabled" })
    if (snapshot.backend !== "v2")
      return yield* new Failure({ code: "unsupported", message: "Native legacy Dream is not available yet" })
    const policy = yield* MemoryPolicy.backend(database.db, id, { ...settings, profile: true })
    if (
      !["active", "shadow"].includes(policy.rollout) ||
      (manual
        ? settings.memory_v2?.manual_dream_enabled === false
        : settings.memory_v2?.automatic_dream_enabled === false || settings.memory?.dream?.enabled === false)
    )
      return yield* new Failure({ code: "disabled", message: "Memory Dream is disabled by current policy" })
    return { ...snapshot, shadow: policy.rollout === "shadow" }
  })
  const prepareDream = Effect.fn("MemoryLifecycleNative.prepareDream")(
    function* (id: SessionSchema.ID, manual: boolean) {
      const snapshot = yield* dreamPolicy(id, manual)
      const session = yield* placement(id)
      const createdEventID = yield* SessionIncarnation.created(database.db, id)
      if (!createdEventID)
        return yield* new Failure({ code: "changed", message: "Session creation proof is unavailable" })
      const agent = yield* agents.select(session.agent)
      const requested = settings.memory_v2?.dream_model?.trim()
      const parts = requested?.split("/")
      if (parts && (parts.length > 2 || parts.some((part) => !part)))
        return yield* new Failure({ code: "invalid", message: "Invalid Dream model selection" })
      const fallback = yield* models.resolve({ ...session, agent: agent.id })
      const base = session.model ?? {
        providerID: ProviderV2.ID.make(fallback.provider),
        id: ModelV2.ID.make(fallback.id),
      }
      const model = yield* models.resolve({
        ...session,
        agent: agent.id,
        model: parts
          ? {
              providerID: parts.length === 2 ? ProviderV2.ID.make(parts[0]!) : base.providerID,
              id: ModelV2.ID.make(parts.at(-1)!),
            }
          : base,
      })
      const scope = yield* access(id, agent.id)
      const store = yield* MemoryCapture.make(scope.input, {
        recover: false,
        compactIndex: settings.memory_v2?.compact_index_enabled,
      })
      if (
        !manual &&
        !(yield* store.dreamEligibility(yield* Clock.currentTimeMillis, snapshot.shadow, scope.permitted)).ready
      )
        return yield* new Failure({ code: "disabled", message: "Automatic Dream is not eligible" })
      return DreamPlan.make({
        sessionID: id,
        createdEventID,
        revision: snapshot.revision,
        generation: yield* store.revision,
        backend: "v2",
        sources: [],
        dream: {
          manual,
          agent: agent.id,
          shadow: snapshot.shadow,
          model: { providerID: ProviderV2.ID.make(model.provider), id: ModelV2.ID.make(model.id) },
          authority: yield* permission.capture(id, agent.id),
          ...(!snapshot.shadow && settings.memory_v2?.batch_dream_enabled
            ? {
                batch: {
                  maxRunSecs: settings.memory_v2.batch_dream_max_run_secs ?? 1800,
                  maxCalls: settings.memory_v2.batch_dream_max_calls_per_batch ?? 6,
                  maxNoteBytes: settings.memory_v2.batch_dream_max_batch_note_bytes ?? 98304,
                },
              }
            : {}),
        },
      })
    },
    Effect.scoped,
    Effect.mapError(failure),
  )
  const executeBatchDream = Effect.fn("MemoryLifecycleNative.executeBatchDream")(
    function* (
      plan: DreamPlan,
      owner: string,
      ownership: {
        operationID: MemoryOperation.ID
        batchComplete?: boolean
        batchClaims?: readonly MemoryConsolidation.Lease[]
        batchClaimed?: (leases: readonly MemoryConsolidation.Lease[]) => Effect.Effect<void, unknown>
        automatic?: { claim: SessionLifecycle.Claim; valid: () => boolean }
      },
    ) {
      const policy = plan.dream.batch
      if (!policy || !ownership.batchClaimed)
        return yield* new Failure({ code: "invalid", message: "Batch owner is unavailable" })
      const session = yield* placement(plan.sessionID)
      const scope = yield* access(plan.sessionID, plan.dream.agent)
      yield* Flock.effect(`native-memory-dream:${MemoryV2.directory(scope.input)}`, {
        dir: path.join(global.state, "memory-operation-locks"),
        timeoutMs: 300000,
        deadOwnerOnly: true,
        reclaimDeadOwner: true,
      })
      const store = yield* MemoryCapture.make(scope.input, {
        recover: false,
        compactIndex: settings.memory_v2?.compact_index_enabled,
      })
      const claims = [...(ownership.batchClaims ?? [])]
      const progress = {
        processed: 0,
        topics: new Set<string>(),
        deferred: 0,
        unplaceable: 0,
        generation: plan.generation,
      }
      const attempted = new Set<string>()
      const validate = (revision = store.revision) =>
        Effect.gen(function* () {
          if (ownership.automatic && !ownership.automatic.valid()) return yield* Effect.interrupt
          const current = yield* dreamPolicy(plan.sessionID, plan.dream.manual)
          const selected = yield* placement(plan.sessionID)
          const agent = yield* agents.select(selected.agent)
          if (
            current.revision !== plan.revision ||
            current.shadow ||
            agent.id !== plan.dream.agent ||
            !settings.memory_v2?.batch_dream_enabled ||
            (yield* SessionIncarnation.created(database.db, plan.sessionID)) !== plan.createdEventID
          )
            return yield* new Failure({ code: "changed", message: "Batch Dream authority changed" })
          if ((yield* revision) !== progress.generation)
            return yield* new Failure({ code: "changed", message: "Batch Dream scope changed" })
          return yield* access(plan.sessionID, plan.dream.agent)
        })
      const record = (result: MemoryConsolidation.Result) => {
        progress.processed += result.observations
        progress.deferred += (result.deferred ?? 0) - (result.unplaceable ?? 0)
        progress.unplaceable += result.unplaceable ?? 0
        result.topics.forEach((path) => progress.topics.add(path))
        result.attempted?.forEach((path) => attempted.add(path))
        if (result.generation) progress.generation = result.generation
      }
      const pending: MemoryConsolidation.Lease[] = []
      for (const lease of claims) {
        const completed = yield* store.dreamCompleted(lease)
        if (completed) record(completed)
        else pending.push(lease)
      }
      if (pending.length > 1)
        return yield* new Failure({ code: "invalid", message: "Batch receipt has multiple unfinished claims" })
      yield* validate()
      const model = yield* models.resolve({
        ...session,
        agent: AgentV2.ID.make(plan.dream.agent),
        model: plan.dream.model,
      })
      const deadline = (yield* Clock.currentTimeMillis) + policy.maxRunSecs * 1000
      const summary = (status: MemoryOperation.Result["status"]): MemoryOperation.Result => ({
        status,
        processed: progress.processed,
        topics: progress.topics.size,
        deferred: progress.deferred,
        unplaceable: progress.unplaceable,
        shadow: false,
      })
      if (ownership.batchComplete)
        return summary(
          progress.deferred ? "retry_required" : progress.processed || progress.unplaceable ? "completed" : "no_work",
        )
      while ((yield* Clock.currentTimeMillis) < deadline && attempted.size < 4096) {
        const current = yield* validate()
        const previous = pending.shift()
        const lease = yield* store.dreamClaim(
          {
            owner,
            now: yield* Clock.currentTimeMillis,
            duration: Math.min(86400_000, Math.max(1000, deadline - (yield* Clock.currentTimeMillis) + 120000)),
            shadow: false,
            ownership: "explicit",
            provenance: MemoryConsolidation.provenance({
              sessionID: plan.sessionID,
              createdEventID: plan.createdEventID,
              operationID: ownership.operationID,
              scope: store.root.path,
            }),
            ...(previous ? { recover: previous } : {}),
            batch: { maxBytes: policy.maxNoteBytes, excluded: [...attempted] },
          },
          (file, action) => scope.permitted(file, action) && current.permitted(file, action),
        )
        if (!lease)
          return summary(
            progress.deferred ? "retry_required" : progress.processed || progress.unplaceable ? "completed" : "no_work",
          )
        if (previous)
          claims.splice(
            claims.findIndex((item) => item.id === previous.id),
            1,
            lease,
          )
        else claims.push(lease)
        yield* ownership.batchClaimed([...claims])
        const result = yield* Effect.gen(function* () {
          yield* Effect.addFinalizer(() => store.dreamRelease(lease, Date.now()).pipe(Effect.ignore))
          const commit = (compiled?: ReturnType<ReturnType<typeof MemoryBatchDream.make>["compile"]>) =>
            store.dreamBatchPublish((owned) => {
              const action = mode.commit(
                plan.sessionID,
                settings,
                plan.revision,
                Effect.gen(function* () {
                  const current = yield* validate(owned.revision)
                  const permitted = (file: string, action: "read" | "edit") =>
                    scope.permitted(file, action) && current.permitted(file, action)
                  return yield* owned.commit(lease, yield* Clock.currentTimeMillis, permitted, compiled)
                }),
              )
              return ownership.automatic ? admission.fence(ownership.automatic.claim, action) : action
            })
          if (lease.planned) return yield* commit()
          const current = yield* validate()
          const input = yield* store.dreamInput(
            lease,
            yield* Clock.currentTimeMillis,
            (file, action) => scope.permitted(file, action) && current.permitted(file, action),
          )
          input.observations.forEach((note) => attempted.add(note.path))
          const protocol = MemoryBatchDream.make(input)
          const messages: Message[] = [
            Message.user(
              JSON.stringify({ catalog: protocol.catalog, notes: protocol.notes, max_replies: policy.maxCalls }),
            ),
          ]
          const counters = { repairs: 0, truncations: 0 }
          const candidate: { value?: ReturnType<typeof protocol.compile> } = {}
          for (let calls = 0; calls < policy.maxCalls; calls++) {
            const current = yield* validate()
            yield* store.dreamInput(
              lease,
              yield* Clock.currentTimeMillis,
              (file, action) => scope.permitted(file, action) && current.permitted(file, action),
            )
            if (Buffer.byteLength(JSON.stringify(messages)) > 480 * 1024) break
            const remaining = deadline - (yield* Clock.currentTimeMillis)
            if (remaining <= 0) break
            const output = { text: "", stop: "" }
            yield* llm
              .stream(
                LLM.request({
                  model,
                  system: [SystemPart.make(MemoryBatchDream.prompt)],
                  messages,
                  tools: [],
                  toolChoice: "none",
                }),
              )
              .pipe(
                Stream.runForEach((event) =>
                  Effect.gen(function* () {
                    if (event.type === "provider-error")
                      return yield* new Failure({ code: "storage", message: "Batch Dream provider failed" })
                    if (event.type === "text-delta") {
                      output.text += event.text
                      if (Buffer.byteLength(output.text) > 256 * 1024)
                        return yield* new Failure({ code: "invalid", message: "Batch response exceeds its bound" })
                    }
                    if (event.type === "finish") output.stop = event.reason
                  }),
                ),
                Effect.timeout(Math.min(300000, remaining)),
              )
            if (output.stop !== "stop") {
              if (output.stop !== "length" || counters.truncations++ >= 2) break
              messages.push(
                Message.assistant(output.text.slice(0, 2048) + " [cut off]"),
                Message.user(
                  'The response was truncated and discarded. Use smaller patches; defer overflow notes with reason "batch too large".',
                ),
              )
              continue
            }
            messages.push(Message.assistant(output.text))
            const response = yield* Effect.try({ try: () => MemoryBatchDream.parse(output.text), catch: failure }).pipe(
              Effect.result,
            )
            if (response._tag === "Failure") {
              messages.push(
                Message.user("Invalid response shape. Supply exactly actions or plan with all required fields."),
              )
              continue
            }
            if (response.success.plan) {
              const checked = protocol.check(response.success.plan, counters.truncations > 0)
              candidate.value = checked.compiled
              if (!checked.error) return yield* commit(checked.compiled)
              if (counters.repairs++ >= 2) break
              messages.push(
                Message.user(`Plan rejected: ${checked.error}. Supply a corrected complete plan or read actions.`),
              )
              continue
            }
            const results: unknown[] = []
            for (const action of response.success.actions ?? []) {
              const current = yield* validate()
              yield* store.dreamInput(
                lease,
                yield* Clock.currentTimeMillis,
                (file, action) => scope.permitted(file, action) && current.permitted(file, action),
              )
              const allowed = (file: string) => scope.permitted(file, "read") && current.permitted(file, "read")
              const value = yield* Effect.gen(function* () {
                if (action.action !== "search") {
                  if (action.action !== "list" && !allowed(action.path))
                    return yield* new Failure({ code: "forbidden", message: "Batch topic read denied" })
                  return yield* Effect.try({ try: () => protocol.action(action), catch: failure })
                }
                if (
                  !action.patterns.length ||
                  action.patterns.length > 8 ||
                  action.patterns.some((pattern) => Buffer.byteLength(pattern) > 256) ||
                  action.paths.length > 64
                )
                  return yield* new Failure({ code: "invalid", message: "Invalid bounded search" })
                if (action.after && (!Number.isSafeInteger(action.after.offset) || action.after.offset < 0))
                  return yield* new Failure({ code: "invalid", message: "Invalid search cursor" })
                yield* store.dreamInput(
                  lease,
                  yield* Clock.currentTimeMillis,
                  (file, action) => scope.permitted(file, action) && current.permitted(file, action),
                )
                const paths = action.paths.length ? action.paths : [...protocol.topics.keys()]
                if (paths.some((file) => !protocol.topics.has(file) || !allowed(file)))
                  return yield* new Failure({ code: "forbidden", message: "Search path is unavailable" })
                const hits: { path: string; line: number; offset: number; text: string }[] = []
                for (const file of [...paths].sort()) {
                  if (action.after && file < action.after.path) continue
                  const matches = yield* ripgrep.grep({
                    cwd: location.directory,
                    file,
                    content: protocol.topics.get(file)!.content,
                    pattern: action.patterns.map((pattern) => `(?:${pattern})`).join("|"),
                    limit: 60 - hits.length,
                    ...(action.after && file === action.after.path ? { afterOffset: action.after.offset } : {}),
                  })
                  for (const hit of matches) {
                    hits.push({ path: file, line: hit.line, offset: hit.offset, text: hit.text.slice(0, 300) })
                    if (hits.length >= 60) break
                  }
                  if (hits.length >= 60) break
                }
                const bytes = Buffer.byteLength(JSON.stringify(hits))
                if (protocol.budget.read + bytes > 128 * 1024)
                  return yield* new Failure({ code: "invalid", message: "Batch read budget exhausted" })
                protocol.budget.read += bytes
                return {
                  action: "search",
                  hits,
                  next: hits.length >= 60 ? { path: hits.at(-1)!.path, offset: hits.at(-1)!.offset } : null,
                }
              }).pipe(Effect.result)
              results.push(value._tag === "Success" ? value.success : { error: String(value.failure) })
            }
            messages.push(Message.user(JSON.stringify(results)))
          }
          if (candidate.value) return yield* commit(candidate.value)
          return yield* commit({
            operations: [],
            outcomes: input.observations.map((note) => ({
              path: note.path,
              outcome: "deferred" as const,
              reason: "batch limit reached",
              uncounted: false,
            })),
          })
        }).pipe(Effect.scoped, Effect.result)
        if (result._tag === "Failure") return summary("retry_required")
        record(result.success)
      }
      return summary("retry_required")
    },
    Effect.scoped,
    Effect.mapError(failure),
  )
  const executeDream = Effect.fn("MemoryLifecycleNative.executeDream")(
    function* (
      plan: DreamPlan,
      owner: string,
      ownership: {
        operationID: MemoryOperation.ID
        recover?: MemoryConsolidation.Lease
        batchComplete?: boolean
        batchClaims?: readonly MemoryConsolidation.Lease[]
        batchClaimed?: (leases: readonly MemoryConsolidation.Lease[]) => Effect.Effect<void, unknown>
        automatic?: { claim: SessionLifecycle.Claim; valid: () => boolean }
        claimed: (lease: MemoryConsolidation.Lease) => Effect.Effect<void, unknown>
      },
    ) {
      const inherited = yield* PermissionV2.Inherited
      if (plan.dream.batch)
        return yield* executeBatchDream(plan, owner, ownership).pipe(
          Effect.provideService(
            PermissionV2.Inherited,
            new Map(inherited).set(plan.sessionID, [...(inherited.get(plan.sessionID) ?? []), ...plan.dream.authority]),
          ),
        )
      return yield* Effect.gen(function* () {
        const session = yield* placement(plan.sessionID)
        const scope = yield* access(plan.sessionID, plan.dream.agent)
        // This scope lock protects different Sessions sharing one memory store.
        yield* Flock.effect(`native-memory-dream:${MemoryV2.directory(scope.input)}`, {
          dir: path.join(global.state, "memory-operation-locks"),
          timeoutMs: 300000,
          deadOwnerOnly: true,
          reclaimDeadOwner: true,
        })
        const store = yield* MemoryCapture.make(scope.input, {
          recover: false,
          compactIndex: settings.memory_v2?.compact_index_enabled,
        })
        const validate = Effect.gen(function* () {
          const current = yield* dreamPolicy(plan.sessionID, plan.dream.manual)
          if (
            current.revision !== plan.revision ||
            current.shadow !== plan.dream.shadow ||
            (yield* SessionIncarnation.created(database.db, plan.sessionID)) !== plan.createdEventID
          )
            return yield* new Failure({ code: "changed", message: "Dream Session authority changed" })
        })
        yield* validate
        // A completed receipt proves this exact operation already published its own
        // generation change. It is not permission to perform new publication.
        const completed = ownership.recover ? yield* store.dreamCompleted(ownership.recover) : undefined
        if (completed)
          return {
            status: "completed",
            processed: completed.observations,
            topics: completed.topics.length,
            shadow: completed.status === "shadow",
          } satisfies MemoryOperation.Result
        if ((yield* store.revision) !== plan.generation)
          return { status: "conflict", reason: "scope_changed" } satisfies MemoryOperation.Result
        if (
          !plan.dream.manual &&
          !(yield* store.dreamEligibility(yield* Clock.currentTimeMillis, plan.dream.shadow, scope.permitted)).ready
        )
          return { status: "no_work", processed: 0 } satisfies MemoryOperation.Result
        const lease = yield* store.dreamClaim(
          {
            owner,
            now: yield* Clock.currentTimeMillis,
            duration: 300000,
            shadow: plan.dream.shadow,
            ownership: "explicit",
            provenance: MemoryConsolidation.provenance({
              sessionID: plan.sessionID,
              createdEventID: plan.createdEventID,
              operationID: ownership.operationID,
              scope: store.root.path,
            }),
            ...(ownership.recover ? { recover: ownership.recover } : {}),
          },
          scope.permitted,
        )
        if (!lease) return { status: "no_work", processed: 0 } satisfies MemoryOperation.Result
        yield* Effect.addFinalizer(() => store.dreamRelease(lease, Date.now()).pipe(Effect.ignore))
        yield* ownership.claimed(lease)
        const commit = (operations?: ReadonlyArray<MemoryConsolidation.Operation>) =>
          mode.commit(
            plan.sessionID,
            settings,
            plan.revision,
            Effect.gen(function* () {
              yield* validate
              if ((yield* store.revision) !== plan.generation)
                return yield* new Failure({ code: "changed", message: "Memory scope changed during Dream" })
              const current = yield* access(plan.sessionID, plan.dream.agent)
              const permitted = (file: string, action: "read" | "edit") =>
                scope.permitted(file, action) && current.permitted(file, action)
              const result = operations
                ? yield* store.dreamCommit(lease, operations, yield* Clock.currentTimeMillis, permitted)
                : yield* store.dreamResume(lease, yield* Clock.currentTimeMillis, permitted)
              return {
                status: "completed",
                processed: result.observations,
                topics: result.topics.length,
                shadow: result.status === "shadow",
              } satisfies MemoryOperation.Result
            }),
          )
        if (lease.planned) return yield* commit()
        const input = yield* store.dreamInput(lease, yield* Clock.currentTimeMillis, scope.permitted)
        const model = yield* models.resolve({
          ...session,
          agent: AgentV2.ID.make(plan.dream.agent),
          model: plan.dream.model,
        })
        const output = { text: "", finished: false }
        yield* llm
          .stream(
            LLM.request({
              model,
              system: [SystemPart.make(MemoryConsolidation.prompt)],
              messages: [Message.user(JSON.stringify(input))],
              tools: [],
              toolChoice: "none",
            }),
          )
          .pipe(
            Stream.runForEach((event) =>
              Effect.gen(function* () {
                if (event.type === "provider-error")
                  return yield* new Failure({ code: "storage", message: "Memory Dream provider failed" })
                if (event.type === "text-delta") {
                  output.text += event.text
                  if (Buffer.byteLength(output.text) > 3 * 1024 * 1024)
                    return yield* new Failure({ code: "invalid", message: "Memory Dream output exceeds its bound" })
                }
                if (event.type === "finish") output.finished = event.reason === "stop"
              }),
            ),
            Effect.timeout("120 seconds"),
          )
        if (!output.finished) return yield* new Failure({ code: "invalid", message: "Memory Dream did not finish" })
        const operations = yield* Effect.try({ try: () => MemoryConsolidation.parse(output.text), catch: failure })
        return yield* commit(operations)
      }).pipe(
        Effect.provideService(
          PermissionV2.Inherited,
          new Map(inherited).set(plan.sessionID, [...(inherited.get(plan.sessionID) ?? []), ...plan.dream.authority]),
        ),
      )
    },
    Effect.scoped,
    Effect.mapError(failure),
  )
  const recoveryAccess = Effect.fn("MemoryLifecycleNative.recoveryAccess")(function* (
    id: SessionSchema.ID,
    agent: string,
    query: MemoryOperation.RecoveryQuery,
  ) {
    const inspect = yield* permission.inspect(id, AgentV2.ID.make(agent))
    const input = {
      home: global.home,
      directory: location.directory,
      projectID: location.project.id,
      scope: query.scope,
    }
    const alias = MemoryV2.directory(input)
    const target = yield* mutation.resolve({ path: alias, kind: "directory" })
    if (target.externalDirectory && inspect("external_directory", [target.externalDirectory.resource]) !== "allow")
      return yield* new Failure({ code: "forbidden", message: "Memory recovery scope is not permitted" })
    if (inspect(query.action === "clear" ? "memory_clear" : "memory_discard", [alias, target.canonical]) !== "allow")
      return yield* new Failure({
        code: "forbidden",
        message: "Explicit Memory recovery is not allowed by current permissions",
      })
    const permitted = (file: string, action: "read" | "edit") =>
      [alias, target.canonical].every((root) => {
        const name = path.join(root, file)
        const relative = path.relative(location.directory, name)
        return (
          inspect(action, [name, relative.startsWith("..") || path.isAbsolute(relative) ? name : relative]) === "allow"
        )
      })
    if (
      !["memory_state.sqlite", "memory_state.sqlite-wal", "memory_state.sqlite-shm", "MEMORY.md"].every(
        (name) => permitted(name, "read") && permitted(name, "edit"),
      )
    )
      return yield* new Failure({ code: "forbidden", message: "Memory recovery storage is not permitted" })
    return { input, permitted }
  })
  const previewRecovery = Effect.fn("MemoryLifecycleNative.previewRecovery")(
    function* (id: SessionSchema.ID, query: MemoryOperation.RecoveryQuery) {
      const session = yield* placement(id)
      const snapshot = yield* mode.get(id, settings)
      if (snapshot.backend !== "v2")
        return yield* new Failure({ code: "unsupported", message: "Native recovery requires the V2 Memory backend" })
      const agent = yield* agents.select(session.agent)
      const scope = yield* recoveryAccess(id, agent.id, query)
      return yield* MemoryCapture.inspectRecovery(scope.input, query, scope.permitted)
    },
    Effect.scoped,
    Effect.mapError(failure),
  )
  const prepareRecovery = Effect.fn("MemoryLifecycleNative.prepareRecovery")(
    function* (id: SessionSchema.ID, input: MemoryOperation.RecoveryInput) {
      const actual = yield* previewRecovery(id, input.preview)
      if (!Schema.toEquivalence(MemoryOperation.RecoveryPreview)(actual, input.preview))
        return yield* new Failure({ code: "changed", message: "Memory recovery preview changed" })
      if (!actual.available)
        return yield* new Failure({ code: "changed", message: `Memory recovery is unavailable: ${actual.reason}` })
      const session = yield* placement(id)
      const snapshot = yield* mode.get(id, settings)
      if (!snapshot.info.enabled)
        return yield* new Failure({ code: "disabled", message: "Enable Memory for this management operation" })
      const createdEventID = yield* SessionIncarnation.created(database.db, id)
      if (!createdEventID)
        return yield* new Failure({ code: "changed", message: "Session creation proof is unavailable" })
      const agent = yield* agents.select(session.agent)
      return RecoveryPlan.make({
        sessionID: id,
        createdEventID,
        revision: snapshot.revision,
        generation: actual.generation,
        backend: "v2",
        sources: [],
        recovery: {
          id: input.id,
          preview: actual,
          agent: agent.id,
          authority: yield* permission.capture(id, agent.id),
        },
      })
    },
    Effect.scoped,
    Effect.mapError(failure),
  )
  const executeRecovery = Effect.fn("MemoryLifecycleNative.executeRecovery")(
    function* (plan: RecoveryPlan, committed: Effect.Effect<void>) {
      const inherited = yield* PermissionV2.Inherited
      return yield* Effect.gen(function* () {
        yield* placement(plan.sessionID)
        const scope = yield* recoveryAccess(plan.sessionID, plan.recovery.agent, plan.recovery.preview)
        yield* Flock.effect(`native-memory-dream:${MemoryV2.directory(scope.input)}`, {
          dir: path.join(global.state, "memory-operation-locks"),
          timeoutMs: 300000,
          deadOwnerOnly: true,
          reclaimDeadOwner: true,
        })
        const store = yield* MemoryCapture.make(scope.input, {
          recover: false,
          strictOwner: true,
          compactIndex: settings.memory_v2?.compact_index_enabled,
        })
        const publication = { permitted: scope.permitted }
        const validate = Effect.gen(function* () {
          yield* placement(plan.sessionID)
          if ((yield* SessionIncarnation.created(database.db, plan.sessionID)) !== plan.createdEventID)
            return yield* new Failure({ code: "changed", message: "Recovery operator Session was replaced" })
          publication.permitted = (yield* recoveryAccess(
            plan.sessionID,
            plan.recovery.agent,
            plan.recovery.preview,
          )).permitted
        })
        yield* validate
        return yield* store.recoverExplicit(
          { id: plan.recovery.id, sessionID: plan.sessionID, createdEventID: plan.createdEventID },
          plan.recovery.preview,
          (file, action) => scope.permitted(file, action) && publication.permitted(file, action),
          (work) => mode.commit(plan.sessionID, settings, plan.revision, validate.pipe(Effect.andThen(work))),
          committed,
        )
      }).pipe(
        Effect.provideService(
          PermissionV2.Inherited,
          new Map(inherited).set(plan.sessionID, [
            ...(inherited.get(plan.sessionID) ?? []),
            ...plan.recovery.authority,
          ]),
        ),
      )
    },
    Effect.scoped,
    Effect.mapError(failure),
  )
  const migrationAccess = Effect.fn("MemoryLifecycleNative.migrationAccess")(function* (
    id: SessionSchema.ID,
    agent: string,
    input: MemoryOperation.MigrationQuery,
  ) {
    const inspect = yield* permission.inspect(id, AgentV2.ID.make(agent))
    const selected = {
      home: global.home,
      directory: location.directory,
      projectID: location.project.id,
      scope: input.scope,
    }
    const source = WorkspaceMemory.file(location.directory, global.home, input.kind === "relocation" ? {} : selected)
    const target =
      input.kind === "relocation"
        ? WorkspaceMemory.file(location.directory, global.home, selected)
        : MemoryV2.directory(selected)
    for (const file of [source, target]) {
      const resolved = yield* mutation.resolve({
        path: file,
        kind: input.kind === "carryover" && file === target ? "directory" : "file",
      })
      if (
        resolved.externalDirectory &&
        inspect("external_directory", [resolved.externalDirectory.resource]) !== "allow"
      )
        return yield* new Failure({ code: "forbidden", message: "Memory migration scope is not permitted" })
    }
    const canonicalHome = yield* Effect.tryPromise({ try: () => realpath(global.home), catch: failure })
    const permitted = (files: readonly string[], action: "read" | "edit") =>
      files.every((file) => {
        const canonical = path.join(canonicalHome, path.relative(global.home, file))
        return [file, canonical].every((name) => {
          const relative = path.relative(location.directory, name)
          return (
            inspect(action, [name, relative.startsWith("..") || path.isAbsolute(relative) ? name : relative]) ===
            "allow"
          )
        })
      })
    if (!permitted([source], "read") || !permitted([target], "read"))
      return yield* new Failure({ code: "forbidden", message: "Memory migration preview is not permitted" })
    return { selected, permitted }
  })
  const previewMigration = Effect.fn("MemoryLifecycleNative.previewMigration")(
    function* (id: SessionSchema.ID, input: MemoryOperation.MigrationQuery) {
      const session = yield* placement(id)
      const snapshot = yield* mode.get(id, settings)
      if (!snapshot.info.enabled) return yield* new Failure({ code: "disabled", message: "Memory is disabled" })
      if (
        (input.kind === "relocation" && (snapshot.backend !== "legacy" || input.scope === "global")) ||
        (input.kind === "carryover" && snapshot.backend !== "v2")
      )
        return yield* new Failure({
          code: "unsupported",
          message: "Migration kind does not match the pinned Memory backend and scope",
        })
      const agent = yield* agents.select(session.agent)
      const access = yield* migrationAccess(id, agent.id, input)
      const source = yield* Effect.tryPromise({
        try: () =>
          WorkspaceMemory.migrationSnapshot(
            location.directory,
            global.home,
            access.selected,
            input.kind === "relocation",
          ),
        catch: failure,
      })
      const generation =
        input.kind === "relocation" ? source.generation : yield* MemoryCapture.inspectRevision(access.selected)
      return MemoryOperation.MigrationPreview.make({
        ...input,
        sourceHash: source.sourceHash,
        targetHash: input.kind === "relocation" ? source.targetHash : "",
        generation,
        available: Boolean(source.content.trim()) && (input.kind !== "relocation" || source.source !== source.target),
      })
    },
    Effect.scoped,
    Effect.mapError(failure),
  )
  const prepareMigration = Effect.fn("MemoryLifecycleNative.prepareMigration")(
    function* (id: SessionSchema.ID, expected: MemoryOperation.MigrationPreview) {
      const actual = yield* previewMigration(id, expected)
      if (JSON.stringify(actual) !== JSON.stringify(MemoryOperation.MigrationPreview.make(expected)))
        return yield* new Failure({ code: "changed", message: "Memory migration preview changed" })
      const session = yield* placement(id)
      const snapshot = yield* mode.get(id, settings)
      const createdEventID = yield* SessionIncarnation.created(database.db, id)
      if (!createdEventID)
        return yield* new Failure({ code: "changed", message: "Session creation proof is unavailable" })
      const agent = yield* agents.select(session.agent)
      return MigrationPlan.make({
        sessionID: id,
        createdEventID,
        revision: snapshot.revision,
        generation: actual.generation,
        backend: snapshot.backend,
        sources: [],
        migration: { preview: actual, agent: agent.id, authority: yield* permission.capture(id, agent.id) },
      })
    },
    Effect.scoped,
    Effect.mapError(failure),
  )
  const executeMigration = Effect.fn("MemoryLifecycleNative.executeMigration")(
    function* (plan: MigrationPlan) {
      const inherited = yield* PermissionV2.Inherited
      return yield* Effect.gen(function* () {
        yield* placement(plan.sessionID)
        const snapshot = yield* mode.get(plan.sessionID, settings)
        if (
          snapshot.revision !== plan.revision ||
          snapshot.backend !== plan.backend ||
          (yield* SessionIncarnation.created(database.db, plan.sessionID)) !== plan.createdEventID
        )
          return yield* new Failure({ code: "changed", message: "Memory migration Session changed" })
        const input = plan.migration.preview
        const scope = yield* migrationAccess(plan.sessionID, plan.migration.agent, input)
        const source = yield* Effect.tryPromise({
          try: () =>
            WorkspaceMemory.migrationSnapshot(
              location.directory,
              global.home,
              scope.selected,
              input.kind === "relocation",
            ),
          catch: failure,
        })
        if (source.sourceHash !== input.sourceHash)
          return yield* new Failure({ code: "changed", message: "Memory migration source changed" })
        if (!input.available) return { status: "no_work", processed: 0 } satisfies MemoryOperation.Result
        return yield* mode.commit(
          plan.sessionID,
          settings,
          plan.revision,
          Effect.gen(function* () {
            if ((yield* SessionIncarnation.created(database.db, plan.sessionID)) !== plan.createdEventID)
              return yield* new Failure({ code: "changed", message: "Memory migration Session was replaced" })
            const fresh = yield* migrationAccess(plan.sessionID, plan.migration.agent, input)
            const permitted = (files: readonly string[], action: "read" | "edit") =>
              scope.permitted(files, action) && fresh.permitted(files, action)
            if (input.kind === "relocation") {
              const paths = { read: [source.source, source.target], edit: [source.target] }
              if (!permitted(paths.read, "read") || !permitted(paths.edit, "edit"))
                return yield* new Failure({ code: "forbidden", message: "Memory migration write is not permitted" })
              yield* Effect.tryPromise({
                try: () =>
                  WorkspaceMemory.migrate(
                    location.directory,
                    global.home,
                    scope.selected,
                    (paths) => permitted(paths.read, "read") && permitted(paths.edit, "edit"),
                    { sourceHash: input.sourceHash, targetHash: input.targetHash, generation: input.generation },
                  ),
                catch: failure,
              }).pipe(Effect.uninterruptible)
              return { status: "completed", processed: 1 } satisfies MemoryOperation.Result
            }
            const policy = yield* MemoryPolicy.backend(database.db, plan.sessionID, { ...settings, profile: true })
            if (policy.rollout !== "active" || policy.restricted)
              return yield* new Failure({
                code: "disabled",
                message: "Curated migration requires active Memory V2 publication",
              })
            const root = MemoryV2.directory(scope.selected)
            if (
              !["memory_state.sqlite", "memory_state.sqlite-wal", "memory_state.sqlite-shm", "MEMORY.md"].every(
                (file) => permitted([path.join(root, file)], "read") && permitted([path.join(root, file)], "edit"),
              )
            )
              return yield* new Failure({
                code: "forbidden",
                message: "Memory migration storage write is not permitted",
              })
            const store = yield* MemoryCapture.make(scope.selected, {
              recover: false,
              compactIndex: settings.memory_v2?.compact_index_enabled,
            })
            const result = yield* store.importLegacy(
              {
                sourceKey: MemoryV2.hash(source.source),
                sourceHash: input.sourceHash,
                generation: input.generation,
                content: source.content,
              },
              (file, action) => permitted([path.join(root, file)], action),
            )
            return {
              status: result.imported ? "completed" : "no_work",
              processed: result.imported ? 1 : 0,
            } satisfies MemoryOperation.Result
          }),
        )
      }).pipe(
        Effect.provideService(
          PermissionV2.Inherited,
          new Map(inherited).set(plan.sessionID, [
            ...(inherited.get(plan.sessionID) ?? []),
            ...plan.migration.authority,
          ]),
        ),
      )
    },
    Effect.scoped,
    Effect.mapError(failure),
  )
  const execute = Effect.fn("MemoryLifecycleNative.execute")(
    function* (
      plan: Plan,
      owner: string,
      retry: boolean,
      ownership: {
        readonly recover: readonly MemoryCapture.ClaimProof[]
        readonly claimed: (proof: MemoryCapture.ClaimProof) => Effect.Effect<void, unknown>
      },
    ) {
      const snapshot = yield* enabled(plan.sessionID)
      if (snapshot.revision !== plan.revision)
        return { status: "conflict", reason: "mode_changed" } satisfies MemoryOperation.Result
      const session = yield* placement(plan.sessionID)
      const scope = yield* access(plan.sessionID, plan.sources.at(-1)?.agent ?? session.agent)
      const store = yield* MemoryCapture.make(scope.input, {
        recover: false,
        compactIndex: settings.memory_v2?.compact_index_enabled,
      })
      const validate = Effect.gen(function* () {
        yield* enabled(plan.sessionID)
        if ((yield* SessionIncarnation.created(database.db, plan.sessionID)) !== plan.createdEventID)
          return yield* new Failure({ code: "changed", message: "Memory source Session was replaced" })
        if ((yield* store.revision) !== plan.generation)
          return yield* new Failure({ code: "changed", message: "Memory scope changed after admission" })
      })
      yield* validate
      const existing = yield* store.jobs(plan.sessionID)
      for (const job of existing) {
        if (job.status === "completed" || (job.status === "failed" && job.terminal)) continue
        const source = yield* MemoryTranscriptNative.decode(job.source).pipe(Effect.result)
        if (source._tag === "Failure")
          return { status: "conflict", reason: "unsupported_source" } satisfies MemoryOperation.Result
      }
      yield* mode.commit(
        plan.sessionID,
        settings,
        plan.revision,
        validate.pipe(Effect.andThen(store.adopt(plan.sessionID, plan.createdEventID))),
      )
      const jobs: string[] = []
      for (const source of plan.sources) {
        const admitted = yield* mode.commit(
          plan.sessionID,
          settings,
          plan.revision,
          validate.pipe(
            Effect.andThen(
              store.admit({
                sessionID: plan.sessionID,
                promptID: source.promptID,
                sourcePromptIndex: 0,
                source: JSON.stringify(source),
                createdAt: source.createdAt,
                exposed: snapshot.expose,
              }),
            ),
          ),
        )
        if (admitted.jobID) jobs.push(admitted.jobID)
      }
      const rows = yield* store.jobs(plan.sessionID)
      const target = Math.max(0, ...rows.filter((row) => jobs.includes(row.job_id)).map((row) => row.through_turn))
      if (!target) return { status: "no_work", through: 0, processed: 0 } satisfies MemoryOperation.Result
      yield* mode.commit(plan.sessionID, settings, plan.revision, validate.pipe(Effect.andThen(store.reconcile)))
      if (retry) {
        for (const proof of ownership.recover)
          yield* mode.commit(
            plan.sessionID,
            settings,
            plan.revision,
            validate.pipe(Effect.andThen(store.releaseClaim(plan.sessionID, plan.createdEventID, proof))),
          )
      }
      let processed = 0
      while (true) {
        yield* validate
        const progress = yield* store.progress(plan.sessionID, target)
        if (progress.failed) return { status: "failed", through: target, processed } satisfies MemoryOperation.Result
        if (progress.indexed >= target)
          return { status: "completed", through: target, processed } satisfies MemoryOperation.Result
        const lease = yield* store.claim({
          owner,
          sessionID: plan.sessionID,
          now: yield* Clock.currentTimeMillis,
          duration: 300000,
          through: target,
          retry,
          expired: false,
        })
        if (!lease) return { status: "retry_required", through: target, processed } satisfies MemoryOperation.Result
        const result = yield* Effect.gen(function* () {
          // Persist exact lease evidence before provider work. A crash before this receipt remains unavailable.
          yield* ownership.claimed({
            jobID: lease.job.job_id,
            owner: lease.owner,
            token: lease.token,
            sourceHash: MemoryV2.hash(lease.job.source),
          })
          const source = yield* MemoryTranscriptNative.decode(lease.job.source)
          if (source.sessionID !== plan.sessionID || source.createdEventID !== plan.createdEventID)
            return yield* new Failure({ code: "changed", message: "Capture source ownership changed" })
          const inherited = yield* PermissionV2.Inherited
          return yield* Effect.gen(function* () {
            const permissions = yield* access(plan.sessionID, source.agent)
            const requested = settings.memory_v2?.capture_model?.trim()
            const parts = requested?.split("/")
            if (parts && (parts.length > 2 || parts.some((part) => !part)))
              return yield* new Failure({ code: "invalid", message: "Invalid capture model selection" })
            const modelRef = parts
              ? {
                  providerID: parts.length === 2 ? ProviderV2.ID.make(parts[0]!) : source.model.providerID,
                  id: ModelV2.ID.make(parts.at(-1)!),
                }
              : source.model
            const model = yield* models.resolve({ ...session, agent: AgentV2.ID.make(source.agent), model: modelRef })
            const request = LLM.request({
              model,
              system: [SystemPart.make(MemoryCapture.prompt)],
              messages: [Message.user(source.transcript)],
              tools: [],
              toolChoice: "none",
            })
            const output = { text: "", finished: false }
            yield* llm.stream(request).pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  if (event.type === "provider-error")
                    return yield* new Failure({ code: "storage", message: "Memory extraction provider failed" })
                  if (event.type === "text-delta") {
                    output.text += event.text
                    if (Buffer.byteLength(output.text) > 2 * 1024 * 1024)
                      return yield* new Failure({
                        code: "invalid",
                        message: "Memory extraction output exceeds its bound",
                      })
                  }
                  if (event.type === "finish") output.finished = event.reason === "stop"
                }),
              ),
              Effect.timeout("120 seconds"),
            )
            if (!output.finished)
              return yield* new Failure({ code: "invalid", message: "Memory extraction did not finish" })
            const now = yield* Clock.currentTimeMillis
            const outcome = yield* Effect.try({
              try: () => MemoryCapture.parse(output.text, `${model.provider}/${model.id}`, Math.floor(now / 1000)),
              catch: failure,
            })
            const prepared = MemoryCapture.prepare(lease.job, outcome)
            yield* mode.commit(
              plan.sessionID,
              settings,
              plan.revision,
              Effect.gen(function* () {
                yield* validate
                const fresh = yield* access(plan.sessionID, source.agent)
                if (
                  !prepared.files.every(
                    (file) => permissions.permitted(file.path, "edit") && fresh.permitted(file.path, "edit"),
                  )
                )
                  return yield* new Failure({ code: "forbidden", message: "Captured observation is not permitted" })
                yield* store.commit(lease, outcome, Date.now(), plan.generation)
              }),
            )
          }).pipe(
            Effect.provideService(
              PermissionV2.Inherited,
              new Map(inherited).set(plan.sessionID, [...(inherited.get(plan.sessionID) ?? []), ...source.authority]),
            ),
          )
        }).pipe(
          Effect.onInterrupt(() => store.fail(lease, "Capture cancelled", false).pipe(Effect.ignore)),
          Effect.result,
        )
        if (result._tag === "Failure") {
          yield* store.fail(lease, "Capture attempt failed", lease.job.attempt >= 3).pipe(Effect.ignore)
          return {
            status: lease.job.attempt >= 3 ? "failed" : "retry_required",
            through: target,
            processed,
          } satisfies MemoryOperation.Result
        }
        processed++
      }
    },
    Effect.scoped,
    Effect.catchTag("MemoryCaptureError", (cause) => {
      if (cause.reason === "historical_owner")
        return Effect.succeed<MemoryOperation.Result>({ status: "conflict", reason: "historical_capture_ownership" })
      return Effect.fail(cause)
    }),
    Effect.mapError(failure),
  )
  return {
    prepare,
    prepareAutomatic: legacy.prepareAutomatic,
    prepareCheckpoint: legacy.prepareCheckpoint,
    executeCheckpoint: legacy.executeCheckpoint,
    checkpointLegacy: (id: SessionSchema.ID, stopped?: SessionMessage.ID) =>
      Effect.gen(function* () {
        const snapshot = yield* mode.get(id, settings)
        if (snapshot.backend !== "legacy") return false
        const plan = yield* legacy.prepareCheckpoint(id, stopped)
        if (plan) yield* legacy.executeCheckpoint(plan)
        return true
      }).pipe(Effect.mapError(failure)),
    prepareFlush: (id: SessionSchema.ID) =>
      Effect.gen(function* () {
        const snapshot = yield* mode.get(id, settings)
        if (snapshot.backend === "legacy") return yield* legacy.prepare(id)
        return yield* prepare(id)
      }).pipe(Effect.mapError(failure)),
    executeLegacy: legacy.execute,
    execute,
    previewRecovery,
    prepareRecovery,
    executeRecovery,
    prepareDream: (id: SessionSchema.ID, manual: boolean) =>
      Effect.gen(function* () {
        const snapshot = yield* mode.get(id, settings)
        if (snapshot.backend === "legacy") return yield* legacyDream.prepare(id, manual)
        return yield* prepareDream(id, manual)
      }).pipe(Effect.mapError(failure)),
    scheduleLegacyDream: legacyDream.schedule,
    executeLegacyDream: legacyDream.execute,
    executeDream,
    previewMigration,
    prepareMigration,
    executeMigration,
    owned: <A, E, R>(plan: Pick<Plan, "sessionID" | "revision">, action: Effect.Effect<A, E, R>) =>
      mode
        .run(plan.sessionID, settings, plan.revision, action)
        .pipe(Effect.mapError((cause) => (cause instanceof SessionLifecycle.Closed ? failure(cause) : cause))),
  }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/MemoryLifecycleNative") {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    MemoryLegacyNative.node,
    MemoryDreamNative.node,
    SessionInputAdmission.node,
    Ripgrep.node,
    Config.node,
    Global.node,
    Location.node,
    Database.node,
    SessionStore.node,
    SessionLifecycle.node,
    SessionManagedChild.node,
    SessionGoal.node,
    SessionMemoryModeNative.node,
    PermissionV2.node,
    LocationMutation.node,
    SessionRunnerModel.node,
    AgentV2.node,
    llmClient,
  ],
})

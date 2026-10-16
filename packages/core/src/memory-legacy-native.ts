export * as MemoryLegacyNative from "./memory-legacy-native"

import path from "node:path"
import { randomUUID } from "node:crypto"
import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises"
import { LLM, LLMClient, Message, SystemPart } from "@apexo/llm"
import { Model } from "@apexo/schema/model"
import { MemoryOperation } from "@apexo/schema/memory-operation"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { and, asc, desc, eq, lte, or, sql } from "drizzle-orm"
import { PermissionAuthority } from "./permission/authority"
import type { SessionCompaction } from "./session/compaction"
import { SessionInputAdmission } from "./session/input-admission"
import type { SessionLifecycle } from "./session/lifecycle"
import { SessionMessage } from "./session/message"
import { SessionMessageTable } from "./session/sql"
import { ConfigMemory } from "./config/memory"
import { Config } from "./config"
import { Database } from "./database/database"
import { makeLocationNode } from "./effect/app-node"
import { llmClient } from "./effect/app-node-platform"
import { Global } from "./global"
import { Location } from "./location"
import { LocationMutation } from "./location-mutation"
import { AgentV2 } from "./agent"
import { ModelV2 } from "./model"
import { ProviderV2 } from "./provider"
import { MemoryEmbedding } from "./memory-embedding"
import { MemoryFiles } from "./memory-files"
import { MemoryFlush } from "./memory-flush"
import { MemoryMaintenance } from "./memory-maintenance"
import { MemorySearch } from "./memory-search"
import { MemorySession } from "./memory-session"
import { MemoryTranscriptNative } from "./memory-transcript-native"
import { MemoryV2 } from "./memory-v2"
import { PermissionV2 } from "./permission"
import { SessionExecutionPolicy } from "./session/execution-policy"
import { SessionGoal } from "./session/goal"
import { SessionGoalUsage } from "./session/goal-usage"
import { SessionIncarnation } from "./session/incarnation"
import { SessionManagedChild } from "./session/managed-child"
import { SessionMemoryModeNative } from "./session/memory-mode-native"
import { SessionRunnerModel } from "./session/runner/model"
import { SessionSchema } from "./session/schema"
import { SessionStore } from "./session/store"
import { WorkspaceMemory } from "./workspace-memory"
import { Flock } from "./util/flock"

export const DuplicateProof = Schema.Struct({
  embeddingIdentity: Schema.String,
  threshold: Schema.Finite,
  similarity: Schema.Finite,
  neighborPath: Schema.String,
  neighborStartLine: Schema.Number,
  neighborFileHash: Schema.String,
  neighborChunkHash: Schema.String,
  candidateHash: Schema.String,
})
export type DuplicateProof = typeof DuplicateProof.Type

export const Publication = Schema.Struct({
  operationID: MemoryOperation.ID,
  planHash: Schema.String,
  status: Schema.Literals(["accepted", "empty", "duplicate"]),
  content: Schema.optionalKey(Schema.String),
  duplicate: Schema.optionalKey(DuplicateProof),
})
export type Publication = typeof Publication.Type

export const Plan = Schema.Struct({
  sessionID: SessionSchema.ID,
  createdEventID: Schema.String,
  revision: Schema.String,
  generation: Schema.String,
  backend: Schema.Literal("legacy"),
  sources: Schema.Array(MemoryTranscriptNative.Source),
  automatic: Schema.optionalKey(
    Schema.Struct({
      trigger: Schema.Literals(["idle", "compaction"]),
      sourceID: SessionMessage.ID,
      sourceSeq: Schema.optionalKey(Schema.Number),
      cycle: Schema.optionalKey(SessionMessage.ID),
    }),
  ),
  flush: Schema.Struct({
    captured: Schema.Number,
    model: Schema.optionalKey(Model.Ref),
    maxChars: Schema.Number,
    previous: Schema.String,
    previousHash: Schema.String,
  }),
})
export type Plan = typeof Plan.Type
export const Checkpoint = Schema.Struct({
  sessionID: SessionSchema.ID,
  createdEventID: Schema.String,
  revision: Schema.String,
  generation: Schema.String,
  messageID: SessionMessage.ID,
  watermark: Schema.Number,
  captured: Schema.Number,
  stopped: Schema.optionalKey(SessionMessage.ID),
  sourceHash: Schema.String,
  content: Schema.String,
  authorities: Schema.Array(
    Schema.Struct({ agent: Schema.String, snapshots: Schema.Array(PermissionAuthority.Snapshot) }),
  ),
})
export type Checkpoint = typeof Checkpoint.Type
const Failure = SessionMemoryModeNative.Failure
const fail = (message: string, code: SessionMemoryModeNative.Failure["code"] = "storage") =>
  new Failure({ code, message })
const io = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => fail("Legacy Memory storage is unavailable") }).pipe(
    Effect.uninterruptible,
  )

const make = Effect.gen(function* () {
  const admission = yield* SessionInputAdmission.Service
  const config = yield* Config.Service
  const database = yield* Database.Service
  const embedding = yield* MemoryEmbedding.Service
  const location = yield* Location.Service
  const global = yield* Global.Service
  const sessions = yield* SessionStore.Service
  const managed = yield* SessionManagedChild.Service
  const goals = yield* SessionGoal.Service
  const modes = yield* SessionMemoryModeNative.Service
  const permission = yield* PermissionV2.Service
  const mutation = yield* LocationMutation.Service
  const models = yield* SessionRunnerModel.Service
  const llm = yield* LLMClient.Service
  const documents = (yield* config.entries()).filter((entry) => entry.type === "document")
  const settings = {
    memory: documents.reduce<typeof ConfigMemory.Info.Type>((value, entry) => ({ ...value, ...entry.info.memory }), {}),
    memory_v2: documents.reduce((value, entry) => ({ ...value, ...entry.info.memory_v2 }), {}),
  }
  const options = documents.reduce<typeof ConfigMemory.Flush.Type>(
    (value, entry) => ({ ...value, ...entry.info.compaction?.memory_flush }),
    {},
  )
  const input = { directory: location.directory, home: global.home, projectID: location.project.id }
  const scope = WorkspaceMemory.maintenance(input.directory, input.home, input)
  const placement = Effect.fnUntraced(function* (id: SessionSchema.ID) {
    const session = yield* sessions.get(id)
    if (
      !session ||
      session.location.directory !== location.directory ||
      session.location.workspaceID !== location.workspaceID
    )
      return yield* fail("Session not found in this Location", "missing")
    if (
      (yield* SessionExecutionPolicy.forSession(id)) ||
      (yield* SessionGoalUsage.Current) ||
      (yield* managed.managed(id)) ||
      (yield* goals.get(id))?.status === "active"
    )
      return yield* fail(
        "Auxiliary Memory work is unavailable to headless inputs, managed children and active Goal attempts",
        "unsupported",
      )
    const snapshot = yield* modes.get(id, settings)
    if (!snapshot.info.enabled || snapshot.backend !== "legacy")
      return yield* fail("Legacy Memory is not enabled", "disabled")
    return { session, snapshot }
  })
  const target = (plan: Pick<Plan, "sessionID" | "flush">) =>
    MemorySession.file(
      input.directory,
      { sessionID: `${plan.sessionID}-flush`, captured: plan.flush.captured, content: "" },
      input.home,
      input,
    )
  const accessAction = Effect.fnUntraced(function* (
    id: SessionSchema.ID,
    agent: string,
    file: string,
    actions: readonly ("read" | "edit")[],
  ) {
    const inspect = yield* permission.inspect(id, AgentV2.ID.make(agent))
    const resolved = yield* mutation.resolve({ path: file, kind: "file" })
    if (resolved.externalDirectory && inspect("external_directory", [resolved.externalDirectory.resource]) !== "allow")
      return yield* fail("Legacy Memory scope access is not allowed", "forbidden")
    const paths = [
      ...new Set(
        [file, resolved.canonical].flatMap((value) => {
          const relative = path.relative(location.directory, value)
          return [value, ...(relative.startsWith("..") || path.isAbsolute(relative) ? [] : [relative])]
        }),
      ),
    ]
    for (const action of actions) {
      if (inspect(action, paths) !== "allow")
        return yield* fail("Legacy Memory source and destination access is not allowed", "forbidden")
    }
  })
  const access = (id: SessionSchema.ID, agent: string, file: string) =>
    accessAction(id, agent, file, ["read", "edit"])
  const metadata = Effect.fnUntraced(function* (
    id: SessionSchema.ID,
    stopped?: SessionMessage.ID,
    boundary?: SessionMessage.ID,
  ) {
    // The runner's explicit stopped boundary follows joined tools, but its assistant completion event can follow this callback.
    const last = yield* database.db
      .select({
        id: SessionMessageTable.id,
        seq: SessionMessageTable.seq,
        captured: SessionMessageTable.time_created,
      })
      .from(SessionMessageTable)
      .where(
        and(
          eq(SessionMessageTable.session_id, id),
          eq(SessionMessageTable.type, "assistant"),
          boundary ? eq(SessionMessageTable.id, boundary) : undefined,
          stopped ? undefined : sql`json_extract(${SessionMessageTable.data}, '$.time.completed') is not null`,
          stopped
            ? eq(SessionMessageTable.id, stopped)
            : sql`json_extract(${SessionMessageTable.data}, '$.finish') = 'stop' and json_extract(${SessionMessageTable.data}, '$.error') is null`,
          sql`not exists (select 1 from json_each(${SessionMessageTable.data}, '$.content') where json_extract(value, '$.type') = 'tool' and json_extract(value, '$.state.status') in ('pending', 'running'))`,
        ),
      )
      .orderBy(desc(SessionMessageTable.seq))
      .limit(1)
      .get()
    if (!last) return
    const within = and(eq(SessionMessageTable.session_id, id), lte(SessionMessageTable.seq, last.seq))
    const real = and(
      within,
      eq(SessionMessageTable.type, "user"),
      sql`trim(json_extract(${SessionMessageTable.data}, '$.text')) not in ('', '__auto_continue__')`,
    )
    // Aggregate counts in SQLite; only five bounded topics and bounded distinct authorities cross this boundary.
    const users = yield* database.db
      .select({
        count: sql<number>`count(*)`,
        bytes: sql<number>`coalesce(sum(length(cast(trim(json_extract(${SessionMessageTable.data}, '$.text')) as blob))), 0)`,
      })
      .from(SessionMessageTable)
      .where(real)
      .get()
    if (!users || users.count < 3 || users.bytes < 50) return
    const topics = yield* database.db
      .select({ text: sql<string>`substr(trim(json_extract(${SessionMessageTable.data}, '$.text')), 1, 100)` })
      .from(SessionMessageTable)
      .where(real)
      .orderBy(asc(SessionMessageTable.seq))
      .limit(5)
      .all()
    const complete = and(
      within,
      eq(SessionMessageTable.type, "assistant"),
      or(
        sql`json_extract(${SessionMessageTable.data}, '$.time.completed') is not null`,
        stopped ? eq(SessionMessageTable.id, stopped) : undefined,
      ),
    )
    const assistants = yield* database.db
      .select({
        count: sql<number>`count(*)`,
        tools: sql<number>`coalesce(sum((select count(*) from json_each(${SessionMessageTable.data}, '$.content') where json_extract(value, '$.type') = 'tool' and json_extract(value, '$.state.status') in ('completed', 'error'))), 0)`,
      })
      .from(SessionMessageTable)
      .where(complete)
      .get()
    const agents = yield* database.db
      .select({ agent: sql<string>`json_extract(${SessionMessageTable.data}, '$.agent')` })
      .from(SessionMessageTable)
      .where(complete)
      .groupBy(sql`json_extract(${SessionMessageTable.data}, '$.agent')`)
      .orderBy(sql`json_extract(${SessionMessageTable.data}, '$.agent')`)
      .limit(129)
      .all()
    if (agents.length > 128) return yield* fail("Metadata checkpoint has too many distinct authorities", "invalid")
    const content = [
      `<!-- apexo-session-checkpoint:${last.captured} -->`,
      "## Session Summary",
      "",
      `- **Messages:** ${users.count} user, ${assistants?.count ?? 0} assistant, ${assistants?.tools ?? 0} tool results`,
      `- **Date:** ${new Date(last.captured).toISOString().slice(0, 16).replace("T", " ")} UTC`,
      "",
      "## Topics Discussed",
      "",
      ...topics.map((topic, index) => `${index + 1}. ${topic.text.replace(/\s+/g, " ")}`),
      "",
    ].join("\n")
    return { last, agents, content, hash: MemoryV2.hash(JSON.stringify([last, content, agents])) }
  })
  const prepareCheckpoint = Effect.fn("MemoryLegacyNative.prepareCheckpoint")(function* (
    id: SessionSchema.ID,
    stopped?: SessionMessage.ID,
  ) {
    if (settings.memory.session?.save_on_end === false) return
    const current = yield* placement(id)
    const createdEventID = yield* SessionIncarnation.created(database.db, id)
    if (!createdEventID) return yield* fail("Session creation proof is unavailable", "changed")
    const generation = yield* io(() => MemoryMaintenance.revision(scope))
    const source = yield* metadata(id, stopped)
    if (!source) return
    const file = MemorySession.file(
      input.directory,
      { sessionID: id, captured: source.last.captured, content: "" },
      input.home,
      input,
    )
    const authorities = yield* Effect.forEach(source.agents, ({ agent }) =>
      Effect.gen(function* () {
        yield* access(id, agent, file)
        return { agent, snapshots: yield* permission.capture(id, AgentV2.ID.make(agent)) }
      }),
    )
    return Checkpoint.make({
      sessionID: id,
      createdEventID,
      revision: current.snapshot.revision,
      generation,
      messageID: source.last.id,
      watermark: source.last.seq,
      captured: source.last.captured,
      ...(stopped ? { stopped } : {}),
      sourceHash: source.hash,
      content: source.content,
      authorities,
    })
  })
  const executeCheckpoint = Effect.fn("MemoryLegacyNative.executeCheckpoint")(function* (plan: Checkpoint) {
    if (settings.memory.session?.save_on_end === false) return false
    const inherited = yield* PermissionV2.Inherited
    const home = yield* io(() => realpath(input.home))
    const file = MemorySession.file(
      input.directory,
      { sessionID: plan.sessionID, captured: plan.captured, content: "" },
      input.home,
      input,
    )
    return yield* modes
      .run(
        plan.sessionID,
        settings,
        plan.revision,
        MemoryMaintenance.writeEffect(
          scope,
          Effect.gen(function* () {
            // Acquire both storage locks before current authority checks; no detached Promise runtimes.
            yield* Flock.effect(path.join(home, path.relative(input.home, file)), {
              dir: path.join(home, ".grok", "memory", ".locks"),
              deadOwnerOnly: true,
            })
            return yield* modes.commit(
              plan.sessionID,
              settings,
              plan.revision,
              Effect.gen(function* () {
                const current = yield* placement(plan.sessionID)
                if (
                  current.snapshot.revision !== plan.revision ||
                  (yield* SessionIncarnation.created(database.db, plan.sessionID)) !== plan.createdEventID
                )
                  return yield* fail("Metadata checkpoint belongs to a changed Session", "changed")
                for (const authority of plan.authorities) yield* access(plan.sessionID, authority.agent, file)
                const source = yield* metadata(plan.sessionID, plan.stopped, plan.messageID)
                if (
                  !source ||
                  source.last.seq !== plan.watermark ||
                  source.hash !== plan.sourceHash ||
                  source.content !== plan.content
                )
                  return yield* fail("Metadata checkpoint source changed", "changed")
                const content = `${plan.content}<!-- apexo-native-checkpoint:${plan.createdEventID}:${plan.watermark}:${plan.sourceHash} -->\n`
                const previous = yield* io(() => read(file, input))
                if (previous === content) return false
                const watermark = previous.match(/<!-- apexo-native-checkpoint:([^:]+):(\d+):[a-f0-9]+ -->/)
                if (watermark?.[1] === plan.createdEventID && Number(watermark[2]) >= plan.watermark) return false
                yield* io(() => publishLocked(file, input, MemoryV2.hash(previous), content))
                return true
              }),
            )
          }).pipe(Effect.scoped),
          plan.generation,
        ),
      )
      .pipe(
        Effect.provideService(
          PermissionV2.Inherited,
          new Map(inherited).set(plan.sessionID, [
            ...(inherited.get(plan.sessionID) ?? []),
            ...plan.authorities.flatMap((authority) => authority.snapshots),
          ]),
        ),
      )
  })
  const prepare = Effect.fn("MemoryLegacyNative.prepare")(function* (id: SessionSchema.ID) {
    const current = yield* placement(id)
    const createdEventID = yield* SessionIncarnation.created(database.db, id)
    if (!createdEventID) return yield* fail("Session creation proof is unavailable", "changed")
    // Native turns exclude unfinished chains and retain the authority of every selected source.
    const history = yield* sessions.context(id)
    const start = Math.max(0, history.length - 20)
    const boundary = history.slice(0, start + 1).findLastIndex((message) => message.type === "user")
    const turns = MemoryTranscriptNative.turns(history.slice(Math.max(0, boundary)))
    const last = turns.at(-1)
    const sources = yield* Effect.forEach(turns, (turn) =>
      Effect.gen(function* () {
        return MemoryTranscriptNative.Source.make({
          version: 2,
          sessionID: id,
          createdEventID,
          authority: yield* permission.capture(id, AgentV2.ID.make(turn.agent)),
          ...turn,
        })
      }),
    )
    const requested = options.flush_model?.trim().split("/")
    if (requested && (requested.length > 2 || requested.some((part) => !part)))
      return yield* fail("Invalid legacy flush model selection", "invalid")
    const fallback = last?.model ?? current.session.model
    if (!fallback && last) return yield* fail("No model is available for legacy flush", "invalid")
    const model = !fallback
      ? undefined
      : requested
        ? {
            providerID: requested.length === 2 ? ProviderV2.ID.make(requested[0]!) : fallback.providerID,
            id: ModelV2.ID.make(requested.at(-1)!),
          }
        : fallback
    const plan = {
      sessionID: id,
      createdEventID,
      revision: current.snapshot.revision,
      generation: yield* io(() => MemoryMaintenance.revision(scope)),
      backend: "legacy" as const,
      sources,
      flush: {
        captured: last?.createdAt ?? Date.now(),
        ...(model ? { model } : {}),
        maxChars: Math.min(options.max_flush_write_chars ?? 8000, 32768),
        previous: "",
        previousHash: "",
      },
    }
    yield* access(id, last?.agent ?? current.session.agent ?? "build", target(plan))
    if (last) yield* models.resolve({ ...current.session, agent: AgentV2.ID.make(last.agent), model })
    const previous = yield* io(() => read(target(plan), input))
    const fresh = yield* placement(id)
    if (
      fresh.snapshot.revision !== plan.revision ||
      (yield* SessionIncarnation.created(database.db, id)) !== createdEventID ||
      (yield* io(() => MemoryMaintenance.revision(scope))) !== plan.generation
    )
      return yield* fail("Legacy Memory changed before admission", "changed")
    return Plan.make({ ...plan, flush: { ...plan.flush, previous, previousHash: MemoryV2.hash(previous) } })
  })
  const prepareAutomatic = Effect.fn("MemoryLegacyNative.prepareAutomatic")(function* (
    id: SessionSchema.ID,
    boundary?: SessionCompaction.MemoryBoundary,
  ) {
    if (options.enabled === false || (!boundary && (options.idle_timeout_secs ?? 300) === 0)) return
    if (
      boundary &&
      (!boundary.source ||
        boundary.estimatedInputTokens <
          Math.max(0, boundary.compactThresholdTokens - (options.soft_threshold_tokens ?? 4000)))
    )
      return
    if (boundary?.source) {
      const selected = yield* database.db
        .select({ seq: SessionMessageTable.seq })
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, id), eq(SessionMessageTable.id, boundary.source.messageID)))
        .get()
      if (selected?.seq !== boundary.source.seq) return
    }
    const plan = yield* prepare(id)
    const last = plan.sources.at(-1)
    if (!last || (boundary && last.assistantID !== boundary.source?.messageID)) return
    return {
      plan: Plan.make({
        ...plan,
        automatic: {
          trigger: boundary ? "compaction" : "idle",
          sourceID: last.assistantID,
          ...(boundary ? { cycle: boundary.compactionID, sourceSeq: boundary.source?.seq } : {}),
        },
      }),
      delay: (options.idle_timeout_secs ?? 300) * 1000,
    }
  })
  type ExecuteOptions =
    | { readonly claim: SessionLifecycle.Claim; readonly valid: () => boolean }
    | {
        readonly operationID: MemoryOperation.ID
        readonly automatic?: { readonly claim: SessionLifecycle.Claim; readonly valid: () => boolean }
        readonly recover?: Publication
        readonly prepared?: (publication: Publication) => Effect.Effect<void, unknown>
      }
  const execute = Effect.fn("MemoryLegacyNative.execute")(function* (plan: Plan, optionsInput?: ExecuteOptions) {
    const automatic =
      optionsInput && "operationID" in optionsInput ? optionsInput.automatic : optionsInput
    const operationID =
      optionsInput && "operationID" in optionsInput
        ? optionsInput.operationID
        : MemoryOperation.ID.make("mop_legacy-flush")
    const recover = optionsInput && "operationID" in optionsInput ? optionsInput.recover : undefined
    const prepared = optionsInput && "operationID" in optionsInput ? optionsInput.prepared : undefined
    const last = plan.sources.at(-1)
    if (!last) return { status: "no_work", processed: 0 } satisfies MemoryOperation.Result
    if (
      plan.sources.some(
        (source) => source.sessionID !== plan.sessionID || source.createdEventID !== plan.createdEventID,
      )
    )
      return yield* fail("Legacy flush source identity changed", "changed")
    const modelRef = plan.flush.model
    if (!modelRef) return yield* fail("Legacy flush model identity is unavailable", "invalid")
    const inherited = yield* PermissionV2.Inherited
    return yield* Effect.gen(function* () {
      const file = target(plan)
      const home = yield* io(() => realpath(input.home))
      const canonicalFile = path.join(home, path.relative(input.home, file))
      const planHash = MemoryV2.hash(JSON.stringify(plan))
      const marker = `<!-- apexo-native-flush:${MemoryV2.hash(JSON.stringify([plan.createdEventID, plan.sources.map((source) => [source.promptID, source.assistantID, source.transcript]), [modelRef.providerID, modelRef.id, modelRef.variant ?? null]]))} -->`
      const initialPlacement = yield* placement(plan.sessionID)
      const initialAgent = initialPlacement.session.agent
      const validate = Effect.gen(function* () {
        if (automatic && !automatic.valid()) return yield* Effect.interrupt
        const current = yield* placement(plan.sessionID)
        if (
          current.snapshot.revision !== plan.revision ||
          (yield* SessionIncarnation.created(database.db, plan.sessionID)) !== plan.createdEventID ||
          (yield* io(() => MemoryMaintenance.revision(scope))) !== plan.generation ||
          current.session.agent !== initialAgent
        )
          return yield* fail("Legacy Memory source changed after admission", "changed")
        for (const source of plan.sources) yield* access(plan.sessionID, source.agent, file)
        return current.session
      })
      const authorizeRead = (files: readonly string[]) =>
        Effect.gen(function* () {
          for (const source of plan.sources) {
            for (const targetPath of files) {
              yield* accessAction(plan.sessionID, source.agent, targetPath, ["read"])
            }
          }
        })
      const verifyDuplicateAtCommit = (dup: DuplicateProof) =>
        Effect.gen(function* () {
          yield* authorizeRead([dup.neighborPath])
          const roots = yield* io(async () =>
            Promise.all(
              (["global", "workspace"] as const).map(async (rootScope) => {
                const folder = path.dirname(
                  WorkspaceMemory.file(input.directory, input.home, { ...input, scope: rootScope }),
                )
                return { path: await realpath(folder), alias: path.resolve(folder), source: rootScope }
              }),
            ),
          )
          const matchedRoot = roots.find(
            (root) =>
              MemoryFiles.allowed(root.path, dup.neighborPath) || MemoryFiles.allowed(root.alias, dup.neighborPath),
          )
          if (!matchedRoot) return yield* fail("Legacy flush duplicate source is outside memory roots", "changed")
          const canonicalNeighbor = MemoryFiles.allowed(matchedRoot.path, dup.neighborPath)
            ? dup.neighborPath
            : path.join(matchedRoot.path, path.relative(matchedRoot.alias, dup.neighborPath))
          yield* authorizeRead([canonicalNeighbor])
          const neighborText = yield* io(() =>
            MemoryFiles.read(canonicalNeighbor, matchedRoot, 1_000_001).then((value) => {
              if (value.size > 1_000_000) throw new Error("Legacy Memory file exceeds bound")
              return value.bytes.toString("utf8")
            }),
          ).pipe(Effect.mapError(() => fail("Legacy flush duplicate source changed before publication", "changed")))
          if (MemoryV2.hash(neighborText) !== dup.neighborFileHash)
            return yield* fail("Legacy flush duplicate source changed before publication", "changed")
          const matchedChunk = MemorySearch.chunks(neighborText).find((item) => item.start === dup.neighborStartLine)
          if (!matchedChunk || MemoryV2.hash(matchedChunk.content) !== dup.neighborChunkHash)
            return yield* fail("Legacy flush duplicate chunk changed before publication", "changed")
        })
      const session = yield* validate
      // Same destination lock orders legacy flushes across processes; never clear while holding it.
      yield* Flock.effect(`${canonicalFile}.native-flush`, {
        dir: path.join(home, ".grok", "memory", ".locks"),
        deadOwnerOnly: true,
        reclaimDeadOwner: true,
      })
      const previous = yield* io(() => read(file, input))
      if (previous.includes(marker)) return { status: "completed", processed: 0 } satisfies MemoryOperation.Result
      if (
        previous.includes(marker.replace(" -->", ":empty -->")) ||
        previous.includes(marker.replace(" -->", ":duplicate -->"))
      )
        return { status: "no_work", processed: 0 } satisfies MemoryOperation.Result
      if (MemoryV2.hash(previous) !== plan.flush.previousHash)
        return yield* fail("Legacy Memory destination changed; request a fresh flush", "changed")
      const publish = (publication: Publication) =>
        Effect.gen(function* () {
          if (
            publication.planHash !== planHash ||
            (publication.status === "accepted" && !publication.content) ||
            (publication.status !== "accepted" && publication.content !== undefined) ||
            (publication.status === "duplicate" && !publication.duplicate)
          )
            return yield* fail("Legacy flush publication receipt is invalid", "changed")
          yield* MemoryMaintenance.writeEffect(
            scope,
            Effect.gen(function* () {
              yield* Flock.effect(canonicalFile, {
                dir: path.join(home, ".grok", "memory", ".locks"),
                deadOwnerOnly: true,
              })
              const commit = modes.commit(
                plan.sessionID,
                settings,
                plan.revision,
                Effect.gen(function* () {
                  if (automatic && !automatic.valid()) return yield* Effect.interrupt
                  yield* validate
                  if (publication.status === "duplicate") {
                    yield* verifyDuplicateAtCommit(publication.duplicate!)
                  }
                  const publishedMarker =
                    publication.status === "empty"
                      ? marker.replace(" -->", ":empty -->")
                      : publication.status === "duplicate"
                        ? marker.replace(" -->", ":duplicate -->")
                        : marker
                  yield* io(() =>
                    publishLocked(
                      file,
                      input,
                      plan.flush.previousHash,
                      [
                        previous.trimEnd(),
                        publishedMarker,
                        ...(publication.status === "accepted" && publication.content ? [publication.content] : []),
                      ]
                        .filter(Boolean)
                        .join("\n\n") + "\n",
                    ),
                  )
                }),
              )
              // Order the final short commit against durable prompt admission after acquiring storage leases.
              yield* automatic ? admission.fence(automatic.claim, commit) : commit
            }),
            plan.generation,
          )
          return {
            status: publication.status === "accepted" ? "completed" : "no_work",
            processed: publication.status === "accepted" ? 1 : 0,
            committed: true,
          } satisfies MemoryOperation.Result
        })
      if (recover) return yield* publish(recover)
      const model = yield* models.resolve({ ...session, agent: AgentV2.ID.make(last.agent), model: modelRef })
      yield* validate
      const output = { text: "", finished: false }
      yield* llm
        .stream(
          LLM.request({
            model,
            system: [SystemPart.make(MemoryFlush.prompt)],
            messages: [
              Message.user(
                JSON.stringify({
                  previous: plan.flush.previous,
                  conversation: plan.sources.map((source) => source.transcript),
                }),
              ),
            ],
            tools: [],
            toolChoice: "none",
          }),
        )
        .pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (event.type === "provider-error") return yield* fail("Legacy flush provider failed")
              if (event.type === "text-delta") {
                output.text += event.text
                if (Buffer.byteLength(output.text) > 128 * 1024)
                  return yield* fail("Legacy flush output exceeds its bound", "invalid")
              }
              if (event.type === "finish") output.finished = event.reason === "stop"
            }),
          ),
          Effect.timeout("120 seconds"),
        )
      if (!output.finished) return yield* fail("Legacy flush did not finish", "invalid")
      const parsed = MemoryFlush.response(output.text, plan.flush.maxChars)
      if (parsed.status === "rejected") return yield* fail("Legacy flush returned invalid Markdown", "invalid")
      yield* validate
      const duplicate =
        parsed.status === "accepted" &&
        (Boolean(settings.memory.embedding?.model?.trim()) ||
          (settings.memory.embedding?.provider !== undefined && settings.memory.embedding.provider !== "api"))
          ? yield* Effect.gen(function* () {
              const cacheFile = path.join(
                scope.root,
                plan.generation === "initial" ? "search.sqlite" : `search-${plan.generation}.sqlite`,
              )
              for (const source of plan.sources) {
                yield* access(plan.sessionID, source.agent, cacheFile)
                yield* accessAction(plan.sessionID, source.agent, `${cacheFile}-wal`, ["edit"])
                yield* accessAction(plan.sessionID, source.agent, `${cacheFile}-shm`, ["edit"])
              }
              const authorityFailure: { error?: SessionMemoryModeNative.Failure } = {}
              const search = yield* MemorySearch.make({
                ...input,
                search: settings.memory.search,
                embedding: () =>
                  Effect.gen(function* () {
                    yield* validate.pipe(
                      Effect.tapError((err) =>
                        Effect.sync(() => {
                          authorityFailure.error = err instanceof Failure ? err : fail("Legacy Memory authority changed", "changed")
                        }),
                      ),
                      Effect.mapError((err) =>
                        new MemorySearch.MemoryError({
                          message: err instanceof Failure ? err.message : "Legacy Memory authority changed",
                        }),
                      ),
                    )
                    return yield* embedding.resolve({
                      embedding: settings.memory.embedding,
                      fallbackProviderID: modelRef.providerID,
                    })
                  }),
                watch: false,
                joinIO: true,
              })
              const outcome = yield* search
                .semanticDuplicate(
                  {
                    content: parsed.content,
                    threshold: options.semantic_dedup_threshold ?? 0.92,
                  },
                  (files) =>
                    Effect.gen(function* () {
                      yield* validate
                      yield* authorizeRead(search.accessPaths(files))
                    }).pipe(
                      Effect.tapError((err) =>
                        Effect.sync(() => {
                          authorityFailure.error = err instanceof Failure ? err : fail("Legacy Memory authority changed", "changed")
                        }),
                      ),
                      Effect.mapError((err) =>
                        new MemorySearch.MemoryError({
                          message: err instanceof Failure ? err.message : "Legacy Memory authority changed",
                        }),
                      ),
                    ),
                )
                .pipe(
                  Effect.mapError(
                    (err) => authorityFailure.error ?? fail(err.message, "changed"),
                  ),
                )
              return outcome.duplicate ? outcome : undefined
            }).pipe(Effect.scoped)
          : undefined
      yield* validate
      const publication =
        parsed.status === "empty"
          ? Publication.make({
              operationID,
              planHash,
              status: "empty",
            })
          : duplicate
            ? Publication.make({
                operationID,
                planHash,
                status: "duplicate",
                duplicate: {
                  embeddingIdentity: duplicate.embeddingIdentity,
                  threshold: duplicate.threshold,
                  similarity: duplicate.similarity,
                  neighborPath: duplicate.neighborPath,
                  neighborStartLine: duplicate.neighborStartLine,
                  neighborFileHash: duplicate.neighborFileHash,
                  neighborChunkHash: duplicate.neighborChunkHash,
                  candidateHash: duplicate.candidateHash,
                },
              })
            : Publication.make({
                operationID,
                planHash,
                status: "accepted",
                content: parsed.content,
              })
      if (prepared) {
        yield* prepared(publication).pipe(
          Effect.mapError((cause) =>
            cause instanceof Failure ? cause : fail("Legacy flush publication state could not be saved"),
          ),
        )
      }
      return yield* publish(publication)
    }).pipe(
      Effect.provideService(
        PermissionV2.Inherited,
        new Map(inherited).set(plan.sessionID, [
          ...(inherited.get(plan.sessionID) ?? []),
          ...plan.sources.flatMap((source) => source.authority),
        ]),
      ),
    )
  }, Effect.scoped)
  return { prepare, prepareAutomatic, execute, prepareCheckpoint, executeCheckpoint }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/MemoryLegacyNative") {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    SessionInputAdmission.node,
    Config.node,
    Database.node,
    MemoryEmbedding.node,
    Location.node,
    Global.node,
    SessionStore.node,
    SessionManagedChild.node,
    SessionGoal.node,
    SessionMemoryModeNative.node,
    PermissionV2.node,
    LocationMutation.node,
    SessionRunnerModel.node,
    llmClient,
  ],
})

async function read(file: string, input: { directory: string; home: string; projectID: string }) {
  const home = await realpath(input.home)
  const canonical = path.join(home, path.relative(input.home, file))
  const root = path.dirname(WorkspaceMemory.file(input.directory, home, input))
  const saved = await MemoryFiles.read(
    canonical,
    { path: root, alias: path.dirname(WorkspaceMemory.file(input.directory, input.home, input)), source: "workspace" },
    1_000_001,
  ).catch((cause: unknown) => {
    if (MemoryFiles.missing(cause)) return undefined
    throw cause
  })
  if (saved && saved.size > 1_000_000) throw new Error("Legacy Memory log exceeds its supported bound")
  return saved?.bytes.toString("utf8") ?? ""
}
async function publishLocked(
  file: string,
  input: { directory: string; home: string; projectID: string },
  expected: string,
  content: string,
) {
  if (Buffer.byteLength(content) > 1_000_000) throw new Error("Legacy Memory log exceeds its supported bound")
  const home = await realpath(input.home)
  for (const folder of [
    path.join(home, ".grok"),
    path.join(home, ".grok", "memory"),
    path.dirname(path.dirname(file)),
    path.dirname(file),
  ]) {
    const stat = await lstat(folder).catch((cause: unknown) => {
      if (MemoryFiles.missing(cause)) return undefined
      throw cause
    })
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
      throw new Error("Legacy Memory directories cannot be redirected")
  }
  if (MemoryV2.hash(await read(file, input)) !== expected) throw new Error("Legacy Memory changed before publication")
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  if ((await realpath(path.dirname(file))) !== path.join(home, path.relative(input.home, path.dirname(file))))
    throw new Error("Legacy Memory directory was redirected")
  const temporary = `${file}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { flag: "wx", mode: 0o600 })
  try {
    if (MemoryV2.hash(await read(file, input)) !== expected) throw new Error("Legacy Memory changed before publication")
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
}

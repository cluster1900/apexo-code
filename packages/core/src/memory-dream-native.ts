export * as MemoryDreamNative from "./memory-dream-native"

import path from "node:path"
import { realpath } from "node:fs/promises"
import { LLM, LLMClient, Message, SystemPart } from "@apexo/llm"
import { Model } from "@apexo/schema/model"
import { MemoryOperation } from "@apexo/schema/memory-operation"
import { Cause, Clock, Context, Effect, Layer, Schema, Stream } from "effect"
import { AgentV2 } from "./agent"
import { Config } from "./config"
import { ConfigMemory } from "./config/memory"
import { Database } from "./database/database"
import { makeLocationNode } from "./effect/app-node"
import { llmClient } from "./effect/app-node-platform"
import { Global } from "./global"
import { Location } from "./location"
import { LocationMutation } from "./location-mutation"
import { MemoryDream } from "./memory-dream"
import { MemoryMaintenance } from "./memory-maintenance"
import { MemoryTranscriptNative } from "./memory-transcript-native"
import { MemoryV2 } from "./memory-v2"
import { ModelV2 } from "./model"
import { PermissionV2 } from "./permission"
import { PermissionAuthority } from "./permission/authority"
import { ProviderV2 } from "./provider"
import { SessionExecutionPolicy } from "./session/execution-policy"
import { SessionGoal } from "./session/goal"
import { SessionGoalUsage } from "./session/goal-usage"
import { SessionInputAdmission } from "./session/input-admission"
import { SessionLifecycle } from "./session/lifecycle"
import { SessionIncarnation } from "./session/incarnation"
import { SessionManagedChild } from "./session/managed-child"
import { SessionMemoryModeNative } from "./session/memory-mode-native"
import { SessionRunnerModel } from "./session/runner/model"
import { SessionSchema } from "./session/schema"
import { SessionStore } from "./session/store"
import { Flock } from "./util/flock"
import { WorkspaceMemory } from "./workspace-memory"

const Snapshot = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
  signature: Schema.String,
  modified: Schema.Number,
})
export const Plan = Schema.Struct({
  sessionID: SessionSchema.ID,
  createdEventID: Schema.String,
  revision: Schema.String,
  generation: Schema.String,
  backend: Schema.Literal("legacy"),
  sources: Schema.Array(MemoryTranscriptNative.Source),
  dream: Schema.Struct({
    manual: Schema.Boolean,
    agent: Schema.String,
    model: Model.Ref,
    authority: Schema.Array(PermissionAuthority.Snapshot),
    existing: Schema.optionalKey(Snapshot),
    state: Schema.optionalKey(Snapshot),
    files: Schema.Array(Snapshot),
    message: Schema.String,
  }),
})
export type Plan = typeof Plan.Type
export const Publication = Schema.Struct({
  operationID: MemoryOperation.ID,
  planHash: Schema.String,
  memory: Schema.optionalKey(Schema.String),
  journal: Schema.String,
  status: Schema.Literals(["completed", "no_work"]),
  processed: Schema.Number,
  cleanup: Schema.optionalKey(Schema.Struct({ version: Schema.Literal(1), cutoff: Schema.Number })),
})
export type Publication = typeof Publication.Type
const Failure = SessionMemoryModeNative.Failure
const fail = (message: string, code: SessionMemoryModeNative.Failure["code"] = "storage") =>
  new Failure({ code, message })
const io = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => fail("Legacy Dream storage changed or is unavailable") }).pipe(
    Effect.uninterruptible,
  )

const make = Effect.gen(function* () {
  const admission = yield* SessionInputAdmission.Service
  const config = yield* Config.Service
  const database = yield* Database.Service
  const location = yield* Location.Service
  const global = yield* Global.Service
  const sessions = yield* SessionStore.Service
  const managed = yield* SessionManagedChild.Service
  const goals = yield* SessionGoal.Service
  const modes = yield* SessionMemoryModeNative.Service
  const permission = yield* PermissionV2.Service
  const mutation = yield* LocationMutation.Service
  const models = yield* SessionRunnerModel.Service
  const agents = yield* AgentV2.Service
  const llm = yield* LLMClient.Service
  const documents = (yield* config.entries()).filter((entry) => entry.type === "document")
  const settings = {
    memory: documents.reduce<typeof ConfigMemory.Info.Type>((value, entry) => ({ ...value, ...entry.info.memory }), {}),
    memory_v2: documents.reduce((value, entry) => ({ ...value, ...entry.info.memory_v2 }), {}),
  }
  const input = { directory: location.directory, home: global.home, projectID: location.project.id }
  const scope = WorkspaceMemory.maintenance(input.directory, input.home, input)
  const paths = MemoryDream.paths(input)
  const placement = Effect.fnUntraced(function* (id: SessionSchema.ID, manual: boolean) {
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
    if (
      !snapshot.info.enabled ||
      snapshot.backend !== "legacy" ||
      (!manual && settings.memory.dream?.enabled === false)
    )
      return yield* fail("Legacy Dream is not enabled", "disabled")
    return { session, snapshot }
  })
  const access = Effect.fnUntraced(function* (id: SessionSchema.ID, agent: string, files: readonly string[]) {
    const inspect = yield* permission.inspect(id, AgentV2.ID.make(agent))
    for (const file of files) {
      const resolved = yield* mutation.resolve({ path: file, kind: "file" })
      if (
        resolved.externalDirectory &&
        inspect("external_directory", [resolved.externalDirectory.resource]) !== "allow"
      )
        return yield* fail("Legacy Dream scope access is not allowed", "forbidden")
      const resources = [
        ...new Set(
          [file, resolved.canonical].flatMap((value) => {
            const relative = path.relative(location.directory, value)
            return [value, ...(relative.startsWith("..") || path.isAbsolute(relative) ? [] : [relative])]
          }),
        ),
      ]
      if (inspect("read", resources) !== "allow" || inspect("edit", resources) !== "allow")
        return yield* fail("Legacy Dream source and destination access is not allowed", "forbidden")
    }
  })
  const schedule = Effect.fn("MemoryDreamNative.schedule")(function* (id: SessionSchema.ID) {
    const current = yield* placement(id, false)
    return {
      sessionID: id,
      revision: current.snapshot.revision,
      generation: yield* io(() => MemoryMaintenance.revision(scope)),
      interval: (settings.memory.dream?.check_interval_secs ?? 3600) * 1000,
    }
  })
  const prepare = Effect.fn("MemoryDreamNative.prepare")(function* (id: SessionSchema.ID, manual: boolean) {
    const current = yield* placement(id, manual)
    const createdEventID = yield* SessionIncarnation.created(database.db, id)
    if (!createdEventID) return yield* fail("Session creation proof is unavailable", "changed")
    const agent = yield* agents.select(current.session.agent)
    const model = yield* models.resolve({ ...current.session, agent: agent.id })
    const generation = yield* io(() => MemoryMaintenance.revision(scope))
    const files = yield* io(() => MemoryDream.files(input, id))
    if (files.length > 1024) return yield* fail("Legacy Dream exceeds its 1024 candidate-file bound", "invalid")
    yield* access(id, agent.id, [paths.file, paths.state, ...files])
    const state = yield* io(() => MemoryDream.snapshot(paths.state, input, 1_000_000))
    const previous = yield* Effect.try({
      try: () => MemoryDream.state(state),
      catch: () => fail("Invalid legacy Dream state"),
    })
    if (
      !manual &&
      (yield* Clock.currentTimeMillis) - previous.completed < (settings.memory.dream?.min_hours ?? 24) * 3600_000
    )
      return yield* fail("Automatic legacy Dream is not yet eligible", "disabled")
    const existing = yield* io(() => MemoryDream.snapshot(paths.file, input, 1_000_000))
    const selected: MemoryDream.Snapshot[] = []
    for (const file of files) {
      const snapshot = yield* io(() => MemoryDream.snapshot(file, input, 64_000))
      if (!snapshot?.content.trim() || (!manual && previous.processed[path.basename(file)] === snapshot.signature))
        continue
      selected.push(snapshot)
      if (selected.length >= 32 || Buffer.byteLength(MemoryDream.message(existing, selected).content) >= 32_000) break
    }
    const count = new Set(
      selected.map((item) =>
        path
          .basename(item.path, ".md")
          .replace(/^\d{4}-\d{2}-\d{2}-/, "")
          .replace(/-flush$/, ""),
      ),
    ).size
    if (!manual && count < (settings.memory.dream?.min_sessions ?? 5))
      return yield* fail("Automatic legacy Dream has too few source Sessions", "disabled")
    const message = MemoryDream.message(existing, selected)
    const fresh = yield* placement(id, manual)
    if (
      fresh.snapshot.revision !== current.snapshot.revision ||
      (yield* SessionIncarnation.created(database.db, id)) !== createdEventID ||
      (yield* io(() => MemoryMaintenance.revision(scope))) !== generation
    )
      return yield* fail("Legacy Dream changed before admission", "changed")
    return Plan.make({
      sessionID: id,
      createdEventID,
      revision: current.snapshot.revision,
      generation,
      backend: "legacy",
      sources: [],
      dream: {
        manual,
        agent: agent.id,
        model: { providerID: ProviderV2.ID.make(model.provider), id: ModelV2.ID.make(model.id) },
        authority: yield* permission.capture(id, agent.id),
        ...(existing ? { existing } : {}),
        ...(state ? { state } : {}),
        files: message.processed,
        message: message.content,
      },
    })
  })
  const execute = Effect.fn("MemoryDreamNative.execute")(function* (
    plan: Plan,
    ownership: {
      operationID: MemoryOperation.ID
      recover?: Publication
      prepared: (publication: Publication) => Effect.Effect<void, unknown>
      automatic?: { readonly claim: SessionLifecycle.Claim; readonly valid: () => boolean }
    },
  ) {
    const inherited = yield* PermissionV2.Inherited
    return yield* Effect.gen(function* () {
      const canonicalHome = yield* io(() => realpath(input.home))
      const canonical = path.join(canonicalHome, path.relative(input.home, paths.root))
      yield* Flock.effect(`${canonical}.dream`, {
        dir: path.join(canonicalHome, ".grok", "memory", ".locks"),
        timeoutMs: 300000,
        deadOwnerOnly: true,
        reclaimDeadOwner: true,
      })
      const validate = Effect.gen(function* () {
        if (ownership.automatic && !ownership.automatic.valid()) return yield* Effect.interrupt
        const current = yield* placement(plan.sessionID, plan.dream.manual)
        const selected = yield* agents.select(current.session.agent)
        if (selected.id !== plan.dream.agent)
          return yield* fail("Legacy Dream selected Agent changed after admission", "changed")
        if (
          current.snapshot.revision !== plan.revision ||
          (yield* SessionIncarnation.created(database.db, plan.sessionID)) !== plan.createdEventID
        )
          return yield* fail("Legacy Dream Session authority changed", "changed")
        if (
          (plan.dream.existing?.path !== undefined && plan.dream.existing.path !== paths.file) ||
          (plan.dream.state?.path !== undefined && plan.dream.state.path !== paths.state) ||
          plan.dream.files.some(
            (file) =>
              path.dirname(file.path) !== paths.sessions ||
              !file.path.endsWith(".md") ||
              file.path.endsWith(`-${plan.sessionID}.md`) ||
              file.path.endsWith(`-${plan.sessionID}-flush.md`),
          )
        )
          return yield* fail("Legacy Dream source identity changed", "changed")
        yield* access(plan.sessionID, plan.dream.agent, [
          paths.file,
          paths.state,
          ...plan.dream.files.map((file) => file.path),
        ])
        return current.session
      })
      const session = yield* validate
      if ((yield* io(() => MemoryMaintenance.revision(scope))) !== plan.generation)
        return { status: "conflict", reason: "scope_changed" } satisfies MemoryOperation.Result
      if (!plan.dream.files.length) return { status: "no_work", processed: 0 } satisfies MemoryOperation.Result
      const planHash = MemoryV2.hash(JSON.stringify(plan))
      const publish = (publication: Publication) =>
        MemoryMaintenance.writeEffect(
          scope,
          Effect.gen(function* () {
            yield* Flock.effect(path.join(canonical, "MEMORY.md"), {
              dir: path.join(canonicalHome, ".grok", "memory", ".locks"),
              deadOwnerOnly: true,
            })
            // Cleanup is optional settlement after successful output. A busy source is retained,
            // and no source lease acquisition may wait while prompt admission is fenced.
            const policy = publication.cleanup
            const cleanup =
              publication.status === "completed" && policy?.version === 1
                ? yield* Effect.forEach(
                    plan.dream.files.filter((file) => policy.cutoff - file.modified >= 300_000),
                    (file) =>
                      Flock.effect(path.join(canonicalHome, path.relative(input.home, file.path)), {
                        dir: path.join(canonicalHome, ".grok", "memory", ".locks"),
                        timeoutMs: 0,
                        deadOwnerOnly: true,
                      }).pipe(
                        Effect.as(file),
                        Effect.catchCause((cause) =>
                          Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.succeed(undefined),
                        ),
                      ),
                  ).pipe(Effect.map((files) => files.filter((file) => file !== undefined)))
                : []
            const commit = modes.commit(
              plan.sessionID,
              settings,
              plan.revision,
              Effect.gen(function* () {
                yield* validate
                if (
                  publication.planHash !== planHash ||
                  publication.processed !== plan.dream.files.length ||
                  Buffer.byteLength(publication.memory ?? "") > 1_000_000 ||
                  Buffer.byteLength(publication.journal) > 1_000_000
                )
                  return yield* fail("Legacy Dream publication receipt is invalid", "changed")
                yield* io(() =>
                  MemoryDream.publish(input, {
                    ...(plan.dream.existing ? { existing: plan.dream.existing } : {}),
                    ...(plan.dream.state ? { state: plan.dream.state } : {}),
                    ...(publication.memory === undefined ? {} : { memory: publication.memory }),
                    journal: publication.journal,
                    ...(publication.cleanup && publication.status === "completed"
                      ? { cleanup: { files: cleanup, cutoff: publication.cleanup.cutoff } }
                      : {}),
                  }),
                )
                return {
                  status: publication.status,
                  processed: publication.processed,
                  committed: true,
                } satisfies MemoryOperation.Result
              }),
            )
            // Acquire storage leases first; only final publication orders against durable input admission.
            return yield* ownership.automatic ? admission.fence(ownership.automatic.claim, commit) : commit
          }),
          plan.generation,
        )
      if (ownership.recover) return yield* publish(ownership.recover)
      const currentMemory = yield* io(() => MemoryDream.snapshot(paths.file, input, 1_000_000))
      const currentState = yield* io(() => MemoryDream.snapshot(paths.state, input, 1_000_000))
      if (
        currentMemory?.signature !== plan.dream.existing?.signature ||
        currentState?.signature !== plan.dream.state?.signature
      )
        return yield* fail("Legacy Dream destination changed after admission", "changed")
      for (const file of plan.dream.files)
        if ((yield* io(() => MemoryDream.snapshot(file.path, input, 64_000)))?.signature !== file.signature)
          return yield* fail("Legacy Dream source changed after admission", "changed")
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
            system: [SystemPart.make(MemoryDream.prompt)],
            messages: [Message.user(plan.dream.message)],
            tools: [],
            toolChoice: "none",
          }),
        )
        .pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (event.type === "provider-error") return yield* fail("Legacy Dream provider failed")
              if (event.type === "text-delta") {
                output.text += event.text
                if (Buffer.byteLength(output.text) > 128 * 1024)
                  return yield* fail("Legacy Dream output exceeds its bound", "invalid")
              }
              if (event.type === "finish") output.finished = event.reason === "stop"
            }),
          ),
          Effect.timeout("120 seconds"),
        )
      if (!output.finished) return yield* fail("Legacy Dream did not finish", "invalid")
      const parsed = MemoryDream.response(output.text)
      if (parsed.status === "rejected") return yield* fail("Legacy Dream returned invalid Markdown", "invalid")
      const previous = yield* Effect.try({
        try: () => MemoryDream.state(plan.dream.state),
        catch: () => fail("Invalid legacy Dream state"),
      })
      const prior = plan.dream.existing?.content.trim() ?? ""
      const retained = MemoryDream.tail(prior, 16_000)
      const marker = `<!-- apexo-native-dream:${ownership.operationID}:${planHash} -->`
      const publication = Publication.make({
        operationID: ownership.operationID,
        planHash,
        ...(parsed.status === "accepted"
          ? {
              memory: `${parsed.content}${retained ? `\n\n## Retained prior memory\n\n${retained}` : ""}\n\n${marker}\n`,
            }
          : plan.dream.existing
            ? { memory: plan.dream.existing.content }
            : {}),
        journal: JSON.stringify({
          completed: yield* Clock.currentTimeMillis,
          processed: {
            ...previous.processed,
            ...Object.fromEntries(plan.dream.files.map((file) => [path.basename(file.path), file.signature])),
          },
          native: { operationID: ownership.operationID, planHash },
        }),
        status: parsed.status === "accepted" ? "completed" : "no_work",
        processed: plan.dream.files.length,
        ...(parsed.status === "accepted"
          ? { cleanup: { version: 1 as const, cutoff: yield* Clock.currentTimeMillis } }
          : {}),
      })
      if (Buffer.byteLength(publication.memory ?? "") > 1_000_000 || Buffer.byteLength(publication.journal) > 1_000_000)
        return yield* fail("Legacy Dream publication exceeds its bound", "invalid")
      yield* ownership.prepared(publication)
      return yield* publish(publication)
    }).pipe(
      Effect.provideService(
        PermissionV2.Inherited,
        new Map(inherited).set(plan.sessionID, [...(inherited.get(plan.sessionID) ?? []), ...plan.dream.authority]),
      ),
    )
  }, Effect.scoped)
  return { prepare, execute, schedule }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/MemoryDreamNative") {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    SessionInputAdmission.node,
    Config.node,
    Database.node,
    Location.node,
    Global.node,
    SessionStore.node,
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

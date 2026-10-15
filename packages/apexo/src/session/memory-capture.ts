import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { randomUUID } from "node:crypto"
import path from "node:path"
import {
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Queue,
  Schema,
  Scope,
  ScopedCache,
  Semaphore,
  Stream,
} from "effect"
import { filesystem } from "@apexo/core/effect/app-node-platform"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { EventV2 } from "@apexo/core/event"
import { Global } from "@apexo/core/global"
import { Database } from "@apexo/core/database/database"
import { MemoryCaptureSource } from "@apexo/core/memory-capture-source"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryTranscript } from "@apexo/core/memory-transcript"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { MemoryWork } from "@apexo/schema/memory-work"
import { MemoryCaptureEvent } from "@apexo/schema/memory-capture-event"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { SessionMemoryBackend } from "./memory-backend"
import { SessionMemoryMaintenance } from "./memory-maintenance"
import { SessionMemoryMode } from "./memory-mode"
import { SessionMemoryV2Dream } from "./memory-v2-dream"
import { SessionID } from "./schema"
import { Session } from "./session"

export interface Interface {
  readonly schedule: (id: SessionID, interrupted?: boolean) => Effect.Effect<void>
  readonly resume: (id: SessionID, retry?: boolean) => Effect.Effect<void>
  readonly flush: (id: SessionID) => Effect.Effect<MemoryWork.Result>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionMemoryCapture") {}
class ExtractionFailure extends Schema.TaggedErrorClass<ExtractionFailure>()("MemoryExtractionFailure", {
  reason: Schema.Literals(["source", "provider", "output"]),
}) {}
type Wake = "admission" | "resume" | "retry"
type Worker = { queue: Queue.Queue<Wake>; fiber: Fiber.Fiber<void>; status: { running: boolean } }

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.Service
    const database = yield* Database.Service
    const sources = MemoryCaptureSource.make(database.db)
    const sessions = yield* Session.Service
    const config = yield* Config.Service
    const backend = yield* SessionMemoryBackend.Service
    const maintenance = yield* SessionMemoryMaintenance.Service
    const mode = yield* SessionMemoryMode.Service
    const dream = yield* SessionMemoryV2Dream.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const global = yield* Global.Service
    const fs = yield* FileSystem.FileSystem
    const events = yield* EventV2Bridge.Service
    const owner = randomUUID()
    const notify = Effect.fn("SessionMemoryCapture.notify")(
      function* (
        id: SessionID,
        activity: MemoryCaptureEvent.Info["activity"],
        job?: MemoryCapture.Job,
        memories?: MemoryCaptureEvent.Entry[],
      ) {
        if (
          !(yield* config.get()).memory_v2?.capture_status_enabled ||
          !(yield* backend.get(id)).capture ||
          !(yield* mode.get(id)).enabled
        )
          return
        yield* events.publish(MemoryCaptureEvent.Activity, {
          sessionID: id,
          activity,
          fromTurn: job?.from_turn ?? 0,
          throughTurn: job?.through_turn ?? 0,
          attempt: job?.attempt ?? 0,
          ...(memories?.length ? { memories } : {}),
        })
      },
      Effect.catchCause(() => Effect.logWarning("Memory V2 capture notification failed")),
    )
    const state = yield* InstanceState.make(() =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const scope = yield* Scope.Scope
        const workers = new Map<SessionID, Worker>()
        const lock = yield* Semaphore.make(1)
        const compactIndex = (yield* config.get()).memory_v2?.compact_index_enabled
        // A repaired filesystem must be reopenable without disposing the project.
        // Failed entries expire immediately and their partial resources are closed
        // before retry; a successful store remains scoped to this instance.
        const store = yield* ScopedCache.makeWith({
          capacity: 1,
          timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
          lookup: (_: undefined) =>
            MemoryCapture.make(
              { home: global.home, directory: ctx.directory, projectID: ctx.project.id },
              { compactIndex },
            ),
        })
        const unsubscribe = yield* events.listen((event) =>
          Effect.gen(function* () {
            if (event.type !== Session.Event.Deleted.type) return
            const id = (event.data as EventV2.Data<typeof Session.Event.Deleted>).sessionID
            const worker = workers.get(id)
            workers.delete(id)
            if (worker) yield* Fiber.interrupt(worker.fiber)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        return { scope, workers, lock, store: ScopedCache.get(store, undefined) }
      }),
    )
    const adopt = (id: SessionID, store: Effect.Success<ReturnType<typeof MemoryCapture.make>>) =>
      lifecycle.use(
        id,
        Effect.gen(function* () {
          const incarnation = yield* sources.stamp(id)
          if (incarnation)
            yield* store.adopt(
              id,
              incarnation,
              sessions
                .messages({ sessionID: id })
                .pipe(Effect.map((messages) => MemoryTranscript.turns(messages, true).map((turn) => turn.source))),
            )
          return incarnation
        }),
      )
    const permitted = Effect.fn("SessionMemoryCapture.permitted")(function* (
      id: SessionID,
      agentName: string,
      files: string[] = [],
    ) {
      const session = yield* sessions.get(id)
      const agent = yield* agents.get(agentName)
      if (!agent || session.parentID) return false
      const ctx = yield* InstanceState.context
      const roots = [global.home, yield* fs.realPath(global.home)].map((home) =>
        MemoryV2.directory({ home, directory: ctx.directory, projectID: ctx.project.id }),
      )
      return roots.every((root) =>
        ["memory_state.sqlite", "MEMORY.md", ...files].every((relative) =>
          ["read", "edit"].every(
            (action) =>
              Permission.evaluate(action, path.join(root, relative), agent.permission, session.permission ?? [])
                .action === "allow",
          ),
        ),
      )
    })
    const drain = Effect.fn("SessionMemoryCapture.drain")(function* (
      id: SessionID,
      queue: Queue.Queue<Wake>,
      reason: Wake,
    ) {
      if (!(yield* backend.get(id)).capture) return
      yield* mode.run(id, (revision) =>
        Effect.gen(function* () {
          const data = yield* InstanceState.get(state)
          const store = yield* data.store
          yield* adopt(id, store)
          yield* store.reconcile
          // Admission may finish notifying after another drain already claimed it.
          // Such a late wake is not an explicit request to retry failed work.
          if (reason === "admission" && !(yield* store.jobs(id)).some((job) => job.status === "pending")) return
          while ((yield* backend.get(id)).capture) {
            // The next claim already sees durable admissions behind these wakes.
            // Leaving them queued would retry a failed batch a second time.
            yield* Queue.clear(queue)
            const lease = yield* store.claim({
              owner,
              sessionID: id,
              now: yield* Clock.currentTimeMillis,
              duration: 5 * 60_000,
            })
            if (!lease) {
              if ((yield* store.jobs(id)).some((job) => job.status === "running")) {
                yield* Effect.sleep("1 second")
                continue
              }
              yield* store.reconcile
              yield* maintenance.run(id)
              yield* dream.schedule(id)
              return
            }
            yield* notify(id, "running", lease.job)
            const result = yield* Effect.gen(function* () {
              if (lease.job.attempt > 3) {
                yield* store.fail(lease, "Capture exceeded three attempts", true)
                yield* notify(id, "failed", lease.job)
                return
              }
              const source = yield* Effect.try({
                try: () => MemoryTranscript.decode(lease.job.source),
                catch: () => new ExtractionFailure({ reason: "source" }),
              })
              // New jobs retain durable incarnation proof even after compaction. Historical
              // unstamped jobs require exact current snapshot correspondence before extraction.
              if (
                !(yield* sources.validate(
                  id,
                  source,
                  sessions
                    .messages({ sessionID: id })
                    .pipe(
                      Effect.map((history) =>
                        MemoryTranscript.turns(history, true).some((turn) => turn.source === lease.job.source),
                      ),
                    ),
                  lease.job.incarnation,
                ))
              ) {
                yield* store.fail(lease, "Capture source no longer belongs to this Session transcript", true)
                yield* notify(id, "failed", lease.job)
                return
              }
              if (!(yield* permitted(id, source.user.agent))) {
                yield* store.fail(lease, "Memory permission denied", true)
                yield* notify(id, "failed", lease.job)
                return
              }
              const session = yield* sessions.get(id)
              const agent = yield* agents.get(source.user.agent)
              if (!agent) {
                yield* store.fail(lease, "Capture agent is unavailable", true)
                yield* notify(id, "failed", lease.job)
                return
              }
              const override = (yield* config.get()).memory_v2?.capture_model?.trim()
              const selected = override
                ? Provider.parseModel(override.includes("/") ? override : `${source.user.model.providerID}/${override}`)
                : source.user.model
              const model = yield* provider.getModel(selected.providerID, selected.modelID)
              const output = { text: "", finished: false }
              yield* llm
                .stream({
                  user: {
                    id: source.user.id,
                    sessionID: source.user.sessionID,
                    role: "user",
                    time: source.user.time,
                    agent: source.user.agent,
                    model: source.user.model,
                  },
                  sessionID: id,
                  model,
                  agent,
                  permission: session.permission,
                  tools: {},
                  toolChoice: "none",
                  outputSchema: MemoryCapture.outputSchema,
                  retries: 0,
                  system: [MemoryCapture.prompt],
                  messages: [{ role: "user", content: source.transcript }],
                })
                .pipe(
                  Stream.runForEach((event) =>
                    Effect.gen(function* () {
                      if (event.type === "provider-error") return yield* new ExtractionFailure({ reason: "provider" })
                      if (event.type === "text-delta") {
                        output.text += event.text
                        if (Buffer.byteLength(output.text) > 2 * 1024 * 1024)
                          return yield* new ExtractionFailure({ reason: "output" })
                      }
                      if (event.type === "finish") output.finished = event.reason === "stop"
                    }),
                  ),
                )
              if (!output.finished) return yield* new ExtractionFailure({ reason: "output" })
              const now = yield* Clock.currentTimeMillis
              const outcome = yield* Effect.try({
                try: () => MemoryCapture.parse(output.text, `${model.providerID}/${model.id}`, Math.floor(now / 1000)),
                catch: () => new ExtractionFailure({ reason: "output" }),
              })
              const paths = MemoryCapture.prepare(lease.job, outcome).files.map((file) => file.path)
              if (!(yield* permitted(id, source.user.agent, paths))) {
                yield* store.fail(lease, "Memory permission denied", true)
                yield* notify(id, "failed", lease.job)
                return
              }
              yield* mode.commit(
                id,
                revision,
                Effect.gen(function* () {
                  const current = yield* backend.get(id)
                  if (!current.capture || (lease.job.is_exposed === 1 && !current.expose))
                    return yield* new SessionMemoryMode.Disabled()
                  const committed = yield* store.commit(lease, outcome, yield* Clock.currentTimeMillis)
                  const prepared = MemoryCapture.prepare(lease.job, outcome)
                  if (!(yield* permitted(id, source.user.agent, paths))) {
                    yield* notify(id, outcome.outcome === "noop" ? "no_op" : "completed", lease.job)
                    return
                  }
                  yield* notify(
                    id,
                    outcome.outcome === "noop" ? "no_op" : "completed",
                    lease.job,
                    outcome.outcome === "noop"
                      ? []
                      : outcome.observations.flatMap((observation, index) => {
                          const file = path.join(store.root.path, prepared.files[index]!.path)
                          if (!committed.files.includes(file)) return []
                          return [
                            {
                              statement: observation.statement,
                              ...(observation.body ? { body: observation.body } : {}),
                              path: file,
                            },
                          ]
                        }),
                  )
                }),
              )
            }).pipe(
              Effect.timeout("2 minutes"),
              Effect.onInterrupt(() => store.fail(lease, "Capture interrupted").pipe(Effect.ignore)),
              Effect.result,
            )
            if (result._tag === "Failure") {
              const terminal =
                lease.job.attempt >= 3 ||
                (result.failure instanceof ExtractionFailure && result.failure.reason === "source")
              const failure = result.failure instanceof ExtractionFailure ? result.failure.reason : "request_or_storage"
              yield* store.fail(lease, `Capture failed: ${failure}`, terminal).pipe(Effect.ignore)
              yield* notify(id, terminal ? "failed" : "retry", lease.job)
              if (!(yield* store.jobs(id)).some((job) => job.status === "pending")) {
                yield* store.reconcile
                return
              }
            }
          }
        }),
      )
    })
    const wake = Effect.fn("SessionMemoryCapture.wake")(
      function* (id: SessionID, reason: Wake) {
        const data = yield* InstanceState.get(state)
        yield* data.lock.withPermit(
          Effect.gen(function* () {
            const current = data.workers.get(id)
            if (current) {
              // Reading status must not consume another retry. Explicit flush
              // joins an existing drain; new durable admissions may queue it.
              if (reason === "resume" || (reason === "retry" && current.status.running)) return
              current.status.running = true
              yield* Queue.offer(current.queue, reason)
              return
            }
            // A one-slot mailbox coalesces wakes without losing admission that races
            // the previous drain's final empty check.
            const queue = yield* Queue.sliding<Wake>(1)
            const status = { running: true }
            const fiber = yield* Queue.take(queue).pipe(
              Effect.flatMap((reason) =>
                drain(id, queue, reason).pipe(
                  Effect.catchTag("SessionMemoryDisabled", () => Effect.void),
                  Effect.catchCause(() =>
                    notify(id, "failed").pipe(Effect.andThen(Effect.logWarning("Memory V2 capture worker failed"))),
                  ),
                  Effect.ensuring(Effect.sync(() => (status.running = Queue.sizeUnsafe(queue) > 0))),
                ),
              ),
              Effect.forever,
              (effect) => lifecycle.run(id, effect),
              Effect.catchTag("SessionLifecycle.Closed", () => Effect.void),
              Effect.ensuring(
                Effect.sync(() => {
                  if (data.workers.get(id)?.status === status) data.workers.delete(id)
                }),
              ),
              Effect.forkIn(data.scope),
            )
            data.workers.set(id, { queue, fiber, status })
            yield* Queue.offer(queue, reason)
          }),
        )
      },
      (effect, id, _reason) =>
        lifecycle.use(id, effect).pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.void)),
    )
    const admit = Effect.fn("SessionMemoryCapture.admit")(
      function* (id: SessionID, interrupted = false) {
        const policy = yield* backend.get(id)
        if (policy.backend !== "v2") return "disabled" as const
        const session = yield* sessions.get(id)
        if (session.parentID) return "disabled" as const
        const messages = yield* sessions.messages({ sessionID: id })
        if (!policy.capture || !(yield* mode.get(id)).enabled) {
          // Remember only the durable boundary while disabled. Re-enabling must
          // not retrospectively capture conversations the user kept out of memory.
          const through = messages.findLast((message) => message.info.role === "user")?.info.id
          if (through) yield* backend.skip(id, through)
          return "disabled" as const
        }
        return yield* mode.run(id, (revision) =>
          Effect.gen(function* () {
            const data = yield* InstanceState.get(state)
            const store = yield* data.store
            const turns = MemoryTranscript.turns(messages, interrupted, yield* adopt(id, store)).filter(
              (turn) => !policy.skipThrough || turn.promptID > policy.skipThrough,
            )
            const user = turns.at(-1) ? MemoryTranscript.decode(turns.at(-1)!.source).user : undefined
            if (!(yield* permitted(id, user?.agent ?? session.agent ?? "build"))) return "denied" as const
            const admitted = yield* mode.commit(
              id,
              revision,
              Effect.gen(function* () {
                const admissions = yield* Effect.forEach(turns, (turn) =>
                  Effect.gen(function* () {
                    const admitted = yield* store.admit({
                      sessionID: id,
                      promptID: turn.promptID,
                      sourcePromptIndex: turn.promptIndex,
                      source: turn.source,
                      exposed: policy.expose,
                      createdAt: MemoryTranscript.decode(turn.source).user.time.created,
                    })
                    if (admitted.admitted) yield* notify(id, "queued", admitted.job)
                    return admitted.admitted
                  }),
                )
                return admissions.some(Boolean)
              }),
            )
            if (admitted) yield* wake(id, "admission")
            return "completed" as const
          }),
        )
      },
      (effect, id, _interrupted?: boolean) =>
        lifecycle
          .use(id, effect)
          .pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.succeed("disabled" as const))),
    )
    return Service.of({
      resume: (id, retry = false) =>
        Effect.gen(function* () {
          if (!(yield* backend.get(id)).capture || !(yield* mode.get(id)).enabled) return
          const session = yield* sessions.get(id)
          if (!(yield* permitted(id, session.agent ?? "build"))) return
          const data = yield* InstanceState.get(state)
          // Open the store before forking so scope disposal interrupts the worker
          // before closing its SQLite connection. Only already-admitted work resumes.
          yield* data.store
          yield* wake(id, retry ? "retry" : "resume")
        }).pipe(
          (effect) => lifecycle.read(id, effect),
          Effect.catchCause((cause) => Effect.logWarning("Memory V2 capture recovery failed", cause)),
        ),
      schedule: (id, interrupted) =>
        admit(id, interrupted).pipe(
          Effect.asVoid,
          Effect.catchTag("SessionMemoryDisabled", () => Effect.void),
          Effect.catchCause(() =>
            notify(id, "failed").pipe(Effect.andThen(Effect.logWarning("Memory V2 capture admission failed"))),
          ),
        ),
      flush: Effect.fn("SessionMemoryCapture.flush")(
        function* (id) {
          const admitted = yield* admit(id)
          if (admitted !== "completed") return { status: admitted }
          const data = yield* InstanceState.get(state)
          const store = yield* data.store
          const target = (yield* store.cursors(id)).requested
          if (!target) return { status: "no_work" } as const
          yield* wake(id, "retry")
          return yield* mode.run(id, () =>
            Effect.gen(function* () {
              while (true) {
                const progress = yield* store.progress(id, target)
                if (progress.failed) return { status: "failed", eligible: target } as const
                if (progress.indexed >= target)
                  return { status: "completed", eligible: target, processed: target } as const
                if (!(yield* backend.get(id)).capture) return { status: "disabled" } as const
                if (progress.retry && !data.workers.get(id)?.status.running)
                  return { status: "retry_required", eligible: target } as const
                yield* Effect.sleep("100 millis")
              }
            }),
          )
        },
        (effect, id) => lifecycle.run(id, effect),
        Effect.timeoutOrElse({
          duration: "4 minutes",
          orElse: () => Effect.succeed({ status: "timed_out" } as const),
        }),
        Effect.catchTag("SessionMemoryDisabled", () => Effect.succeed({ status: "disabled" } as const)),
        Effect.catchTag("MemoryCaptureError", (error) =>
          error.reason === "historical_owner"
            ? Effect.succeed({ status: "conflict", reason: "historical_capture_ownership" } as const)
            : Effect.fail(error),
        ),
        Effect.catchCause(() => Effect.succeed({ status: "failed" } as const)),
      ),
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    Database.node,
    SessionLifecycle.node,
    Session.node,
    Config.node,
    SessionMemoryBackend.node,
    SessionMemoryMaintenance.node,
    SessionMemoryMode.node,
    SessionMemoryV2Dream.node,
    Agent.node,
    Provider.node,
    LLM.node,
    Global.node,
    EventV2Bridge.node,
    filesystem,
  ],
})
export * as SessionMemoryCapture from "./memory-capture"

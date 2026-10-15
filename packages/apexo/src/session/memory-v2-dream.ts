import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { Clock, Context, Effect, FileSystem, Layer, Queue, Stream } from "effect"
import { filesystem } from "@apexo/core/effect/app-node-platform"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryConsolidation } from "@apexo/core/memory-consolidation"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { MemoryWork } from "@apexo/schema/memory-work"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { SessionMemoryBackend } from "./memory-backend"
import { SessionMemoryMaintenance } from "./memory-maintenance"
import { SessionMemoryMode } from "./memory-mode"
import { MessageID, SessionID } from "./schema"
import { Session } from "./session"

type Options = { manual?: boolean; signal?: AbortSignal }
export interface Interface {
  readonly run: (id: SessionID, options?: Options) => Effect.Effect<MemoryWork.Result>
  readonly schedule: (id: SessionID) => Effect.Effect<void>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionMemoryV2Dream") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const global = yield* Global.Service
    const fs = yield* FileSystem.FileSystem
    const mode = yield* SessionMemoryMode.Service
    const backend = yield* SessionMemoryBackend.Service
    const maintenance = yield* SessionMemoryMaintenance.Service
    const owner = randomUUID()
    const policy = (id: SessionID, manual: boolean) =>
      Effect.gen(function* () {
        const value = yield* backend.get(id)
        const cfg = yield* config.get()
        const enabled =
          value.backend === "v2" &&
          !value.restricted &&
          ["active", "shadow"].includes(value.rollout) &&
          (manual
            ? cfg.memory_v2?.manual_dream_enabled !== false
            : cfg.memory_v2?.automatic_dream_enabled !== false && cfg.memory?.dream?.enabled !== false)
        return { enabled, shadow: value.rollout === "shadow" }
      })
    const runUnowned = (id: SessionID, options: Options = {}): Effect.Effect<MemoryWork.Result> =>
      Effect.gen(function* () {
        const selectedPolicy = yield* policy(id, Boolean(options.manual))
        if (!selectedPolicy.enabled) return { status: "disabled" } as const
        return yield* mode.run(id, (revision) =>
          Effect.gen(function* () {
            const session = yield* sessions.get(id)
            if (session.parentID) return { status: "disabled" } as const
            const messages = yield* sessions.messages({ sessionID: id })
            const previous = messages.findLast((message) => message.info.role === "user")?.info
            const agent = yield* agents.get(previous?.agent ?? session.agent ?? "build")
            if (!agent) return { status: "disabled" } as const
            const ctx = yield* InstanceState.context
            const input = { home: global.home, directory: ctx.directory, projectID: ctx.project.id }
            const roots = [global.home, yield* fs.realPath(global.home)].map((home) =>
              MemoryV2.directory({ ...input, home }),
            )
            const permissions = Effect.gen(function* () {
              const current = yield* sessions.get(id)
              const currentAgent = yield* agents.get(agent.name)
              return (relative: string, action: "read" | "edit") =>
                Boolean(currentAgent) &&
                roots.every(
                  (root) =>
                    Permission.evaluate(
                      action,
                      path.join(root, relative),
                      currentAgent!.permission,
                      current.permission ?? [],
                    ).action === "allow",
                )
            })
            const access = yield* permissions
            if (["memory_state.sqlite", "MEMORY.md"].some((file) => !access(file, "read") || !access(file, "edit")))
              return { status: "denied" } as const
            const store = yield* MemoryCapture.make(input, {
              compactIndex: (yield* config.get()).memory_v2?.compact_index_enabled,
            })
            yield* mode.commit(id, revision, store.dreamConsumeTrigger)
            if (!options.manual) {
              const eligible = yield* store.dreamEligibility(
                yield* Clock.currentTimeMillis,
                selectedPolicy.shadow,
                access,
              )
              if (!eligible.ready) return { status: "no_work", eligible: eligible.count } as const
            }
            const lease = yield* store.dreamClaim(
              { owner, now: yield* Clock.currentTimeMillis, duration: 31 * 60_000, shadow: selectedPolicy.shadow },
              access,
            )
            if (!lease) return { status: "no_work", eligible: 0 } as const
            yield* Effect.addFinalizer(() =>
              Clock.currentTimeMillis.pipe(
                Effect.flatMap((now) => store.dreamRelease(lease, now)),
                Effect.ignore,
              ),
            )
            const commit = (operations?: ReadonlyArray<MemoryConsolidation.Operation>) =>
              mode.commit(
                id,
                revision,
                Effect.gen(function* () {
                  const current = yield* policy(id, Boolean(options.manual))
                  if (!current.enabled || current.shadow !== lease.shadow)
                    return yield* new SessionMemoryMode.Disabled()
                  const permitted = yield* permissions
                  if (
                    ["memory_state.sqlite", "MEMORY.md"].some(
                      (file) => !permitted(file, "read") || !permitted(file, "edit"),
                    )
                  )
                    return yield* new MemoryConsolidation.ConsolidationError({
                      reason: "denied",
                      message: "Dream permission was revoked",
                    })
                  const result = operations
                    ? yield* store.dreamCommit(lease, operations, yield* Clock.currentTimeMillis, permitted)
                    : yield* store.dreamResume(lease, yield* Clock.currentTimeMillis, permitted)
                  return {
                    status: result.status,
                    eligible: result.observations,
                    processed: result.observations,
                    topics: result.topics.length,
                    cleaned: result.status === "shadow" ? 0 : result.observations,
                    path: store.root.path,
                  }
                }),
              )
            if (lease.planned) return yield* commit()
            const snapshot = yield* store.dreamInput(lease, yield* Clock.currentTimeMillis, access)
            const fallback = previous?.role === "user" ? previous.model : yield* provider.defaultModel()
            const override = (yield* config.get()).memory_v2?.dream_model?.trim()
            const selected = override
              ? Provider.parseModel(override.includes("/") ? override : `${fallback.providerID}/${override}`)
              : fallback
            const model = yield* provider.getModel(selected.providerID, selected.modelID)
            const output = { text: "", finished: false }
            yield* llm
              .stream({
                user:
                  previous?.role === "user"
                    ? previous
                    : {
                        id: MessageID.ascending(),
                        sessionID: id,
                        role: "user",
                        time: { created: yield* Clock.currentTimeMillis },
                        agent: agent.name,
                        model: selected,
                      },
                sessionID: id,
                model,
                agent,
                permission: session.permission,
                tools: {},
                toolChoice: "none",
                outputSchema: MemoryConsolidation.outputSchema,
                retries: 0,
                system: [MemoryConsolidation.prompt],
                messages: [
                  {
                    role: "user",
                    content: JSON.stringify({
                      scope: "workspace",
                      observations: snapshot.observations.map((row) => ({ path: row.path, content: row.content })),
                      topics: snapshot.topics.map((row) => ({ path: row.path, content: row.content })),
                    }),
                  },
                ],
              })
              .pipe(
                Stream.timeout("15 minutes"),
                Stream.runForEach((event) =>
                  Effect.gen(function* () {
                    if (event.type === "provider-error") return yield* Effect.fail(new Error("Dream provider failed"))
                    if (event.type === "text-delta") {
                      output.text += event.text
                      if (Buffer.byteLength(output.text) > 3 * 1024 * 1024)
                        return yield* Effect.fail(new Error("Dream output exceeds its limit"))
                    }
                    if (event.type === "finish") output.finished = event.reason === "stop"
                  }),
                ),
              )
            if (!output.finished) return { status: "failed" } as const
            const operations = yield* Effect.try({
              try: () => MemoryConsolidation.parse(output.text),
              catch: () => new Error("Invalid Dream model plan"),
            })
            return yield* commit(operations)
          }),
        )
      }).pipe(
        Effect.scoped,
        Effect.timeoutOrElse({
          duration: "30 minutes",
          orElse: () => Effect.succeed({ status: "timed_out" } as const),
        }),
        Effect.raceFirst(
          options.signal
            ? Effect.callback<MemoryWork.Result, never>((resume) => {
                const signal = options.signal!
                const abort = () => resume(Effect.succeed({ status: "cancelled" }))
                if (signal.aborted) abort()
                signal.addEventListener("abort", abort, { once: true })
                return Effect.sync(() => signal.removeEventListener("abort", abort))
              })
            : Effect.never,
        ),
        Effect.catch((error) =>
          Effect.succeed({
            status:
              error instanceof SessionMemoryMode.Disabled
                ? "disabled"
                : error instanceof MemoryConsolidation.ConsolidationError
                  ? error.reason === "busy"
                    ? "busy"
                    : error.reason === "denied"
                      ? "denied"
                      : ["conflict", "stale_lease"].includes(error.reason)
                        ? "conflict"
                        : "failed"
                  : typeof error === "object" && error !== null && "_tag" in error && error._tag === "TimeoutError"
                    ? "timed_out"
                    : "failed",
          } as MemoryWork.Result),
        ),
        Effect.catchCause(() => Effect.succeed({ status: "failed" } as const)),
        Effect.tap((result) =>
          ["completed", "shadow"].includes(result.status) ? maintenance.schedule(id) : Effect.void,
        ),
        Effect.tap((result) =>
          options.manual && ["completed", "shadow"].includes(result.status) ? schedule(id) : Effect.void,
        ),
      )
    const run = (id: SessionID, options: Options = {}) =>
      lifecycle
        .run(id, runUnowned(id, options))
        .pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.succeed({ status: "cancelled" } as const)))
    const state = yield* InstanceState.make(() =>
      Effect.gen(function* () {
        const queue = yield* Queue.sliding<SessionLifecycle.Claim>(1)
        const latest = { claim: undefined as SessionLifecycle.Claim | undefined }
        yield* Queue.take(queue).pipe(
          Effect.flatMap((claim) =>
            !lifecycle.available(claim)
              ? Effect.void
              : lifecycle.owned(claim, run(claim.sessionID)).pipe(
                  Effect.tap((result) =>
                    ["failed", "timed_out"].includes(result.status)
                      ? Effect.logWarning("Memory V2 automatic Dream did not finish", { status: result.status })
                      : Effect.void,
                  ),
                  Effect.flatMap((result) =>
                    ["completed", "shadow"].includes(result.status)
                      ? Queue.offer(queue, claim).pipe(Effect.asVoid)
                      : Effect.void,
                  ),
                ),
          ),
          Effect.forever,
          Effect.forkScoped,
        )
        yield* Effect.gen(function* () {
          const seconds = (yield* config.get()).memory?.dream?.check_interval_secs ?? 3600
          yield* Effect.sleep((seconds || 3600) * 1000)
          if (seconds && latest.claim && lifecycle.available(latest.claim)) yield* Queue.offer(queue, latest.claim)
        }).pipe(Effect.forever, Effect.forkScoped)
        return { queue, latest }
      }),
    )
    const schedule = Effect.fn("SessionMemoryV2Dream.schedule")(
      function* (id: SessionID) {
        if (!(yield* policy(id, false)).enabled || !(yield* mode.get(id)).enabled) return
        const data = yield* InstanceState.get(state)
        const claim = yield* lifecycle.capture(id).pipe(Effect.orDie)
        data.latest.claim = claim
        yield* Queue.offer(data.queue, claim)
      },
      (effect, id) => lifecycle.use(id, effect).pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.void)),
    )
    return Service.of({ run, schedule })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    SessionLifecycle.node,
    Config.node,
    Session.node,
    Agent.node,
    Provider.node,
    LLM.node,
    Global.node,
    SessionMemoryMode.node,
    SessionMemoryBackend.node,
    SessionMemoryMaintenance.node,
    filesystem,
  ],
})
export * as SessionMemoryV2Dream from "./memory-v2-dream"

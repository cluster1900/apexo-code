import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import path from "node:path"
import { Clock, Context, Effect, FileSystem, Layer, Scope, Stream } from "effect"
import { filesystem } from "@apexo/core/effect/app-node-platform"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { MemoryDream } from "@apexo/core/memory-dream"
import { MemoryWork } from "@apexo/schema/memory-work"
import { MemoryMaintenance } from "@apexo/core/memory-maintenance"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { Flock } from "@apexo/core/util/flock"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { MessageID, SessionID } from "./schema"
import { Session } from "./session"
import { SessionMemoryMode } from "./memory-mode"
import { SessionMemoryBackend } from "./memory-backend"
import { SessionMemoryV2Dream } from "./memory-v2-dream"

type Options = { signal?: AbortSignal; manual?: boolean; authorize?: (paths: string[]) => Effect.Effect<void> }
export interface Interface {
  readonly run: (sessionID: SessionID, options?: Options) => Effect.Effect<MemoryWork.Result>
  readonly schedule: (sessionID: SessionID) => Effect.Effect<void>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionMemoryDream") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const flags = yield* RuntimeFlags.Service
    const global = yield* Global.Service
    const fs = yield* FileSystem.FileSystem
    const mode = yield* SessionMemoryMode.Service
    const backend = yield* SessionMemoryBackend.Service
    const v2 = yield* SessionMemoryV2Dream.Service

    const runUnowned = (sessionID: SessionID, options: Options = {}): Effect.Effect<MemoryWork.Result> =>
      Effect.gen(function* () {
        if (flags.runtimeProfile !== "grok-build") return { status: "disabled" } as const
        if ((yield* backend.get(sessionID)).backend === "v2")
          return yield* v2.run(sessionID, { ...options, manual: options.manual === true || Boolean(options.authorize) })
        const cfg = yield* config.get()
        const settings = cfg.memory?.dream
        const manual = options.manual === true || Boolean(options.authorize)
        if (!manual && settings?.enabled === false) return { status: "disabled" } as const
        return yield* mode
          .run(sessionID, (revision) =>
            Effect.gen(function* () {
              const session = yield* sessions.get(sessionID)
              if (session.parentID) return { status: "disabled" } as const
              const messages = yield* sessions.messages({ sessionID })
              const previousUser = messages.findLast((message) => message.info.role === "user")?.info
              if (!manual && (!previousUser || previousUser.role !== "user")) return { status: "no_work" } as const
              const agent =
                previousUser?.role === "user"
                  ? yield* agents.get(previousUser.agent)
                  : session.agent
                    ? yield* agents.get(session.agent)
                    : yield* agents.defaultInfo()
              if (!agent) return { status: "disabled" } as const
              const ctx = yield* InstanceState.context
              const input = { directory: ctx.directory, projectID: ctx.project.id, home: global.home }
              const generation = yield* Effect.promise(() =>
                MemoryMaintenance.revision(WorkspaceMemory.maintenance(ctx.directory, global.home, input)),
              )
              const location = MemoryDream.paths(input)
              const canonical = yield* fs.realPath(global.home)
              const files = yield* Effect.promise(() => MemoryDream.files(input, sessionID))
              const access = [
                ...new Set(
                  [location.file, location.state, ...files].flatMap((file) => [
                    file,
                    path.join(canonical, path.relative(global.home, file)),
                  ]),
                ),
              ]
              if (options.authorize) yield* options.authorize(access)
              if (
                !options.authorize &&
                access.some((file) =>
                  ["read", "edit"].some(
                    (action) =>
                      Permission.evaluate(action, file, agent.permission, session.permission ?? []).action !== "allow",
                  ),
                )
              )
                return { status: "denied" } as const
              const locked = yield* Flock.effect(`${location.root}.dream`, {
                dir: path.join(global.home, ".grok", "memory", ".locks"),
                timeoutMs: 0,
                staleMs: Math.max(1860, settings?.stale_lock_secs ?? 3600) * 1000,
                reclaimDeadOwner: true,
              }).pipe(
                Effect.as(true),
                Effect.catchCause(() => Effect.succeed(false)),
              )
              if (!locked) return { status: "busy" } as const
              // All gating and snapshots happen under the lease. Only the pre-authorized paths are read.
              const previous = MemoryDream.state(
                yield* Effect.promise(() => MemoryDream.snapshot(location.state, input)),
              )
              const now = yield* Clock.currentTimeMillis
              if (!manual && now - previous.completed < (settings?.min_hours ?? 24) * 3600_000)
                return { status: "too_soon" } as const
              const snapshots = (yield* Effect.forEach(files, (file) =>
                Effect.promise(() => MemoryDream.snapshot(file, input)),
              ))
                .filter((item): item is MemoryDream.Snapshot => Boolean(item?.content.trim()))
                .filter((item) => manual || previous.processed[path.basename(item.path)] !== item.signature)
              const count = new Set(
                snapshots.map((item) =>
                  path
                    .basename(item.path, ".md")
                    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
                    .replace(/-flush$/, ""),
                ),
              ).size
              if (!manual && count < (settings?.min_sessions ?? 5))
                return { status: "too_few_sessions", eligible: count } as const
              if (!snapshots.length) return { status: "no_work", eligible: 0 } as const
              const existing = yield* Effect.promise(() => MemoryDream.snapshot(location.file, input))
              const message = MemoryDream.message(existing, snapshots)
              const selected = previousUser?.role === "user" ? previousUser.model : yield* provider.defaultModel()
              const model = yield* provider.getModel(selected.providerID, selected.modelID)
              const user =
                previousUser?.role === "user"
                  ? previousUser
                  : {
                      id: MessageID.ascending(),
                      sessionID,
                      role: "user" as const,
                      time: { created: yield* Clock.currentTimeMillis },
                      agent: agent.name,
                      model: selected,
                    }
              const output = { text: "", finished: false }
              yield* llm
                .stream({
                  user,
                  sessionID,
                  model,
                  agent,
                  permission: session.permission,
                  tools: {},
                  toolChoice: "none",
                  retries: 0,
                  system: [MemoryDream.prompt],
                  messages: [{ role: "user", content: message.content }],
                })
                .pipe(
                  Stream.runForEach((event) =>
                    Effect.gen(function* () {
                      if (event.type === "provider-error") return yield* Effect.fail(new Error(event.message))
                      if (event.type === "text-delta") output.text += event.text
                      if (event.type === "finish") output.finished = event.reason === "stop"
                    }),
                  ),
                  Effect.timeout("30 minutes"),
                )
              if (!output.finished) return { status: "failed" } as const
              const result = MemoryDream.response(output.text)
              if (result.status === "rejected") return { status: "failed" } as const
              const completed = yield* Clock.currentTimeMillis
              const committed = yield* mode.commit(
                sessionID,
                revision,
                Effect.promise(() =>
                  MemoryDream.commit(input, {
                    generation,
                    existing,
                    previous,
                    processed: message.processed,
                    content: result.status === "accepted" ? result.content : undefined,
                    now: completed,
                  }),
                ),
              )
              return { ...committed, eligible: count }
            }),
          )
          .pipe(
            Effect.catchIf(
              (error) => error instanceof SessionMemoryMode.Disabled,
              () => Effect.succeed({ status: "disabled" } as const),
            ),
          )
      }).pipe(
        Effect.raceFirst(
          options.signal
            ? Effect.callback<MemoryWork.Result>((resume) => {
                const signal = options.signal!
                const abort = () => resume(Effect.succeed({ status: "cancelled" }))
                if (signal.aborted) abort()
                signal.addEventListener("abort", abort, { once: true })
                return Effect.sync(() => signal.removeEventListener("abort", abort))
              })
            : Effect.never,
        ),
        Effect.scoped,
        Effect.catchCause(() => Effect.succeed({ status: "failed" } as const)),
      )

    const run = (id: SessionID, options: Options = {}) =>
      lifecycle
        .run(id, runUnowned(id, options))
        .pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.succeed({ status: "cancelled" } as const)))
    const state = yield* InstanceState.make(() =>
      Effect.gen(function* () {
        const data = { scope: yield* Scope.Scope, claim: undefined as SessionLifecycle.Claim | undefined }
        yield* Effect.gen(function* () {
          const cfg = yield* config.get()
          const seconds = cfg.memory?.dream?.check_interval_secs ?? 3600
          yield* Effect.sleep((seconds || 3600) * 1000)
          if (seconds && data.claim && lifecycle.available(data.claim))
            yield* lifecycle.owned(data.claim, run(data.claim.sessionID))
        }).pipe(Effect.forever, Effect.forkScoped)
        return data
      }),
    )
    const schedule = Effect.fn("SessionMemoryDream.schedule")(
      function* (sessionID: SessionID) {
        if (flags.runtimeProfile !== "grok-build") return
        if ((yield* backend.get(sessionID)).backend === "v2") return yield* v2.schedule(sessionID)
        const cfg = yield* config.get()
        if (!(yield* mode.get(sessionID)).enabled || cfg.memory?.dream?.enabled === false) return
        const session = yield* sessions.get(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!session || session.parentID) return
        const data = yield* InstanceState.get(state)
        data.claim = yield* lifecycle.capture(sessionID).pipe(Effect.orDie)
        yield* run(sessionID).pipe(Effect.forkIn(data.scope))
      },
      (effect, sessionID) =>
        lifecycle.use(sessionID, effect).pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.void)),
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
    RuntimeFlags.node,
    Global.node,
    SessionMemoryMode.node,
    SessionMemoryBackend.node,
    SessionMemoryV2Dream.node,
    filesystem,
  ],
})
export * as SessionMemoryDream from "./memory-dream"

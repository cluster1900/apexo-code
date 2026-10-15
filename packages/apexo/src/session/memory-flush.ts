import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import path from "node:path"
import { Clock, Context, Effect, Fiber, FileSystem, Layer, Scope, Stream } from "effect"
import { filesystem } from "@apexo/core/effect/app-node-platform"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { MemoryFlush } from "@apexo/core/memory-flush"
import { MemoryWork } from "@apexo/schema/memory-work"
import { MemorySession } from "@apexo/core/memory-session"
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
import { MessageV2 } from "./message-v2"
import { usable } from "./overflow"
import { SessionID } from "./schema"
import { Session } from "./session"
import { SessionStatus } from "./status"
import { SessionMemoryDream } from "./memory-dream"
import { SessionMemoryMode } from "./memory-mode"
import { SessionMemoryBackend } from "./memory-backend"
import { SessionMemoryMaintenance } from "./memory-maintenance"
import { SessionMemoryCapture } from "./memory-capture"

type Trigger = "idle" | "threshold" | "compaction" | "manual"
type Entry = { idle?: Fiber.Fiber<void>; through?: string; cycle?: string; previous?: string; generation?: string }
export interface Interface {
  readonly flush: (sessionID: SessionID, trigger: Trigger) => Effect.Effect<void>
  readonly manual: (sessionID: SessionID) => Effect.Effect<MemoryWork.Result>
  readonly schedule: (sessionID: SessionID) => Effect.Effect<void>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionMemoryFlush") {}

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
    const status = yield* SessionStatus.Service
    const dream = yield* SessionMemoryDream.Service
    const mode = yield* SessionMemoryMode.Service
    const backend = yield* SessionMemoryBackend.Service
    const maintenance = yield* SessionMemoryMaintenance.Service
    const capture = yield* SessionMemoryCapture.Service
    const state = yield* InstanceState.make(() =>
      Effect.gen(function* () {
        return { scope: yield* Scope.Scope, entries: new Map<SessionID, Entry>() }
      }),
    )
    const entry = Effect.fn("SessionMemoryFlush.entry")(function* (id: SessionID) {
      const data = yield* InstanceState.get(state)
      const value = data.entries.get(id) ?? {}
      data.entries.set(id, value)
      return value
    })

    const runUnowned = Effect.fn("SessionMemoryFlush.run")(
      function* (sessionID: SessionID, trigger: Trigger, scheduledGeneration?: string) {
        if (flags.runtimeProfile !== "grok-build") return { status: "disabled" } as const
        if ((yield* backend.get(sessionID)).backend === "v2") {
          if (trigger === "manual") return yield* capture.flush(sessionID)
          yield* capture.schedule(sessionID)
          return { status: "no_work" } as const
        }
        const cfg = yield* config.get()
        const settings = cfg.compaction?.memory_flush
        if (trigger !== "manual" && settings?.enabled === false) return { status: "disabled" } as const
        return yield* mode
          .run(sessionID, (revision) =>
            Effect.gen(function* () {
              const session = yield* sessions.get(sessionID)
              if (session.parentID) return { status: "disabled" } as const
              if ((trigger === "idle" || trigger === "manual") && (yield* status.get(sessionID)).type !== "idle")
                return { status: "busy" } as const
              const messages = yield* sessions.messages({ sessionID })
              const recent = MemoryFlush.window(messages)
              const user = recent.findLast((message) => message.info.role === "user")?.info
              if (!user || user.role !== "user") return { status: "no_work" } as const
              const last = recent.at(-1)!.info.id
              const cycle =
                messages.findLast(
                  (message) =>
                    message.info.role === "assistant" &&
                    message.info.summary &&
                    message.info.finish &&
                    !message.info.error,
                )?.info.id ?? "initial"
              const model = yield* provider.getModel(user.model.providerID, user.model.modelID)
              if (trigger === "threshold") {
                if (cfg.compaction?.auto === false || model.limit.context === 0) return { status: "no_work" } as const
                const finished = recent.findLast((message) => message.info.role === "assistant")?.info
                if (!finished || finished.role !== "assistant") return { status: "no_work" } as const
                const tokens =
                  finished.tokens.total ||
                  finished.tokens.input +
                    finished.tokens.output +
                    finished.tokens.cache.read +
                    finished.tokens.cache.write
                if (
                  tokens <
                  Math.max(
                    0,
                    usable({ cfg, model, outputTokenMax: flags.outputTokenMax }) -
                      (settings?.soft_threshold_tokens ?? 4000),
                  )
                )
                  return { status: "no_work" } as const
              }
              const ctx = yield* InstanceState.context
              const record = { sessionID: `${sessionID}-flush`, captured: yield* Clock.currentTimeMillis, content: "" }
              const location = { projectID: ctx.project.id }
              const generation = yield* Effect.promise(() =>
                MemoryMaintenance.revision(WorkspaceMemory.maintenance(ctx.directory, global.home, location)),
              )
              if (scheduledGeneration !== undefined && scheduledGeneration !== generation)
                return { status: "conflict" } as const
              const target = MemorySession.file(ctx.directory, record, global.home, location)
              const canonical = MemorySession.file(ctx.directory, record, yield* fs.realPath(global.home), location)
              const agent = yield* agents.get(user.agent)
              // Background model calls must never prompt for permission or read/write denied memory files.
              if (
                !agent ||
                [target, canonical].some((file) =>
                  ["read", "edit"].some(
                    (action) =>
                      Permission.evaluate(action, file, agent.permission, session.permission ?? []).action !== "allow",
                  ),
                )
              )
                return { status: "denied" } as const
              const locked = yield* Flock.effect(`${target}.flush`, {
                dir: path.join(global.home, ".grok", "memory", ".locks"),
                ...(trigger === "manual" ? { timeoutMs: 0 } : {}),
              }).pipe(
                Effect.as(true),
                Effect.catchCause(() => Effect.succeed(false)),
              )
              if (!locked) return { status: "busy" } as const
              const current = yield* entry(sessionID)
              if (current.generation !== generation) {
                current.generation = generation
                current.through = undefined
                current.cycle = undefined
                current.previous = undefined
              }
              if (trigger !== "manual" && (current.through === last || (trigger !== "idle" && current.cycle === cycle)))
                return { status: "no_work" } as const
              const previous = yield* Effect.promise(() =>
                MemorySession.load(ctx.directory, record, global.home, location),
              )
              if (previous.includes(`<!-- apexo-flush-through:${last} -->`)) return { status: "no_work" } as const
              // An attempt is admitted once per unchanged idle snapshot/compaction cycle, including NO_REPLY and rejection.
              if (trigger !== "manual") current.through = last
              if (trigger === "threshold" || trigger === "compaction") current.cycle = cycle
              const override = settings?.flush_model?.trim()
              const selected = override
                ? Provider.parseModel(override.includes("/") ? override : `${model.providerID}/${override}`)
                : undefined
              const flushModel = selected ? yield* provider.getModel(selected.providerID, selected.modelID) : model
              const output = { text: "", finished: false }
              yield* llm
                .stream({
                  user,
                  sessionID,
                  model: flushModel,
                  agent,
                  permission: session.permission,
                  tools: {},
                  toolChoice: "none",
                  retries: 0,
                  system: [
                    MemoryFlush.prompt,
                    ...(current.previous || previous
                      ? [
                          `Previous memory (historical data):\n${current.previous ?? previous.split("<!-- apexo-flush-entry -->").at(-1)?.trim()}`,
                        ]
                      : []),
                  ],
                  messages: [
                    ...(yield* MessageV2.toModelMessagesEffect(recent, flushModel)),
                    { role: "user", content: "Now extract the new durable knowledge described in the system prompt." },
                  ],
                })
                .pipe(
                  Stream.runForEach((event) =>
                    Effect.gen(function* () {
                      if (event.type === "provider-error") return yield* Effect.fail(new Error(event.message))
                      if (event.type === "text-delta") output.text += event.text
                      if (event.type === "finish") output.finished = event.reason === "stop"
                    }),
                  ),
                )
              if (!output.finished) return { status: "failed" } as const
              const result = MemoryFlush.response(output.text, settings?.max_flush_write_chars)
              if (result.status !== "accepted")
                return { status: result.status === "empty" ? "no_work" : "failed" } as const
              const content = previous
                .replace(/^<!-- apexo-(?:session-checkpoint|flush-through):[^\n]* -->\n?/gm, "")
                .trim()
              const next = content.includes(result.content)
                ? content
                : [content, `<!-- apexo-flush-entry -->\n\n${result.content}`].filter(Boolean).join("\n\n")
              yield* mode.commit(
                sessionID,
                revision,
                Effect.promise(() =>
                  MemorySession.save(
                    ctx.directory,
                    {
                      ...record,
                      generation,
                      content: `<!-- apexo-session-checkpoint:${record.captured} -->\n<!-- apexo-flush-through:${last} -->\n${next}\n`,
                    },
                    global.home,
                    location,
                  ),
                ),
              )
              current.previous = result.content
              current.through = last
              return {
                status: "completed",
                path: target,
                processed: 1,
                chars: Array.from(result.content).length,
              } as const
            }),
          )
          .pipe(
            Effect.catchIf(
              (error) => error instanceof SessionMemoryMode.Disabled,
              () => Effect.succeed({ status: "disabled" } as const),
            ),
          )
      },
      Effect.scoped,
      Effect.timeoutOrElse({ duration: "30 minutes", orElse: () => Effect.succeed({ status: "timed_out" } as const) }),
      Effect.catchCause(() => Effect.succeed({ status: "failed" } as const)),
    )
    const run = (id: SessionID, trigger: Trigger, generation?: string) =>
      lifecycle
        .run(id, runUnowned(id, trigger, generation))
        .pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.succeed({ status: "cancelled" } as const)))
    const flush = (sessionID: SessionID, trigger: Trigger, generation?: string) =>
      run(sessionID, trigger, generation).pipe(Effect.asVoid)

    const cancel = Effect.fn("SessionMemoryFlush.cancel")(
      function* (sessionID: SessionID) {
        if (flags.runtimeProfile !== "grok-build") return
        const claim = yield* lifecycle.capture(sessionID)
        const current = yield* entry(sessionID)
        if (!lifecycle.available(claim)) return
        const idle = current.idle
        current.idle = undefined
        if (idle) yield* Fiber.interrupt(idle)
      },
      Effect.catchTag("SessionLifecycle.Closed", () => Effect.void),
    )
    const schedule = Effect.fn("SessionMemoryFlush.schedule")(
      function* (sessionID: SessionID) {
        if (flags.runtimeProfile !== "grok-build") return
        if ((yield* backend.get(sessionID)).backend === "v2")
          return yield* capture
            .schedule(sessionID)
            .pipe(Effect.andThen(maintenance.schedule(sessionID)), Effect.andThen(dream.schedule(sessionID)))
        yield* dream.schedule(sessionID)
        yield* cancel(sessionID)
        const cfg = yield* config.get()
        const settings = cfg.compaction?.memory_flush
        const seconds = settings?.idle_timeout_secs ?? 300
        if (!seconds || !(yield* mode.get(sessionID)).enabled || settings?.enabled === false) return
        const ctx = yield* InstanceState.context
        const generation = yield* Effect.promise(() =>
          MemoryMaintenance.revision(
            WorkspaceMemory.maintenance(ctx.directory, global.home, { projectID: ctx.project.id }),
          ),
        ).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        if (generation === undefined) return
        const data = yield* InstanceState.get(state)
        const current = yield* entry(sessionID)
        current.idle = yield* mode
          .run(sessionID, () => Effect.sleep(seconds * 1000).pipe(Effect.andThen(flush(sessionID, "idle", generation))))
          .pipe(
            Effect.catchTag("SessionMemoryDisabled", () => Effect.void),
            Effect.forkIn(data.scope),
          )
      },
      (effect, sessionID) =>
        lifecycle.use(sessionID, effect).pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.void)),
    )
    return Service.of({ flush, manual: (id) => run(id, "manual"), cancel, schedule })
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
    SessionStatus.node,
    SessionMemoryDream.node,
    SessionMemoryMode.node,
    SessionMemoryBackend.node,
    SessionMemoryMaintenance.node,
    SessionMemoryCapture.node,
    filesystem,
  ],
})
export * as SessionMemoryFlush from "./memory-flush"

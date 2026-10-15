import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import path from "node:path"
import { Clock, Context, Effect, FileSystem, Layer, Queue } from "effect"
import { filesystem } from "@apexo/core/effect/app-node-platform"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryRetention } from "@apexo/core/memory-retention"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import { SessionMemoryBackend } from "./memory-backend"
import { SessionMemoryMode } from "./memory-mode"
import { SessionID } from "./schema"
import { Session } from "./session"

export interface Interface {
  readonly run: (id: SessionID) => Effect.Effect<MemoryRetention.Result | void>
  readonly schedule: (id: SessionID) => Effect.Effect<void>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionMemoryMaintenance") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const global = yield* Global.Service
    const fs = yield* FileSystem.FileSystem
    const backend = yield* SessionMemoryBackend.Service
    const mode = yield* SessionMemoryMode.Service
    const enabled = Effect.fn("SessionMemoryMaintenance.enabled")(function* (id: SessionID) {
      const policy = yield* backend.get(id)
      return policy.backend === "v2" && !policy.restricted && (yield* mode.get(id)).enabled
    })
    const runUnowned = Effect.fn("SessionMemoryMaintenance.run")(
      function* (id: SessionID) {
        if (!(yield* enabled(id))) return
        return yield* mode.run(id, (revision) =>
          mode.commit(
            id,
            revision,
            Effect.gen(function* () {
              // Recheck after waiting for the mode lock; configuration may have
              // restricted a pinned session while another operation was committing.
              if (!(yield* enabled(id))) return
              const session = yield* sessions.get(id)
              if (session.parentID) return
              const messages = yield* sessions.messages({ sessionID: id })
              const previous = messages.findLast((message) => message.info.role === "user")?.info
              const agent = yield* agents.get(previous?.agent ?? session.agent ?? "build")
              if (!agent) return
              const ctx = yield* InstanceState.context
              const input = { home: global.home, directory: ctx.directory, projectID: ctx.project.id }
              const roots = [global.home, yield* fs.realPath(global.home)].map((home) =>
                MemoryV2.directory({ ...input, home }),
              )
              const access = (relative: string, action: "read" | "edit") =>
                roots.every(
                  (root) =>
                    Permission.evaluate(action, path.join(root, relative), agent.permission, session.permission ?? [])
                      .action === "allow",
                )
              if (["memory_state.sqlite", "MEMORY.md"].some((file) => !access(file, "read") || !access(file, "edit")))
                return
              const settings = (yield* config.get()).memory_v2
              const store = yield* MemoryCapture.make(input, {
                compactIndex: (yield* config.get()).memory_v2?.compact_index_enabled,
              })
              return yield* store.gc(
                yield* Clock.currentTimeMillis,
                {
                  archivedDays: settings?.archived_retention_days ?? 30,
                  jobDays: settings?.job_retention_days ?? 14,
                },
                access,
              )
            }),
          ),
        )
      },
      Effect.scoped,
      Effect.catch((error) =>
        error instanceof SessionMemoryMode.Disabled ||
        (error instanceof MemoryRetention.RetentionError && error.reason === "busy")
          ? Effect.void
          : Effect.logWarning("Memory V2 retention deferred", {
              reason: error instanceof MemoryRetention.RetentionError ? error.reason : "storage",
            }).pipe(Effect.as(undefined)),
      ),
      Effect.catchCause(() => Effect.logWarning("Memory V2 retention failed").pipe(Effect.as(undefined))),
    )
    const run = (id: SessionID) =>
      lifecycle.run(id, runUnowned(id)).pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.void))
    const state = yield* InstanceState.make(() =>
      Effect.gen(function* () {
        const queue = yield* Queue.sliding<SessionLifecycle.Claim>(1)
        const latest = { claim: undefined as SessionLifecycle.Claim | undefined }
        yield* Queue.take(queue).pipe(
          Effect.flatMap((claim) =>
            !lifecycle.available(claim)
              ? Effect.void
              : lifecycle
                  .owned(claim, run(claim.sessionID))
                  .pipe(
                    Effect.flatMap((result) =>
                      result && (result.archives === 256 || result.jobs === 256)
                        ? Queue.offer(queue, claim).pipe(Effect.asVoid)
                        : Effect.void,
                    ),
                  ),
          ),
          Effect.forever,
          Effect.forkScoped,
        )
        yield* Effect.gen(function* () {
          const seconds = (yield* config.get()).memory_v2?.maintenance_interval_secs ?? 3600
          yield* Effect.sleep((seconds || 3600) * 1000)
          if (seconds && latest.claim && lifecycle.available(latest.claim)) yield* Queue.offer(queue, latest.claim)
        }).pipe(Effect.forever, Effect.forkScoped)
        return { queue, latest }
      }),
    )
    const schedule = Effect.fn("SessionMemoryMaintenance.schedule")(
      function* (id: SessionID) {
        if (!(yield* enabled(id))) return
        const value = yield* InstanceState.get(state)
        const claim = yield* lifecycle.capture(id).pipe(Effect.orDie)
        value.latest.claim = claim
        yield* Queue.offer(value.queue, claim)
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
    Global.node,
    SessionMemoryBackend.node,
    SessionMemoryMode.node,
    filesystem,
  ],
})
export * as SessionMemoryMaintenance from "./memory-maintenance"

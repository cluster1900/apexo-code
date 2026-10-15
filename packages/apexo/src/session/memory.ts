import { Clock, Context, Effect, FileSystem, Layer } from "effect"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { filesystem } from "@apexo/core/effect/app-node-platform"
import { MemorySession } from "@apexo/core/memory-session"
import { MemoryMaintenance } from "@apexo/core/memory-maintenance"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { Global } from "@apexo/core/global"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Permission } from "@/permission"
import { Session } from "./session"
import { SessionID } from "./schema"
import { SessionMemoryMode } from "./memory-mode"
import { SessionMemoryBackend } from "./memory-backend"

export interface Interface {
  readonly checkpoint: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/SessionMemory") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const config = yield* Config.Service
    const agents = yield* Agent.Service
    const flags = yield* RuntimeFlags.Service
    const global = yield* Global.Service
    const fs = yield* FileSystem.FileSystem
    const mode = yield* SessionMemoryMode.Service
    const backend = yield* SessionMemoryBackend.Service

    const checkpoint = Effect.fn("SessionMemory.checkpoint")(
      function* (sessionID: SessionID) {
        if (flags.runtimeProfile !== "grok-build") return
        if ((yield* backend.get(sessionID)).backend === "v2") return
        const settings = (yield* config.get()).memory
        if (settings?.session?.save_on_end === false) return
        return yield* mode.run(sessionID, (revision) =>
          Effect.gen(function* () {
            const session = yield* sessions.get(sessionID)
            if (session.parentID) return
            const captured = yield* Clock.currentTimeMillis
            const ctx = yield* InstanceState.context
            const generation = yield* Effect.promise(() =>
              MemoryMaintenance.revision(
                WorkspaceMemory.maintenance(ctx.directory, global.home, { projectID: ctx.project.id }),
              ),
            )
            const messages = yield* sessions.messages({ sessionID })
            const record = MemorySession.summarize(sessionID, messages, captured)
            if (!record) return
            const target = MemorySession.file(ctx.directory, record, global.home, { projectID: ctx.project.id })
            const canonical = MemorySession.file(ctx.directory, record, yield* fs.realPath(global.home), {
              projectID: ctx.project.id,
            })
            const lastUser = messages.findLast((message) => message.info.role === "user")
            const agent = yield* agents.get(lastUser?.info.agent ?? session.agent ?? "build")
            // Automatic memory must not open an approval prompt or bypass an edit restriction.
            if (
              !agent ||
              [target, canonical].some(
                (file) =>
                  Permission.evaluate("edit", file, agent.permission, session.permission ?? []).action !== "allow",
              )
            )
              return
            yield* mode.commit(
              sessionID,
              revision,
              Effect.promise(() =>
                MemorySession.save(ctx.directory, { ...record, generation }, global.home, {
                  projectID: ctx.project.id,
                }),
              ),
            )
          }),
        )
      },
      Effect.asVoid,
      Effect.catchTag("SessionMemoryDisabled", () => Effect.void),
      Effect.catchCause(() => Effect.logWarning("Memory session checkpoint failed")),
    )

    return Service.of({ checkpoint })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    Session.node,
    Config.node,
    Agent.node,
    RuntimeFlags.node,
    Global.node,
    SessionMemoryMode.node,
    SessionMemoryBackend.node,
    filesystem,
  ],
})

export * as SessionMemory from "./memory"

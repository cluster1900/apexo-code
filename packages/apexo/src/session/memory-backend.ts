import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { ConfigMemory } from "@apexo/core/config/memory"
import { MemoryPolicy } from "@apexo/core/memory-policy"
import { Database } from "@apexo/core/database/database"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { SessionMemoryBackendTable } from "@apexo/core/session/sql"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { SessionID } from "./schema"

export type Policy = {
  backend: "legacy" | "v2"
  rollout: ConfigMemory.Rollout
  configured: boolean | undefined
  restricted: boolean
  capture: boolean
  expose: boolean
  skipThrough: string | null
}
export interface Interface {
  readonly get: (id?: SessionID) => Effect.Effect<Policy>
  readonly skip: (id: SessionID, through: string) => Effect.Effect<void>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionMemoryBackend") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.Service
    const config = yield* Config.Service
    const database = yield* Database.Service
    const flags = yield* RuntimeFlags.Service
    return Service.of({
      get: Effect.fn("SessionMemoryBackend.get")(
        function* (id) {
          const cfg = yield* config.get()
          return yield* MemoryPolicy.backend(database.db, id, {
            profile: flags.runtimeProfile === "grok-build",
            memory: cfg.memory,
            memory_v2: cfg.memory_v2,
          })
        },
        (effect, id) => (id ? lifecycle.use(id, effect).pipe(Effect.orDie) : effect),
      ),
      skip: (id, through) =>
        database.db
          .update(SessionMemoryBackendTable)
          .set({
            skip_through: sql`MAX(COALESCE(${SessionMemoryBackendTable.skip_through}, ''), ${through})`,
          })
          .where(eq(SessionMemoryBackendTable.session_id, id))
          .run()
          .pipe(Effect.asVoid, (effect) => lifecycle.use(id, effect), Effect.orDie),
    })
  }),
)
export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [SessionLifecycle.node, Config.node, Database.node, RuntimeFlags.node],
})
export * as SessionMemoryBackend from "./memory-backend"

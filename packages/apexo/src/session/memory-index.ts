import { Context, Effect, Layer, ScopedCache } from "effect"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { MemorySearch } from "@apexo/core/memory-search"
import { MemoryMaintenance } from "@apexo/core/memory-maintenance"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"

export interface Interface {
  readonly get: () => Effect.Effect<MemorySearch.Interface, MemorySearch.MemoryError>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/MemoryIndex") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const config = yield* Config.Service
    const state = yield* InstanceState.make(
      Effect.fn("MemoryIndex.state")(function* (ctx) {
        return yield* ScopedCache.make({
          capacity: 1,
          lookup: (_generation: string) =>
            Effect.gen(function* () {
              return yield* MemorySearch.make({
                search: (yield* config.get()).memory?.search,
                directory: ctx.directory,
                projectID: ctx.project.id,
                home: global.home,
              })
            }),
        })
      }),
    )
    return Service.of({
      get: Effect.fn("MemoryIndex.get")(function* () {
        const index = yield* InstanceState.get(state)
        const ctx = yield* InstanceState.context
        const generation = yield* Effect.tryPromise({
          try: () =>
            MemoryMaintenance.revision(
              WorkspaceMemory.maintenance(ctx.directory, global.home, { projectID: ctx.project.id }),
            ),
          catch: (error) =>
            new MemorySearch.MemoryError({ message: error instanceof Error ? error.message : String(error) }),
        })
        return yield* ScopedCache.get(index, generation)
      }),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Global.node, Config.node] })

export * as MemoryIndex from "./memory-index"

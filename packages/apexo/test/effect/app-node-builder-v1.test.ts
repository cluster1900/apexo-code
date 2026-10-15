import { expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { Node } from "@apexo/core/effect/app-node"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { buildLocationServiceMap, LocationServiceMap } from "@apexo/core/location-services"
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

it.live("explicit Location map replacement takes precedence over the shared compatibility default", () =>
  Effect.gen(function* () {
    const services = yield* Layer.build(buildLocationServiceMap())
    const replacement = Context.get(services, LocationServiceMap.Service)
    const actual = yield* LocationServiceMap.Service.pipe(
      Effect.provide(
        AppNodeBuilderV1.build(LocationServiceMap.node, [
          [LocationServiceMap.node, Layer.succeed(LocationServiceMap.Service)(replacement)],
        ]),
      ),
    )
    expect(actual).toBe(replacement)
  }),
)

it.live("shared rewriteCache prevents conflicting implementations when replacements and hoisted location services share a dependency", () =>
  Effect.gen(function* () {
    class Base extends Context.Service<Base, { readonly id: string }>()("test/Base") {}
    class Shared extends Context.Service<Shared, { readonly id: string }>()("test/Shared") {}
    class Bound extends Context.Service<Bound, { readonly shared: { readonly id: string } }>()("test/Bound") {}
    class Hoisted extends Context.Service<Hoisted, { readonly shared: { readonly id: string } }>()("test/Hoisted") {}
    class Root extends Context.Service<
      Root,
      {
        readonly bound: { readonly shared: { readonly id: string } }
        readonly hoisted: { readonly shared: { readonly id: string } }
      }
    >()("test/Root") {}

    const baseNode = Node.makeGlobalNode({
      service: Base,
      layer: Layer.succeed(Base)({ id: "default" }),
      deps: [],
    })
    const sharedNode = Node.makeGlobalNode({
      service: Shared,
      layer: Layer.effect(
        Shared,
        Effect.map(Base, (b) => ({ id: `shared:${b.id}` })),
      ),
      deps: [baseNode],
    })
    const boundDefaultNode = Node.makeLocationNode({
      service: Bound,
      layer: Layer.effect(
        Bound,
        Effect.map(Shared, (shared) => ({ shared })),
      ),
      deps: [sharedNode],
    })
    const boundReplacementNode = Node.makeLocationNode({
      service: Bound,
      layer: Layer.effect(
        Bound,
        Effect.map(Shared, (shared) => ({ shared })),
      ),
      deps: [sharedNode],
    })
    const hoistedNode = Node.makeGlobalNode({
      service: Hoisted,
      layer: Layer.effect(
        Hoisted,
        Effect.map(Shared, (shared) => ({ shared })),
      ),
      deps: [sharedNode],
    })
    const rootNode = Node.makeLocationNode({
      service: Root,
      layer: Layer.effect(
        Root,
        Effect.all({ bound: Bound, hoisted: Hoisted }),
      ),
      deps: [boundDefaultNode, hoistedNode],
    })

    const replacements: LayerNode.Replacements = [
      [baseNode, Layer.succeed(Base)({ id: "custom" })],
      [boundDefaultNode, boundReplacementNode],
    ]
    const hoisted = LayerNode.hoist(rootNode, Node.tags.values.global, replacements)
    const actual = yield* Root.pipe(
      Effect.provide(
        LayerNode.compile(hoisted.node).pipe(Layer.provideMerge(LayerNode.compile(hoisted.hoisted))),
      ),
    )

    expect(actual.bound.shared.id).toBe("shared:custom")
    expect(actual.hoisted.shared.id).toBe("shared:custom")
    expect(actual.bound.shared).toBe(actual.hoisted.shared)
  }),
)



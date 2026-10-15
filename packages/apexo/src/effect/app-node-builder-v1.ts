import { buildLocationServiceMap, LocationServiceMap } from "@apexo/core/location-services"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"

const bootstrapReplacement = [InstanceStore.bootstrapNode, InstanceBootstrap.node] as const
// Shared service implementations can be memoized across compatibility entrypoints.
// Their captured Location map must have the same identity in each default graph.
export const locationServiceMap = buildLocationServiceMap([bootstrapReplacement])

export function build<A, E>(root: LayerNode.Node<A, E, any>, replacements: LayerNode.Replacements = []) {
  return AppNodeBuilder.build(
    root,
    replacements.concat(
      replacements.length > 0
        ? [bootstrapReplacement]
        : [bootstrapReplacement, [LocationServiceMap.node, locationServiceMap]],
    ),
  )
}

export * as AppNodeBuilderV1 from "./app-node-builder-v1"

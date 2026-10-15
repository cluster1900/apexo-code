import path from "node:path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { MCP } from "@apexo/core/mcp"
import { McpPreferences } from "@apexo/core/mcp-preferences"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { AbsolutePath } from "@apexo/schema/schema"
const root = process.argv[2],
  action = process.argv[3]
const location = { directory: AbsolutePath.make(path.join(root, "project")) }
if (action === "store") {
  await Effect.runPromise(
    McpPreferences.make(location, path.join(root, "data")).change(process.argv[4], true, () => Effect.void),
  )
  console.log("RESULT " + JSON.stringify({ saved: process.argv[4] }))
} else {
  const layer = AppNodeBuilder.build(LayerNode.group([SessionV2.node, LocationServiceMap.node]), [
    [
      Global.node,
      Layer.succeed(Global.Service)(
        Global.make({
          data: path.join(root, "data"),
          config: path.join(root, "config"),
          home: root,
        }),
      ),
    ],
    [SessionExecution.node, SessionExecution.noopLayer],
  ])
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service,
        locations = yield* LocationServiceMap.Service
      const session = yield* sessions.create({ location })
      return yield* Effect.gen(function* () {
        const mcp = yield* MCP.Service
        if (action === "connect") yield* mcp.connect("local")
        if (action === "disconnect") yield* mcp.disconnect("local")
        return yield* mcp.status
      }).pipe(Effect.provide(locations.get(session.location)))
    }).pipe(Effect.scoped, Effect.provide(layer)),
  )
  console.log("RESULT " + JSON.stringify(result))
}

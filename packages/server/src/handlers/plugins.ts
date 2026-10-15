import path from "node:path"
import { Global } from "@apexo/core/global"
import { PluginStore } from "@apexo/core/plugin-store"
import { PluginBundleRuntime } from "@apexo/core/plugin-bundle-runtime"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "@apexo/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const PluginsHandler = HttpApiBuilder.group(Api, "server.plugins", (handlers) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const root = path.join(global.data, "plugins")
    const run = <A>(operation: () => Promise<A>) =>
      Effect.tryPromise({
        try: operation,
        catch: (error) => {
          const message = error instanceof Error ? error.message : String(error)
          if (error instanceof PluginStore.Error && error.code !== "failed") return new InvalidRequestError({ message })
          return new ServiceUnavailableError({ message })
        },
      })

    return handlers
      .handle("plugins.list", () => run(() => PluginStore.catalog(root)))
      .handle("plugins.detail", (ctx) => run(() => PluginStore.detail(root, ctx.query.id)))
      .handle("plugins.manage", (ctx) => run(() => PluginStore.mutate(root, ctx.payload)))
      .handle(
        "plugins.runtime",
        Effect.fn(function* () {
          const runtime = yield* PluginBundleRuntime.Service
          return yield* runtime.status
        }),
      )
      .handle(
        "plugins.reload",
        Effect.fn(function* () {
          const runtime = yield* PluginBundleRuntime.Service
          yield* runtime.reload().pipe(
            Effect.mapError((error) => {
              if (error.code === "busy") return new ConflictError({ message: error.message })
              if (error.code === "invalid" || error.code === "unsupported")
                return new InvalidRequestError({ message: error.message })
              return new ServiceUnavailableError({ message: error.message })
            }),
          )
          return true
        }),
      )
  }),
)

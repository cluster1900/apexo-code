export * as PluginBundleState from "./plugin-bundle-state"

import path from "node:path"
import { Context, Effect, Layer, Schema } from "effect"
import { RuntimeFailure, type Runtime } from "@apexo/schema/plugin-store"
import { makeLocationNode } from "./effect/app-node"
import { Global } from "./global"
import { PluginStore } from "./plugin-store"
import { PluginBundle } from "./plugin-bundle"
import { ConfigHooks } from "./config/hooks"
import { ConfigV1 } from "./v1/config/config"
import { HostHooks } from "./hooks"

export class Failure extends Schema.TaggedErrorClass<Failure>()("PluginBundleRuntime.Failure", RuntimeFailure.fields) {}
export type Snapshot = {
  generation: number
  active: string[]
  config: typeof ConfigV1.Info.Type
  skills: Awaited<ReturnType<typeof PluginBundle.read>>["skills"]
  sources: HostHooks.Source[]
}
export const Candidate = Context.Reference<Snapshot | undefined>("@apexo/PluginBundleCandidate", {
  defaultValue: () => undefined,
})

const make = Effect.gen(function* () {
  const global = yield* Global.Service
  const captures: Awaited<ReturnType<typeof PluginStore.capture>>[] = []
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      for (const captured of captures) await captured.release()
    }),
  )
  const current: { value: Snapshot; failure?: Failure } = {
    value: { generation: 0, active: [], config: {}, skills: [], sources: [] },
  }
  const stage = () =>
    Effect.tryPromise({
      try: async () => {
        const captured = await PluginStore.capture(path.join(global.data, "plugins"))
        captures.push(captured)
        const plugins = captured.plugins
        const bundles = await Promise.all(
          plugins.map(async (plugin) => {
            if (!plugin.trusted) throw new Failure({ code: "invalid", message: "Enabled plugin is not trusted" })
            const bundle = await PluginBundle.read(plugin.root, plugin.item.name, { native: true, data: plugin.data })
            for (const groups of Object.values(ConfigHooks.normalize(bundle.hooks))) {
              const decoded = Schema.decodeUnknownSync(Schema.Array(ConfigHooks.Group))(groups)
              for (const group of decoded)
                for (const hook of group.hooks)
                  if (hook.type === "command" ? !hook.command?.trim() : !hook.url?.trim())
                    throw new Failure({ code: "invalid", message: "Plugin hook handler is missing its command or URL" })
            }
            return { plugin, bundle }
          }),
        )
        const config = Schema.decodeUnknownSync(ConfigV1.Info)(
          bundles.reduce<ConfigV1.Info>(
            (result, { bundle }) => ({
              command: { ...result.command, ...bundle.config.command },
              agent: { ...result.agent, ...bundle.config.agent },
              mcp: { ...result.mcp, ...bundle.config.mcp },
              lsp: {
                ...(typeof result.lsp === "object" ? result.lsp : {}),
                ...(typeof bundle.config.lsp === "object" ? bundle.config.lsp : {}),
              },
            }),
            {},
          ),
        )
        return {
          generation: current.value.generation + 1,
          active: plugins.map((plugin) => plugin.item.id),
          config,
          skills: bundles.flatMap(({ bundle }) => bundle.skills),
          sources: bundles.map(({ plugin, bundle }) => ({
            name: plugin.item.name,
            pluginID: plugin.item.id,
            root: plugin.root,
            data: plugin.data,
            host: false,
            hooks: ConfigHooks.normalize(bundle.hooks),
          })),
        } satisfies Snapshot
      },
      catch: (error) =>
        error instanceof PluginBundle.Unsupported
          ? new Failure({ code: "unsupported", message: error.message, components: error.components })
          : error instanceof Failure
            ? error
            : new Failure({
                code:
                  (error instanceof PluginStore.Error && error.code === "invalid") || Schema.isSchemaError(error)
                    ? "invalid"
                    : "load",
                message: "Could not validate installed plugin bundles",
              }),
    }).pipe(Effect.uninterruptible)
  yield* stage().pipe(
    Effect.tap((value) =>
      Effect.sync(() => {
        current.value = value
      }),
    ),
    Effect.catch((failure) =>
      Effect.sync(() => {
        current.failure = failure
      }),
    ),
  )
  return {
    get: Effect.map(Candidate, (candidate) => candidate ?? current.value),
    stage,
    publish: (value: Snapshot) => {
      current.value = value
      current.failure = undefined
    },
    failed: (failure: Failure) => {
      current.failure = failure
    },
    status: Effect.sync(
      (): Runtime => ({ generation: current.value.generation, active: current.value.active, failure: current.failure }),
    ),
  }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/PluginBundleState") {}
export const layer = Layer.effect(Service, make)
export const node = makeLocationNode({ service: Service, layer, deps: [Global.node] })

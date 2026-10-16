import { Context, Effect, Layer, ScopedCache } from "effect"
import { HttpClient } from "effect/unstable/http"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { httpClient } from "@apexo/core/effect/app-node-platform"
import { Global } from "@apexo/core/global"
import { MemoryEmbedding } from "@apexo/core/memory-embedding"
import { MemorySearch } from "@apexo/core/memory-search"
import { MemoryMaintenance } from "@apexo/core/memory-maintenance"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Provider } from "@/provider/provider"

export interface Interface {
  readonly get: (fallbackProviderID?: ProviderV2.ID) => Effect.Effect<MemorySearch.Interface, MemorySearch.MemoryError>
  readonly resolveEmbedding: (
    fallbackProviderID?: ProviderV2.ID,
  ) => Effect.Effect<MemoryEmbedding.Client | undefined, MemoryEmbedding.Error>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/MemoryIndex") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const auth = yield* Auth.Service
    const http = yield* HttpClient.HttpClient
    const resolveEmbedding = Effect.fn("MemoryIndex.resolveEmbedding")(function* (fallbackProviderID?: ProviderV2.ID) {
      const cfg = yield* config.get()
      const fallback =
        fallbackProviderID ??
        (yield* provider.defaultModel().pipe(
          Effect.map((item) => item.providerID),
          Effect.catch(() => Effect.succeed(undefined)),
        ))
      const parsed = yield* MemoryEmbedding.parseModelReference(cfg.memory?.embedding, fallback)
      if (!parsed) return undefined
      const allProviders = yield* provider.list()
      const providerInfo = allProviders[parsed.providerID]
      if (!providerInfo)
        return yield* new MemoryEmbedding.Error({
          reason: "unavailable_provider",
          message: `Memory embedding provider "${parsed.providerID}" is unavailable`,
        })
      const ownModel = providerInfo.models[parsed.modelID]
      if (!parsed.explicitProvider && !ownModel) {
        const foreignOwner = Object.values(allProviders)
          .flatMap((item) => Object.values(item.models))
          .find(
            (item) =>
              item.providerID !== parsed.providerID &&
              (item.id === ModelV2.ID.make(parsed.modelID) || item.api.id === parsed.modelID),
          )
        if (foreignOwner)
          return yield* new MemoryEmbedding.Error({
            reason: "invalid_model",
            message: `Unqualified embedding model "${parsed.modelID}" belongs to provider "${foreignOwner.providerID}"; qualify the provider explicitly`,
          })
      }
      const configuredBaseURL =
        typeof providerInfo.options?.baseURL === "string" && providerInfo.options.baseURL.trim()
          ? providerInfo.options.baseURL.trim()
          : Object.values(providerInfo.models)[0]?.api.url
      const providerEndpoint = MemoryEmbedding.defaultProviderURL({
        id: parsed.providerID,
        api: { type: "aisdk", url: configuredBaseURL },
      })
      if (!providerEndpoint)
        return yield* new MemoryEmbedding.Error({
          reason: "invalid_endpoint",
          message: `Memory embedding provider "${parsed.providerID}" has no configured API endpoint`,
        })
      const normalizedProviderEndpoint = yield* MemoryEmbedding.normalizeEndpoint(providerEndpoint)
      if (ownModel?.api.url) {
        const normalizedModelEndpoint = yield* MemoryEmbedding.normalizeEndpoint(ownModel.api.url)
        if (normalizedModelEndpoint.origin !== normalizedProviderEndpoint.origin)
          return yield* new MemoryEmbedding.Error({
            reason: "invalid_endpoint",
            message: "Memory embedding model cannot override the provider endpoint origin",
          })
      }
      const authInfo = yield* auth.get(parsed.providerID).pipe(Effect.orDie)
      const envKey =
        parsed.providerID === "xai"
          ? (process.env.XAI_API_KEY ?? process.env.GROK_API_KEY)
          : parsed.providerID === "openai"
            ? process.env.OPENAI_API_KEY
            : undefined
      const rawKey =
        authInfo?.type === "api"
          ? authInfo.key
          : authInfo?.type === "oauth"
            ? authInfo.access
            : typeof providerInfo.options?.apiKey === "string"
              ? providerInfo.options.apiKey
              : (providerInfo.key ?? envKey)
      if (typeof rawKey !== "string" || !rawKey.trim())
        return yield* new MemoryEmbedding.Error({
          reason: "unauthorized",
          message: `No API key is configured for embedding provider "${parsed.providerID}"`,
        })
      return yield* MemoryEmbedding.makeClient({
        providerID: parsed.providerID,
        model: ownModel?.api.id || parsed.modelID,
        endpoint: ownModel?.api.url ?? providerEndpoint,
        dimensions: parsed.dimensions,
        key: rawKey,
        headers:
          typeof providerInfo.options?.headers === "object" && providerInfo.options.headers !== null
            ? (providerInfo.options.headers as Record<string, string>)
            : undefined,
        http,
      })
    })
    const state = yield* InstanceState.make(
      Effect.fn("MemoryIndex.state")(function* (ctx) {
        return yield* ScopedCache.make({
          capacity: 2,
          lookup: (key: string) =>
            Effect.gen(function* () {
              const fallback = key.split("\0")[1]
              return yield* MemorySearch.make({
                search: (yield* config.get()).memory?.search,
                embedding: () =>
                  resolveEmbedding(fallback ? ProviderV2.ID.make(fallback) : undefined),
                directory: ctx.directory,
                projectID: ctx.project.id,
                home: global.home,
              })
            }),
        })
      }),
    )
    return Service.of({
      resolveEmbedding,
      get: Effect.fn("MemoryIndex.get")(function* (fallbackProviderID?: ProviderV2.ID) {
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
        return yield* ScopedCache.get(index, `${generation}\0${fallbackProviderID ?? ""}`)
      }),
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Global.node, Config.node, Provider.node, Auth.node, httpClient],
})

export * as MemoryIndex from "./memory-index"

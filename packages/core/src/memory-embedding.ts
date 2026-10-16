export * as MemoryEmbedding from "./memory-embedding"

import { Cause, Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Catalog } from "./catalog"
import { ConfigMemory } from "./config/memory"
import { makeLocationNode } from "./effect/app-node"
import { LayerNodePlatform } from "./effect/app-node-platform"
import { Integration } from "./integration"
import { MemoryV2 } from "./memory-v2"
import { ModelV2 } from "./model"
import { ProviderV2 } from "./provider"
import { collectBoundedResponseBody } from "./tool/http-body"

export const Reason = Schema.Literals([
  "unsupported_provider",
  "invalid_model",
  "unavailable_provider",
  "unauthorized",
  "invalid_endpoint",
  "transport",
  "malformed_response",
])
export type Reason = typeof Reason.Type

export class Error extends Schema.TaggedErrorClass<Error>()("MemoryEmbeddingError", {
  reason: Reason,
  message: Schema.String,
}) {}

export type Client = {
  readonly identity: string
  readonly providerID: ProviderV2.ID
  readonly model: string
  readonly endpoint: string
  readonly dimensions: number
  readonly embed: (inputs: readonly string[]) => Effect.Effect<readonly (readonly number[])[], Error>
}

export interface Interface {
  readonly resolve: (input: {
    embedding?: ConfigMemory.Embedding
    fallbackProviderID?: ProviderV2.ID
  }) => Effect.Effect<Client | undefined, Error>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/MemoryEmbedding") {}

const DEFAULT_DIMENSIONS = 1024
const MAX_DIMENSIONS = 4096
const BATCH_SIZE = 32
const MAX_ATTEMPTS = 3
const MAX_REQUEST_BYTES = 512 * 1024
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

export const defaultProviderURL = (provider: {
  id: ProviderV2.ID
  api: { type: string; package?: string; url?: string }
}) => {
  if (provider.api.url) return provider.api.url
  if ((provider.api.type === "aisdk" && provider.api.package === "@ai-sdk/xai") || provider.id === "xai")
    return "https://api.x.ai/v1"
  if ((provider.api.type === "aisdk" && provider.api.package === "@ai-sdk/openai") || provider.id === "openai")
    return "https://api.openai.com/v1"
  return undefined
}

export const normalizeEndpoint = (raw: string): Effect.Effect<{ origin: string; url: string }, Error> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => new URL(raw),
      catch: () => new Error({ reason: "invalid_endpoint", message: "Invalid memory embedding endpoint URL" }),
    })
    if (parsed.username || parsed.password)
      return yield* new Error({
        reason: "invalid_endpoint",
        message: "Memory embedding endpoint URL must not include credentials",
      })
    if (
      parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
    )
      return yield* new Error({
        reason: "invalid_endpoint",
        message: "Memory embedding endpoint must use HTTPS or loopback HTTP",
      })
    const base = parsed.toString().replace(/\/+$/, "")
    const url = base.endsWith("/embeddings") ? base : `${base}/embeddings`
    return { origin: parsed.origin, url }
  })

export const makeClient = Effect.fn("MemoryEmbedding.makeClient")(function* (input: {
  providerID: ProviderV2.ID
  model: string
  endpoint: string
  dimensions?: number
  key: string
  headers?: Readonly<Record<string, string>>
  http: HttpClient.HttpClient
}) {
  const dimensions = input.dimensions ?? DEFAULT_DIMENSIONS
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_DIMENSIONS)
    return yield* new Error({
      reason: "invalid_model",
      message: `Memory embedding dimensions must be an integer between 1 and ${MAX_DIMENSIONS}`,
    })
  const key = input.key.trim()
  if (!key)
    return yield* new Error({
      reason: "unauthorized",
      message: `No API key is configured for embedding provider ${input.providerID}`,
    })
  const normalized = yield* normalizeEndpoint(input.endpoint)
  const identity = MemoryV2.hash(
    JSON.stringify(["api", input.providerID, input.model, normalized.url, dimensions]),
  )
  const headers = { ...input.headers, authorization: `Bearer ${key}` }

  const embedBatch = (batch: readonly string[]) =>
    Effect.gen(function* () {
      const payload = {
        model: input.model,
        input: batch,
        dimensions,
      }
      if (Buffer.byteLength(JSON.stringify(payload)) > MAX_REQUEST_BYTES)
        return yield* new Error({
          reason: "invalid_model",
          message: "Memory embedding batch exceeds the request size bound",
        })
      let attempt = 0
      while (true) {
        attempt++
        const outcome = yield* Effect.gen(function* () {
          const request = yield* HttpClientRequest.post(normalized.url).pipe(
            HttpClientRequest.bodyJson(payload),
            Effect.mapError(() => ({
              transient: false as const,
              error: new Error({ reason: "transport", message: "Could not encode memory embedding request" }),
            })),
          )
          const response = yield* input.http
            .execute(request.pipe(HttpClientRequest.setHeaders(headers)))
            .pipe(
              Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
              Effect.mapError((cause) => ({
                transient: true as const,
                error: new Error({
                  reason: "transport",
                  message: cause instanceof globalThis.Error ? cause.message : "Memory embedding request failed",
                }),
              })),
            )
          if (response.status < 200 || response.status >= 300) {
            const transient = [408, 409, 429, 500, 502, 503, 504].includes(response.status)
            return yield* Effect.fail({
              transient,
              error: new Error({
                reason: response.status === 401 || response.status === 403 ? "unauthorized" : "transport",
                message: `Memory embedding API returned HTTP ${response.status}`,
              }),
            })
          }
          const bytes = yield* collectBoundedResponseBody(
            response,
            MAX_RESPONSE_BYTES,
            () => new Error({ reason: "malformed_response", message: "Memory embedding response exceeds size limit" }),
          ).pipe(
            Effect.mapError((error) => ({
              transient: false as const,
              error:
                error instanceof Error
                  ? error
                  : new Error({ reason: "transport", message: "Failed to read memory embedding response" }),
            })),
          )
          const decoded = yield* Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)(
            new TextDecoder().decode(bytes),
          ).pipe(
            Effect.mapError(() => ({
              transient: false as const,
              error: new Error({ reason: "malformed_response", message: "Memory embedding response is not valid JSON" }),
            })),
          )
          return yield* validateBatchResponse(decoded, batch.length, dimensions).pipe(
            Effect.mapError((error) => ({ transient: false as const, error })),
          )
        }).pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterrupts(cause)) return Effect.failCause(cause)
            const failure = Cause.squash(cause)
            if (
              typeof failure === "object" &&
              failure !== null &&
              "transient" in failure &&
              "error" in failure &&
              failure.error instanceof Error
            ) {
              return Effect.fail(failure as { transient: boolean; error: Error })
            }
            return Effect.fail({
              transient: false,
              error:
                failure instanceof Error
                  ? failure
                  : new Error({ reason: "transport", message: "Memory embedding request failed" }),
            })
          }),
          Effect.result,
        )
        if (outcome._tag === "Success") return outcome.success
        if (!outcome.failure.transient || attempt >= MAX_ATTEMPTS) return yield* Effect.fail(outcome.failure.error)
        yield* Effect.sleep(`${attempt * 50} millis`)
      }
    })

  const embed: Client["embed"] = Effect.fn("MemoryEmbedding.embed")(function* (inputs) {
    if (!inputs.length) return []
    const vectors: (readonly number[])[] = []
    for (let offset = 0; offset < inputs.length; offset += BATCH_SIZE) {
      const batch = inputs.slice(offset, offset + BATCH_SIZE)
      const batchVectors = yield* embedBatch(batch)
      vectors.push(...batchVectors)
    }
    return vectors
  })

  return {
    identity,
    providerID: input.providerID,
    model: input.model,
    endpoint: normalized.url,
    dimensions,
    embed,
  } satisfies Client
})

function validateBatchResponse(
  payload: unknown,
  expectedCount: number,
  expectedDimensions: number,
): Effect.Effect<readonly (readonly number[])[], Error> {
  if (typeof payload !== "object" || payload === null || !("data" in payload) || !Array.isArray(payload.data))
    return Effect.fail(
      new Error({ reason: "malformed_response", message: "Memory embedding response is missing data array" }),
    )
  const items = payload.data
  if (items.length !== expectedCount)
    return Effect.fail(
      new Error({
        reason: "malformed_response",
        message: `Memory embedding response count ${items.length} does not match requested ${expectedCount}`,
      }),
    )
  const ordered = new Array<readonly number[] | undefined>(expectedCount)
  for (const item of items) {
    if (typeof item !== "object" || item === null || !("index" in item) || !("embedding" in item))
      return Effect.fail(
        new Error({ reason: "malformed_response", message: "Memory embedding item is missing index or embedding" }),
      )
    const index = item.index
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= expectedCount)
      return Effect.fail(
        new Error({ reason: "malformed_response", message: "Memory embedding item has out-of-bounds index" }),
      )
    if (ordered[index] !== undefined)
      return Effect.fail(
        new Error({ reason: "malformed_response", message: "Memory embedding response has duplicate index" }),
      )
    const vector = item.embedding
    if (!Array.isArray(vector) || vector.length !== expectedDimensions)
      return Effect.fail(
        new Error({
          reason: "malformed_response",
          message: `Memory embedding vector length does not match expected dimensions ${expectedDimensions}`,
        }),
      )
    for (const value of vector) {
      if (typeof value !== "number" || !Number.isFinite(value))
        return Effect.fail(
          new Error({
            reason: "malformed_response",
            message: "Memory embedding vector contains non-finite numbers",
          }),
        )
    }
    ordered[index] = vector
  }
  const complete: (readonly number[])[] = []
  for (const entry of ordered) {
    if (!entry)
      return Effect.fail(
        new Error({ reason: "malformed_response", message: "Memory embedding response is missing an indexed result" }),
      )
    complete.push(entry)
  }
  return Effect.succeed(complete)
}

export const parseModelReference = (
  embedding: ConfigMemory.Embedding | undefined,
  fallbackProviderID?: ProviderV2.ID,
): Effect.Effect<{ providerID: ProviderV2.ID; modelID: string; explicitProvider: boolean; dimensions: number } | undefined, Error> =>
  Effect.gen(function* () {
    if (!embedding) return undefined
    const providerType = embedding.provider ?? "api"
    if (providerType !== "api")
      return yield* new Error({
        reason: "unsupported_provider",
        message: `Unsupported memory embedding provider "${providerType}"; only "api" is supported`,
      })
    const raw = embedding.model?.trim()
    if (!raw) return undefined
    const dimensions = embedding.dimensions ?? DEFAULT_DIMENSIONS
    if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_DIMENSIONS)
      return yield* new Error({
        reason: "invalid_model",
        message: `Memory embedding dimensions must be an integer between 1 and ${MAX_DIMENSIONS}`,
      })
    if (raw.includes("/")) {
      const parts = raw.split("/")
      if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim())
        return yield* new Error({
          reason: "invalid_model",
          message: "Invalid memory embedding model reference",
        })
      return {
        providerID: ProviderV2.ID.make(parts[0].trim()),
        modelID: parts[1].trim(),
        explicitProvider: true,
        dimensions,
      }
    }
    if (!fallbackProviderID)
      return yield* new Error({
        reason: "unavailable_provider",
        message: "Unqualified memory embedding model requires a configured Session or default provider",
      })
    return {
      providerID: fallbackProviderID,
      modelID: raw,
      explicitProvider: false,
      dimensions,
    }
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const integrations = yield* Integration.Service
    const http = yield* HttpClient.HttpClient
    return Service.of({
      resolve: Effect.fn("MemoryEmbedding.resolve")(function* (input) {
        const defaultModel = input.fallbackProviderID ? undefined : yield* catalog.model.default()
        const parsed = yield* parseModelReference(
          input.embedding,
          input.fallbackProviderID ?? defaultModel?.providerID,
        )
        if (!parsed) return undefined
        const provider = yield* catalog.provider.get(parsed.providerID)
        if (!provider || provider.disabled)
          return yield* new Error({
            reason: "unavailable_provider",
            message: `Memory embedding provider "${parsed.providerID}" is unavailable`,
          })
        if (!parsed.explicitProvider) {
          const allModels = yield* catalog.model.all()
          const foreignOwner = allModels.find(
            (item) =>
              item.providerID !== parsed.providerID &&
              (item.id === ModelV2.ID.make(parsed.modelID) || item.api.id === parsed.modelID),
          )
          const ownModel = yield* catalog.model.get(parsed.providerID, ModelV2.ID.make(parsed.modelID))
          if (foreignOwner && !ownModel)
            return yield* new Error({
              reason: "invalid_model",
              message: `Unqualified embedding model "${parsed.modelID}" belongs to provider "${foreignOwner.providerID}"; qualify the provider explicitly`,
            })
        }
        const providerEndpoint = defaultProviderURL(provider)
        if (!providerEndpoint)
          return yield* new Error({
            reason: "invalid_endpoint",
            message: `Memory embedding provider "${parsed.providerID}" has no configured API endpoint`,
          })
        const normalizedProviderEndpoint = yield* normalizeEndpoint(providerEndpoint)
        const catalogModel = yield* catalog.model.get(parsed.providerID, ModelV2.ID.make(parsed.modelID))
        if (catalogModel?.api.url) {
          const normalizedModelEndpoint = yield* normalizeEndpoint(catalogModel.api.url)
          if (normalizedModelEndpoint.origin !== normalizedProviderEndpoint.origin)
            return yield* new Error({
              reason: "invalid_endpoint",
              message: "Memory embedding model cannot override the provider endpoint origin",
            })
        }
        const connection = yield* integrations.connection.active(
          provider.integrationID ?? Integration.ID.make(parsed.providerID),
        )
        const credential = connection
          ? yield* integrations.connection.resolve(connection).pipe(
              Effect.mapError(
                () =>
                  new Error({
                    reason: "unauthorized",
                    message: `Could not resolve credentials for embedding provider "${parsed.providerID}"`,
                  }),
              ),
            )
          : undefined
        const rawKey =
          credential?.type === "key"
            ? credential.key
            : credential?.type === "oauth"
              ? credential.access
              : (provider.request.body.apiKey ?? provider.api.settings?.apiKey)
        if (typeof rawKey !== "string" || !rawKey.trim())
          return yield* new Error({
            reason: "unauthorized",
            message: `No API key is configured for embedding provider "${parsed.providerID}"`,
          })
        return yield* makeClient({
          providerID: parsed.providerID,
          model: catalogModel?.api.id || parsed.modelID,
          endpoint: catalogModel?.api.url ?? providerEndpoint,
          dimensions: parsed.dimensions,
          key: rawKey,
          headers: provider.request.headers,
          http,
        })
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Catalog.node, Integration.node, LayerNodePlatform.httpClient],
})

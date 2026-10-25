import path from "path"
import { Effect } from "effect"
import { Credential } from "../../credential"
import { FSUtil } from "../../fs-util"
import { Global } from "../../global"
import { InstallationVersion } from "../../installation/version"
import { Integration } from "../../integration"
import { define } from "../internal"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"

const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
const TOKEN_URL = "https://auth.x.ai/oauth2/token"
const DEVICE_AUTHORIZATION_URL = "https://auth.x.ai/oauth2/device/code"
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
const SCOPE = "openid profile email offline_access grok-cli:access api:access"
const DEFAULT_GROK_EFFORTS = ["low", "medium", "high", "xhigh"] as const

const GROK_MODELS = [
  { id: "grok-4.7", name: "Grok 4.7", context_window: 256_000, efforts: [...DEFAULT_GROK_EFFORTS] },
  { id: "grok-4.7-build-fast", name: "Grok 4.7 Fast", context_window: 256_000, efforts: [...DEFAULT_GROK_EFFORTS] },
  { id: "grok-4.6", name: "Grok 4.6", context_window: 256_000, efforts: [...DEFAULT_GROK_EFFORTS] },
  { id: "grok-4.5", name: "Grok 4.5", context_window: 256_000, efforts: [...DEFAULT_GROK_EFFORTS] },
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function authHeaders() {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": `apexo/${InstallationVersion}`,
  }
}

async function refreshAccessToken(refreshToken: string) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`xAI token refresh failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  return (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }
}

export const XAIPlugin = define({
  id: "xai",
  effect: Effect.fn(function* (ctx) {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const integrations = yield* Integration.Service
    const integrationID = Integration.ID.make("xai")
    const oauthMethodID = Integration.MethodID.make("oauth")

    const loadModels = Effect.fnUntraced(function* () {
      const map = new Map<string, { id: string; name: string; context_window: number; efforts: string[] }>(
        GROK_MODELS.map((item) => [item.id, { ...item, efforts: [...item.efforts] }]),
      )
      const grokDir = process.env.GROK_HOME || path.join(global.home, ".grok")
      const raw = yield* fs.readJson(path.join(grokDir, "models_cache.json")).pipe(Effect.orElseSucceed(() => undefined))
      const list = isRecord(raw) && Array.isArray(raw.models) ? raw.models : []
      for (const item of list) {
        if (!isRecord(item) || typeof item.id !== "string" || !item.id) continue
        const prev = map.get(item.id)
        const efforts = Array.isArray(item.reasoning_efforts)
          ? item.reasoning_efforts.flatMap((entry) =>
              isRecord(entry) && typeof entry.effort === "string" && entry.effort ? [entry.effort] : [],
            )
          : []
        map.set(item.id, {
          id: item.id,
          name: typeof item.name === "string" && item.name ? item.name : (prev?.name ?? item.id),
          context_window:
            typeof item.context_window === "number" && item.context_window > 0
              ? item.context_window
              : (prev?.context_window ?? 256_000),
          efforts: efforts.length > 0 ? efforts : (prev?.efforts ?? [...DEFAULT_GROK_EFFORTS]),
        })
      }
      return [...map.values()]
    })

    yield* integrations.transform((draft) =>
      Effect.sync(() => {
        if (!draft.get(integrationID)) {
          draft.update(integrationID, (integration) => {
            integration.name = "xAI"
          })
          draft.method.update({
            integrationID,
            method: { type: "key" },
          })
          draft.method.update({
            integrationID,
            method: { type: "env", names: ["XAI_API_KEY"] },
          })
        }
        draft.method.update({
          integrationID,
          method: {
            id: oauthMethodID,
            type: "oauth",
            label: "SuperGrok Subscription",
            prompts: [],
          },
          authorize: () =>
            Effect.tryPromise(async () => {
              const response = await fetch(DEVICE_AUTHORIZATION_URL, {
                method: "POST",
                headers: authHeaders(),
                body: new URLSearchParams({
                  client_id: CLIENT_ID,
                  scope: SCOPE,
                  referrer: "apexo",
                }).toString(),
              })
              if (!response.ok) {
                const detail = await response.text().catch(() => "")
                throw new Error(`xAI device code request failed (${response.status})${detail ? `: ${detail}` : ""}`)
              }
              const device = (await response.json()) as {
                device_code: string
                user_code: string
                verification_uri: string
                verification_uri_complete?: string
                expires_in?: number
                interval?: number
              }
              return {
                url: device.verification_uri_complete ?? device.verification_uri,
                instructions: `Open ${device.verification_uri} on any device and enter code: ${device.user_code}`,
                mode: "auto" as const,
                callback: Effect.tryPromise(async () => {
                  const expiresInMs =
                    typeof device.expires_in === "number" && device.expires_in > 0 ? device.expires_in * 1000 : 300_000
                  const deadline = Date.now() + expiresInMs
                  let intervalMs =
                    typeof device.interval === "number" && device.interval > 0 ? device.interval * 1000 : 5_000
                  while (Date.now() < deadline) {
                    const poll = await fetch(TOKEN_URL, {
                      method: "POST",
                      headers: authHeaders(),
                      body: new URLSearchParams({
                        grant_type: DEVICE_CODE_GRANT_TYPE,
                        client_id: CLIENT_ID,
                        device_code: device.device_code,
                      }).toString(),
                    })
                    if (poll.ok) {
                      const tokens = (await poll.json()) as {
                        access_token: string
                        refresh_token: string
                        expires_in?: number
                      }
                      return Credential.OAuth.make({
                        type: "oauth",
                        methodID: oauthMethodID,
                        access: tokens.access_token,
                        refresh: tokens.refresh_token,
                        expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                      })
                    }
                    const body = (await poll.json().catch(() => ({}))) as { error?: string; error_description?: string }
                    if (body.error === "authorization_pending") {
                      await new Promise((resolve) => setTimeout(resolve, intervalMs + 3_000))
                      continue
                    }
                    if (body.error === "slow_down") {
                      intervalMs += 5_000
                      await new Promise((resolve) => setTimeout(resolve, intervalMs + 3_000))
                      continue
                    }
                    throw new Error(body.error_description ?? body.error ?? `xAI device token exchange failed (${poll.status})`)
                  }
                  throw new Error("xAI device authorization timed out")
                }),
              }
            }),
          refresh: (credential) =>
            Effect.tryPromise(async () => {
              const tokens = await refreshAccessToken(credential.refresh)
              return Credential.OAuth.make({
                type: "oauth",
                methodID: credential.methodID,
                access: tokens.access_token,
                refresh: tokens.refresh_token || credential.refresh,
                expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
              })
            }),
        })
      }),
    )

    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        const providerID = ProviderV2.ID.make("xai")
        const hasProvider = evt.provider.get(providerID) !== undefined
        const hasConnection = (yield* integrations.connection.active(integrationID)) !== undefined
        if (!hasProvider && !hasConnection) return
        evt.provider.update(providerID, (provider) => {
          provider.name ||= "xAI"
          provider.integrationID ??= integrationID
          if (provider.api.type === "native" && !provider.api.url) {
            provider.api = {
              type: "aisdk",
              package: "@ai-sdk/xai",
              url: "https://api.x.ai/v1",
              settings: {},
            }
          }
        })
        const models = yield* loadModels()
        for (const item of models) {
          evt.model.update(providerID, ModelV2.ID.make(item.id), (model) => {
            model.name = item.name
            if (model.api.type === "native" && !model.api.url) {
              model.api = {
                id: item.id,
                type: "aisdk",
                package: "@ai-sdk/xai",
                url: "https://api.x.ai/v1",
                settings: {},
              }
            }
            model.status = "active"
            model.enabled = true
            model.time.released =
              item.id === "grok-4.7" ? Date.parse("2026-04-15") : model.time.released || Date.parse("2026-03-09")
            model.limit = { context: item.context_window, output: 64_000 }
            model.capabilities = {
              tools: true,
              input: ["text", "image"],
              output: ["text"],
            }
            model.variants = item.efforts.map((effort) => ({
              id: ModelV2.VariantID.make(effort),
              headers: {},
              body: { reasoning: { effort } },
            }))
          })
        }
      }),
    )
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/xai") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/xai"))
        evt.sdk = mod.createXai(evt.options)
      }),
    )
    yield* ctx.aisdk.language(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("xai")) return
        evt.language = evt.sdk.responses(evt.model.api.id)
      }),
    )
  }),
})

import path from "path"
import { Effect } from "effect"
import type { Hooks, PluginInput } from "@apexo/plugin"
import { Global } from "@apexo/core/global"
import { InstallationVersion } from "@apexo/core/installation/version"
import { Auth, OAUTH_DUMMY_KEY } from "../auth"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"

// Public Grok-CLI OAuth client.
const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
const TOKEN_URL = "https://auth.x.ai/oauth2/token"
const GROK_OIDC_ENTRY_KEY = `https://auth.x.ai::${CLIENT_ID}`
// RFC 8628 device authorization grant. Confirmed exposed by xAI's
// /.well-known/openid-configuration as `device_authorization_endpoint`
// with the matching `urn:ietf:params:oauth:grant-type:device_code` grant
// in `grant_types_supported`. This is the headless / VPS path: no
// loopback callback server, no SSH port forwarding, no inbound firewall
// holes — the user opens the URL on any device with a browser, types
// the short user_code, and the CLI long-polls the token endpoint.
const DEVICE_AUTHORIZATION_URL = "https://auth.x.ai/oauth2/device/code"
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
const SCOPE = "openid profile email offline_access grok-cli:access api:access"

// Bounds for the device-code poll loop. xAI returns `interval` (seconds)
// but we floor it to avoid hammering and we add the spec's slow_down
// increment when xAI explicitly asks us to back off.
const DEVICE_CODE_DEFAULT_INTERVAL_MS = 5_000
const DEVICE_CODE_MIN_INTERVAL_MS = 1_000
const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5_000
const DEVICE_CODE_DEFAULT_EXPIRES_MS = 5 * 60 * 1000
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000

// Refresh the access token a little before it actually expires so a single
// long-running tool call doesn't have to recover from a mid-flight 401.
const ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000

const DEFAULT_GROK_EFFORTS = ["low", "medium", "high", "xhigh"] as const

const DEFAULT_GROK_MODELS = [
  {
    id: "grok-4.7",
    name: "Grok 4.7",
    context_window: 256_000,
    release_date: "2026-04-15",
    efforts: [...DEFAULT_GROK_EFFORTS],
  },
  {
    id: "grok-4.7-build-fast",
    name: "Grok 4.7 Fast",
    context_window: 256_000,
    release_date: "2026-04-14",
    efforts: [...DEFAULT_GROK_EFFORTS],
  },
  {
    id: "grok-4.6",
    name: "Grok 4.6",
    context_window: 256_000,
    release_date: "2026-03-01",
    efforts: [...DEFAULT_GROK_EFFORTS],
  },
  {
    id: "grok-4.5",
    name: "Grok 4.5",
    context_window: 256_000,
    release_date: "2026-02-01",
    efforts: [...DEFAULT_GROK_EFFORTS],
  },
] as const

export interface XaiAuthPluginOptions {
  tokenUrl?: string
  deviceAuthorizationUrl?: string
  grokDir?: string
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  id_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
}

function defaultGrokDir() {
  return process.env.GROK_HOME || path.join(Global.Path.home, ".grok")
}

export async function readGrokCliAuth(grokDir = defaultGrokDir()): Promise<Auth.Info | undefined> {
  const raw = await Filesystem.readJson(path.join(grokDir, "auth.json")).catch(() => undefined)
  if (!isRecord(raw)) return
  const candidates = [raw[GROK_OIDC_ENTRY_KEY], raw, ...Object.values(raw)]
  for (const item of candidates) {
    if (!isRecord(item)) continue
    const token =
      typeof item.key === "string" && item.key.length > 0
        ? item.key
        : typeof item.access_token === "string" && item.access_token.length > 0
          ? item.access_token
          : undefined
    if (token && typeof item.refresh_token === "string" && item.refresh_token.length > 0) {
      const parsed =
        typeof item.expires_at === "number"
          ? item.expires_at < 1e12
            ? item.expires_at * 1000
            : item.expires_at
          : typeof item.expires_at === "string"
            ? Date.parse(item.expires_at)
            : NaN
      const expires = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
      return {
        type: "oauth",
        access: token,
        refresh: item.refresh_token,
        expires,
      }
    }
    if ((item.auth_mode === "api_key" || item.auth_mode === "api") && typeof item.key === "string" && item.key.length) {
      return {
        type: "api",
        key: item.key,
      }
    }
  }
}

export async function writeGrokCliOAuth(
  tokens: { access: string; refresh: string; expires: number; idToken?: string },
  grokDir = defaultGrokDir(),
) {
  const file = path.join(grokDir, "auth.json")
  const raw = await Filesystem.readJson(file).catch(() => undefined)
  if (!isRecord(raw)) return
  const key =
    GROK_OIDC_ENTRY_KEY in raw
      ? GROK_OIDC_ENTRY_KEY
      : Object.keys(raw).find((k) => isRecord(raw[k]) && raw[k].auth_mode === "oidc")
  if (!key || !isRecord(raw[key])) return
  const updated = {
    ...raw,
    [key]: {
      ...raw[key],
      auth_mode: "oidc",
      key: tokens.access,
      refresh_token: tokens.refresh,
      ...(tokens.idToken ? { id_token: tokens.idToken } : {}),
      expires_at: new Date(tokens.expires).toISOString(),
      last_refresh: new Date().toISOString(),
    },
  }
  await Filesystem.write(file, JSON.stringify(updated, null, 2) + "\n").catch(() => {})
}

export async function readGrokCliModels(grokDir = defaultGrokDir()) {
  const map = new Map<
    string,
    { id: string; name: string; context_window: number; release_date: string; efforts: string[] }
  >(DEFAULT_GROK_MODELS.map((item) => [item.id, { ...item, efforts: [...item.efforts] }]))
  const raw = await Filesystem.readJson(path.join(grokDir, "models_cache.json")).catch(() => undefined)
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
      release_date: prev?.release_date ?? "",
      efforts: efforts.length > 0 ? efforts : (prev?.efforts ?? [...DEFAULT_GROK_EFFORTS]),
    })
  }
  return [...map.values()]
}

export const syncGrokCliAuth = Effect.fn("Xai.syncGrokCliAuth")(function* (
  auth: Auth.Interface,
  grokDir = defaultGrokDir(),
) {
  const external = yield* Effect.promise(() => readGrokCliAuth(grokDir))
  if (!external) return
  const existing = yield* auth.get("xai").pipe(Effect.orElseSucceed(() => undefined))
  if (!existing || (existing.type === "oauth" && external.type === "oauth" && external.expires > existing.expires)) {
    yield* auth.set("xai", external).pipe(Effect.ignore)
  }
})

function authHeaders() {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": `apexo/${InstallationVersion}`,
  }
}

// Parse the `exp` claim out of a JWT access_token without verifying the
// signature. We only use this to decide whether to proactively refresh, never
// to make trust decisions, so unsigned decode is safe. Returns false for
// opaque tokens (no JWT shape), which conservatively skips the proactive
// refresh and lets the 401-on-call path drive the refresh instead.
export function accessTokenIsExpiring(
  token: string | undefined,
  skewMs: number = ACCESS_TOKEN_REFRESH_SKEW_MS,
): boolean {
  if (!token || typeof token !== "string") return false
  const parts = token.split(".")
  if (parts.length < 2) return false
  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    while (payload.length % 4 !== 0) payload += "="
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8"))
    if (typeof claims?.exp !== "number") return false
    return claims.exp * 1000 <= Date.now() + Math.max(0, skewMs)
  } catch {
    return false
  }
}

async function refreshAccessToken(refreshToken: string, options: XaiAuthPluginOptions = {}): Promise<TokenResponse> {
  const response = await fetch(options.tokenUrl ?? TOKEN_URL, {
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
  return response.json() as Promise<TokenResponse>
}

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
}

interface DeviceTokenErrorBody {
  error?: string
  error_description?: string
}

export async function requestDeviceCode(options: XaiAuthPluginOptions = {}): Promise<DeviceCodeResponse> {
  const response = await fetch(options.deviceAuthorizationUrl ?? DEVICE_AUTHORIZATION_URL, {
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
  const json = (await response.json()) as DeviceCodeResponse
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error("xAI device code response is missing device_code / user_code / verification_uri")
  }
  return json
}

// Default sleep used between device-code polls. Test-injectable so we can
// exercise authorization_pending / slow_down branches without real waits.
async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// Normalize a server-supplied seconds value to milliseconds, falling back to
// the supplied default when the input is missing, non-positive, or not a
// finite number. Defends the polling loop against garbage like `NaN`, `"NaN"`,
// `null`, or `-5` from a misbehaving device-code endpoint — without this,
// a NaN interval would slip through `?? default` (NaN is typeof number),
// reach `setTimeout(_, NaN)` which is treated as 0, and busy-loop until the
// hard deadline. Matches the defensive normalization Codex uses for the same
// field (`parseInt(deviceData.interval) || 5`).
function positiveSecondsToMs(value: unknown, defaultMs: number): number {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultMs
}

export async function pollDeviceCodeToken(
  device: DeviceCodeResponse,
  options: XaiAuthPluginOptions & { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<TokenResponse> {
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? (() => Date.now())
  const expiresInMs = positiveSecondsToMs(device.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS)
  const deadline = now() + expiresInMs
  let intervalMs = Math.max(
    positiveSecondsToMs(device.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS),
    DEVICE_CODE_MIN_INTERVAL_MS,
  )

  while (now() < deadline) {
    const response = await fetch(options.tokenUrl ?? TOKEN_URL, {
      method: "POST",
      headers: authHeaders(),
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT_TYPE,
        client_id: CLIENT_ID,
        device_code: device.device_code,
      }).toString(),
    })
    if (response.ok) return (await response.json()) as TokenResponse

    const body = (await response.json().catch(() => ({}))) as DeviceTokenErrorBody
    const remaining = Math.max(0, deadline - now())
    // RFC 8628 §3.5: authorization_pending = keep polling at the same
    // interval; slow_down = bump the interval by ≥5s and keep polling.
    // Anything else is terminal.
    if (body.error === "authorization_pending") {
      await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, remaining))
      continue
    }
    if (body.error === "slow_down") {
      intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS
      await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, remaining))
      continue
    }
    if (body.error === "access_denied" || body.error === "authorization_denied") {
      throw new Error("xAI device authorization was denied")
    }
    if (body.error === "expired_token") {
      throw new Error("xAI device code expired - please re-run login")
    }
    const detail = body.error_description ?? body.error ?? ""
    throw new Error(`xAI device token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  throw new Error("xAI device authorization timed out")
}

interface RefreshResult {
  access: string
  refresh: string
  expires: number
}

export async function XaiAuthPlugin(input: PluginInput, options: XaiAuthPluginOptions = {}): Promise<Hooks> {
  return {
    provider: {
      id: "xai",
      async models(provider) {
        const extra = await readGrokCliModels(options.grokDir)
        const models: typeof provider.models = {}
        for (const item of extra) {
          const existing = provider.models[item.id]
          const isVideo = /video/i.test(item.id)
          const isImage = /image|imagine/i.test(item.id) && !isVideo
          const isText = !isVideo && !isImage
          models[item.id] = {
            id: item.id,
            providerID: "xai",
            api: existing?.api ?? {
              id: item.id,
              url: "https://api.x.ai/v1",
              npm: "@ai-sdk/xai",
            },
            name: item.name,
            family: item.id,
            capabilities: existing?.capabilities ?? {
              temperature: isText,
              reasoning: isText && item.efforts.length > 0,
              attachment: isText,
              toolcall: isText,
              input: {
                text: true,
                audio: false,
                image: isText || isImage || isVideo,
                video: false,
                pdf: false,
              },
              output: {
                text: isText,
                audio: false,
                image: isImage,
                video: isVideo,
                pdf: false,
              },
              interleaved: false,
            },
            cost: existing?.cost ?? {
              input: 0,
              output: 0,
              cache: { read: 0, write: 0 },
            },
            limit: existing?.limit ?? {
              context: item.context_window,
              output: 64_000,
              context_options: [256_000, 500_000],
            },
            status: existing?.status ?? "active",
            options: existing?.options ?? {},
            headers: existing?.headers ?? {},
            release_date: item.release_date,
            variants:
              existing?.variants ??
              Object.fromEntries(item.efforts.map((effort) => [effort, { reasoningEffort: effort }])),
          }
        }
        return {
          ...models,
          ...Object.fromEntries(Object.entries(provider.models).filter(([id]) => !(id in models))),
        }
      },
    },
    auth: {
      provider: "xai",
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        // Single-flight refresh: collapse concurrent fetches from this loaded
        // provider onto one HTTP call so we don't replay a rotating refresh_token.
        let refreshPromise: Promise<RefreshResult> | undefined

        return {
          // Dummy bearer keeps the AI SDK from bailing on "missing apiKey"; the
          // real OAuth token is injected by the fetch override below.
          // We intentionally do NOT set baseURL — @ai-sdk/xai already defaults
          // to https://api.x.ai/v1 and overriding here would silently route
          // around a user-configured gateway.
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            let currentAuth = await getAuth()
            // Auth can flip from oauth to api mid-session (user re-runs
            // /connect with a pasted key). When that happens, pass the
            // request through untouched so the AI SDK's own apiKey-based
            // Authorization header reaches xAI unmodified.
            if (currentAuth.type !== "oauth") return fetch(requestInput, init)

            // Refresh either when the stored expires timestamp is within the
            // skew window, or — for JWT access tokens — when the JWT exp
            // claim itself is. The stored expires field is best-effort
            // (xAI doesn't always return expires_in) so the JWT check is the
            // load-bearing one for tokens that lack a fresh stored deadline.
            const expiresSoon =
              !currentAuth.expires ||
              currentAuth.expires - Date.now() <= ACCESS_TOKEN_REFRESH_SKEW_MS ||
              accessTokenIsExpiring(currentAuth.access)
            if (expiresSoon) {
              if (!refreshPromise) {
                refreshPromise = (async () => {
                  const external = await readGrokCliAuth(options.grokDir)
                  if (
                    external?.type === "oauth" &&
                    external.expires - Date.now() > ACCESS_TOKEN_REFRESH_SKEW_MS &&
                    !accessTokenIsExpiring(external.access)
                  ) {
                    await input.client.auth
                      .set({
                        path: { id: "xai" },
                        body: external,
                      })
                      .catch(() => {})
                    return { access: external.access, refresh: external.refresh, expires: external.expires }
                  }
                  const refreshToken =
                    external?.type === "oauth" && external.expires > (currentAuth.expires ?? 0)
                      ? external.refresh
                      : currentAuth.refresh
                  const tokens = await refreshAccessToken(refreshToken, options)
                  const refreshedExpires = Date.now() + (tokens.expires_in ?? 3600) * 1000
                  const refreshedRefresh = tokens.refresh_token || refreshToken
                  // Persist the rotated pair to both Apexo auth and ~/.grok/auth.json
                  // so Grok CLI and Apexo stay in sync across rotating refresh tokens.
                  await input.client.auth
                    .set({
                      path: { id: "xai" },
                      body: {
                        type: "oauth",
                        access: tokens.access_token,
                        refresh: refreshedRefresh,
                        expires: refreshedExpires,
                      },
                    })
                    .catch(() => {})
                  await writeGrokCliOAuth(
                    {
                      access: tokens.access_token,
                      refresh: refreshedRefresh,
                      expires: refreshedExpires,
                      idToken: tokens.id_token,
                    },
                    options.grokDir,
                  )
                  return { access: tokens.access_token, refresh: refreshedRefresh, expires: refreshedExpires }
                })().finally(() => {
                  refreshPromise = undefined
                })
              }
              const refreshed = await refreshPromise
              currentAuth = { ...currentAuth, ...refreshed }
            }

            // Copy the caller's headers into a fresh Headers (case-insensitive)
            // so we never mutate the RequestInit the AI SDK may reuse on retry.
            // Headers.set overwrites case-insensitively, which kills the dummy
            // bearer the AI SDK injected from apiKey in a single line.
            const headers = new Headers(requestInput instanceof Request ? requestInput.headers : undefined)
            if (init?.headers) {
              const entries =
                init.headers instanceof Headers
                  ? init.headers.entries()
                  : Array.isArray(init.headers)
                    ? init.headers
                    : Object.entries(init.headers as Record<string, string | undefined>)
              for (const [key, value] of entries) {
                if (value !== undefined) headers.set(key, String(value))
              }
            }
            headers.set("authorization", `Bearer ${currentAuth.access}`)
            headers.set("User-Agent", `apexo/${InstallationVersion}`)

            return fetch(requestInput, { ...init, headers })
          },
        }
      },
      methods: [
        {
          // RFC 8628 device-code flow. The CLI prints a verification URL
          // and a short user_code that the user enters in a browser on
          // any device. No loopback callback server runs on the CLI host,
          // so this works on VPS / SSH / Docker / CI / WSL / any
          // environment where 127.0.0.1:56121 isn't reachable from the
          // user's browser. Defends the only attack surface (the polling
          // loop) with the standard authorization_pending / slow_down
          // backoff and a hard deadline from xAI's `expires_in`.
          label: "SuperGrok Subscription",
          type: "oauth",
          authorize: async () => {
            const device = await requestDeviceCode(options)
            const browserUrl = device.verification_uri_complete ?? device.verification_uri
            return {
              url: browserUrl,
              instructions: `Open ${device.verification_uri} on any device and enter code: ${device.user_code}`,
              method: "auto" as const,
              callback: async () => {
                try {
                  const tokens = await pollDeviceCodeToken(device, options)
                  return {
                    type: "success" as const,
                    refresh: tokens.refresh_token,
                    access: tokens.access_token,
                    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                  }
                } catch (err) {
                  return { type: "failed" as const }
                }
              },
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
  }
}

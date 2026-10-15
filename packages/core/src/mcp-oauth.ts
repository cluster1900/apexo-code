export * as McpOAuth from "./mcp-oauth"

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js"
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js"
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { Mcp } from "@apexo/schema/mcp"
import type { ConfigMCP } from "./config/mcp"
import type { Location } from "./location"
import { McpOAuthStore } from "./mcp-oauth-store"

export type Phase = NonNullable<Mcp.Authentication["flow"]>["phase"]
export type Status = Mcp.Authentication
export type Start = Mcp.AuthenticationStart
export class Failure extends Error {
  constructor(readonly code: Mcp.AuthenticationError) {
    super(
      {
        invalid: "MCP authentication configuration is invalid",
        auth: "MCP authentication is required or was declined",
        storage: "Could not access saved MCP authentication; repair the private credential store and try again",
        conflict: "MCP authentication changed; retry the current connection",
        not_found: "MCP authentication operation is not current",
        unsupported: "MCP authentication is unavailable for this connection",
        cancelled: "MCP authentication was cancelled",
        expired: "MCP authentication expired; start again",
        load: "MCP authentication could not complete; try again",
      }[code],
    )
    this.name = "McpOAuth.Failure"
  }
}
const safe = (error: unknown) =>
  error instanceof Failure
    ? error
    : error instanceof McpOAuthStore.Failure
      ? new Failure(error.code)
      : new Failure("load")
const remote = (url: string) => {
  const parsed = url.length <= 8192 && URL.canParse(url) ? new URL(url) : undefined
  if (!parsed || parsed.username || parsed.password || parsed.hash) throw new Failure("invalid")
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
  )
    throw new Failure("unsupported")
  return parsed
}
const configuration = (server: ConfigMCP.Remote) => {
  remote(server.url)
  const config = typeof server.oauth === "object" ? server.oauth : undefined
  const redirect = config?.redirect_uri ? remote(config.redirect_uri) : undefined
  if (redirect && (redirect.protocol !== "http:" || redirect.hostname !== "127.0.0.1" || redirect.search))
    throw new Failure("unsupported")
  return { config, redirect }
}
const eligible = (server: typeof ConfigMCP.Server.Type | undefined): server is ConfigMCP.Remote =>
  server?.type === "remote" &&
  server.oauth !== false &&
  !Object.keys(server.headers ?? {}).some((name) => name.toLowerCase() === "authorization")
export const supported = (server: typeof ConfigMCP.Server.Type | undefined): server is ConfigMCP.Remote => {
  if (!eligible(server)) return false
  try {
    remote(server.url)
    return true
  } catch {
    return false
  }
}
export const identity = (location: Location.Ref, name: string, server: ConfigMCP.Remote) =>
  JSON.stringify([
    location.directory,
    location.workspaceID ?? null,
    name,
    remote(server.url).href,
    createHash("sha256")
      .update(
        JSON.stringify([
          server.oauth ?? {},
          Object.entries(server.headers ?? {}).sort(([a], [b]) => a.localeCompare(b)),
        ]),
      )
      .digest("hex"),
  ])

/** OAuth requests are finite JSON exchanges; never follow a credential-bearing redirect. */
const boundedFetch =
  (signal: AbortSignal): FetchLike =>
  async (input, init) => {
    const controller = AbortSignal.any([signal, AbortSignal.timeout(10000), ...(init?.signal ? [init.signal] : [])])
    const request = { url: remote(String(input)) }
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetch(request.url, {
        ...init,
        signal: controller,
        redirect: "manual",
      })
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        if ((init?.method ?? "GET") !== "GET" || new Headers(init?.headers).has("authorization") || redirects === 3)
          throw new Failure("invalid")
        request.url = remote(new URL(response.headers.get("location") ?? "", request.url).href)
        continue
      }
      const reader = response.body?.getReader()
      const chunks: Uint8Array[] = []
      const size = { value: 0 }
      if (reader) {
        await (async () => {
          while (true) {
            const part = await reader.read()
            if (part.done) return
            size.value += part.value.byteLength
            if (size.value > 1024 * 1024) throw new Failure("invalid")
            chunks.push(part.value)
          }
        })().finally(() => reader.cancel().catch(() => {}))
      }
      return new Response([204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }
    throw new Failure("invalid")
  }

const provider = (
  server: ConfigMCP.Remote,
  redirect: string,
  state: string,
  stored: McpOAuthStore.Credentials | undefined,
  passive: boolean,
) => {
  const config = typeof server.oauth === "object" ? server.oauth : undefined
  const pending: {
    discovery?: OAuthDiscoveryState
    client?: OAuthClientInformationMixed
    tokens?: OAuthTokens
    verifier?: string
    url?: string
  } = {
    client: config?.client_id
      ? {
          client_id: config.client_id,
          ...(config.client_secret ? { client_secret: config.client_secret } : {}),
        }
      : stored
        ? {
            client_id: stored.clientId,
            ...(stored.clientSecret ? { client_secret: stored.clientSecret } : {}),
          }
        : undefined,
    tokens:
      passive && stored
        ? {
            access_token: stored.accessToken,
            token_type: "Bearer",
            refresh_token: stored.refreshToken,
            scope: stored.scope,
          }
        : undefined,
  }
  const api: OAuthClientProvider = {
    redirectUrl: redirect,
    clientMetadata: {
      redirect_uris: [redirect],
      client_name: "Apexo",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: config?.client_secret ? "client_secret_post" : "none",
      ...(config?.scope ? { scope: config.scope } : {}),
    },
    state: () => state,
    clientInformation: () => {
      if (passive && !pending.client) throw new Failure("auth")
      return pending.client
    },
    saveClientInformation: (client) => {
      if (passive) throw new Failure("auth")
      pending.client = client
    },
    tokens: () => pending.tokens,
    saveTokens: (tokens) => {
      if (tokens.token_type.toLowerCase() !== "bearer") throw new Failure("auth")
      pending.tokens = {
        ...tokens,
        refresh_token: tokens.refresh_token ?? pending.tokens?.refresh_token,
      }
    },
    saveCodeVerifier: (verifier) => {
      if (passive) throw new Failure("auth")
      pending.verifier = verifier
    },
    codeVerifier: () => {
      if (!pending.verifier) throw new Failure("auth")
      return pending.verifier
    },
    redirectToAuthorization: (url) => {
      if (passive || remote(url.href).searchParams.get("state") !== state) throw new Failure("auth")
      pending.url = url.href
    },
    discoveryState: () => pending.discovery,
    saveDiscoveryState: (discovery) => {
      const issuer = discovery.authorizationServerMetadata?.issuer
      if (!issuer || remote(issuer).href !== remote(discovery.authorizationServerUrl).href) throw new Failure("auth")
      if (stored && stored.issuer !== issuer) {
        if (passive) throw new Failure("auth")
        if (!config?.client_id) pending.client = undefined
      }
      pending.discovery = discovery
    },
    invalidateCredentials: (kind) => {
      if (passive) throw new Failure("auth")
      if (kind === "all" || kind === "tokens") pending.tokens = undefined
      if (kind === "all" || kind === "client")
        pending.client = config?.client_id
          ? { client_id: config.client_id, client_secret: config.client_secret }
          : undefined
      if (kind === "discovery") pending.discovery = undefined
    },
  }
  const credentials = (): McpOAuthStore.Credentials => {
    if (!pending.tokens || !pending.client || !pending.discovery?.authorizationServerMetadata?.issuer)
      throw new Failure("auth")
    return {
      issuer: pending.discovery.authorizationServerMetadata.issuer,
      clientId: pending.client.client_id,
      clientSecret: pending.client.client_secret,
      accessToken: pending.tokens.access_token,
      refreshToken: pending.tokens.refresh_token,
      scope: pending.tokens.scope,
      ...(pending.tokens.expires_in ? { expiresAt: Date.now() + pending.tokens.expires_in * 1000 } : {}),
    }
  }
  return { api, pending, credentials }
}

interface Flow {
  readonly id: string
  readonly identity: string
  readonly controller: AbortController
  readonly expiresAt: number
  readonly ready: ReturnType<typeof Promise.withResolvers<Start>>
  phase: Phase
  error?: Mcp.AuthenticationError
  done: Promise<void>
}
export function make(input: {
  location: Location.Ref
  data: string
  definition: (name: string) => typeof ConfigMCP.Server.Type | undefined
  notify: (name: string) => void
  publish: (name: string, active: () => boolean) => Promise<"connected" | "credentials_ready" | "retry_required">
  timeout?: number
}) {
  const store = McpOAuthStore.make(input.data)
  const lifetime = new AbortController()
  const flows = new Map<string, Flow>()
  const saved = new Set<string>()
  const active = (name: string, flow: Flow) => {
    const definition = input.definition(name)
    if (lifetime.signal.aborted || flow.controller.signal.aborted || flows.get(name) !== flow || !supported(definition))
      return false
    try {
      return identity(input.location, name, definition) === flow.identity
    } catch {
      return false
    }
  }
  const issues = new Map<string, Mcp.AuthenticationError>()
  const read = async (name: string, key: string) => {
    try {
      const result = await store.read(key)
      if (issues.delete(key)) input.notify(name)
      return result
    } catch (error) {
      const failure = safe(error)
      if (issues.get(key) !== failure.code) {
        issues.set(key, failure.code)
        input.notify(name)
      }
      throw failure
    }
  }
  const observe = async (name: string, server: typeof ConfigMCP.Server.Type) => {
    if (!supported(server)) return
    const key = identity(input.location, name, server)
    if ((await read(name, key)).credentials) saved.add(key)
    else saved.delete(key)
  }
  const status = (name: string, server: typeof ConfigMCP.Server.Type | undefined): Status => {
    if (!eligible(server)) return { supported: false, credentials: "missing" }
    try {
      configuration(server)
      const key = identity(input.location, name, server)
      const flow = flows.get(name)
      return {
        supported: true,
        credentials: saved.has(key) ? "available" : "missing",
        ...(issues.has(key) ? { error: issues.get(key) } : {}),
        ...(flow?.identity === key
          ? {
              flow: {
                id: flow.id,
                phase: flow.phase,
                expiresAt: flow.expiresAt,
                ...(flow.error ? { error: flow.error } : {}),
              },
            }
          : {}),
      }
    } catch (error) {
      return {
        supported: false,
        credentials: "missing",
        error: safe(error).code,
      }
    }
  }
  const start = async (name: string, signal: AbortSignal): Promise<Start> => {
    signal.throwIfAborted()
    const server = input.definition(name)
    if (!server) throw new Failure("not_found")
    if (!eligible(server)) throw new Failure("unsupported")
    const { config, redirect } = configuration(server)
    const key = identity(input.location, name, server)
    const previous = flows.get(name)
    if (["waiting", "exchanging"].includes(previous?.phase ?? "")) throw new Failure("conflict")
    if (previous) {
      await previous.done
      if (flows.get(name) !== previous) throw new Failure("conflict")
      signal.throwIfAborted()
    }
    const flow: Flow = {
      id: randomUUID(),
      identity: key,
      controller: new AbortController(),
      expiresAt: Date.now() + (input.timeout ?? 300000),
      ready: Promise.withResolvers<Start>(),
      phase: "waiting",
      done: Promise.resolve(),
    }
    flows.set(name, flow)
    const received = Promise.withResolvers<{ code: string; issuer?: string }>()
    void received.promise.catch(() => {})
    const nonce = randomBytes(32).toString("hex")
    const pathname = redirect?.pathname ?? "/mcp/oauth/callback"
    const listener = createServer({ maxHeaderSize: 8192 }, (request, response) => {
      request.resume()
      const fail = () => {
        response.writeHead(400, {
          "content-type": "text/plain",
          connection: "close",
        })
        response.end("This authorization request is invalid or expired.")
      }
      if (request.method !== "GET" || (request.url?.length ?? 0) > 8192 || !active(name, flow)) return fail()
      if (!URL.canParse(request.url ?? "/", "http://127.0.0.1")) return fail()
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      const state = Buffer.from(url.searchParams.get("state") ?? "")
      const expected = Buffer.from(nonce)
      if (
        url.pathname !== pathname ||
        url.searchParams.getAll("state").length !== 1 ||
        state.byteLength !== expected.byteLength ||
        !timingSafeEqual(state, expected)
      )
        return fail()
      const code = url.searchParams.get("code")
      if (
        flow.phase !== "waiting" ||
        (!code && !url.searchParams.has("error")) ||
        url.searchParams.getAll("code").length > 1
      )
        return fail()
      flow.phase = "exchanging"
      input.notify(name)
      if (url.searchParams.has("error")) received.reject(new Failure("auth"))
      else
        received.resolve({
          code: code!,
          issuer: url.searchParams.get("iss") ?? undefined,
        })
      response.writeHead(200, {
        "content-type": "text/plain",
        "cache-control": "no-store",
        connection: "close",
      })
      response.end("Authorization received. Return to Apexo to see the connection result.")
    })
    listener.requestTimeout = 5000
    const abort = () => received.reject(new Failure("cancelled"))
    flow.controller.signal.addEventListener("abort", abort, { once: true })
    const startAbort = () => flow.controller.abort()
    signal.addEventListener("abort", startAbort, { once: true })
    const timer = setTimeout(() => {
      flow.error = "expired"
      flow.controller.abort()
    }, input.timeout ?? 300000)
    timer.unref()
    flow.done = (async () => {
      await new Promise<void>((resolve, reject) => {
        listener.once("error", reject)
        listener.listen(redirect ? Number(redirect.port || 80) : (config?.callback_port ?? 0), "127.0.0.1", resolve)
      })
      if (!active(name, flow)) throw new Failure("cancelled")
      const address = listener.address()
      if (!address || typeof address === "string") throw new Failure("load")
      const url = `http://127.0.0.1:${address.port}${pathname}`
      const initial = await read(name, key)
      const pending = provider(server, url, nonce, initial.credentials, false)
      const { auth, extractWWWAuthenticateParams } = await import("@modelcontextprotocol/sdk/client/auth.js")
      const fetchFn = boundedFetch(flow.controller.signal)
      // Explicit authentication may probe the protected resource, including while
      // disabled. This GET does not initialize an MCP transport or invoke tools.
      const probe = await fetchFn(server.url, {
        method: "GET",
        headers: { accept: "application/json" },
      })
      const challenge = probe.status === 401 ? extractWWWAuthenticateParams(probe) : {}
      await probe.body?.cancel()
      await auth(pending.api, {
        serverUrl: server.url,
        scope: config?.scope ?? challenge.scope,
        resourceMetadataUrl: challenge.resourceMetadataUrl,
        fetchFn,
      })
      if (!pending.pending.url || !active(name, flow)) throw new Failure("auth")
      flow.ready.resolve({
        id: flow.id,
        authorizationUrl: pending.pending.url,
        expiresAt: flow.expiresAt,
      })
      signal.removeEventListener("abort", startAbort)
      input.notify(name)
      const callback = await received.promise
      const metadata = pending.pending.discovery?.authorizationServerMetadata
      if (
        (callback.issuer && callback.issuer !== metadata?.issuer) ||
        (metadata &&
          "authorization_response_iss_parameter_supported" in metadata &&
          metadata.authorization_response_iss_parameter_supported === true &&
          !callback.issuer)
      )
        throw new Failure("auth")
      await store.transaction(
        key,
        flow.controller.signal,
        () => active(name, flow),
        async (latest, commit) => {
          if (latest.revision !== initial.revision) throw new Failure("conflict")
          await auth(pending.api, {
            serverUrl: server.url,
            authorizationCode: callback.code,
            fetchFn: boundedFetch(flow.controller.signal),
          })
          // A successful issuer grant is durable even if runtime publication was
          // retired while its response arrived. Never activate that retired flow.
          await commit(pending.credentials(), true)
          saved.add(key)
        },
      )
      if (!active(name, flow)) throw new Failure("cancelled")
      flow.phase = await input.publish(name, () => active(name, flow))
      input.notify(name)
    })()
      .catch((error: unknown) => {
        const failure = safe(error)
        flow.phase = flow.controller.signal.aborted && !flow.error ? "cancelled" : "failed"
        flow.error ??= flow.phase === "cancelled" ? "cancelled" : failure.code
        flow.ready.reject(failure)
        input.notify(name)
      })
      .finally(async () => {
        clearTimeout(timer)
        signal.removeEventListener("abort", startAbort)
        flow.controller.signal.removeEventListener("abort", abort)
        listener.closeAllConnections()
        if (listener.listening) await new Promise<void>((resolve) => listener.close(() => resolve()))
      })
    return flow.ready.promise
  }
  const supersede = (name?: string) => {
    for (const [key, flow] of flows)
      if ((name === undefined || key === name) && ["waiting", "exchanging"].includes(flow.phase))
        flow.controller.abort()
  }
  const cancel = async (name: string, id: string) => {
    const flow = flows.get(name)
    if (!flow || flow.id !== id) throw new Failure("not_found")
    flow.controller.abort()
    await flow.done
  }
  const fetchFor =
    (name: string, server: ConfigMCP.Remote, alive: () => boolean): FetchLike =>
    async (url, init) => {
      const key = identity(input.location, name, server)
      const signal = AbortSignal.any([lifetime.signal, ...(init?.signal ? [init.signal] : [])])
      const snapshot = await read(name, key)
      const send = (credentials?: McpOAuthStore.Credentials) => {
        if (!alive() || signal.aborted) throw new Failure("cancelled")
        // SSE announces a separate message endpoint. Delegate within the configured
        // origin only; neither cross-origin endpoints nor redirects receive tokens.
        if (remote(String(url)).origin !== new URL(server.url).origin) throw new Failure("invalid")
        const headers = new Headers(init?.headers)
        if (credentials) headers.set("authorization", `Bearer ${credentials.accessToken}`)
        return fetch(url, { ...init, headers, signal, redirect: "error" })
      }
      if (snapshot.credentials) saved.add(key)
      const response = await send(snapshot.credentials)
      if (response.status !== 401 || !snapshot.credentials) return response
      const { auth, extractWWWAuthenticateParams } = await import("@modelcontextprotocol/sdk/client/auth.js")
      const challenge = extractWWWAuthenticateParams(response)
      await response.body?.cancel()
      const credentials = await store.transaction(key, signal, alive, async (latest, commit) => {
        if (!latest.credentials) throw new Failure("auth")
        if (latest.revision !== snapshot.revision) return latest.credentials
        if (!latest.credentials.refreshToken) throw new Failure("auth")
        const pending = provider(server, "http://127.0.0.1/mcp/oauth/callback", "", latest.credentials, true)
        await auth(pending.api, {
          serverUrl: server.url,
          scope: challenge.scope,
          resourceMetadataUrl: challenge.resourceMetadataUrl,
          fetchFn: boundedFetch(signal),
        })
        const credentials = pending.credentials()
        // The issuer has already rotated this token. Preserve it under the old
        // credential identity even if runtime ownership was canceled meanwhile.
        await commit(credentials, true)
        return credentials
      })
      return send(credentials)
    }
  return {
    observe,
    status,
    start,
    cancel,
    supersede,
    fetchFor,
    settle: (name?: string) =>
      Promise.all([...flows].filter(([key]) => name === undefined || name === key).map(([, flow]) => flow.done)).then(
        () => {},
      ),
    close: async () => {
      lifetime.abort()
      supersede()
      await Promise.all([...flows.values()].map((flow) => flow.done))
    },
  }
}

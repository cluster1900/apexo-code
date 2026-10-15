import { createHash } from "node:crypto"

export function oauthServer(options: { challenge?: boolean; manualConsent?: boolean } = {}) {
  const state = {
    authorize: 0,
    grants: 0,
    refresh: 0,
    register: 0,
    mcp: 0,
    initializes: 0,
    calls: 0,
    tools: 0,
    probes: 0,
    metadata: 0,
    publish: 0,
    events: 0,
    denied: false,
    reject: false,
    retired: false,
    issuerRequired: false,
    invalidIssuer: false,
    refreshRetires: false,
    grantRetires: false,
    redirect: "",
  }
  let authorization: string | undefined
  const codes = new Map<string, { challenge: string; redirect: string }>()
  const access = new Set<string>()
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url),
        origin = url.origin
      if (url.pathname === "/custom/resource") {
        state.metadata++
        return Response.json({
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
        })
      }
      if (url.pathname.includes("oauth-protected-resource"))
        return options.challenge
          ? new Response(null, { status: 404 })
          : Response.json({
              resource: `${origin}/mcp`,
              authorization_servers: [origin],
            })
      if (url.pathname.includes("oauth-authorization-server"))
        return Response.json({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
          authorization_response_iss_parameter_supported: state.issuerRequired,
        })
      if (url.pathname === "/register") {
        state.register++
        return Response.json({ ...(await request.json()), client_id: "fixture-client" }, { status: 201 })
      }
      if (url.pathname === "/authorize") {
        if (request.method === "GET") {
          state.authorize++
          authorization = request.url
          if (options.manualConsent)
            return new Response(
              '<!doctype html><title>Local OAuth fixture</title><form method="post"><button>Authorize local fixture</button></form>',
              { headers: { "content-type": "text/html" } },
            )
        }
        const target = new URL(url.searchParams.get("redirect_uri")!)
        target.searchParams.set("state", url.searchParams.get("state")!)
        if (state.denied) target.searchParams.set("error", "access_denied")
        else {
          const code = crypto.randomUUID()
          codes.set(code, {
            challenge: url.searchParams.get("code_challenge")!,
            redirect: target.origin + target.pathname,
          })
          target.searchParams.set("code", code)
        }
        if (state.issuerRequired || state.invalidIssuer)
          target.searchParams.set("iss", state.invalidIssuer ? "https://wrong.example" : origin)
        return Response.redirect(target)
      }
      if (url.pathname === "/token") {
        const values = new URLSearchParams(await request.text())
        if (values.get("grant_type") === "authorization_code") {
          state.grants++
          const code = codes.get(values.get("code")!)
          if (
            !code ||
            code.challenge !== createHash("sha256").update(values.get("code_verifier")!).digest("base64url") ||
            code.redirect !== values.get("redirect_uri")
          )
            return Response.json({ error: "invalid_grant" }, { status: 400 })
          codes.delete(values.get("code")!)
          if (state.grantRetires) state.retired = true
        } else {
          state.refresh++
          if (state.refreshRetires) state.retired = true
        }
        const token = crypto.randomUUID()
        access.add(token)
        state.reject = false
        return Response.json({
          access_token: token,
          token_type: "Bearer",
          refresh_token: `refresh-${state.refresh}`,
          expires_in: 3600,
        })
      }
      if (url.pathname === "/mcp") {
        if (state.redirect) return Response.redirect(state.redirect)
        if (request.method === "GET") state.probes++
        else state.mcp++
        if (state.reject || !access.has((request.headers.get("authorization") ?? "").replace("Bearer ", "")))
          return new Response(null, {
            status: 401,
            headers: options.challenge
              ? {
                  "www-authenticate": `Bearer resource_metadata="${origin}/custom/resource", scope="fixture:read"`,
                }
              : undefined,
          })
        if (request.method === "POST") {
          const body = (await request.json()) as {
            id?: number
            method?: string
          }
          if (body.method === "initialize") {
            state.initializes++
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                protocolVersion: "2025-11-25",
                capabilities: { tools: {} },
                serverInfo: { name: "oauth-fixture", version: "1" },
              },
            })
          }
          if (body.method === "tools/list") {
            state.tools++
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                tools: [
                  {
                    name: "echo",
                    description: "Local OAuth fixture",
                    inputSchema: {
                      type: "object",
                      properties: {},
                      additionalProperties: false,
                    },
                  },
                ],
              },
            })
          }
          if (body.method === "tools/call") {
            state.calls++
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              result: { content: [{ type: "text", text: "MCP_OAUTH_TOOL_RESULT" }] },
            })
          }
          if (body.method?.startsWith("notifications/")) return new Response(null, { status: 202 })
        }
        return Response.json({ ok: true })
      }
      return new Response(null, { status: 404 })
    },
  })
  return { server, state, authorization: () => authorization }
}

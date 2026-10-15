// Isolated installed Grok evidence; no Apexo runtime depends on this process.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { chmod } from "node:fs/promises"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const configured = !process.argv.includes("--dcr")
const directory = await mkdtemp(join(tmpdir(), "apexo-mcp-oauth-official-"))
const home = join(directory, "home")
const workspace = join(directory, "workspace")
const trace = join(directory, "mcp.jsonl")
await mkdir(home)
await mkdir(workspace)
const calls = []
const events = []
const logs = []
const checks = []
const provider = createServer(async (request, response) => {
  if (request.method !== "POST") return response.end(JSON.stringify({ data: [{ id: "fixture", object: "model" }] }))
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push(body)
  if (request.url.endsWith("/responses")) {
    const item = {
      type: "function_call",
      id: "fc_reference_title",
      call_id: "call_reference_title",
      name: "session_title",
      arguments: JSON.stringify({ session_title: "Preserve the apricot decision" }),
      status: "completed",
    }
    const result = {
      id: "resp_reference_title",
      object: "response",
      created_at: 1,
      model: body.model,
      status: "completed",
      output: [item],
      error: null,
      incomplete_details: null,
      instructions: null,
      max_output_tokens: null,
      parallel_tool_calls: true,
      previous_response_id: null,
      reasoning: { effort: null, summary: null },
      store: false,
      temperature: 1,
      text: { format: { type: "text" } },
      tool_choice: "auto",
      tools: body.tools ?? [],
      top_p: 1,
      truncation: "disabled",
      user: null,
      metadata: {},
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }
    response.writeHead(200, { "content-type": "text/event-stream" })
    return response.end(
      [
        { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, arguments: "", status: "in_progress" },
        },
        { type: "response.function_call_arguments.delta", output_index: 0, item_id: item.id, delta: item.arguments },
        { type: "response.function_call_arguments.done", output_index: 0, item_id: item.id, arguments: item.arguments },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: result },
      ]
        .map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
        .join(""),
    )
  }
  const names = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
  const results = (body.messages ?? []).filter((message) => message.role === "tool")
  const searched = results.find((message) => JSON.stringify(message).includes("echo"))
  const finished = results.some((message) => JSON.stringify(message).includes("OFFICIAL_MCP_RESULT"))
  const discover = (value) => {
    if (!value || typeof value !== "object") return undefined
    if (typeof value.name === "string" && value.name.includes("echo")) return value.name
    if (typeof value.tool_name === "string" && value.tool_name.includes("echo")) return value.tool_name
    return Object.values(value).map(discover).find(Boolean)
  }
  const content = searched?.content
  const result = typeof content === "string" ? JSON.parse(content) : content
  const leaf = discover(result)
  const name = finished ? undefined : leaf ? "use_tool" : names.includes("search_tool") ? "search_tool" : undefined
  const args = leaf ? { tool_name: leaf, tool_input: { text: "OFFICIAL_MCP_RESULT" } } : { query: "reference echo" }
  const delta = name
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `call_reference_mcp_${results.length}`,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      }
    : { role: "assistant", content: "MCP reference completed" }
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(
    [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      {
        choices: [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      },
    ]
      .map(
        (event) =>
          `data: ${JSON.stringify({ id: "mcp-reference", object: "chat.completion.chunk", created: 1, model: body.model, ...event })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
  )
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
const url = `http://127.0.0.1:${provider.address().port}/v1`
await writeFile(
  join(home, "config.toml"),
  `[models]\ndefault = "fixture"\n[model.fixture]\nmodel = "fixture"\nname = "MCP fixture"\nbase_url = "${url}"\napi_key = "fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = false\n[memory_v2]\nenabled = false\n`,
)
const launch = () => {
  const child = spawn(process.env.GROK_BIN ?? "grok", ["agent", "stdio", "--leader-socket", join(directory, "leader.sock")], {
    cwd: workspace,
    env: {
      ...process.env,
      HOME: home,
      GROK_HOME: home,
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_DATA_HOME: join(home, "data"),
      XDG_CACHE_HOME: join(home, "cache"),
      XDG_STATE_HOME: join(home, "state"),
      GROK_CONFIG: "",
      GROK_CONFIG_PATH: "",
      XAI_API_KEY: "fixture",
      GROK_MANAGED_MCPS_ENABLED: "0",
      GROK_TITLE_REFRESH: "0",
      GROK_TURN_SUMMARY: "0",
      GROK_MODELS_BASE_URL: url,
      GROK_MODELS_LIST_URL: `${url}/models`,
      ...Object.fromEntries(
        ["CURSOR", "CLAUDE", "CODEX"].flatMap((vendor) =>
          ["MCPS", "RULES", "SKILLS", "AGENTS", "HOOKS"].map((surface) => [`GROK_${vendor}_${surface}_ENABLED`, "0"]),
        ),
      ),
    },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const exited = new Promise((resolve) => child.once("exit", resolve))
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()))
  const connection = new ClientSideConnection(
    () => ({
      async requestPermission(params) {
        const option = params.options.find((item) => item.kind === "allow_once")
        return { outcome: option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" } }
      },
      async sessionUpdate(params) {
        events.push(params)
      },
      async extNotification(method, params) {
        events.push({ method, params })
      },
    }),
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  )
  return { child, exited, connection }
}
const processes = []
const stop = async (process) => {
  process.child.kill("SIGTERM")
  await deadline(process.exited, 10_000, "reference exit").catch(async () => {
    process.child.kill("SIGKILL")
    await deadline(process.exited, 10_000, "forced reference exit")
  })
}

const requests = []
const grants = new Map()
const issued = new Set()
const state = { denial: false, expired: false }
const authorization = createServer(async (request, response) => {
  const origin = `http://127.0.0.1:${authorization.address().port}`
  const url = new URL(request.url, origin)
  const json = (value, status = 200) => {
    response.writeHead(status, { "content-type": "application/json" })
    response.end(JSON.stringify(value))
  }
  requests.push({
    path: url.pathname,
    method: request.method,
    ...(url.pathname === "/authorize" ? { browserAgent: request.headers["user-agent"] } : {}),
  })
  if (url.pathname.includes("oauth-protected-resource"))
    return json({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ["mcp"] })
  if (url.pathname.includes("oauth-authorization-server") || url.pathname.includes("openid-configuration"))
    return json({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp"],
    })
  if (url.pathname === "/authorize") {
    assert.equal(url.searchParams.get("code_challenge_method"), "S256")
    assert.ok(url.searchParams.get("state"))
    const redirect = new URL(url.searchParams.get("redirect_uri"))
    assert.equal(redirect.hostname, "127.0.0.1")
    redirect.searchParams.set("state", url.searchParams.get("state"))
    if (state.denial) redirect.searchParams.set("error", "access_denied")
    else {
      const code = crypto.randomUUID()
      grants.set(code, {
        challenge: url.searchParams.get("code_challenge"),
        redirect: url.searchParams.get("redirect_uri"),
      })
      redirect.searchParams.set("code", code)
    }
    response.writeHead(302, { location: redirect.href })
    return response.end()
  }
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString()
  if (url.pathname === "/register") return json({ ...JSON.parse(raw), client_id: "fixture-client" }, 201)
  if (url.pathname === "/token") {
    const input = new URLSearchParams(raw)
    if (input.get("grant_type") === "authorization_code") {
      const grant = grants.get(input.get("code"))
      assert.ok(grant, "one-use fixture code")
      grants.delete(input.get("code"))
      assert.equal(createHash("sha256").update(input.get("code_verifier")).digest("base64url"), grant.challenge)
      assert.equal(input.get("redirect_uri"), grant.redirect)
    } else assert.equal(input.get("refresh_token"), "fixture-refresh")
    requests.at(-1).grant = input.get("grant_type")
    const access = crypto.randomUUID()
    issued.add(access)
    state.expired = false
    return json({
      access_token: access,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "fixture-refresh",
      scope: "mcp",
    })
  }
  if (url.pathname !== "/mcp") return json({ error: "not_found" }, 404)
  if (request.method === "GET") {
    response.writeHead(405)
    return response.end()
  }
  if (request.method === "DELETE") {
    response.writeHead(200)
    return response.end()
  }
  if (!issued.has((request.headers.authorization ?? "").replace("Bearer ", "")) || state.expired) {
    response.writeHead(401, {
      "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="mcp"`,
    })
    return response.end()
  }
  const input = JSON.parse(raw)
  requests.at(-1).rpc = input.method
  if (!("id" in input)) {
    response.writeHead(202)
    return response.end()
  }
  const result =
    input.method === "initialize"
      ? {
          protocolVersion: input.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "oauth-fixture", version: "1" },
        }
      : input.method === "tools/list"
        ? {
            tools: [
              {
                name: "echo",
                description: "reference echo",
                inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
              },
            ],
          }
        : input.method === "tools/call"
          ? { content: [{ type: "text", text: input.params.arguments.text }] }
          : {}
  return json({ jsonrpc: "2.0", id: input.id, result })
})
await new Promise((resolve) => authorization.listen(0, "127.0.0.1", resolve))
const configFile = join(home, "config.toml")
await writeFile(
  configFile,
  (await readFile(configFile, "utf8")) +
    `\n[mcp_servers.reference]\nurl = "http://127.0.0.1:${authorization.address().port}/mcp"\n${configured ? 'oauth_client_id = "fixture-client"\n' : ""}oauth_scopes = ["mcp"]\n`,
)
const start = async () => {
  const process = launch()
  processes.push(process)
  await deadline(
    process.connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    30_000,
    "initialize",
  )
  const session = await deadline(
    process.connection.newSession({
      cwd: workspace,
      mcpServers: [
        { type: "http", name: "reference", url: `http://127.0.0.1:${authorization.address().port}/mcp`, headers: [] },
      ],
    }),
    30_000,
    "new session",
  )
  await poll(
    () =>
      events.some((event) => event.method === "_x.ai/mcp_initialized" && event.params?.sessionId === session.sessionId),
    "MCP settled",
    30_000,
  )
  return { ...process, session }
}
const ext = async (process, method, params = {}) => {
  const value = await deadline(
    process.connection.extMethod(`_x.ai/mcp/${method}`, {
      ...(method === "list" ? { sessionId: process.session.sessionId } : { session_id: process.session.sessionId }),
      ...params,
    }),
    45_000,
    method,
  )
  return value.result ?? value
}
try {
  const first = await start()
  const before = await ext(first, "auth_status")

  assert.ok(before.servers.some((x) => x.server_name === "reference" && x.status === "needs_auth"))
  assert.equal(calls.length, 0)
  assert.equal(requests.filter((x) => x.path === "/authorize").length, 0)
  checks.push("passive-start-status-does-not-open-consent-or-run-model")
  const result = await ext(first, "auth_trigger", { server_name: "reference" })

  assert.equal(result.status, "authenticated")
  assert.ok(requests.some((x) => x.grant === "authorization_code"))
  assert.equal(requests.filter((x) => x.path === "/register").length, configured ? 0 : 1, "client registration policy")
  checks.push(
    configured
      ? "configured-client-consent-pkce-exchange-authenticates"
      : "dynamic-client-registration-consent-pkce-exchange-authenticates",
  )
  const listed = await ext(first, "list")
  assert.ok(listed.servers.some((x) => x.name === "reference" && x.session?.status === "ready"))
  assert.equal(calls.length, 0)
  checks.push("auth-publishes-ready-tool-catalog-without-model")
  await stop(first)
  const second = await start()
  const persisted = await ext(second, "list")
  assert.ok(persisted.servers.some((x) => x.name === "reference" && x.session?.status === "ready"))
  assert.equal(requests.filter((x) => x.path === "/authorize").length, 1)
  checks.push("stored-token-reused-after-process-restart")
  state.expired = true
  await stop(second)
  const third = await start()
  const refreshed = await ext(third, "list", { cache: false })
  assert.ok(refreshed.servers.some((x) => x.name === "reference" && x.session?.status === "ready"))
  assert.ok(requests.some((x) => x.grant === "refresh_token"))
  assert.equal(requests.filter((x) => x.path === "/authorize").length, 1)
  checks.push("rejected-token-refreshes-without-new-consent")
  assert.equal(calls.length, 0)
  console.log(
    JSON.stringify({
      profile: configured ? "configured-client" : "dynamic-registration",
      passed: checks.length,
      checks,
      providerCalls: calls.length,
      requests,
    }),
  )
} finally {
  for (const process of processes)
    if (process.child.exitCode === null && process.child.signalCode === null) await stop(process)
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  authorization.closeAllConnections()
  await new Promise((resolve) => authorization.close(resolve))
  await writeFile(
    join(directory, "stderr-size.json"),
    JSON.stringify({ bytes: logs.reduce((total, chunk) => total + Buffer.byteLength(chunk), 0) }),
  )
  await writeFile(
    join(directory, "observations.json"),
    JSON.stringify({ checks, providerCalls: calls.length, requests, agentPIDs: processes.map((x) => x.child.pid) }),
  )
  console.error(`OAuth reference evidence: ${directory}`)
}

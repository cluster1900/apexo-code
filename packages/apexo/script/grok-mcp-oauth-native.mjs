// Real native CLI / packaged Desktop OAuth with a private local issuer and MCP server.
import assert from "node:assert/strict"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, deadline } from "./grok-shell-fixture.mjs"
import { oauthServer } from "../test/fixture/mcp-oauth-server.ts"

const kind = process.argv[2] ?? "cli"
const issuer = oauthServer({ challenge: true })
const provider = { calls: 0, gate: undefined }
const gates = []
const runtime = await startShellFixture(kind, {
  config: {
    snapshot: false,
    compaction: { auto: false },
    mcp: {
      reference: {
        type: "remote",
        url: `${issuer.server.url.origin}/mcp`,
        enabled: false,
        oauth: { clientId: "fixture-client" },
      },
    },
  },
  async next({ body, finished, text }) {
    provider.calls++
    if (provider.gate) {
      const gate = provider.gate
      provider.gate = undefined
      gate.entered.resolve()
      await gate.release.promise
      return { content: "OAuth idle barrier released" }
    }
    if (!finished && text.includes("MCP_OAUTH_CALL")) {
      const name = (body.tools ?? [])
        .map((x) => x.function?.name ?? x.name)
        .find((x) => x.startsWith("mcp_reference_echo_"))
      assert.ok(name, "authenticated native tool is advertised")
      return { tool: name, args: {} }
    }
    return { content: "Native OAuth complete" }
  },
}).catch(async (error) => {
  await issuer.server.stop(true)
  throw error
})
const checks = []
const request = async (path, method = "GET", body, directory = runtime.directory) => {
  const url = new URL(path, runtime.url)
  url.searchParams.set("location[directory]", directory)
  return fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45000),
  })
}
const api = async (path, method = "GET", body, directory) => {
  const response = await request(path, method, body, directory)
  assert.ok(response.ok, `${method} ${path}: ${response.status}`)
  return response.json()
}
const status = () => api("/api/mcp")
const wait = async (check, label) => {
  const end = Date.now() + 15000
  while (Date.now() < end) {
    const value = await check()
    if (value) return value
    await Bun.sleep(25)
  }
  throw new Error(`Timed out: ${label}`)
}
const start = () => api("/api/mcp/reference/auth/start", "POST")
const cancel = (id) => api(`/api/mcp/reference/auth/${id}`, "DELETE")
const control = (action) => api(`/api/mcp/reference/${action}`, "POST")
const complete = async (started, phase) => {
  assert.equal((await fetch(started.authorizationUrl)).status, 200)
  return wait(async () => {
    const row = (await status()).reference
    return row.authentication?.flow?.phase === phase ? row : undefined
  }, `authentication ${phase}`)
}
try {
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  assert.equal((await status()).reference.status, "disabled")
  assert.equal(issuer.state.authorize, 0)
  assert.equal(issuer.state.register, 0)
  assert.equal(provider.calls, 0)
  assert.equal((await request("/api/mcp/missing/auth/start", "POST")).status, 404)
  checks.push("passive-native-status-never-starts-consent-model-or-transport")

  const pending = await start()
  const callback = new URL(new URL(pending.authorizationUrl).searchParams.get("redirect_uri"))
  callback.searchParams.set("state", "é".repeat(64))
  callback.searchParams.set("code", "wrong")
  assert.equal((await fetch(callback)).status, 400)
  assert.equal(issuer.state.grants, 0)
  assert.equal((await request("/api/mcp/reference/auth/wrong", "DELETE")).status, 404)
  await cancel(pending.id)
  await assert.rejects(fetch(new URL(pending.authorizationUrl).searchParams.get("redirect_uri")))
  checks.push("callback-byte-validation-exact-cancel-and-listener-cleanup")

  const first = await complete(await start(), "credentials_ready")
  assert.equal(first.status, "disabled")
  assert.equal(first.authentication.credentials, "available")
  assert.equal(issuer.state.initializes, 0)
  assert.equal(issuer.state.tools, 0)
  assert.equal(issuer.state.register, 0)
  assert.equal(issuer.state.metadata, 2)
  assert.equal(provider.calls, 0)
  checks.push("configured-client-custom-metadata-pkce-saves-without-enabling")

  await control("connect")
  assert.equal((await status()).reference.tools, 1)
  const session = (
    await api("/api/session", "POST", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  await api(`/api/session/${session.id}/prompt`, "POST", {
    id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    prompt: { text: "MCP_OAUTH_CALL" },
  })
  await api(`/api/session/${session.id}/wait`, "POST")
  const messages = (await api(`/api/session/${session.id}/message`)).data
  assert.ok(JSON.stringify(messages).includes("MCP_OAUTH_TOOL_RESULT"))
  assert.equal(issuer.state.calls, 1)
  checks.push("authenticated-tool-runs-through-native-session-permission-and-model-followup")

  issuer.state.reject = true
  await control("retry")
  assert.equal(issuer.state.refresh, 1)
  assert.equal(issuer.state.authorize, 1)
  checks.push("passive-refresh-rotates-without-new-browser-consent")

  issuer.state.denied = true
  await complete(await start(), "failed")
  assert.equal((await status()).reference.status, "connected")
  assert.equal((await status()).reference.tools, 1)
  issuer.state.denied = false
  checks.push("declined-reauthorization-retains-healthy-generation")

  const active = await start()
  const gate = { entered: Promise.withResolvers(), release: Promise.withResolvers() }
  gates.push(gate)
  provider.gate = gate
  await api(`/api/session/${session.id}/prompt`, "POST", {
    id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    prompt: { text: "Hold native work for OAuth publication" },
  })
  await deadline(gate.entered.promise, 15000, "native provider idle barrier")
  const before = issuer.state.initializes
  await complete(active, "retry_required")
  assert.equal(issuer.state.initializes, before)
  gate.release.resolve()
  await api(`/api/session/${session.id}/wait`, "POST")
  await control("retry")
  checks.push("busy-completion-keeps-credentials-and-requires-explicit-idle-retry")

  const credentialDirectory = join(runtime.env.XDG_DATA_HOME, "apexo", "mcp-oauth")
  const names = (await readdir(credentialDirectory)).filter((x) => x.endsWith(".json"))
  assert.equal(names.length, 1)
  const file = join(credentialDirectory, names[0]),
    bytes = await readFile(file)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  await writeFile(file, "{")
  try {
    assert.equal((await request("/api/mcp/reference/auth/start", "POST")).status, 503)
    const row = (await status()).reference
    assert.equal(row.status, "connected")
    assert.equal(row.authentication.flow.error, "storage")
    assert.equal(await readFile(file, "utf8"), "{")
  } finally {
    await writeFile(file, bytes)
  }
  checks.push("private-corrupt-storage-fails-closed-and-retains-live-transport")

  const consent = issuer.state.authorize
  await runtime.crash()
  await runtime.reopen()
  assert.equal((await status()).reference.status, "connected")
  assert.equal(issuer.state.authorize, consent)
  checks.push("new-backend-process-reuses-project-credentials-without-consent")

  const other = join(runtime.output, "other-project")
  await mkdir(other)
  await writeFile(join(other, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  const isolated = (await api("/api/mcp", "GET", undefined, other)).reference
  assert.equal(isolated.status, "disabled")
  assert.equal(isolated.authentication.credentials, "missing")
  checks.push("different-location-does-not-reuse-private-authentication")

  const superseded = await start()
  await control("disconnect")
  assert.equal((await status()).reference.authentication.flow.phase, "cancelled")
  await assert.rejects(fetch(new URL(superseded.authorizationUrl).searchParams.get("redirect_uri")))
  checks.push("explicit-disconnect-joins-pending-flow-and-preserves-saved-disabled-choice")
  await writeFile(
    join(runtime.output, "mcp-oauth-report.json"),
    JSON.stringify(
      {
        kind,
        checks,
        providerCalls: provider.calls,
        counts: {
          authorize: issuer.state.authorize,
          grants: issuer.state.grants,
          refresh: issuer.state.refresh,
          tools: issuer.state.tools,
          calls: issuer.state.calls,
        },
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ kind, checks: checks.length, providerCalls: provider.calls, evidence: runtime.output }))
} finally {
  for (const gate of gates) gate.release.resolve()
  await runtime.close()
  await issuer.server.stop(true)
}

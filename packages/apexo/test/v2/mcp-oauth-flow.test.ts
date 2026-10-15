import path from "node:path"
import { Flock } from "@apexo/core/util/flock"
import { McpOAuthStore } from "@apexo/core/mcp-oauth-store"
import { Schema } from "effect"
import { Mcp } from "@apexo/schema/mcp"
import { test, expect } from "bun:test"
import { createConnection } from "node:net"
import { McpOAuth } from "@apexo/core/mcp-oauth"
const wait = async (check: () => boolean | Promise<boolean>) => {
  const until = Date.now() + 5000
  while (Date.now() < until) {
    if (await check()) return
    await Bun.sleep(10)
  }
  throw new Error("OAuth fixture deadline")
}
import { setup } from "../fixture/mcp-oauth"
test("explicit callback validates state, commits private credentials and leaves disabled transport unopened", async () => {
  const f = await setup({ disabled: true })
  try {
    await f.manager.observe("reference", f.definition)
    expect(f.manager.status("reference", f.definition)).toMatchObject({
      supported: true,
      credentials: "missing",
    })
    const start = await f.manager.start("reference", new AbortController().signal)
    expect(f.state.authorize).toBe(0)
    expect(f.state.mcp).toBe(0)
    const redirect = new URL(new URL(start.authorizationUrl).searchParams.get("redirect_uri")!)
    redirect.searchParams.set("state", "wrong")
    redirect.searchParams.set("code", "wrong")
    expect((await fetch(redirect)).status).toBe(400)
    expect(f.state.grants).toBe(0)
    await fetch(start.authorizationUrl)
    await wait(() => f.manager.status("reference", f.definition).flow?.phase === "credentials_ready")
    expect(f.manager.status("reference", f.definition).credentials).toBe("available")
    expect(f.state.mcp).toBe(0)
    expect(f.state.authorize).toBe(1)
    expect(f.state.register).toBe(0)
    expect((await f.store.read(f.identity)).credentials?.clientId).toBe("fixture-client")
    expect(JSON.stringify(f.manager.status("reference", f.definition))).not.toContain("accessToken")
  } finally {
    await f.close()
  }
})
test("dynamic registration and busy completion retain credentials for explicit retry", async () => {
  const f = await setup({ dcr: true, busy: true })
  try {
    const start = await f.manager.start("reference", new AbortController().signal)
    await fetch(start.authorizationUrl)
    await wait(() => f.manager.status("reference", f.definition).flow?.phase === "retry_required")
    expect(f.state.register).toBe(1)
    expect(f.state.publish).toBe(1)
    expect(f.state.mcp).toBe(0)
    expect((await f.store.read(f.identity)).credentials).toBeDefined()
  } finally {
    await f.close()
  }
})
test("exact cancellation and Location closure own callbacks and write no credentials", async () => {
  const f = await setup()
  try {
    const first = await f.manager.start("reference", new AbortController().signal)
    await expect(f.manager.cancel("reference", "wrong")).rejects.toBeInstanceOf(McpOAuth.Failure)
    await expect(f.manager.start("reference", new AbortController().signal)).rejects.toBeInstanceOf(McpOAuth.Failure)
    await f.manager.cancel("reference", first.id)
    expect(f.manager.status("reference", f.definition).flow?.phase).toBe("cancelled")
    expect(await f.store.read(f.identity)).toEqual({})
    await expect(fetch(new URL(first.authorizationUrl).searchParams.get("redirect_uri")!)).rejects.toThrow()
    const second = await f.manager.start("reference", new AbortController().signal)
    await f.manager.close()
    await expect(fetch(new URL(second.authorizationUrl).searchParams.get("redirect_uri")!)).rejects.toThrow()
    expect(f.state.grants).toBe(0)
  } finally {
    await f.close()
  }
})
test("denial, issuer mismatch and expiration never commit tokens", async () => {
  for (const mode of ["denied", "invalidIssuer", "expiry"] as const) {
    const f = await setup({ timeout: mode === "expiry" ? 100 : 5000 })
    try {
      if (mode !== "expiry") f.state[mode] = true
      const start = await f.manager.start("reference", new AbortController().signal)
      if (mode !== "expiry") await fetch(start.authorizationUrl)
      await wait(() => f.manager.status("reference", f.definition).flow?.phase === "failed")
      expect(await f.store.read(f.identity)).toEqual({})
      expect(f.state.grants).toBe(0)
    } finally {
      await f.close()
    }
  }
})
test("passive reuse and serialized refresh do not initiate consent or registration", async () => {
  const f = await setup()
  try {
    const request = f.manager.fetchFor("reference", f.definition, () => !f.state.retired)
    expect((await request(f.definition.url, { method: "POST", body: "{}" })).status).toBe(401)
    expect(f.state.authorize).toBe(0)
    expect(f.state.register).toBe(0)
    const start = await f.manager.start("reference", new AbortController().signal)
    await fetch(start.authorizationUrl)
    await wait(() => f.manager.status("reference", f.definition).flow?.phase === "connected")
    expect((await request(f.definition.url, { method: "POST", body: "{}" })).status).toBe(200)
    f.state.reject = true
    const results = await Promise.all([
      request(f.definition.url, { method: "POST", body: "{}" }),
      request(f.definition.url, { method: "POST", body: "{}" }),
    ])
    expect(results.map((x) => x.status)).toEqual([200, 200])
    expect(f.state.refresh).toBe(1)
    expect(f.state.authorize).toBe(1)
    expect(f.state.register).toBe(0)
  } finally {
    await f.close()
  }
})
test("known refresh rotation survives retired runtime and never reactivates it", async () => {
  const f = await setup()
  try {
    const start = await f.manager.start("reference", new AbortController().signal)
    await fetch(start.authorizationUrl)
    await wait(() => f.manager.status("reference", f.definition).flow?.phase === "connected")
    const previous = await f.store.read(f.identity)
    f.state.reject = true
    f.state.refreshRetires = true
    await expect(
      f.manager.fetchFor(
        "reference",
        f.definition,
        () => !f.state.retired,
      )(f.definition.url, { method: "POST", body: "{}" }),
    ).rejects.toBeInstanceOf(McpOAuth.Failure)
    const next = await f.store.read(f.identity)
    expect(next.revision).not.toBe(previous.revision)
    expect(next.credentials?.refreshToken).toBe("refresh-1")
    expect(f.state.publish).toBe(1)
    expect(f.state.refresh).toBe(1)
  } finally {
    await f.close()
  }
})

test("invalid redirect rejects without installing a pending flow", async () => {
  const f = await setup({ redirect: "not a URL" })
  try {
    await expect(f.manager.start("reference", new AbortController().signal)).rejects.toMatchObject({ code: "invalid" })
    expect(f.manager.status("reference", f.definition).flow).toBeUndefined()
    f.definition.oauth.redirect_uri = undefined
    const started = await f.manager.start("reference", new AbortController().signal)
    await f.manager.cancel("reference", started.id)
    expect(f.state.grants).toBe(0)
  } finally {
    await f.close()
  }
})
test("non-ASCII callback state is rejected without escaping the HTTP handler", async () => {
  const f = await setup()
  try {
    const started = await f.manager.start("reference", new AbortController().signal)
    const callback = new URL(new URL(started.authorizationUrl).searchParams.get("redirect_uri")!)
    callback.searchParams.set("state", "é".repeat(64))
    callback.searchParams.set("code", "wrong")
    expect((await fetch(callback, { signal: AbortSignal.timeout(1000) })).status).toBe(400)
    expect(f.state.grants).toBe(0)
    await f.manager.cancel("reference", started.id)
  } finally {
    await f.close()
  }
})

test("non-default protected-resource challenge drives explicit discovery and passive refresh", async () => {
  const f = await setup({ challenge: true, disabled: true })
  try {
    const started = await f.manager.start("reference", new AbortController().signal)
    expect(new URL(started.authorizationUrl).searchParams.get("scope")).toBe("fixture:read")
    expect(f.state.metadata).toBe(1)
    expect(f.state.probes).toBe(1)
    expect(f.state.mcp).toBe(0)
    await fetch(started.authorizationUrl)
    await wait(() => f.manager.status("reference", f.definition).flow?.phase === "credentials_ready")
    f.state.reject = true
    expect(
      (
        await f.manager.fetchFor(
          "reference",
          f.definition,
          () => true,
        )(f.definition.url, { method: "POST", body: "{}" })
      ).status,
    ).toBe(200)
    expect(f.state.metadata).toBe(2)
    expect(f.state.refresh).toBe(1)
    expect(f.state.authorize).toBe(1)
  } finally {
    await f.close()
  }
})
test("invalid OAuth configuration has isolated passive safe status", async () => {
  const f = await setup()
  try {
    for (const definition of [
      { ...f.definition, url: "not a URL" },
      { ...f.definition, oauth: { redirect_uri: "bad" } },
    ]) {
      expect(f.manager.status("broken", definition)).toEqual({
        supported: false,
        credentials: "missing",
        error: "invalid",
      })
    }
    expect(f.manager.status("reference", f.definition)).toEqual({
      supported: true,
      credentials: "missing",
    })
    expect(f.state.probes).toBe(0)
    expect(f.state.mcp).toBe(0)
    expect(f.state.register).toBe(0)
  } finally {
    await f.close()
  }
})

test("malformed absolute-form callback request is safely rejected", async () => {
  const f = await setup()
  try {
    const started = await f.manager.start("reference", new AbortController().signal)
    const callback = new URL(new URL(started.authorizationUrl).searchParams.get("redirect_uri")!)
    const response = await new Promise<string>((resolve, reject) => {
      const chunks: string[] = []
      const socket = createConnection({ host: "127.0.0.1", port: Number(callback.port) }, () =>
        socket.write("GET http://[ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"),
      )
      socket.setTimeout(1000, () => {
        socket.destroy()
        reject(new Error("callback socket timeout"))
      })
      socket.on("data", (chunk) => chunks.push(String(chunk)))
      socket.on("end", () => resolve(chunks.join("")))
      socket.on("error", reject)
    })
    expect(response).toContain("400 Bad Request")
    expect(f.state.grants).toBe(0)
    await f.manager.cancel("reference", started.id)
  } finally {
    await f.close()
  }
})

test("known authorization grant survives retired runtime without publication", async () => {
  const f = await setup()
  try {
    const started = await f.manager.start("reference", new AbortController().signal)
    f.state.grantRetires = true
    await fetch(started.authorizationUrl)
    await f.manager.settle("reference")
    expect((await f.store.read(f.identity)).credentials?.accessToken).toBeDefined()
    expect(f.state.publish).toBe(0)
    expect(f.state.mcp).toBe(0)
    expect(f.manager.status("reference", f.definition).flow?.phase).toBe("failed")
  } finally {
    await f.close()
  }
})

test("stored credentials never reach cross-origin endpoints or redirects", async () => {
  const f = await setup()
  const hits: { authorization: string | null }[] = []
  const other = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      hits.push({ authorization: request.headers.get("authorization") })
      return Response.json({ ok: true })
    },
  })
  try {
    const started = await f.manager.start("reference", new AbortController().signal)
    await fetch(started.authorizationUrl)
    await f.manager.settle("reference")
    const request = f.manager.fetchFor("reference", f.definition, () => true)
    await expect(request(other.url, { method: "POST", body: "{}" })).rejects.toMatchObject({ code: "invalid" })
    expect(hits).toHaveLength(0)
    f.state.redirect = other.url.href
    await expect(request(f.definition.url, { method: "POST", body: "{}" })).rejects.toThrow()
    expect(hits).toHaveLength(0)
  } finally {
    await other.stop(true)
    await f.close()
  }
})

test("authentication wire fields omit undefined and accept only safe error codes", () => {
  expect(
    Schema.encodeSync(Mcp.Authentication)({
      supported: true,
      credentials: "missing",
      error: undefined,
      flow: undefined,
    }),
  ).toEqual({ supported: true, credentials: "missing" })
  expect(
    Schema.encodeSync(Mcp.Authentication)({
      supported: true,
      credentials: "missing",
      flow: { id: "fixture", phase: "waiting", expiresAt: 1, error: undefined },
    }),
  ).toEqual({ supported: true, credentials: "missing", flow: { id: "fixture", phase: "waiting", expiresAt: 1 } })
  expect(() =>
    Schema.decodeUnknownSync(Mcp.Authentication)({
      supported: true,
      credentials: "missing",
      error: "arbitrary issuer response",
    }),
  ).toThrow()
})

test("cancelling a credential lease wait reports cancellation rather than storage damage", async () => {
  const f = await setup()
  const lease = await Flock.acquire(McpOAuthStore.file(f.root, f.identity), {
    dir: path.join(f.root, "mcp-oauth/.locks"),
    timeoutMs: 1000,
  })
  try {
    const started = await f.manager.start("reference", new AbortController().signal)
    await fetch(started.authorizationUrl)
    await wait(() => f.manager.status("reference", f.definition).flow?.phase === "exchanging")
    await f.manager.cancel("reference", started.id)
    expect(f.manager.status("reference", f.definition).flow).toMatchObject({ phase: "cancelled", error: "cancelled" })
    expect(f.state.grants).toBe(0)
  } finally {
    await lease.release()
    await f.close()
  }
})

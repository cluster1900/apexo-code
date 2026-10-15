import { expect, test } from "bun:test"
import path from "node:path"
import { HookNetwork } from "@apexo/core/hook-network"
import { hookTLS } from "../fixture/hook-tls"
import { tmpdir } from "../fixture/fixture"

test("host hook address policy matches private ranges and loopback exceptions", async () => {
  for (const address of [
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "::",
    "fe80::1",
    "febf::1",
    "fc00::1",
    "fdff::1",
    "::ffff:192.168.1.1",
    "::ffff:0:0",
  ]) {
    expect(HookNetwork.isBlocked(address)).toBe(true)
    await expect(
      HookNetwork.validate(new URL(`https://${address.includes(":") ? `[${address}]` : address}/`)),
    ).rejects.toThrow("blocked")
  }
  for (const address of [
    "127.0.0.1",
    "127.255.255.254",
    "::1",
    "::ffff:127.0.0.1",
    "8.8.8.8",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "2001:4860:4860::8888",
  ])
    expect(HookNetwork.isBlocked(address)).toBe(false)
  await HookNetwork.validate(new URL("https://localhost/"))
  await expect(HookNetwork.validate(new URL("http://127.0.0.1/"))).rejects.toThrow("HTTPS")
  await expect(HookNetwork.validate(new URL("https://0xa9fea9fe/"))).rejects.toThrow("blocked")
})

test("extra CA selection is host-only, bounded and skips malformed certificates", async () => {
  await using tmp = await tmpdir()
  expect(HookNetwork.bundlePath({ GROK_EXTRA_CA_BUNDLE: "", SSL_CERT_FILE: "fallback" })).toBeUndefined()
  expect(HookNetwork.bundlePath({ GROK_EXTRA_CA_BUNDLE: "primary", SSL_CERT_FILE: "fallback" })).toBe("primary")
  expect(HookNetwork.bundlePath({ SSL_CERT_FILE: "fallback" })).toBe("fallback")
  expect(await HookNetwork.extraRoots(path.join(tmp.path, "missing"))).toEqual([])
  const file = path.join(tmp.path, "ca.pem")
  await Bun.write(file, "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----")
  expect(await HookNetwork.extraRoots(file)).toEqual([])
  await Bun.write(file, "x".repeat(1024 * 1024 + 1))
  expect(await HookNetwork.extraRoots(file)).toEqual([])
  expect(await HookNetwork.extraRoots(path.join(import.meta.dir, "../fixture/hook-tls/ca.pem"))).toHaveLength(1)
})

test("trusted HTTPS posts verify TLS, never follow redirects, and cap output", async () => {
  using tls = hookTLS()
  const hits: string[] = []
  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls: tls.tls,
    async fetch(request) {
      await request.text()
      const pathname = new URL(request.url).pathname
      hits.push(pathname)
      if (pathname === "/redirect") return new Response(null, { status: 302, headers: { location: "/target" } })
      if (pathname === "/large") return new Response("x".repeat(1_000_001))
      return Response.json({ continue: false })
    },
  })
  expect(await HookNetwork.post(new URL("/ok", server.url), "{}", {}, AbortSignal.timeout(2000))).toBe(
    '{"continue":false}',
  )
  await expect(HookNetwork.post(new URL("/redirect", server.url), "{}", {}, AbortSignal.timeout(2000))).rejects.toThrow(
    "HTTP 302",
  )
  expect(hits).toEqual(["/ok", "/redirect"])
  await expect(HookNetwork.post(new URL("/large", server.url), "{}", {}, AbortSignal.timeout(2000))).rejects.toThrow(
    "size limit",
  )
  process.env.GROK_EXTRA_CA_BUNDLE = ""
  await expect(
    HookNetwork.post(new URL("/untrusted", server.url), "{}", {}, AbortSignal.timeout(2000)),
  ).rejects.toThrow()
  expect(hits).not.toContain("/untrusted")
})

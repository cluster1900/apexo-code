export * as HookNetwork from "./hook-network"

import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"
import { request } from "node:https"
import { open } from "node:fs/promises"
import { X509Certificate } from "node:crypto"

const blocked = new BlockList()
for (const [address, prefix] of [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["169.254.0.0", 16],
  ["100.64.0.0", 10],
  ["0.0.0.0", 32],
] as const)
  blocked.addSubnet(address, prefix, "ipv4")
for (const [address, prefix] of [
  ["::", 128],
  ["fe80::", 10],
  ["fc00::", 7],
] as const)
  blocked.addSubnet(address, prefix, "ipv6")

export function isBlocked(address: string) {
  const family = isIP(address)
  return family === 0 || blocked.check(address, family === 4 ? "ipv4" : "ipv6")
}

export async function validate(url: URL) {
  if (url.protocol !== "https:") throw new Error("Host HTTP hooks require HTTPS")
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true })
  if (!addresses.length || addresses.some((entry) => isBlocked(entry.address)))
    throw new Error("Host HTTP hook resolves to a blocked private or internal address")
  // Like the reference, this checks resolution time only. Transport resolution can
  // change afterwards; this is not a DNS-rebinding-resistant connection policy.
}

export function bundlePath(env: Record<string, string | undefined>) {
  return (env.GROK_EXTRA_CA_BUNDLE ?? env.SSL_CERT_FILE) || undefined
}

export async function extraRoots(file: string | undefined) {
  if (!file) return []
  const handle = await open(file, "r").catch(() => undefined)
  if (!handle) return []
  try {
    const info = await handle.stat().catch(() => undefined)
    if (!info?.isFile() || info.size > 1024 * 1024) return []
    const buffer = Buffer.alloc(1024 * 1024 + 1)
    const size = { value: 0 }
    while (size.value < buffer.length) {
      const result = await handle
        .read(buffer, size.value, buffer.length - size.value, size.value)
        .catch(() => undefined)
      if (!result) return []
      if (!result.bytesRead) break
      size.value += result.bytesRead
    }
    if (size.value > 1024 * 1024) return []
    return [
      ...buffer
        .subarray(0, size.value)
        .toString()
        .matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g),
    ].flatMap(([pem]) => {
      try {
        return [new X509Certificate(pem).toString()]
      } catch {
        return []
      }
    })
  } finally {
    await handle.close()
  }
}

export async function post(
  url: URL,
  body: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  beforeRequest?: () => Promise<void>,
) {
  await abortable(validate(url), signal)
  const roots = await abortable(extraRoots(bundlePath(process.env)), signal)
  const { getCACertificates, rootCertificates } = await import("node:tls")
  const ca = roots.length
    ? [...(typeof getCACertificates === "function" ? getCACertificates("default") : rootCertificates), ...roots]
    : undefined
  if (beforeRequest) await beforeRequest()
  signal.throwIfAborted()
  return new Promise<string>((resolve, reject) => {
    const outgoing = request(url, { method: "POST", headers, signal, ca }, (response) => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume()
        reject(new Error(`Host HTTP hook returned HTTP ${response.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      const size = { value: 0 }
      response.on("data", (chunk: Buffer) => {
        size.value += chunk.length
        if (size.value > 1_000_000) {
          response.destroy(new Error("Host HTTP hook response exceeds the size limit"))
          return
        }
        chunks.push(chunk)
      })
      response.once("end", () => resolve(Buffer.concat(chunks).toString()))
      response.once("error", reject)
    })
    outgoing.once("error", reject)
    outgoing.end(body)
  })
}

async function abortable<T>(pending: Promise<T>, signal: AbortSignal) {
  signal.throwIfAborted()
  const state: { abort?: () => void } = {}
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        state.abort = () => reject(signal.reason)
        signal.addEventListener("abort", state.abort, { once: true })
        if (signal.aborted) state.abort()
      }),
    ])
  } finally {
    if (state.abort) signal.removeEventListener("abort", state.abort)
  }
}

export * as CommandSandboxNetworkProxy from "./network-proxy"

import { createServer, request, type IncomingHttpHeaders } from "node:http"
import { connect, type Socket } from "node:net"
import { unlink } from "node:fs/promises"
import { Effect } from "effect"
import { CommandSandboxPolicy } from "./policy"

const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export const LINUX_TCP_TO_UNIX_BRIDGE_SCRIPT = [
  'const net = require("node:net"), fs = require("node:fs");',
  "const sockPath = process.argv.at(-1);",
  "const server = net.createServer((client) => {",
  "  const upstream = net.createConnection(sockPath);",
  '  const close = () => { client.destroy(); upstream.destroy(); };',
  '  client.on("error", close);',
  '  upstream.on("error", close);',
  "  client.pipe(upstream);",
  "  upstream.pipe(client);",
  "});",
  'server.listen(0, "127.0.0.1", () => {',
  '  fs.writeSync(3, String(server.address().port) + "\\n");',
  "  fs.closeSync(3);",
  "});",
].join(" ")

export function normalizeDomainPattern(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/\.$/, "")
  if (
    !trimmed ||
    trimmed.length > 253 ||
    /\s/.test(trimmed) ||
    trimmed.includes("://") ||
    trimmed.includes("/") ||
    trimmed.includes("\0")
  ) {
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `Invalid sandbox allow_domains entry: '${raw}'`,
    })
  }
  const wildcard = trimmed.startsWith("*.")
  const host = wildcard ? trimmed.slice(2) : trimmed
  if (!host || host.includes("*")) {
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `Invalid sandbox allow_domains wildcard: '${raw}' (use exact domain or '*.example.com')`,
    })
  }
  if (!wildcard && (host === "localhost" || isIpv4Literal(host) || isBracketedOrPlainIpv6(host))) {
    return stripBrackets(host)
  }
  const labels = host.split(".")
  if (labels.some((label) => !DOMAIN_LABEL_RE.test(label))) {
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `Invalid sandbox allow_domains hostname: '${raw}'`,
    })
  }
  return wildcard ? `*.${host}` : host
}

export function normalizeDomainPatterns(entries: ReadonlyArray<string>): string[] {
  const unique = [...new Set(entries.map(normalizeDomainPattern))].toSorted()
  if (unique.length > 128) {
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: "Sandbox allow_domains exceeds maximum of 128 patterns.",
    })
  }
  return unique
}

export function isDomainAllowed(rawHost: string, allowDomains: ReadonlyArray<string>): boolean {
  const host = stripBrackets(rawHost.trim().toLowerCase()).replace(/\.$/, "")
  if (!host) return false
  return allowDomains.some((pattern) => {
    const normalized = pattern.toLowerCase()
    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(1)
      return host.endsWith(suffix) && host.length > suffix.length
    }
    return host === normalized
  })
}

export type ListenTarget = { readonly kind: "tcp" } | { readonly kind: "unix"; readonly socketPath: string }

export interface RunningProxy {
  readonly port?: number
  readonly socketPath?: string
  readonly close: () => Promise<void>
}

export const start = (options: {
  readonly allowDomains: ReadonlyArray<string>
  readonly listen: ListenTarget
}) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => startServer(options.allowDomains, options.listen),
      catch: (cause) =>
        new CommandSandboxPolicy.Failure({
          code: "unavailable",
          message: `Failed to start sandbox domain-allowlist proxy: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    }),
    (proxy) => Effect.promise(() => proxy.close()).pipe(Effect.orDie),
  )

function startServer(allowDomains: ReadonlyArray<string>, listen: ListenTarget): Promise<RunningProxy> {
  const normalized = normalizeDomainPatterns(allowDomains)
  const sockets = new Set<Socket>()
  const track = (socket: Socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  }

  const server = createServer((req, res) => {
    const rawUrl = req.url ?? ""
    if (!rawUrl.startsWith("http://")) {
      res.writeHead(400, { "content-type": "text/plain", connection: "close" })
      res.end("Sandbox proxy expects absolute http:// request targets or HTTP CONNECT.\n")
      return
    }
    const parsed = parseHttpUrl(rawUrl)
    if (!parsed) {
      res.writeHead(400, { "content-type": "text/plain", connection: "close" })
      res.end("Malformed proxy request URL.\n")
      return
    }
    const host = stripBrackets(parsed.hostname)
    const port = parsed.port ? Number(parsed.port) : 80
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      res.writeHead(400, { "content-type": "text/plain", connection: "close" })
      res.end("Invalid target port.\n")
      return
    }
    if (!isDomainAllowed(host, normalized)) {
      res.writeHead(403, {
        "content-type": "text/plain",
        connection: "close",
        "x-apexo-sandbox": "blocked-domain",
      })
      res.end(`Domain "${host}" is blocked by Apexo sandbox allowlist.\n`)
      return
    }
    const upstream = request(
      {
        host,
        port,
        method: req.method,
        path: `${parsed.pathname}${parsed.search}`,
        headers: forwardHeaders(req.headers),
      },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers)
        upRes.pipe(res)
      },
    )
    upstream.on("socket", track)
    upstream.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain", connection: "close" })
      }
      res.end(`Sandbox proxy upstream error: ${err.message}\n`)
    })
    req.on("error", () => upstream.destroy())
    req.pipe(upstream)
  })

  server.on("connection", track)

  server.on("connect", (req, clientSocket, head) => {
    const sock = clientSocket as Socket
    track(sock)
    const target = parseConnectAuthority(req.url ?? "")
    if (!target) {
      sock.end("HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nInvalid CONNECT authority.\r\n")
      return
    }
    if (!isDomainAllowed(target.host, normalized)) {
      sock.end(
        `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\nX-Apexo-Sandbox: blocked-domain\r\n\r\nDomain "${target.host}" is blocked by Apexo sandbox allowlist.\r\n`,
      )
      return
    }
    let established = false
    const upstream = connect({ host: target.host, port: target.port }, () => {
      established = true
      sock.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length > 0) upstream.write(head)
      upstream.pipe(sock)
      sock.pipe(upstream)
    })
    track(upstream)
    upstream.on("error", (err) => {
      if (!established && !sock.destroyed) {
        sock.end(
          `HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nUpstream connection failed: ${err.message}\r\n`,
        )
        return
      }
      sock.destroy()
    })
    sock.on("error", () => upstream.destroy())
  })

  return new Promise<RunningProxy>((resolve, reject) => {
    const onError = (err: Error) => reject(err)
    server.once("error", onError)
    const finish = () => {
      server.off("error", onError)
      const addr = server.address()
      const port = listen.kind === "tcp" && typeof addr === "object" && addr ? addr.port : undefined
      let closed: Promise<void> | undefined
      const close = () => {
        closed ??= new Promise<void>((done) => {
          for (const socket of sockets) socket.destroy()
          sockets.clear()
          server.close(() => {
            if (listen.kind === "unix") {
              unlink(listen.socketPath).catch(() => undefined).finally(() => done())
              return
            }
            done()
          })
        })
        return closed
      }
      resolve({
        ...(port !== undefined ? { port } : {}),
        ...(listen.kind === "unix" ? { socketPath: listen.socketPath } : {}),
        close,
      })
    }
    if (listen.kind === "unix") {
      unlink(listen.socketPath)
        .catch(() => undefined)
        .then(() => server.listen(listen.socketPath, finish))
      return
    }
    server.listen(0, "127.0.0.1", finish)
  })
}

function forwardHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const copy: IncomingHttpHeaders = { ...headers }
  delete copy["proxy-connection"]
  delete copy["proxy-authorization"]
  return copy
}

function parseHttpUrl(rawUrl: string): URL | undefined {
  try {
    const parsed = new URL(rawUrl)
    return parsed.protocol === "http:" && parsed.hostname ? parsed : undefined
  } catch {
    return undefined
  }
}

function parseConnectAuthority(raw: string): { host: string; port: number } | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith("[")) {
    const endBracket = trimmed.indexOf("]")
    if (endBracket <= 1) return undefined
    const host = trimmed.slice(1, endBracket)
    const rest = trimmed.slice(endBracket + 1)
    const port = rest === "" ? 443 : rest.startsWith(":") ? Number(rest.slice(1)) : NaN
    if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
    return { host, port }
  }
  const colon = trimmed.lastIndexOf(":")
  const host = colon === -1 ? trimmed : trimmed.slice(0, colon)
  const port = colon === -1 ? 443 : Number(trimmed.slice(colon + 1))
  if (!host || host.includes(":") || !Number.isInteger(port) || port < 1 || port > 65535) return undefined
  return { host, port }
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
}

function isIpv4Literal(host: string): boolean {
  const parts = host.split(".")
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  )
}

function isBracketedOrPlainIpv6(host: string): boolean {
  const plain = stripBrackets(host)
  return plain.includes(":") && /^[0-9a-f:]+$/i.test(plain)
}

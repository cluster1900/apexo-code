export * as NativeLspClient from "./lsp-client"

import { execFile } from "node:child_process"
import path from "node:path"
import { Socket } from "node:net"
import { Transform } from "node:stream"
import { pathToFileURL } from "node:url"
import spawn from "cross-spawn"
import {
  CancellationTokenSource,
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node"

export const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "goToImplementation",
  "documentSymbol",
  "workspaceSymbol",
] as const
export type Operation = (typeof operations)[number]
const methods = {
  goToDefinition: ["textDocument/definition", "definitionProvider"],
  findReferences: ["textDocument/references", "referencesProvider"],
  hover: ["textDocument/hover", "hoverProvider"],
  goToImplementation: ["textDocument/implementation", "implementationProvider"],
  documentSymbol: ["textDocument/documentSymbol", "documentSymbolProvider"],
  workspaceSymbol: ["workspace/symbol", "workspaceSymbolProvider"],
} as const

export async function create(input: {
  command: readonly string[]
  transport?: "stdio" | "socket"
  root: string
  workspaceFolder?: string
  workspaceOpen?: { readonly solution?: string; readonly projects?: readonly string[] }
  environment?: Record<string, string>
  initialization?: Record<string, unknown>
  settings?: Record<string, unknown>
  shutdownTimeout?: number
  startupTimeout?: number
  requestTimeout?: number
  signal: AbortSignal
  onClosed?: () => void
}) {
  if (!input.command[0]?.trim()) throw new Error("Language-server command is empty")
  if (input.signal.aborted) throw input.signal.reason ?? new Error("LSP startup interrupted")
  const address = input.transport === "socket" ? endpoint(input.command[0]) : undefined
  const socket = address ? new Socket() : undefined
  const child = socket
    ? undefined
    : spawn(input.command[0], input.command.slice(1), {
        cwd: input.root,
        env: { ...process.env, ...input.environment },
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      })
  const readable = socket ?? child?.stdout
  const writable = socket ?? child?.stdin
  const transport = socket ?? child
  if (!readable || !writable || !transport) throw new Error("Language-server transport is unavailable")
  const workspaceRoot = input.workspaceFolder ?? input.root
  const alive = { value: true, initialized: false }
  const disconnected = () => {
    if (!alive.value) return
    alive.value = false
    input.onClosed?.()
  }
  const closed = new Promise<void>((resolve) =>
    transport.once("close", () => {
      disconnected()
      resolve()
    }),
  )
  // Bound a frame before it reaches the generic JSON-RPC decoder. A process may
  // split either headers or payload across arbitrarily many stream chunks.
  const framing = new Framing()
  const stream = new Transform({
    transform(chunk, _, done) {
      try {
        framing.append(chunk)
        done(null, chunk)
      } catch (error) {
        done(error instanceof Error ? error : new Error("Invalid LSP frame"))
      }
    },
  })
  const writer = new StreamMessageWriter(writable)
  const connection = createMessageConnection(new StreamMessageReader(readable.pipe(stream)), {
    onError: writer.onError,
    onClose: writer.onClose,
    // JSON-RPC 8.2 uses an async Promise executor in sendRequest and rethrows
    // writer failures after rejecting the request, causing an unhandled rejection.
    // Dispose here to reject every pending request, then settle the write itself.
    write: (message) =>
      writer.write(message).catch(() => {
        disconnected()
        connection.dispose()
      }),
    end: () => writer.end(),
    dispose: () => writer.dispose(),
  })
  child?.stderr?.resume()
  // Keep an error listener after JSON-RPC disposal: a queued write may settle
  // after a crashed child has closed its stdin.
  writable.on("error", disconnected)
  transport.on("error", () => {
    disconnected()
    connection.dispose()
  })
  stream.on("error", () => {
    disconnected()
    connection.dispose()
    void close().catch(() => undefined)
  })
  connection.onClose(disconnected)
  connection.onError(disconnected)
  connection.onRequest("workspace/configuration", (params: unknown) => {
    const items = record(params).items
    return Array.isArray(items)
      ? items.map((item) => {
          const section = record(item).section
          if (typeof section !== "string" || !section) return input.settings ?? null
          return section.split(".").reduce<unknown>((value, key) => record(value)[key], input.settings) ?? null
        })
      : []
  })
  connection.onRequest("workspace/workspaceFolders", () => [
    { uri: pathToFileURL(workspaceRoot).href, name: "project" },
  ])
  connection.onRequest("window/workDoneProgress/create", () => null)
  connection.onRequest("workspace/applyEdit", () => ({
    applied: false,
    failureReason: "Native LSP tools are read-only",
  }))
  connection.listen()
  const lifecycle: { closing?: Promise<void> } = {}
  const request = async (
    method: string,
    params: unknown,
    signal: AbortSignal,
    timeout = input.requestTimeout ?? 30_000,
  ) => {
    if (signal.aborted) throw signal.reason ?? new Error("LSP request interrupted")
    if (!alive.value) throw new Error("Language server is not connected")
    const cleanup: Array<() => void> = []
    const token = new CancellationTokenSource()
    const abort = () => {
      if (alive.value) token.cancel()
    }
    signal.addEventListener("abort", abort, { once: true })
    const deadline = AbortSignal.timeout(timeout)
    deadline.addEventListener("abort", abort, { once: true })
    try {
      return await Promise.race([
        connection.sendRequest<unknown>(method, params, token.token),
        closed.then(() => {
          throw new Error("Language-server connection closed")
        }),
        new Promise<never>((_, reject) => {
          const cancel = () =>
            reject(
              signal.aborted
                ? (signal.reason ?? new Error("LSP request interrupted"))
                : new Error("Language-server request timed out"),
            )
          signal.addEventListener("abort", cancel, { once: true })
          deadline.addEventListener("abort", cancel, { once: true })
          // Listener cleanup is attached to the request token lifecycle below.
          cleanup.push(() => {
            signal.removeEventListener("abort", cancel)
            deadline.removeEventListener("abort", cancel)
          })
        }),
      ])
    } finally {
      signal.removeEventListener("abort", abort)
      deadline.removeEventListener("abort", abort)
      token.dispose()
      cleanup.splice(0).forEach((remove) => remove())
    }
  }
  const close = () =>
    (lifecycle.closing ??= (async () => {
      // The configured deadline bounds the entire handshake, including a blocked
      // writer. Failed startup skips shutdown: initialize never established a session.
      if (alive.value && alive.initialized) {
        const timeout = input.shutdownTimeout ?? 5_000
        const timer = { handle: undefined as ReturnType<typeof setTimeout> | undefined }
        await Promise.race([
          (async () => {
            await request("shutdown", null, AbortSignal.timeout(timeout), timeout).catch(() => undefined)
            if (alive.value && writable.writable) await connection.sendNotification("exit")
          })().catch(() => undefined),
          new Promise<void>((resolve) => {
            timer.handle = setTimeout(resolve, timeout)
          }),
        ]).finally(() => clearTimeout(timer.handle))
      }
      connection.dispose()
      disconnected()
      writable.end()
      await Promise.race([closed, delay(100)])
      if (child?.pid && process.platform === "win32")
        await new Promise<void>((resolve) =>
          execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolve()),
        )
      if (child?.pid && process.platform !== "win32") {
        for (const signal of ["SIGTERM", "SIGKILL"] as const) {
          try {
            process.kill(-child.pid, signal)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH")
              throw new Error("Language-server process cleanup failed")
          }
          if (signal === "SIGTERM") await Promise.race([closed, delay(100)])
        }
      }
      socket?.destroy()
      await Promise.race([
        closed,
        delay(2000).then(() => {
          throw new Error("Language-server transport did not close")
        }),
      ])
      readable.destroy()
      child?.stderr?.destroy()
      stream.destroy()
    })())
  const startup = AbortSignal.any([input.signal, AbortSignal.timeout(input.startupTimeout ?? 15_000)])
  try {
    if (socket && address) await connect(socket, address, startup)
    const initialized = record(
      await request(
        "initialize",
        {
          processId: process.pid,
          rootUri: pathToFileURL(workspaceRoot).href,
          workspaceFolders: [{ uri: pathToFileURL(workspaceRoot).href, name: "project" }],
          capabilities: {
            workspace: { configuration: true, workspaceFolders: true, applyEdit: false },
            textDocument: {
              synchronization: { dynamicRegistration: false },
              definition: { linkSupport: true },
              implementation: { linkSupport: true },
              documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            },
            general: { positionEncodings: ["utf-16"] },
          },
          initializationOptions: input.initialization,
          clientInfo: { name: "Apexo native LSP" },
        },
        startup,
        input.startupTimeout ?? 15_000,
      ),
    )
    const capabilities = record(initialized.capabilities)
    if (capabilities.positionEncoding && capabilities.positionEncoding !== "utf-16")
      throw new Error("Language server requires an unsupported position encoding")
    alive.initialized = true
    await starting(() => connection.sendNotification("initialized", {}), startup)
    if (startup.aborted) throw startup.reason ?? new Error("LSP startup interrupted")
    const solution = input.workspaceOpen?.solution
    const projects = input.workspaceOpen?.projects
    if (solution)
      await starting(
        () =>
          connection.sendNotification("solution/open", {
            solution: pathToFileURL(path.resolve(workspaceRoot, solution)).href,
          }),
        startup,
      )
    if (projects?.length)
      await starting(
        () =>
          connection.sendNotification("project/open", {
            projects: projects.map((file) => pathToFileURL(path.resolve(workspaceRoot, file)).href),
          }),
        startup,
      )
    const supported = operations.filter((operation) => !!capabilities[methods[operation][1]])
    const documents = new Map<string, { text: string; version: number }>()
    const serial = { tail: Promise.resolve() }
    return {
      supported,
      healthy: () => alive.value,
      close,
      execute: (
        args: {
          operation: Operation
          file?: string
          text?: string
          languageId?: string
          line?: number
          character?: number
          query?: string
        },
        signal: AbortSignal,
      ) => {
        const next = serial.tail.then(async () => {
          if (signal.aborted) throw signal.reason ?? new Error("LSP request interrupted")
          if (!supported.includes(args.operation)) throw new Error(`Language server does not support ${args.operation}`)
          if (args.operation === "workspaceSymbol")
            return request(methods.workspaceSymbol[0], { query: args.query ?? "" }, signal)
          if (!args.file || args.text === undefined) throw new Error("Language-server document input is missing")
          const uri = pathToFileURL(args.file).href
          const previous = documents.get(uri)
          if (!previous) {
            await connection.sendNotification("textDocument/didOpen", {
              textDocument: { uri, languageId: args.languageId ?? "plaintext", version: 1, text: args.text },
            })
            documents.set(uri, { text: args.text, version: 1 })
          } else if (previous.text !== args.text) {
            const sync =
              typeof capabilities.textDocumentSync === "number"
                ? capabilities.textDocumentSync
                : record(capabilities.textDocumentSync).change
            const lines = previous.text.split(/\r\n|\r|\n/)
            await connection.sendNotification("textDocument/didChange", {
              textDocument: { uri, version: previous.version + 1 },
              contentChanges: [
                {
                  ...(sync === 2
                    ? {
                        range: {
                          start: { line: 0, character: 0 },
                          end: { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 },
                        },
                      }
                    : {}),
                  text: args.text,
                },
              ],
            })
            documents.set(uri, { text: args.text, version: previous.version + 1 })
          }
          return request(
            methods[args.operation][0],
            {
              textDocument: { uri },
              ...(args.operation !== "documentSymbol"
                ? { position: { line: args.line ?? 0, character: args.character ?? 0 } }
                : {}),
              ...(args.operation === "findReferences" ? { context: { includeDeclaration: true } } : {}),
            },
            signal,
          )
        })
        serial.tail = next.then(
          () => undefined,
          () => undefined,
        )
        return next
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export class Framing {
  private header = Buffer.alloc(0)
  private remaining = 0
  constructor(private readonly limit = 16 * 1024 * 1024) {}
  append(input: Buffer) {
    let offset = 0
    while (offset < input.length) {
      if (this.remaining) {
        const count = Math.min(this.remaining, input.length - offset)
        this.remaining -= count
        offset += count
        continue
      }
      // Append one byte at a time only while assembling the small header, to
      // correctly recognize delimiters split between chunks without retaining payload.
      this.header = Buffer.concat([this.header, input.subarray(offset, offset + 1)])
      offset++
      if (this.header.length > 8192) throw new Error("Language-server header exceeds its byte limit")
      if (!this.header.subarray(-4).equals(Buffer.from("\r\n\r\n"))) continue
      const lengths = [...this.header.toString("ascii").matchAll(/^Content-Length:\s*(\d+)\s*$/gim)]
      if (lengths.length !== 1) throw new Error("Invalid language-server Content-Length")
      this.remaining = Number(lengths[0]![1])
      if (!Number.isSafeInteger(this.remaining) || this.remaining <= 0 || this.remaining > this.limit)
        throw new Error("Language-server message exceeds its byte limit")
      this.header = Buffer.alloc(0)
    }
  }
}

// Socket command is the reference host:port endpoint, never a program or URL.
function endpoint(address: string) {
  const match = /^(?:\[([^\]]+)\]|([^:\/\s?#@]+)):(\d+)$/.exec(address)
  const port = Number(match?.[3])
  const host = match?.[1] ?? match?.[2]
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Language-server socket requires a host:port endpoint")
  return { host, port }
}

function connect(socket: Socket, address: { host: string; port: number }, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      signal.removeEventListener("abort", abort)
      socket.removeListener("connect", connected)
      socket.removeListener("error", failed)
      socket.removeListener("close", closed)
      if (error) return reject(error)
      resolve()
    }
    const abort = () => finish(signal.reason ?? new Error("LSP connection interrupted"))
    const connected = () => finish()
    const failed = (error: Error) => finish(error)
    const closed = () => finish(new Error("Language-server connection closed during startup"))
    signal.addEventListener("abort", abort, { once: true })
    socket.once("connect", connected)
    socket.once("error", failed)
    socket.once("close", closed)
    if (signal.aborted) return abort()
    socket.connect(address)
  })
}

async function starting<T>(pending: () => Promise<T>, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new Error("LSP startup interrupted")
  const cleanup: Array<() => void> = []
  try {
    return await Promise.race([
      pending(),
      new Promise<never>((_, reject) => {
        const abort = () => reject(signal.reason ?? new Error("LSP startup interrupted"))
        signal.addEventListener("abort", abort, { once: true })
        cleanup.push(() => signal.removeEventListener("abort", abort))
      }),
    ])
  } finally {
    cleanup.forEach((remove) => remove())
  }
}

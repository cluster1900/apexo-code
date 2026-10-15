export * as McpStdio from "./mcp-stdio"

import { execFile } from "node:child_process"
import spawn from "cross-spawn"
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"

/** SDK protocol framing with an Apexo-owned process group and bounded shutdown. */
export function make(input: { command: string[]; cwd: string; environment?: Record<string, string> }): Transport {
  const state: { process?: ReturnType<typeof spawn>; closed?: Promise<void>; closing?: Promise<void> } = {}
  const buffer = new Framing()
  const transport: Transport = {
    start: () =>
      new Promise<void>((resolve, reject) => {
        if (state.process) return reject(new Error("MCP transport already started"))
        const child = spawn(input.command[0]!, input.command.slice(1), {
          cwd: input.cwd,
          env: { ...process.env, ...input.environment },
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
          windowsHide: true,
        })
        state.process = child
        state.closed = new Promise<void>((done) =>
          child.once("close", () => {
            transport.onclose?.()
            done()
          }),
        )
        child.once("spawn", resolve)
        child.on("error", (error) => {
          transport.onerror?.(error)
          reject(error)
        })
        // Drain stderr without exposing server-provided secrets or filling its pipe.
        child.stderr?.resume()
        child.stdout?.on("data", (chunk: Buffer) => {
          try {
            buffer.append(chunk)
            for (let message = buffer.readMessage(); message; message = buffer.readMessage()) {
              transport.onmessage?.(message)
            }
          } catch (error) {
            transport.onerror?.(error instanceof Error ? error : new Error("Invalid MCP message"))
            void transport
              .close()
              .catch((error: unknown) =>
                transport.onerror?.(error instanceof Error ? error : new Error("MCP cleanup failed")),
              )
          }
        })
      }),
    send: (message: JSONRPCMessage) =>
      new Promise<void>((resolve, reject) => {
        if (!state.process?.stdin?.writable) return reject(new Error("MCP transport is closed"))
        state.process.stdin.write(serializeMessage(message), (error) => (error ? reject(error) : resolve()))
      }),
    close: () =>
      (state.closing ??= (async () => {
        const child = state.process
        if (!child) return
        child.stdin?.end()
        await Promise.race([state.closed, new Promise<void>((resolve) => setTimeout(resolve, 100))])
        if (child.pid && process.platform === "win32") {
          await new Promise<void>((resolve) =>
            execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolve()),
          )
        }
        if (child.pid && process.platform !== "win32") {
          // The group can outlive its leader; kill it even if the direct child exited.
          for (const signal of ["SIGTERM", "SIGKILL"] as const) {
            try {
              process.kill(-child.pid, signal)
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw new Error("MCP process cleanup failed")
            }
            if (signal === "SIGTERM")
              await Promise.race([state.closed, new Promise<void>((resolve) => setTimeout(resolve, 100))])
          }
        }
        if (state.closed)
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("MCP child did not close after forced shutdown")), 2_000)
            state.closed!.then(() => {
              clearTimeout(timer)
              resolve()
            }, reject)
          })
        child.stdout?.destroy()
        child.stderr?.destroy()
        buffer.clear()
      })()),
  }
  return transport
}

/** Bound each wire frame, including a partial frame following a complete one. */
export class Framing {
  private readonly buffer = new ReadBuffer()
  private bytes = 0
  constructor(private readonly limit = 16 * 1024 * 1024) {}
  append(chunk: Buffer) {
    for (let offset = 0; offset < chunk.length; ) {
      const newline = chunk.indexOf(10, offset)
      const end = newline < 0 ? chunk.length : newline + 1
      this.bytes += end - offset
      if (this.bytes > this.limit) throw new Error("MCP stdio message exceeds its byte limit")
      if (newline >= 0) this.bytes = 0
      offset = end
    }
    this.buffer.append(chunk)
  }
  readMessage() {
    return this.buffer.readMessage()
  }
  clear() {
    this.buffer.clear()
    this.bytes = 0
  }
}

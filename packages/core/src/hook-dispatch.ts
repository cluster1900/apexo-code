export * as HookDispatch from "./hook-dispatch"

import { spawn } from "node:child_process"
import { realpath } from "node:fs/promises"
import { Shell } from "./shell"
import { Schema } from "effect"
import { HookEnvironment } from "./hook-environment"
import { HookNetwork } from "./hook-network"
import { HookProjectTrust } from "./hook-project-trust"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export async function run(
  hook: Record<string, unknown>,
  input: string,
  root: string,
  cwd: string,
  timeout: number,
  host: boolean,
  event: string,
  signal?: AbortSignal,
  name = event,
  data?: string,
  projectAuthority?: HookProjectTrust.Authority,
) {
  const parsed = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(input)
  const payload = parsed._tag === "Some" ? record(parsed.value) : {}
  const env = {
    ...process.env,
    ...Object.fromEntries(
      Object.entries(record(hook.env)).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    CLAUDE_PLUGIN_ROOT: root,
    GROK_PLUGIN_ROOT: root,
    PLUGIN_ROOT: root,
    ...(data ? { GROK_PLUGIN_DATA: data, CLAUDE_PLUGIN_DATA: data } : {}),
    ...(host
      ? {
          GROK_HOOK_EVENT: event.replace(/[A-Z]/g, (letter, index) => `${index ? "_" : ""}${letter.toLowerCase()}`),
          GROK_HOOK_NAME: name,
          GROK_SESSION_ID: String(payload.session_id ?? payload.sessionId ?? ""),
          GROK_WORKSPACE_ROOT: cwd,
          CLAUDE_PROJECT_DIR: await realpath(cwd),
        }
      : {}),
  }
  if (hook.type === "http" && typeof hook.url === "string") {
    const url = new URL(
      host
        ? HookEnvironment.expand(
            hook.url,
            Object.fromEntries(
              Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            ),
          )
        : hook.url,
    )
    if (projectAuthority) await HookProjectTrust.authorize(projectAuthority)
    if (signal?.aborted) throw new Error("Hook invocation was cancelled")
    if (host)
      return HookNetwork.post(
        url,
        input,
        {
          "content-type": "application/json",
          ...Object.fromEntries(
            Object.entries(record(hook.headers)).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
        },
        signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
        projectAuthority ? () => HookProjectTrust.authorize(projectAuthority) : undefined,
      )
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid hook URL")
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...Object.fromEntries(
          Object.entries(record(hook.headers)).filter((v): v is [string, string] => typeof v[1] === "string"),
        ),
      },
      redirect: "error",
      body: input,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    })
    if (!response.ok) throw new Error(`Plugin hook returned HTTP ${response.status}`)
    const reader = response.body?.getReader()
    if (!reader) return ""
    const chunks: Uint8Array[] = []
    const size = { value: 0 }
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size.value += chunk.value.length
      if (size.value > 1_000_000) {
        await reader.cancel()
        throw new Error("Plugin hook response exceeds the size limit")
      }
      chunks.push(chunk.value)
    }
    return Buffer.concat(chunks).toString()
  }
  if (hook.type !== "command" || typeof hook.command !== "string") return ""
  const command = hook.command
  if (host && HookEnvironment.unresolved(command, env).length)
    throw new Error("Hook command references an unset environment variable")
  if (projectAuthority) await HookProjectTrust.authorize(projectAuthority)
  if (signal?.aborted) throw new Error("Hook invocation was cancelled")
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "cmd.exe" : "/bin/sh",
      process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command],
      {
        cwd,
        env,
        stdio: "pipe",
        detached: process.platform !== "win32",
        windowsHide: true,
      },
    )
    const output: Buffer[] = []
    const errors: Buffer[] = []
    const size = { value: 0 }
    const lifecycle = { closed: false, stopped: false }
    const stop = () => {
      if (lifecycle.stopped || lifecycle.closed) return
      lifecycle.stopped = true
      void Shell.killTree(child, { exited: () => lifecycle.closed })
    }
    signal?.addEventListener("abort", stop, { once: true })
    if (signal?.aborted) stop()
    const timer = setTimeout(stop, timeout)
    child.stdout.on("data", (chunk: Buffer) => {
      size.value += chunk.length
      if (size.value > 1_000_000) stop()
      else output.push(chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.concat(errors).length < 32_000) errors.push(chunk)
    })
    child.once("error", reject)
    child.stdin.on("error", () => {})
    child.stdin.end(input)
    child.once("close", (code) => {
      lifecycle.closed = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", stop)
      if (lifecycle.stopped) {
        reject(new Error("Plugin hook exceeded its time or output limit"))
        return
      }
      if (
        host &&
        code === 2 &&
        ["PreToolUse", "UserPromptSubmit", "PostToolUse", "Stop", "SubagentStop"].includes(event)
      ) {
        resolve(
          JSON.stringify({
            decision: "block",
            reason: Buffer.concat(errors).toString().trim() || `Hook blocked ${event} (exit code 2)`,
          }),
        )
        return
      }
      if (
        code !== 0 &&
        !(
          host &&
          ["UserPromptSubmit", "PostToolUse", "Stop", "SubagentStop"].includes(event) &&
          Buffer.concat(output).toString().trim().startsWith("{")
        )
      ) {
        reject(new Error(Buffer.concat(errors).toString() || `Plugin hook exited ${code}`))
        return
      }
      const result = Buffer.concat(output).toString().trim()
      // Plain command output is informational. Structured hook responses start with an object.
      resolve(result.startsWith("{") ? result : "")
    })
  })
}

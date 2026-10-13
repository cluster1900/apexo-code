import type { CliRenderer } from "@opentui/core"
import { spawn } from "node:child_process"
import { setTimeout } from "node:timers/promises"

/** Let the native client own browser login and credential persistence, then return to Apexo. */
export async function externalLogin(input: {
  command: readonly string[]
  cwd?: string
  renderer: Pick<CliRenderer, "suspend" | "resume" | "requestRender"> & {
    currentRenderBuffer: Pick<CliRenderer["currentRenderBuffer"], "clear">
  }
  connect: (signal: AbortSignal) => Promise<boolean>
  signal?: AbortSignal
  stdio?: "inherit" | "ignore"
  timeoutMs?: number
  intervalMs?: number
}) {
  const controller = new AbortController()
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(input.timeoutMs ?? 10 * 60 * 1000),
    ...(input.signal ? [input.signal] : []),
  ])
  if (await input.connect(signal)) return true
  if (!input.command[0]) throw new Error("The native login command is unavailable")
  signal.throwIfAborted()

  input.renderer.suspend()
  input.renderer.currentRenderBuffer.clear()
  // suspend() removes OpenTUI's signal handlers; Ctrl+C should cancel login, not exit Apexo.
  const interrupt = () => controller.abort()
  process.on("SIGINT", interrupt)
  try {
    const child = spawn(input.command[0], [...input.command.slice(1)], {
      cwd: input.cwd,
      stdio: input.stdio ?? "inherit",
    })
    const closed = new Promise<void>((resolve, reject) => {
      child.once("error", reject)
      child.once("close", () => resolve())
    })
    const poll = async () => {
      while (true) {
        await setTimeout(input.intervalMs ?? 2000, undefined, { signal })
        if (await input.connect(signal)) return true
      }
    }
    try {
      return await Promise.race([closed.then(() => input.connect(signal)), poll()]).catch((error) => {
        if (controller.signal.aborted) return false
        throw error
      })
    } finally {
      controller.abort()
      if (child.exitCode === null && child.signalCode === null) {
        child.kill()
        await Promise.race([closed.catch(() => undefined), setTimeout(1000)])
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL")
          await closed.catch(() => undefined)
        }
      }
    }
  } finally {
    controller.abort()
    process.off("SIGINT", interrupt)
    input.renderer.currentRenderBuffer.clear()
    input.renderer.resume()
    input.renderer.requestRender()
  }
}

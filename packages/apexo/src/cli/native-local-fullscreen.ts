import { Rpc } from "@/util/rpc"
import { createTuiWorker } from "./tui-worker"
import type { rpc } from "./tui/worker-native"
import { nativeLocalDirectory } from "./native-local"
import { withTimeout } from "@/util/timeout"
import { win32InstallCtrlCGuard } from "@apexo/tui/terminal-win32"

export async function runNativeLocalFullscreen(input: {
  directory: string
  worker: URL | string
  prompt?: string
  session?: string
  continue?: boolean
  agent?: string
  model?: string
}) {
  if (!process.stdout.isTTY) throw new Error("Native fullscreen requires a TTY stdout")
  const directory = await nativeLocalDirectory(input.directory)
  process.chdir(directory)
  const unguard = win32InstallCtrlCGuard()
  const worker = createTuiWorker(input.worker, "native")
  const client = Rpc.client<typeof rpc>(worker)
  const settlement: { close?: Promise<void> } = {}
  const close = () =>
    (settlement.close ??= (async () => {
      try {
        await withTimeout(client.call("shutdown", undefined), 10_000)
      } finally {
        worker.terminate()
        unguard?.()
      }
    })())
  const lifetime = new AbortController()
  const terminate = () => {
    process.exitCode = 143
    lifetime.abort()
  }
  process.once("SIGTERM", terminate)
  try {
    const transport = await withTimeout(client.call("start", undefined), 20_000)
    if (!transport.ok) throw new Error(transport.message)
    const { validateSession } = await import("./tui/validate-session")
    await validateSession({
      url: transport.url,
      headers: transport.headers,
      sessionID: input.session,
      directory,
      sessionProtocol: "native",
    })
    const { TuiConfig } = await import("@/config/tui")
    const { createLegacyTuiPluginHost } = await import("@/plugin/tui/runtime")
    const { Effect } = await import("effect")
    const { run } = await import("./tui/layer")
    await Effect.runPromise(
      run({
        url: transport.url,
        headers: transport.headers,
        directory,
        config: await TuiConfig.get(),
        pluginHost: createLegacyTuiPluginHost(),
        args: {
          sessionProtocol: "native",
          sessionID: input.session,
          continue: input.continue,
          agent: input.agent,
          model: input.model,
          prompt: input.prompt,
        },
      }),
      { signal: lifetime.signal },
    ).catch((error) => {
      if (!lifetime.signal.aborted) throw error
    })
  } finally {
    process.off("SIGTERM", terminate)
    await close()
  }
}

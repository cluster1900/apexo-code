import path from "node:path"
import { realpath, stat } from "node:fs/promises"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { runNativeInteractive } from "./native-interactive"
import { resolveInteractiveStdin } from "./cmd/run/runtime.stdin"

export interface NativeLocalOptions {
  "input-id"?: string
  session?: string
  continue?: boolean
  fork?: boolean
  agent?: string
  model?: string
  variant?: string
  auto?: boolean
  yolo?: boolean
  "dangerously-skip-permissions"?: boolean
  command?: string
  demo?: boolean
  profile?: string
  title?: string
  file?: string[]
  port?: number
  format?: string
  mini?: boolean
  dir?: string
  message?: string[]
  "--"?: string[]
  thinking?: boolean
  replay?: boolean
  "replay-limit"?: number
}

export function validateNativeLocal(input: NativeLocalOptions) {
  const unsupported = [
    ["--fork", input.fork],
    ["--command", input.command !== undefined],
    ["--demo", input.demo],
    ["--profile", input.profile !== undefined],
    ["--title", input.title !== undefined],
    ["--file", input.file !== undefined],
    ["--port", input.port !== undefined],
    ["--auto", input.auto || input.yolo || input["dangerously-skip-permissions"]],
    ["--format", input.format !== undefined && input.format !== "default"],
  ].find((entry) => entry[1])?.[0]
  if (unsupported) throw new Error(`${unsupported} is not available for native local interactive startup`)
  if (input["replay-limit"] !== undefined && (!Number.isInteger(input["replay-limit"]) || input["replay-limit"] <= 0))
    throw new Error("--replay-limit must be a positive integer")
}

export async function nativeLocalDirectory(directory?: string) {
  const resolved = await realpath(path.resolve(process.env.PWD ?? process.cwd(), directory ?? "."))
  if (!(await stat(resolved)).isDirectory()) throw new Error("Native local startup requires a directory")
  return resolved
}

export async function runNativeLocalMini(input: NativeLocalOptions) {
  if (!input.mini) {
    const { runNativeHeadless, validateNativeInputID } = await import("./native-headless")
    validateNativeInputID({ inputID: input["input-id"], session: input.session, continue: input.continue })
    const unsupported = [
      ["--fork", input.fork],
      ["--command", input.command !== undefined],
      ["--demo", input.demo],
      ["--profile", input.profile !== undefined],
      ["--title", input.title !== undefined],
      ["--port", input.port !== undefined],
      ["--replay-limit", input["replay-limit"] !== undefined],
    ].find((item) => item[1])?.[0]
    if (unsupported) throw new Error(`${unsupported} is not supported by native local headless execution`)
    const format = input.format ?? "default"
    if (format !== "default" && format !== "json" && format !== "streaming-json")
      throw new Error("Unsupported native output format")
    const parts = input.model?.split("/")
    if (parts && (!parts[0] || !parts.slice(1).join("/"))) throw new Error("Model must use provider/model syntax")
    const directory = await nativeLocalDirectory(input.dir)
    const text = [
      [...(input.message ?? []), ...(input["--"] ?? [])].join(" "),
      process.stdin.isTTY ? undefined : await Bun.stdin.text(),
    ]
      .filter(Boolean)
      .join("\n")
    const filenames = input.file ?? []
    const files = filenames.length
      ? await (async () => {
          const { readRunAttachment } = await import("./file-attachment")
          return Promise.all(filenames.map((filename) => readRunAttachment(path.resolve(directory, filename))))
        })()
      : []
    if (!text.trim() && !files.length) throw new Error("A new prompt or file is required for native headless execution")
    process.chdir(directory)
    const { createNativeLocalHost } = await import("./native-local-host")
    const host = createNativeLocalHost(undefined, true)
    try {
      return await runNativeHeadless({
        sdk: createApexoClient({ baseUrl: "http://apexo.local", fetch: host.fetch, directory }),
        directory,
        session: input.session,
        continue: input.continue,
        inputID: input["input-id"],
        agent: input.agent,
        model: parts ? { providerID: parts[0], modelID: parts.slice(1).join("/") } : undefined,
        variant: input.variant,
        files,
        dispose: host.close,
        text,
        format,
        thinking: input.thinking,
        auto: input.auto || input.yolo || input["dangerously-skip-permissions"],
      })
    } finally {
      await host.close()
    }
  }
  validateNativeLocal(input)
  if (!process.stdout.isTTY) throw new Error("--mini requires a TTY stdout")
  resolveInteractiveStdin().cleanup?.()
  const directory = await nativeLocalDirectory(input.dir)
  const message = [...(input.message ?? []), ...(input["--"] ?? [])].join(" ")
  const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
  const initialInput = [message, piped].filter(Boolean).join("\n") || undefined
  const parts = input.model?.split("/")
  if (parts && (parts.length < 2 || !parts[0] || !parts.slice(1).join("/")))
    throw new Error("Model must use provider/model syntax")
  process.chdir(directory)
  const { createNativeLocalHost } = await import("./native-local-host")
  const host = createNativeLocalHost()
  const lifetime = new AbortController()
  const terminate = () => {
    process.exitCode = 143
    lifetime.abort()
  }
  process.once("SIGTERM", terminate)
  try {
    const { Effect } = await import("effect")
    const { RuntimeFlags } = await import("@/effect/runtime-flags")
    const flags = await Effect.runPromise(RuntimeFlags.Service.pipe(Effect.provide(RuntimeFlags.Service.layer)))
    return await runNativeInteractive({
      sdk: createApexoClient({ baseUrl: "http://apexo.local", fetch: host.fetch, directory }),
      directory,
      signal: lifetime.signal,
      session: input.session,
      continue: input.continue,
      agent: input.agent,
      model: parts ? { providerID: parts[0], modelID: parts.slice(1).join("/") } : undefined,
      variant: input.variant,
      files: [],
      initialInput,
      thinking: input.thinking ?? true,
      backgroundSubagents: flags.experimentalBackgroundSubagents,
      replay: input.replay,
      replayLimit: input["replay-limit"],
    }).catch((error) => {
      if (!lifetime.signal.aborted) throw error
    })
  } finally {
    process.off("SIGTERM", terminate)
    await host.close()
  }
}

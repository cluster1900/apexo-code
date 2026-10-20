import { cmd } from "@/cli/cmd/cmd"
import { ModeSwitch, type ModeSwitchRequest } from "@apexo/core/mode-switch"
import { Rpc } from "@/util/rpc"
import { createTuiWorker } from "../tui-worker"
import { type rpc } from "../tui/worker"
import path from "path"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { errorMessage } from "@apexo/tui/util/error"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptionsNoConfig, hasArg } from "@/cli/network"
import { Filesystem } from "@/util/filesystem"
import type { GlobalEvent } from "@apexo/sdk/v2"
import type { EventSource } from "@apexo/tui/context/sdk"
import { writeHeapSnapshot } from "v8"
import { ServerAuth } from "@/server/auth"
import { validateSession } from "../tui/validate-session"
import { win32InstallCtrlCGuard } from "@apexo/tui/terminal-win32"

declare global {
  const APEXO_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  return {
    subscribe: async (handler) => {
      return client.on<GlobalEvent>("global.event", (e) => {
        handler(e)
      })
    },
  }
}

async function target() {
  if (typeof APEXO_WORKER_PATH !== "undefined") return APEXO_WORKER_PATH
  const dist = new URL("./cli/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  return new URL("../tui/worker.ts", import.meta.url)
}

async function input(value?: string) {
  const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

export function resolveThreadDirectory(project?: string, envPWD = process.env.PWD, cwd = process.cwd()) {
  const root = Filesystem.resolve(envPWD ?? cwd)
  if (project) return Filesystem.resolve(path.isAbsolute(project) ? project : path.join(root, project))
  return Filesystem.resolve(cwd)
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start apexo tui",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start apexo in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session-protocol", {
        choices: ["auto", "native", "compatibility"] as const,
        default: "auto" as const,
        describe: "Session API transport (native also enables local interactive startup)",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("auto", {
        type: "boolean",
        describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
        default: false,
      })
      .option("yolo", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("dangerously-skip-permissions", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("mini", {
        type: "boolean",
        describe: "start the minimal interactive interface",
        default: false,
      })
      .option("replay", {
        type: "boolean",
        hidden: true,
      })
      .option("no-replay", {
        type: "boolean",
        describe: "disable mini session history replay on resume and after resize",
      })
      .option("replay-limit", {
        type: "number",
        describe: "cap visible mini replay to the newest N messages",
      })
      .option("demo", {
        type: "boolean",
        hidden: true,
      }),
  handler: async (args) => {
    if (
      args.project &&
      !/^[.~/\\]|[/\\]/.test(args.project) &&
      !(await Filesystem.isDir(resolveThreadDirectory(args.project)))
    ) {
      UI.error(`Unknown command: ${args.project}`)
      process.exitCode = 1
      return
    }
    if (args["session-protocol"] === "native") {
      const { runNativeLocalMini, validateNativeLocal } = await import("../native-local")
      validateNativeLocal({ ...args, port: undefined })
      const network = ["--port", "--hostname", "--mdns", "--no-mdns", "--mdns-domain", "--cors"].find((option) =>
        process.argv.some((arg) => arg === option || arg.startsWith(option + "=")),
      )
      if (network) throw new Error(`${network} is not available for native local interactive startup`)
      if (args.replay === true) throw new Error("--replay is not supported; replay is enabled by default")
      if (args.mini)
        return runNativeLocalMini({
          ...args,
          port: undefined,
          dir: resolveThreadDirectory(args.project),
          message: args.prompt ? [args.prompt] : [],
          replay: args.replay === false || args.noReplay === true ? false : undefined,
        })
      if (args.replay === false || args.noReplay === true || args.replayLimit !== undefined)
        throw new Error("Replay options require --mini")
      const { runNativeLocalFullscreen } = await import("../native-local-fullscreen")
      return runNativeLocalFullscreen({
        directory: resolveThreadDirectory(args.project),
        worker: await target(),
        prompt: await input(args.prompt),
        session: args.session,
        continue: args.continue,
        agent: args.agent,
        model: args.model,
      })
    }
    if (args["session-protocol"] !== "auto") {
      UI.error("--session-protocol requires attach <url>; local terminal bootstrap uses compatibility")
      process.exitCode = 1
      return
    }
    if (args.replay === true) {
      UI.error("--replay is not supported; replay is enabled by default")
      process.exitCode = 1
      return
    }
    const noReplay = args.replay === false || args.noReplay === true

    // Grok Build `/minimal` ↔ `/fullscreen`: this entry point loops over renderers while the process lives.
    let handoff: ModeSwitchRequest | undefined
    if (args.mini) {
      const network = ["--port", "--hostname", "--mdns", "--no-mdns", "--mdns-domain", "--cors"].find((option) =>
        process.argv.some((arg) => arg === option || arg.startsWith(option + "=")),
      )
      if (network) {
        UI.error(`${network} cannot be used with --mini`)
        process.exitCode = 1
        return
      }

      const { runMini } = await import("./run")
      ModeSwitch.setAvailable(!args.demo)
      await runMini({
        directory: resolveThreadDirectory(args.project),
        continue: args.continue,
        session: args.session,
        fork: args.fork,
        model: args.model,
        agent: args.agent,
        prompt: args.prompt,
        replay: noReplay ? false : undefined,
        replayLimit: args.replayLimit,
        demo: args.demo,
      })
      handoff = ModeSwitch.take()
      if (!handoff) return
    }

    const unsupported = [
      ["--no-replay", noReplay && !handoff],
      ["--replay-limit", args.replayLimit !== undefined && !handoff],
      ["--demo", args.demo !== undefined && !handoff],
    ].find((entry) => entry[1])?.[0]
    if (unsupported) {
      UI.error(`${unsupported} requires --mini`)
      process.exitCode = 1
      return
    }

    const unguard = win32InstallCtrlCGuard()
    try {
      const { TuiConfig } = await import("@/config/tui")
      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }

      // Resolve relative --project paths from PWD, then use the real cwd after
      // chdir so the thread and worker share the same directory key.
      const next = resolveThreadDirectory(args.project)
      const file = await target()
      try {
        process.chdir(next)
      } catch {
        UI.error("Failed to change directory to " + next)
        process.exitCode = 1
        return
      }
      const cwd = Filesystem.resolve(process.cwd())

      const worker = createTuiWorker(file, "compatibility")
      const client = Rpc.client<typeof rpc>(worker)
      const reload = () => {
        client.call("reload", undefined).catch(() => {})
      }
      process.on("SIGUSR2", reload)

      let stopped = false
      const stop = async () => {
        if (stopped) return
        stopped = true
        process.off("SIGUSR2", reload)
        await withTimeout(client.call("shutdown", undefined), 5000).catch(() => {})
        worker.terminate()
      }

      const prompt = await input(args.prompt)
      const config = await TuiConfig.get()

      const network = resolveNetworkOptionsNoConfig(args)
      const external = hasArg("--port") || hasArg("--hostname") || network.mdns === true

      const headers = external ? ServerAuth.headers() : undefined

      const transport = external
        ? {
            url: (await client.call("server", network)).url,
            fetch: undefined,
            events: undefined,
            headers,
          }
        : {
            url: "http://apexo.internal",
            fetch: createWorkerFetch(client),
            events: createEventSource(client),
          }

      // `-s` may name a session by title; continue with the ID it resolves to.
      const validated = await validateSession({
        url: transport.url,
        sessionID: args.session,
        directory: cwd,
        fetch: transport.fetch,
        headers,
      }).then(
        (sessionID) => ({ sessionID }),
        (error: unknown) => {
          UI.error(errorMessage(error))
          process.exitCode = 1
          return undefined
        },
      )
      if (!validated) return

      setTimeout(() => {
        client.call("warmInstance", { directory: cwd }).catch(() => {})
      }, 1000).unref?.()

      // A switch to the minimal renderer attaches to this worker over loopback, so both renderers share one backend.
      let shared: { url: string; headers?: Record<string, string> } | undefined
      const sharedServer = async () => {
        if (external) return { url: transport.url, headers: headers as Record<string, string> | undefined }
        shared ??= {
          url: (await client.call("server", { port: 0, hostname: "127.0.0.1", mdns: false, cors: [] })).url,
          headers: ServerAuth.headers() as Record<string, string> | undefined,
        }
        return shared
      }
      ModeSwitch.setAvailable(true)
      let session = handoff?.sessionID ?? validated.sessionID
      let launch = {
        prompt: handoff ? undefined : prompt,
        continue: handoff ? false : args.continue,
        fork: handoff ? false : args.fork,
      }
      let agent = handoff?.agent ?? args.agent
      let model = handoff?.model ?? args.model
      try {
        while (true) {
          const { Effect } = await import("effect")
          const { run } = await import("../tui/layer")
          const { createLegacyTuiPluginHost } = await import("@/plugin/tui/runtime")
          await Effect.runPromise(
            run({
              url: transport.url,
              local: true,
              async onSnapshot() {
                const tui = writeHeapSnapshot("tui.heapsnapshot")
                const server = await client.call("snapshot", undefined)
                return [tui, server]
              },
              config,
              pluginHost: createLegacyTuiPluginHost(),
              directory: cwd,
              fetch: transport.fetch,
              headers: transport.headers,
              events: transport.events,
              args: {
                continue: launch.continue,
                sessionID: session,
                agent,
                model,
                prompt: launch.prompt,
                fork: launch.fork,
                auto: args.auto || args.yolo || args["dangerously-skip-permissions"],
              },
            }),
          )
          const toMinimal = ModeSwitch.take()
          if (toMinimal?.mode !== "minimal") break
          ModeSwitch.seedDraft(toMinimal.draft)
          const backend = await sharedServer()
          const { runMini } = await import("./run")
          await runMini({
            directory: cwd,
            attach: backend.url,
            password: undefined,
            session: toMinimal.sessionID,
            model: toMinimal.model,
            agent: toMinimal.agent,
            replay: noReplay ? false : undefined,
            replayLimit: args.replayLimit,
          })
          const back = ModeSwitch.take()
          if (back?.mode !== "fullscreen") break
          session = back.sessionID ?? toMinimal.sessionID
          agent = toMinimal.agent ?? agent
          model = toMinimal.model ?? model
          launch = { prompt: undefined, continue: false, fork: false }
        }
      } finally {
        ModeSwitch.setAvailable(false)
        await stop()
      }
    } finally {
      try {
        unguard?.()
      } catch {}
    }
    process.exit()
  },
})
// scratch

import type { PermissionV1 } from "@apexo/core/v1/permission"
// CLI entry point for `apexo run` and `apexo --mini`.
//
// Handles three modes:
//   1. Non-interactive (default): sends a single prompt, streams events to
//      stdout, and exits when the session goes idle.
//   2. Interactive local (`apexo --mini`): boots the split-footer direct mode
//      with an in-process server (no external HTTP).
//   3. Interactive attach (`apexo --mini --attach`): connects to a running
//      apexo server and runs interactive mode against it.
//
// Also supports `--command` for slash-command execution, `--format json` for
// raw event streaming, `--continue` / `--session` for session resumption,
// and `--fork` for forking before continuing.
import type { Argv } from "yargs"
import path from "path"
import { pathToFileURL } from "url"
import { Effect } from "effect"
import { UI } from "../ui"
import { memoryCaptureText } from "@apexo/tui/util/memory-capture"
import { effectCmd } from "../effect-cmd"
import { EOL } from "os"
import { Filesystem } from "@/util/filesystem"
import { createApexoClient, type ApexoClient, type ToolPart } from "@apexo/sdk/v2/client"
import { FormatError, FormatUnknownError } from "../error"
import { INTERACTIVE_INPUT_ERROR, readPipedStdin, resolveInteractiveStdin } from "./run/runtime.stdin"
import { GrokBuildTools } from "@/tool/grok-build"
import { Permission } from "@/permission"

type ModelInput = Parameters<ApexoClient["session"]["prompt"]>[0]["model"]

function pick(value: string | undefined): ModelInput | undefined {
  if (!value) return undefined
  const [providerID, ...rest] = value.split("/")
  return {
    providerID,
    modelID: rest.join("/"),
  } as ModelInput
}

async function grokBuildToolNames(
  client: ApexoClient,
  agent: string | undefined,
  requestedModel: string | undefined,
  directory: string,
  webSearch: boolean,
  sessionID: string,
  permission: PermissionV1.Ruleset,
) {
  const [agents, session] = await Promise.all([
    client.app
      .agents({ directory })
      .then((result) => result.data ?? [])
      .catch(() => []),
    client.session
      .get({ sessionID, directory })
      .then((result) => result.data)
      .catch(() => undefined),
  ])
  // The agent endpoint orders the configured default first.
  const selected = agent
    ? agents.find((item) => item.name === agent)
    : agents.find((item) => item.mode !== "subagent" && item.hidden !== true)
  const allowed = (names: string[]) => {
    const disabled = Permission.disabled(
      names,
      Permission.merge(selected?.permission ?? [], session?.permission ?? permission),
    )
    return names.filter((name) => !disabled.has(name))
  }
  const fallback = () => allowed(GrokBuildTools.advertisedToolNames({ webSearch }))
  const model = pick(requestedModel)
  const resolved =
    model ??
    selected?.model ??
    (session?.model ? { providerID: session.model.providerID, modelID: session.model.id } : undefined) ??
    agents.find((item) => item.name === "build")?.model ??
    agents.find((item) => item.mode === "primary" && item.hidden !== true)?.model
  if (!resolved) return fallback()

  const tools = await client.tool
    .list({
      directory,
      provider: resolved.providerID,
      model: resolved.modelID,
    })
    .catch(() => undefined)
  if (!tools?.data) return fallback()

  const actual = new Set<string>(
    tools.data
      .map((item) => GrokBuildTools.canonicalToolName(item.id))
      .filter((id) => GrokBuildTools.isProfileTool(id)),
  )
  return allowed(GrokBuildTools.advertisedToolNames({ webSearch }).filter((name) => actual.has(name)))
}

function resolveRunInput(value?: string, piped?: string): string | undefined {
  if (!value) {
    return piped
  }

  if (!piped) {
    return value
  }

  return value + "\n" + piped
}

type FilePart = {
  type: "file"
  url: string
  filename: string
  mime: string
}

type Inline = {
  icon: string
  title: string
  description?: string
}

type SessionInfo = {
  id: string
  title?: string
  directory?: string
}

function inline(info: Inline) {
  const suffix = info.description ? UI.Style.TEXT_DIM + ` ${info.description}` + UI.Style.TEXT_NORMAL : ""
  UI.println(UI.Style.TEXT_NORMAL + info.icon, UI.Style.TEXT_NORMAL + info.title + suffix)
}

function block(info: Inline, output?: string) {
  UI.empty()
  inline(info)
  if (!output?.trim()) return
  UI.println(output)
  UI.empty()
}

function formatRunError(error: unknown) {
  return FormatError(error) ?? FormatUnknownError(error)
}

async function tool(part: ToolPart) {
  try {
    const { toolInlineInfo } = await import("./run/tool")
    const next = toolInlineInfo(part)
    if (next.mode === "block") {
      block(next, next.body)
      return
    }

    inline(next)
  } catch {
    inline({
      icon: "\u2699",
      title: part.tool,
    })
  }
}

async function toolError(part: ToolPart) {
  try {
    const { toolInlineInfo } = await import("./run/tool")
    const next = toolInlineInfo(part)
    inline({
      icon: "✗",
      title: `${next.title} failed`,
      ...(next.description && { description: next.description }),
    })
    return
  } catch {
    inline({
      icon: "✗",
      title: `${part.tool} failed`,
    })
  }
}

/**
 * `-s/--session` accepts a session ID or, like Grok Build's `--resume`, a title of a top-level session in this
 * project: an exact title (ignoring case) or the same words joined by any separators. Several matches fail as
 * ambiguous instead of guessing.
 */
async function resolveSession(sdk: ApexoClient, reference: string) {
  const byID = await sdk.session.get({ sessionID: reference }).catch(() => undefined)
  if (byID?.data) return byID.data
  const sessions = (await sdk.session.list({ roots: true, limit: 1000 }).catch(() => undefined))?.data ?? []
  const { resolveSessionReference, sessionMatches } = await import("@apexo/sdk/v2/grok-commands")
  const found = resolveSessionReference(reference, sessions)
  if (found) return found
  const similar = sessions.filter((item) => sessionMatches(reference, item)).slice(0, 5)
  UI.error(
    similar.length > 1
      ? `Session "${reference}" is ambiguous; matching sessions: ${similar.map((item) => `${item.id} (${item.title})`).join(", ")}`
      : `Session not found: no session ID or title matches "${reference}"`,
  )
  process.exit(1)
}

const CompatibilityRunCommand = effectCmd({
  prepare: (args) => {
    if ((args["session-protocol"] ?? "auto") !== "auto" && !args.attach)
      throw new Error("--session-protocol requires --attach; local terminal bootstrap uses compatibility")
    if (args.profile) process.env.APEXO_RUNTIME_PROFILE = args.profile
  },
  command: "run [message..]",
  describe: "run apexo with a message",
  // --attach connects to a remote server (no local instance needed); the
  // default path runs an in-process server and needs the project instance.
  instance: (args) => !args.attach,
  // For --dir without --attach, load instance for the resolved target dir.
  // The handler also chdirs (preserving the legacy order: chdir → file resolution).
  directory: (args) => (args.dir && !args.attach ? path.resolve(process.cwd(), args.dir) : process.cwd()),
  builder: (yargs: Argv) =>
    yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session-protocol", {
        choices: ["auto", "native", "compatibility"] as const,
        default: "auto" as const,
        describe: "Session API transport (native also enables local execution)",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id or title to continue",
        type: "string",
      })
      .option("input-id", {
        describe: "exact native headless input retry (requires --session)",
        type: "string",
      })
      .option("fork", {
        describe: "fork the session before continuing (requires --continue or --session)",
        type: "boolean",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json", "streaming-json"],
        default: "default",
        describe: "format: default (formatted), json (completed events), or streaming-json (streaming event JSONL)",
      })
      .option("profile", {
        type: "string",
        choices: ["apexo", "grok-build"],
        describe: "runtime profile for the local server",
        hidden: true,
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("attach", {
        type: "string",
        describe: "attach to a running apexo server (e.g., http://localhost:4096)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password (defaults to APEXO_SERVER_PASSWORD)",
      })
      .option("username", {
        alias: ["u"],
        type: "string",
        describe: "basic auth username (defaults to APEXO_SERVER_USERNAME or 'apexo')",
      })
      .option("dir", {
        type: "string",
        describe: "directory to run in, path on remote server if attaching",
      })
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("thinking", {
        type: "boolean",
        describe: "show thinking blocks",
      })
      .option("wait-for-background", {
        type: "boolean",
        default: true,
        describe:
          "wait for background work the prompt started and print the follow-up turns it triggers (use --no-wait-for-background to exit after the first turn)",
      })
      .option("background-wait-timeout", {
        type: "number",
        default: 600,
        describe: "seconds to wait for background work after the latest turn ends before stopping it and exiting 1",
      })
      .option("mini", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("replay", {
        type: "boolean",
        default: true,
        hidden: true,
        describe: "replay interactive session history on resume and after resize (use --no-replay to disable)",
      })
      .option("replay-limit", {
        type: "number",
        hidden: true,
        describe: "cap visible interactive replay to the newest N messages",
      })
      .option("interactive", {
        alias: ["i"],
        type: "boolean",
        describe: "run in direct interactive split-footer mode",
        default: false,
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
      .option("demo", {
        type: "boolean",
        default: false,
        hidden: true,
        describe: "enable direct interactive demo slash commands; pass one as the message to run it immediately",
      }),
  handler: Effect.fn("Cli.run")(function* (args) {
    const { Agent } = yield* Effect.promise(() => import("@/agent/agent"))
    const { RuntimeFlags } = yield* Effect.promise(() => import("@/effect/runtime-flags"))
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { ServerAuth } = yield* Effect.promise(() => import("@/server/auth"))
    const agentSvc = yield* Agent.Service
    const flags = yield* RuntimeFlags.Service
    const localInstance = yield* InstanceRef
    yield* Effect.promise(async () => {
      const rawMessage = [...args.message, ...(args["--"] || [])].join(" ")
      const interactive = Boolean(args.mini || args.interactive)
      const auto = args.auto || args.yolo || args["dangerously-skip-permissions"]
      const thinking = args.demo ? (args.thinking ?? true) : (args.thinking ?? false)
      const die = (message: string): never => {
        UI.error(message)
        process.exit(1)
      }
      const dieInteractive = (error: unknown): never => {
        if (error instanceof Error && error.message === INTERACTIVE_INPUT_ERROR) {
          die(error.message)
        }

        throw error
      }

      let message = [...args.message, ...(args["--"] || [])]
        .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
        .join(" ")

      if (interactive && args.command) {
        die("--mini cannot be used with --command")
      }

      if (args.mini && args._?.[0] !== "mini") {
        die("--mini must be used without the run subcommand")
      }

      if (args.demo && !interactive) {
        die("--demo requires --mini")
      }

      if (interactive && args.format !== "default") {
        die("--mini cannot be used with a machine-readable format")
      }

      if (args["replay-limit"] !== undefined && !interactive) {
        die("--replay-limit requires --mini")
      }

      if (
        args["replay-limit"] !== undefined &&
        (!Number.isInteger(args["replay-limit"]) || args["replay-limit"] <= 0)
      ) {
        die("--replay-limit must be a positive integer")
      }

      if (interactive && !process.stdout.isTTY) {
        die("--mini requires a TTY stdout")
      }

      if (!Number.isInteger(args["background-wait-timeout"]) || args["background-wait-timeout"] <= 0) {
        die("--background-wait-timeout must be a positive integer number of seconds")
      }

      if (interactive) {
        try {
          resolveInteractiveStdin().cleanup?.()
        } catch (error) {
          dieInteractive(error)
        }
      }

      const replay = args.replay === false ? false : args.replay || args["replay-limit"] !== undefined

      const root = Filesystem.resolve(process.env.PWD ?? process.cwd())
      const directory = (() => {
        if (!args.dir) return args.attach ? undefined : root
        if (args.attach) return args.dir

        try {
          process.chdir(path.isAbsolute(args.dir) ? args.dir : path.join(root, args.dir))
          return process.cwd()
        } catch {
          UI.error("Failed to change directory to " + args.dir)
          process.exit(1)
        }
      })()
      const attachHeaders = args.attach
        ? ServerAuth.headers({ password: args.password, username: args.username })
        : undefined
      const attachSDK = (dir?: string) => {
        return createApexoClient({
          baseUrl: args.attach!,
          directory: dir,
          headers: attachHeaders,
        })
      }

      const files: FilePart[] = []
      if (args.file) {
        const list = Array.isArray(args.file) ? args.file : [args.file]

        for (const filePath of list) {
          const resolvedPath = path.resolve(args.attach ? root : (directory ?? root), filePath)
          if (!(await Filesystem.exists(resolvedPath))) {
            UI.error(`File not found: ${filePath}`)
            process.exit(1)
          }

          const stat = Filesystem.stat(resolvedPath)
          const isDirectory = stat?.isDirectory() ?? false
          if (args.attach && isDirectory) {
            UI.error(`Cannot attach local directory without a shared filesystem: ${filePath}`)
            process.exit(1)
          }

          if (args.attach) {
            const { readRunAttachment } = await import("../file-attachment")
            files.push(await readRunAttachment(resolvedPath))
            continue
          }
          files.push({
            type: "file",
            url: pathToFileURL(resolvedPath).href,
            filename: path.basename(resolvedPath),
            mime: isDirectory ? "application/x-directory" : "text/plain",
          })
        }
      }

      const piped = await readPipedStdin(
        message.trim().length > 0 || Boolean(args.command) || Boolean(args.file?.length) || interactive,
      )
      message = resolveRunInput(message, piped) ?? ""
      const initialInput = resolveRunInput(rawMessage, piped)

      if (message.trim().length === 0 && !args.command && !interactive) {
        UI.error("You must provide a message or a command")
        process.exit(1)
      }

      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exit(1)
      }

      const rules: PermissionV1.Ruleset = interactive
        ? []
        : [
            {
              permission: "question",
              action: "deny",
              pattern: "*",
            },
            {
              permission: "plan_enter",
              action: "deny",
              pattern: "*",
            },
            {
              permission: "plan_exit",
              action: "deny",
              pattern: "*",
            },
          ]

      function title() {
        if (args.title !== undefined && args.title !== "") return args.title
        if (interactive && args.title === undefined) return
        const text = (initialInput ?? "").trim().replace(/\s+/g, " ")
        if (!text) return
        return text.slice(0, 50) + (text.length > 50 ? "..." : "")
      }

      async function session(sdk: ApexoClient): Promise<SessionInfo | undefined> {
        if (args.session) {
          const current = await resolveSession(sdk, args.session)

          if (args.fork) {
            if (
              directory &&
              (args.attach
                ? current.directory !== directory
                : Filesystem.resolve(current.directory) !== Filesystem.resolve(directory))
            )
              throw new Error(
                `Session ${current.id} belongs to ${current.directory}. Retry with --dir ${JSON.stringify(current.directory)} to fork it.`,
              )
            const forked = await sdk.session.fork({
              sessionID: current.id,
            })
            const id = forked.data?.id
            if (!id) {
              return
            }

            return {
              id,
              title: forked.data?.title ?? current.title,
              directory: forked.data?.directory ?? current.directory,
            }
          }

          return {
            id: current.id,
            title: current.title,
            directory: current.directory,
          }
        }

        const base = args.continue ? (await sdk.session.list()).data?.find((item) => !item.parentID) : undefined

        if (base && args.fork) {
          const forked = await sdk.session.fork({
            sessionID: base.id,
          })
          const id = forked.data?.id
          if (!id) {
            return
          }

          return {
            id,
            title: forked.data?.title ?? base.title,
            directory: forked.data?.directory ?? base.directory,
          }
        }

        if (base) {
          return {
            id: base.id,
            title: base.title,
            directory: base.directory,
          }
        }

        const name = title()
        const result = await sdk.session.create({
          title: name,
          permission: [...rules],
        })
        const id = result.data?.id
        if (!id) {
          return
        }

        return {
          id,
          title: result.data?.title ?? name,
          directory: result.data?.directory,
        }
      }

      async function createFreshSession(
        sdk: ApexoClient,
        input: { agent: string | undefined; model: ModelInput | undefined; variant: string | undefined },
      ): Promise<SessionInfo> {
        const result = await sdk.session.create({
          title: args.title !== undefined && args.title !== "" ? args.title : undefined,
          agent: input.agent,
          model: input.model
            ? {
                providerID: input.model.providerID,
                id: input.model.modelID,
                variant: input.variant,
              }
            : undefined,
          permission: [...rules],
        })
        const id = result.data?.id
        if (!id) {
          throw new Error("Failed to create session")
        }

        return {
          id,
          title: result.data?.title,
        }
      }

      async function current(sdk: ApexoClient): Promise<string> {
        if (!args.attach) {
          return directory ?? root
        }

        const next = await sdk.path
          .get()
          .then((x) => x.data?.directory)
          .catch(() => undefined)
        if (next) {
          return next
        }

        UI.error("Failed to resolve remote directory")
        process.exit(1)
      }

      async function localAgent() {
        if (!args.agent) return undefined
        const name = args.agent

        const entry = await Effect.runPromise(
          agentSvc.get(name).pipe(Effect.provideService(InstanceRef, localInstance)),
        )
        if (!entry) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" not found. Falling back to default agent`,
          )
          return undefined
        }
        if (entry.mode === "subagent") {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" is a subagent, not a primary agent. Falling back to default agent`,
          )
          return undefined
        }
        return name
      }

      async function attachAgent(sdk: ApexoClient) {
        if (!args.agent) return undefined
        const name = args.agent

        const modes = await sdk.app
          .agents(undefined, { throwOnError: true })
          .then((x) => x.data ?? [])
          .catch(() => undefined)

        if (!modes) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `failed to list agents from ${args.attach}. Falling back to default agent`,
          )
          return undefined
        }

        const agent = modes.find((a) => a.name === name)
        if (!agent) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" not found. Falling back to default agent`,
          )
          return undefined
        }

        if (agent.mode === "subagent") {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" is a subagent, not a primary agent. Falling back to default agent`,
          )
          return undefined
        }

        return name
      }

      async function pickAgent(sdk: ApexoClient) {
        if (!args.agent) return undefined
        if (args.attach) {
          return attachAgent(sdk)
        }

        return localAgent()
      }

      async function execute(sdk: ApexoClient) {
        if (args.attach) {
          const { sessionTransport } = await import("@apexo/tui/transport/session")
          const native = await sessionTransport(sdk, directory, args["session-protocol"])(AbortSignal.timeout(10_000))
          if (native.kind === "native") {
            if (!interactive) {
              if (args.fork || args.command || args.demo || args.profile || args.title)
                throw new Error(
                  "Native headless attachment does not support fork, command, demo, profile or title options",
                )
              if (args.format !== "default" && args.format !== "json" && args.format !== "streaming-json")
                throw new Error("Unsupported native output format")
              const { runNativeHeadless } = await import("../native-headless")
              return runNativeHeadless({
                sdk,
                directory,
                session: args.session,
                continue: args.continue,
                inputID: args["input-id"],
                agent: args.agent,
                model: pick(args.model),
                variant: args.variant,
                files,
                text: initialInput ?? "",
                auto,
                thinking,
                format: args.format,
              })
            }
            if (args.fork) throw new Error("Fork is not available on the native terminal transport")
            if (args.command) throw new Error("Native terminal command execution is not available")
            const { runNativeInteractive } = await import("../native-interactive")
            return runNativeInteractive({
              sdk,
              directory,
              session: args.session,
              continue: args.continue,
              agent: args.agent,
              model: pick(args.model),
              variant: args.variant,
              files,
              initialInput,
              thinking,
              backgroundSubagents: flags.experimentalBackgroundSubagents,
              replay,
              replayLimit: args["replay-limit"],
            })
          }
        }
        const sess = await session(sdk)
        if (!sess?.id) {
          UI.error("Session not found")
          process.exit(1)
        }
        const sessionID = sess.id

        function emit(type: string, data: Record<string, unknown>) {
          if (args.format === "streaming-json") {
            process.stdout.write(JSON.stringify({ type, ...data }) + EOL)
            return true
          }
          if (args.format === "json") {
            process.stdout.write(
              JSON.stringify({
                type,
                timestamp: Date.now(),
                sessionID,
                ...data,
              }) + EOL,
            )
            return true
          }
          return false
        }

        const toolKind = (name: string) => {
          if (["run_terminal_cmd", "run_terminal_command", "bash", "shell"].includes(name)) return "execute"
          if (["read_file", "read", "list_dir"].includes(name)) return "read"
          if (["search_replace", "write", "edit", "apply_patch", "patch"].includes(name)) return "edit"
          if (["grep", "glob", "web_search"].includes(name)) return "search"
          if (["spawn_subagent", "task"].includes(name)) return "think"
          if (["enter_plan_mode", "exit_plan_mode", "plan_enter", "plan_exit"].includes(name)) return "think"
          if (name === "web_fetch") return "fetch"
          return "other"
        }

        const toolTitle = (name: string, input: Record<string, unknown>) => {
          if (toolKind(name) === "execute" && typeof input.command === "string") return input.command
          if (typeof input.description === "string") return input.description
          if (typeof input.target_file === "string") return input.target_file
          if (typeof input.file_path === "string") return input.file_path
          return name
        }

        const toolLocations = (input: Record<string, unknown>) => {
          const value =
            typeof input.target_file === "string"
              ? input.target_file
              : typeof input.file_path === "string"
                ? input.file_path
                : typeof input.target_directory === "string"
                  ? input.target_directory
                  : typeof input.workdir === "string"
                    ? input.workdir
                    : undefined
          return value ? [{ path: value }] : []
        }

        const toolContent = (output: string) => [{ type: "content", content: { type: "text", text: output } }]

        const seenToolCalls = new Set<string>()
        const emitStreamingTool = (part: ToolPart) => {
          const input = part.state.input
          const common = {
            toolCallId: part.callID,
            toolName: part.tool,
            title: toolTitle(part.tool, input),
            kind: toolKind(part.tool),
            rawInput: input,
            locations: toolLocations(input),
          }
          if (!seenToolCalls.has(part.callID)) {
            emit("tool_call", { ...common, status: "pending", content: [] })
            seenToolCalls.add(part.callID)
          }
          if (part.state.status === "running") {
            emit("tool_call_update", { ...common, status: "in_progress", content: [] })
            return
          }
          if (part.state.status === "completed") {
            emit("tool_call_update", {
              toolCallId: part.callID,
              status: "completed",
              content: toolContent(part.state.output),
              rawOutput: {
                output: part.state.output,
                ...(part.state.metadata ? { metadata: part.state.metadata } : {}),
              },
            })
            return
          }
          if (part.state.status === "error") {
            emit("tool_call_update", {
              toolCallId: part.callID,
              status: "failed",
              content: toolContent(part.state.error),
              rawOutput: {
                error: part.state.error,
                ...(part.state.metadata ? { metadata: part.state.metadata } : {}),
              },
            })
          }
        }

        const printedTextParts = new Set<string>()
        const printedErrors = new Set<string>()
        const toggles = new Map<string, boolean>()

        // Consume one subscribed event stream for the active session and mirror it
        // to stdout/UI. `client` is passed explicitly because attach mode may
        // rebind the SDK to the session's directory after the subscription is
        // created, and replies issued from inside the loop must use that client.
        // `stream` ends the subscription when the background wait settles without another idle event.
        async function loop(
          client: ApexoClient,
          events: Awaited<ReturnType<typeof sdk.event.subscribe>>,
          stream: AbortController,
        ) {
          const sessions = new Set([sessionID])
          let error: string | undefined
          // Grok Build headless contract: after a turn ends, keep running while background work the session started
          // is still going, so the turn its completion wakes is printed too. The limit counts from the latest turn end
          // and never cuts a running turn short; a completed task that wakes no turn within the grace period ends it.
          const wait = {
            busy: false,
            idleAt: 0,
            quietAt: undefined as number | undefined,
            timer: undefined as ReturnType<typeof setInterval> | undefined,
            stopped: undefined as string | undefined,
          }
          const running = async () =>
            ((await client.experimental.task.list({ sessionID }).catch(() => undefined))?.data ?? []).filter(
              (task) => task.status === "running" && task.background && task.type !== "scheduler",
            )
          const settle = async () => {
            if (wait.busy || stream.signal.aborted) return
            const tasks = await running()
            if (wait.busy) return
            if (!tasks.length) {
              wait.quietAt ??= Date.now()
              if (Date.now() - wait.quietAt >= 2000) stream.abort()
              return
            }
            wait.quietAt = undefined
            const seconds = args["background-wait-timeout"]
            if (Date.now() - wait.idleAt < seconds * 1000) return
            // Aborting first suppresses completion wakes, so stopped work never starts another model turn.
            await client.session.abort({ sessionID }).catch(() => undefined)
            await Promise.all(
              tasks.map((task) =>
                client.experimental.task.cancel({ sessionID, taskID: task.id }).catch(() => undefined),
              ),
            )
            const noun = tasks.length === 1 ? "background task" : "background tasks"
            wait.stopped = `the wait for background work ran out after ${seconds} s and exit stopped ${tasks.length} ${noun} (${tasks.map((task) => task.title ?? task.id).join(", ")})`
            stream.abort()
          }
          const keepWaiting = async () => {
            if (args.attach || !args["wait-for-background"]) return false
            wait.idleAt = Date.now()
            wait.quietAt = undefined
            if (!wait.timer && !(await running()).length) return false
            wait.timer ??= setInterval(() => void settle(), 250)
            return true
          }

          for await (const event of events.stream) {
            if (event.type === "memory.capture.activity") {
              if (event.properties.sessionID !== sessionID) continue
              if (!emit("memory_capture_activity", { ...event.properties }))
                UI.println(memoryCaptureText(event.properties))
              continue
            }
            if (event.type === "session.created" && event.properties.info.parentID) {
              if (sessions.has(event.properties.info.parentID)) sessions.add(event.properties.info.id)
            }

            if (
              event.type === "message.part.delta" &&
              args.format === "streaming-json" &&
              event.properties.sessionID === sessionID &&
              (event.properties.field === "text" || event.properties.field === "reasoning")
            ) {
              if (emit(event.properties.field === "reasoning" ? "thought" : "text", { data: event.properties.delta })) {
                continue
              }
            }

            if (
              event.type === "message.updated" &&
              event.properties.sessionID === sessionID &&
              event.properties.info.role === "assistant" &&
              args.format === "default" &&
              toggles.get("start") !== true
            ) {
              UI.empty()
              UI.println(`> ${event.properties.info.agent} · ${event.properties.info.modelID}`)
              UI.empty()
              toggles.set("start", true)
            }

            if (event.type === "message.part.updated") {
              const part = event.properties.part
              if (part.sessionID !== sessionID) continue

              if (args.format === "streaming-json" && part.type === "tool") {
                emitStreamingTool(part)
                continue
              }

              if (part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")) {
                if (emit("tool_use", { part })) continue
                if (part.state.status === "completed") {
                  await tool(part)
                  continue
                }
                await toolError(part)
                UI.error(part.state.error)
              }

              if (
                part.type === "tool" &&
                part.tool === "task" &&
                part.state.status === "running" &&
                args.format === "default"
              ) {
                if (toggles.get(part.id) === true) continue
                await tool(part)
                toggles.set(part.id, true)
              }

              if (part.type === "step-start") {
                if (emit("step_start", { part })) continue
              }

              if (part.type === "step-finish") {
                if (emit("step_finish", { part })) continue
              }

              if (part.type === "text" && part.time?.end && args.format !== "streaming-json") {
                printedTextParts.add(part.id)
                if (emit("text", { part })) continue
                const text = part.text.trim()
                if (!text) continue
                if (!process.stdout.isTTY) {
                  process.stdout.write(text + EOL)
                  continue
                }
                UI.empty()
                UI.println(text)
                UI.empty()
              }

              if (part.type === "reasoning" && part.time?.end && args.format !== "streaming-json") {
                if (emit("reasoning", { part })) continue
                if (!thinking) continue
                const text = part.text.trim()
                if (!text) continue
                const line = `Thinking: ${text}`
                if (process.stdout.isTTY) {
                  UI.empty()
                  UI.println(`${UI.Style.TEXT_DIM}\u001b[3m${line}\u001b[0m${UI.Style.TEXT_NORMAL}`)
                  UI.empty()
                  continue
                }
                process.stdout.write(line + EOL)
              }
            }

            if (event.type === "session.error") {
              const props = event.properties
              if (props.sessionID !== sessionID || !props.error) continue
              const formatted = FormatError(props.error)
              let err = formatted ?? String(props.error.name)
              if (!formatted && "data" in props.error && props.error.data && "message" in props.error.data) {
                err = String(props.error.data.message)
              }
              error = error ? error + EOL + err : err
              if (printedErrors.has(err)) continue
              printedErrors.add(err)
              if (args.format === "streaming-json") {
                emit("error", { message: err })
                continue
              }
              if (emit("error", { error: props.error })) continue
              UI.error(err)
            }

            if (event.type === "session.status" && event.properties.sessionID === sessionID) {
              wait.busy = event.properties.status.type !== "idle"
              if (wait.busy) {
                wait.quietAt = undefined
                continue
              }
              if (await keepWaiting()) continue
              stream.abort()
            }

            if (event.type === "permission.asked") {
              const permission = event.properties
              if (!sessions.has(permission.sessionID)) continue

              if (auto) {
                await client.permission.reply({
                  requestID: permission.id,
                  reply: "once",
                })
              } else {
                const rejectedMessage = `permission requested: ${permission.permission} (${permission.patterns.join(", ")}); auto-rejecting`
                error = error ? error + EOL + rejectedMessage : rejectedMessage
                UI.println(UI.Style.TEXT_WARNING_BOLD + "!", UI.Style.TEXT_NORMAL + rejectedMessage)
                await client.permission.reply({
                  requestID: permission.id,
                  reply: "reject",
                })
              }
            }
            if (stream.signal.aborted) break
          }
          clearInterval(wait.timer)
          if (wait.stopped) {
            error = error ? error + EOL + wait.stopped : wait.stopped
            if (!emit("error", { message: wait.stopped })) UI.error(wait.stopped)
            return error
          }
          if (args.format === "streaming-json") {
            emit("end", { stopReason: "end_turn", sessionId: sessionID, requestId: sessionID })
          }
          return error
        }
        const cwd = args.attach ? (directory ?? sess.directory ?? (await current(sdk))) : (directory ?? root)
        const client = args.attach ? attachSDK(cwd) : sdk

        // Validate agent if specified
        const agent = await pickAgent(client)

        if (args.format === "streaming-json") {
          const commands = await client.command.list({ directory: cwd })
          if (commands.data) {
            const available =
              flags.runtimeProfile === "grok-build"
                ? await grokBuildToolNames(
                    client,
                    agent,
                    args.model,
                    cwd,
                    flags.enableExa || flags.enableParallel,
                    sess.id,
                    rules,
                  )
                : []
            emit("available_commands", {
              tools: available,
              commands: commands.data.map((item) => item.name),
            })
          }
        }

        if (!interactive) {
          const stream = new AbortController()
          const events = await client.event.subscribe(undefined, { signal: stream.signal })
          const completed = loop(client, events, stream).catch((e) => {
            console.error(e)
            process.exitCode = 1
          })
          let signalCode: number | undefined
          const handleSignal = (sig: "SIGINT" | "SIGTERM") => {
            if (signalCode !== undefined) return
            signalCode = sig === "SIGINT" ? 130 : 143
            process.exitCode = signalCode
            void (async () => {
              await client.session.abort({ sessionID }).catch(() => undefined)
              await Promise.race([completed, Bun.sleep(3500)])
              stream.abort()
              process.exit(signalCode)
            })()
          }
          const onSigint = () => handleSignal("SIGINT")
          const onSigterm = () => handleSignal("SIGTERM")
          process.once("SIGINT", onSigint)
          process.once("SIGTERM", onSigterm)
          async function finish(responseData?: {
            info?: { role?: string; agent?: string; modelID?: string }
            parts?: Array<{ id: string; type: string; text?: string }>
          }) {
            if (args.attach) {
              await Promise.race([completed, Bun.sleep(1500)])
              stream.abort()
            }
            const error = await completed
            if (error) process.exitCode = 1
            if (args.attach && responseData?.parts && args.format !== "streaming-json") {
              if (
                responseData.info?.role === "assistant" &&
                args.format === "default" &&
                toggles.get("start") !== true
              ) {
                UI.empty()
                UI.println(`> ${responseData.info.agent} · ${responseData.info.modelID}`)
                UI.empty()
                toggles.set("start", true)
              }
              for (const part of responseData.parts) {
                if (part.type !== "text" || printedTextParts.has(part.id)) continue
                printedTextParts.add(part.id)
                if (emit("text", { part })) continue
                const text = (part.text ?? "").trim()
                if (!text) continue
                if (!process.stdout.isTTY) {
                  process.stdout.write(text + EOL)
                  continue
                }
                UI.empty()
                UI.println(text)
                UI.empty()
              }
            }
          }

          try {
            if (args.command) {
              const result = await client.session.command({
                sessionID,
                agent,
                model: args.model,
                command: args.command,
                arguments: message,
                variant: args.variant,
              })
              if (result.error) {
                if (signalCode !== undefined) {
                  await Promise.race([completed, Bun.sleep(3500)])
                  return
                }
                const formatted = formatRunError(result.error)
                if (!printedErrors.has(formatted)) {
                  printedErrors.add(formatted)
                  if (!emit("error", { error: result.error })) UI.error(formatted)
                }
                stream.abort()
                await completed
                process.exitCode = 1
                return
              }
              await finish()
              return
            }

            const model = pick(args.model)
            const result = await client.session.prompt({
              sessionID,
              agent,
              model,
              variant: args.variant,
              // The prompt is sent as typed; only --command arguments keep their shell-style quoting.
              parts: [...files, { type: "text", text: initialInput ?? "" }],
            })
            if (result.error) {
              if (signalCode !== undefined) {
                await Promise.race([completed, Bun.sleep(3500)])
                return
              }
              const formatted = formatRunError(result.error)
              if (!printedErrors.has(formatted)) {
                printedErrors.add(formatted)
                if (!emit("error", { error: result.error })) UI.error(formatted)
              }
              stream.abort()
              await completed
              process.exitCode = 1
              return
            }
            await finish(result.data)
            return
          } finally {
            process.removeListener("SIGINT", onSigint)
            process.removeListener("SIGTERM", onSigterm)
            if (signalCode !== undefined) {
              await Promise.race([completed, Bun.sleep(3500)])
              process.exitCode = signalCode
            }
          }
        }

        const model = pick(args.model)
        const { runInteractiveMode } = await import("./run/runtime")
        try {
          await runInteractiveMode({
            sdk: client,
            directory: cwd,
            sessionID,
            sessionTitle: sess.title,
            resume: Boolean(args.session || args.continue) && !args.fork,
            replay,
            replayLimit: args["replay-limit"],
            agent,
            model,
            variant: args.variant,
            files,
            initialInput,
            createSession: createFreshSession,
            thinking,
            backgroundSubagents: flags.experimentalBackgroundSubagents,
            demo: args.demo,
          })
        } catch (error) {
          dieInteractive(error)
        }
        return
      }

      if (interactive && !args.attach && !args.session && !args.continue) {
        const model = pick(args.model)
        const { runInteractiveLocalMode } = await import("./run/runtime")
        const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const { Server } = await import("@/server/server")
          const request = new Request(input, init)
          const headers = new Headers(request.headers)
          const auth = ServerAuth.header()
          if (auth) headers.set("Authorization", auth)
          return Server.Default().app.fetch(new Request(request, { headers }))
        }) as typeof globalThis.fetch

        try {
          return await runInteractiveLocalMode({
            directory: directory ?? root,
            fetch: fetchFn,
            resolveAgent: localAgent,
            session,
            createSession: createFreshSession,
            agent: args.agent,
            model,
            variant: args.variant,
            replay,
            replayLimit: args["replay-limit"],
            files,
            initialInput,
            thinking,
            backgroundSubagents: flags.experimentalBackgroundSubagents,
            demo: args.demo,
          })
        } catch (error) {
          dieInteractive(error)
        }
      }

      if (args.attach) {
        const sdk = attachSDK(directory)
        return await execute(sdk)
      }

      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const { Server } = await import("@/server/server")
        const request = new Request(input, init)
        const headers = new Headers(request.headers)
        const auth = ServerAuth.header()
        if (auth) headers.set("Authorization", auth)
        return Server.Default().app.fetch(new Request(request, { headers }))
      }) as typeof globalThis.fetch
      const sdk = createApexoClient({
        baseUrl: "http://apexo.internal",
        fetch: fetchFn,
        directory,
      })
      await execute(sdk)
    })
  }),
})

export const RunCommand: typeof CompatibilityRunCommand = {
  ...CompatibilityRunCommand,
  async handler(args) {
    if (args["input-id"] !== undefined) {
      if (args["session-protocol"] !== "native") throw new Error("--input-id requires --session-protocol native")
      const { validateNativeInputID } = await import("../native-headless")
      validateNativeInputID({
        inputID: args["input-id"],
        session: args.session,
        continue: args.continue,
        mini: args.mini,
      })
    }
    if (args["session-protocol"] === "native" && !args.attach) {
      if (args.mini && args._?.[0] !== "mini") throw new Error("--mini must be used without the run subcommand")
      const { runNativeLocalMini } = await import("../native-local")
      return runNativeLocalMini(args)
    }
    return CompatibilityRunCommand.handler(args)
  },
}

type MiniCommandInput = {
  sessionProtocol?: "auto" | "native" | "compatibility"
  directory?: string
  attach?: string
  password?: string
  username?: string
  continue?: boolean
  session?: string
  fork?: boolean
  model?: string
  agent?: string
  prompt?: string
  replay?: boolean
  replayLimit?: number
  demo?: boolean
}

export async function runMini(input: MiniCommandInput) {
  if (!RunCommand.handler) throw new Error("Mini command handler is unavailable")
  await RunCommand.handler({
    $0: "apexo",
    _: ["mini"],
    message: input.prompt ? [input.prompt] : [],
    command: undefined,
    continue: input.continue,
    session: input.session,
    "input-id": undefined,
    inputId: undefined,
    fork: input.fork,
    model: input.model,
    agent: input.agent,
    format: "default",
    profile: undefined,
    file: undefined,
    title: undefined,
    attach: input.attach,
    "session-protocol": input.sessionProtocol ?? "auto",
    sessionProtocol: input.sessionProtocol ?? "auto",
    password: input.password,
    username: input.username,
    dir: input.directory,
    port: undefined,
    variant: undefined,
    thinking: undefined,
    "wait-for-background": true,
    waitForBackground: true,
    "background-wait-timeout": 600,
    backgroundWaitTimeout: 600,
    mini: true,
    interactive: false,
    replay: input.replay ?? true,
    "replay-limit": input.replayLimit,
    replayLimit: input.replayLimit,
    auto: false,
    yolo: false,
    "dangerously-skip-permissions": false,
    dangerouslySkipPermissions: false,
    demo: input.demo ?? false,
  })
}

import { SessionExecutionPolicy } from "../session/execution-policy"
export * as BashTool from "./bash"

import path from "path"
import { SessionProcess } from "@apexo/schema/session-process"
import { optional } from "@apexo/schema/schema"
import { SessionProcessCompletion } from "../session/process-completion"
import { SessionProcessExecution } from "../session/process-execution"
import { ToolFailure } from "@apexo/llm"
import { Duration, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { CommandSandbox } from "../command-sandbox"
import { Config } from "../config"
import { ShellEnvironment } from "../shell-environment"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { AppProcess } from "../process"
import { PermissionV2 } from "../permission"
import { NonNegativeInt } from "../schema"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "bash"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
export const MAX_TIMEOUT_MS = 10 * 60 * 1_000
export const MAX_BACKGROUND_TIMEOUT_MS = 10 * 60 * 60 * 1_000
export const MAX_BLOCK_MS = 10 * 60 * 60 * 1_000
export const MAX_CAPTURE_BYTES = 1024 * 1024

export const Input = Schema.Struct({
  command: Schema.optional(Schema.String).annotate({ description: "Shell command string to execute" }),
  cmd: Schema.optional(Schema.String).annotate({ description: "Alternative parameter name for command" }),
  workdir: Schema.String.pipe(Schema.optional).annotate({
    description: "Working directory. Defaults to the active Location; relative paths resolve from that Location.",
  }),
  background: optional(Schema.Boolean).annotate({
    description: "Return after successful spawn while the command continues. Requires description.",
  }),
  block_until_ms: optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_BLOCK_MS }))).annotate({
    description:
      "Opt into owned process execution. Wait this many milliseconds, then return its process_id if still running. Zero returns after spawn. Host toolset.bash settings may lower this wait. This wait budget does not replace the process timeout.",
  }),
  description: optional(Schema.String.check(Schema.isMinLength(1))),
  timeout: NonNegativeInt.check(Schema.isLessThanOrEqualTo(MAX_BACKGROUND_TIMEOUT_MS))
    .pipe(Schema.optional)
    .annotate({
      description: `Process lifetime in milliseconds. Foreground defaults to ${DEFAULT_TIMEOUT_MS}, maximum ${MAX_TIMEOUT_MS}. Eligible owned/background execution defaults to the ${MAX_BACKGROUND_TIMEOUT_MS} safety cap; zero selects that cap, and positive values may not exceed it. Zero does not enable background ownership.`,
    }),
}).check(
  Schema.makeFilter((input) =>
    input.command === undefined && input.cmd === undefined
      ? "command or cmd is required"
      : input.background === true && input.block_until_ms !== undefined
        ? "background and block_until_ms cannot be combined"
        : (input.background === true || input.block_until_ms !== undefined) && !input.description?.trim()
          ? "Background shell requires a nonempty description"
          : undefined,
  ),
)

const ForegroundStructuredOutput = Schema.Struct({
  exit: Schema.Number.pipe(Schema.optional),
  truncated: Schema.Boolean,
  timeout: Schema.Boolean.pipe(Schema.optional),
})

const ForegroundOutput = Schema.Struct({
  outputLimit: optional(Schema.Number),
  ...ForegroundStructuredOutput.fields,
  output: Schema.String,
  warnings: Schema.Array(Schema.String).pipe(Schema.optional),
})

const ProcessStructuredOutput = Schema.Struct({
  process_id: SessionProcess.ID,
  status: SessionProcess.Status,
  background: Schema.Boolean,
  truncated: Schema.Boolean,
})
const StructuredOutput = Schema.Union([ProcessStructuredOutput, ForegroundStructuredOutput])
const Output = Schema.Union([
  Schema.Struct({ ...SessionProcess.Detail.fields, outputLimit: optional(Schema.Number) }),
  ForegroundOutput,
])
type Output = typeof ForegroundOutput.Type

const defaultShell = () => (process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh")

const modelOutput = (output: Output) => {
  const warnings = output.warnings?.length
    ? `\n\nWarnings:\n${output.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : ""
  if (output.timeout) return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command timed out before completion.`
  return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command exited with code ${output.exit}.`
}

const isTimeout = (error: AppProcess.AppProcessError) =>
  error.cause instanceof Error && error.cause.message === "Timed out"

/**
 * Minimal V2 core shell boundary. Keep parity debt visible without pulling the
 * legacy shell runtime into core.
 */
// TODO: Port tree-sitter bash / PowerShell parser-based approval reduction.
// TODO: Port BashArity reusable command-prefix approvals.
// TODO: Replace token-based command-argument external-directory advisories with parser-based detection.
// TODO: Restore PowerShell and cmd-specific invocation/path handling on Windows.
// TODO: Add durable/live progress metadata streaming for long-running commands once V2 tool invocation progress context is wired.
// TODO: Revisit process-group cleanup and platform coverage with shell-specific tests if current AppProcess semantics do not fully cover it.
// TODO: Revisit binary output handling if stdout/stderr decoding is text-only.
// TODO: Stream full shell output into managed storage while retaining only a bounded in-memory preview.

const shellTokens = (command: string) => command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
const unquote = (value: string) => value.replace(/^(['"])(.*)\1$/, "$2")
const externalCommandDirectories = Effect.fn("BashTool.externalCommandDirectories")(function* (
  fs: FSUtil.Interface,
  command: string,
  cwd: string,
) {
  const directories = new Set<string>()
  for (const token of shellTokens(command)) {
    const value = unquote(token).replace(/[;,|&]+$/, "")
    if (!path.isAbsolute(value)) continue
    const resolved = yield* fs.resolve(value)
    if (FSUtil.contains(cwd, resolved)) continue
    directories.add(yield* fs.resolve(path.dirname(resolved)))
  }
  return [...directories]
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const fs = yield* FSUtil.Service
    const appProcess = yield* AppProcess.Service
    const sandbox = yield* CommandSandbox.Service
    const config = yield* Config.Service
    const shellEnvironment = yield* ShellEnvironment.Service
    const permission = yield* PermissionV2.Service
    const processes = yield* SessionProcessExecution.Service
    const completions = yield* SessionProcessCompletion.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description: `Execute one shell command string. Off-profile Sessions use the host user's authority; selected native command sandbox profiles restrict this command and its descendants by filesystem path and disable network access. This command-only scope does not confine other tools. The active Location is the default working directory. Relative workdir values resolve from that Location. External workdir values require external_directory approval; best-effort command-argument path warnings are advisory only. For an ordinary Session, background=true or block_until_ms opts into an owned process receipt with process_output/process_wait/process_cancel; description is required for explicit requests. Configured toolset.bash foreground waits also opt ordinary Sessions into this receipt path; when promotion is prohibited, implicit defaults retain foreground execution. Unfinished processes never restart automatically. Background shell is unavailable to managed children and active Goals. Timeout values are milliseconds. Foreground default is ${DEFAULT_TIMEOUT_MS}, maximum ${MAX_TIMEOUT_MS}. Owned processes use the ${MAX_BACKGROUND_TIMEOUT_MS} safety cap when timeout is omitted or zero; positive owned deadlines may extend to that cap. Zero never enables background authority. Uses the configured shell when set; otherwise uses /bin/sh on POSIX and COMSPEC or cmd.exe on Windows.`,
          input: Input,
          output: Output,
          structured: StructuredOutput,
          toStructuredOutput: ({ output }) =>
            "kind" in output
              ? {
                  process_id: output.id,
                  status: output.status,
                  background: output.background,
                  truncated: output.truncated,
                }
              : {
                  truncated: output.truncated,
                  ...(output.exit === undefined ? {} : { exit: output.exit }),
                  ...(output.timeout === undefined ? {} : { timeout: output.timeout }),
                },
          outputPolicy: ({ output }) =>
            output.outputLimit === undefined ? undefined : { firstTextCharacters: output.outputLimit },
          toModelOutput: ({ output }) =>
            "kind" in output
              ? [
                  { type: "text", text: output.output },
                  { type: "text", text: JSON.stringify({ ...output, output: undefined, outputLimit: undefined }) },
                ]
              : [
                  { type: "text", text: output.output },
                  { type: "text", text: modelOutput(output) },
                ],
          execute: (input, context) =>
            Effect.scoped(
              Effect.gen(function* () {
                const entries = yield* config.entries()
                const settings = Config.latest(entries, "toolset")?.bash
                const explicit = input.background === true || input.block_until_ms !== undefined
                const owned = explicit || (settings !== undefined && (yield* processes.canPromote(context.sessionID)))
                if (!owned && (input.timeout === 0 || (input.timeout ?? 0) > MAX_TIMEOUT_MS))
                  return yield* new ToolFailure({
                    message: `Foreground timeout must be between 1 and ${MAX_TIMEOUT_MS} milliseconds; zero or a longer deadline requires eligible owned execution`,
                  })
                if (explicit && (yield* SessionExecutionPolicy.forSession(context.sessionID)))
                  return yield* new ToolFailure({
                    message:
                      "Owned background process execution is unavailable to headless inputs; use foreground bash",
                  })
                // Capture before permission I/O: accepted Stop revokes a late completion even during launch admission.
                const checkpoint = owned ? yield* completions.checkpoint(context.sessionID) : undefined
                const source = {
                  type: "tool" as const,
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                }
                const requestedCommand = input.command ?? input.cmd
                if (requestedCommand === undefined)
                  return yield* new ToolFailure({ message: "command or cmd is required" })
                const shell = Config.latest(entries, "shell") ?? defaultShell()
                const separator =
                  process.platform === "win32" && /(?:^|[\\/])powershell(?:\.exe)?$/i.test(shell) ? ";" : "&&"
                const rawCommand =
                  settings?.cmd_prefix === undefined
                    ? requestedCommand
                    : `${settings.cmd_prefix} ${separator} ${requestedCommand}`
                const target = yield* mutation.resolve({ path: input.workdir ?? ".", kind: "directory" })
                const external = target.externalDirectory
                if (external)
                  yield* permission.assert({
                    ...LocationMutation.externalDirectoryPermission(external),
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source,
                  })
                const warnings = (yield* externalCommandDirectories(fs, rawCommand, target.canonical)).map(
                  (directory) =>
                    `Command argument references external directory ${path.join(directory, "*").replaceAll("\\", "/")}. This scan is advisory only; permission checks and any selected native command sandbox policy still apply.`,
                )
                yield* permission.assert({
                  action: name,
                  resources: [rawCommand],
                  save: [rawCommand],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })

                if ((yield* fs.stat(target.canonical)).type !== "Directory")
                  return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.canonical}`))

                const maximum = Math.min(
                  MAX_BLOCK_MS,
                  settings?.max_block_until_ms || MAX_BLOCK_MS,
                  (settings?.max_timeout_secs ?? 0) > 0
                    ? Math.max(1, Math.round(settings!.max_timeout_secs! * 1000))
                    : MAX_BLOCK_MS,
                )
                const waitMs = input.background
                  ? 0
                  : Math.min(input.block_until_ms ?? settings?.default_block_until_ms ?? 30_000, maximum)
                if (checkpoint)
                  return {
                    ...(yield* processes.execute({
                      sessionID: context.sessionID,
                      messageID: context.assistantMessageID,
                      callID: context.toolCallID,
                      checkpoint,
                      request: {
                        agent: context.agent,
                        command: rawCommand,
                        cwd: target.canonical,
                        shell,
                        description: input.description ?? rawCommand,
                        waitMs,
                        timeoutMs: input.timeout || MAX_BACKGROUND_TIMEOUT_MS,
                      },
                    })),
                    outputLimit: settings?.output_byte_limit,
                  }
                const confined = yield* sandbox.prepare(context.sessionID, {
                  shell,
                  command: rawCommand,
                  cwd: target.canonical,
                })
                // Plugin shell.env variables extend the host environment; sandboxed commands keep their fixed environment.
                const env = confined
                  ? {}
                  : yield* shellEnvironment.resolve({
                      cwd: target.canonical,
                      sessionID: context.sessionID,
                      callID: context.toolCallID,
                    })
                const command =
                  confined?.command ??
                  ChildProcess.make(rawCommand, [], {
                    cwd: target.canonical,
                    shell,
                    stdin: "ignore",
                    detached: process.platform !== "win32",
                    forceKillAfter: Duration.seconds(3),
                    ...(Object.keys(env).length ? { env, extendEnv: true } : {}),
                  })
                const timeout = input.timeout ?? DEFAULT_TIMEOUT_MS
                const result = yield* appProcess
                  .run(command, {
                    combineOutput: !confined,
                    timeout: Duration.millis(timeout),
                    maxOutputBytes: MAX_CAPTURE_BYTES + (confined ? 128 : 0),
                    ...(confined ? { maxErrorBytes: MAX_CAPTURE_BYTES } : {}),
                  })
                  .pipe(
                    Effect.catchTag("AppProcessError", (error) =>
                      isTimeout(error) ? Effect.succeed(undefined) : Effect.fail(error),
                    ),
                  )
                if (!result) {
                  return {
                    outputLimit: settings?.output_byte_limit,
                    output: `Command exceeded timeout of ${timeout} ms. Retry with a larger timeout if the command is expected to take longer.`,
                    truncated: false,
                    timeout: true,
                    ...(warnings.length ? { warnings } : {}),
                  }
                }

                const confirmed = confined ? yield* confined.settle(result) : undefined
                const combined = confirmed ? Buffer.concat([confirmed.stdout, confirmed.stderr]) : result.output
                const truncated = confirmed
                  ? confirmed.stdoutTruncated ||
                    confirmed.stderrTruncated ||
                    (combined?.length ?? 0) > MAX_CAPTURE_BYTES
                  : result.outputTruncated === true
                const output = combined?.subarray(0, MAX_CAPTURE_BYTES).toString("utf8") || "(no output)"
                const notice = truncated ? "[output capture truncated at the in-memory safety limit]" : undefined
                return {
                  outputLimit: settings?.output_byte_limit,
                  exit: result.exitCode,
                  output: notice ? `${output}\n\n${notice}` : output,
                  truncated,
                  ...(warnings.length ? { warnings } : {}),
                }
              }),
            ).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: `Unable to execute command: ${input.command ?? input.cmd}` }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/bash",
  layer,
  deps: [
    ToolRegistry.node,
    LocationMutation.node,
    FSUtil.node,
    AppProcess.node,
    CommandSandbox.node,
    Config.node,
    ShellEnvironment.node,
    PermissionV2.node,
    SessionProcessExecution.node,
    SessionProcessCompletion.node,
  ],
})

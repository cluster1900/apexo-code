export * as MonitorTool from "./monitor"

import { Effect, Layer, Schema } from "effect"
import { NonNegativeInt, optional } from "@apexo/schema/schema"
import { SessionProcess } from "@apexo/schema/session-process"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { SessionProcessCompletion } from "../session/process-completion"
import { SessionProcessExecution } from "../session/process-execution"
import { SessionProcessStore } from "../session/process-store"
import { Tool } from "./tool"
import { ToolRegistry } from "./registry"
import { Tools } from "./tools"

export const MAX_TIMEOUT_MS = 36_000_000
export const Input = Schema.Struct({
  command: Schema.String.check(Schema.isMinLength(1)),
  description: Schema.String.check(Schema.isMinLength(1)),
  workdir: optional(Schema.String),
  timeout_ms: optional(Schema.NullOr(NonNegativeInt)),
  persistent: optional(Schema.Boolean),
}).check(
  Schema.makeFilter((input) =>
    !input.command.trim() || !input.description.trim()
      ? "Monitor requires a nonempty command and description"
      : !input.persistent && (input.timeout_ms ?? MAX_TIMEOUT_MS) > MAX_TIMEOUT_MS
        ? "Monitor timeout must not exceed 36000000 milliseconds"
        : undefined,
  ),
)

export const node = makeLocationNode({
  name: "tool/monitor",
  deps: [
    ToolRegistry.node,
    Config.node,
    FSUtil.node,
    LocationMutation.node,
    PermissionV2.node,
    SessionProcessExecution.node,
    SessionProcessCompletion.node,
  ],
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const tools = yield* Tools.Service
      const config = yield* Config.Service
      const fs = yield* FSUtil.Service
      const mutation = yield* LocationMutation.Service
      const permission = yield* PermissionV2.Service
      const processes = yield* SessionProcessExecution.Service
      const completions = yield* SessionProcessCompletion.Service
      yield* tools
        .register({
          monitor: Tool.make({
            description:
              "Run a shell command in the background and receive bounded batches of stdout and stderr lines at safe provider-turn boundaries. Use this for event-driven watching, not periodic model work. Quiet scripts cause no provider turns. Sustained excessive output stops and joins the process. timeout_ms defaults to 36000000 (10 hours); zero or persistent=true removes the deadline. Monitor uses the native command sandbox and requires monitor and bash permissions. Only ordinary Sessions may start a Monitor. Use process_output, process_wait and process_cancel with its process_id. Accepted Stop suppresses delivery until a real new user input is promoted; old events are discarded. Processes never restart automatically.",
            input: Input,
            output: SessionProcess.Detail,
            execute: (input, context) =>
              Effect.scoped(
                Effect.gen(function* () {
                  const checkpoint = yield* completions.checkpoint(context.sessionID)
                  const source = {
                    type: "tool" as const,
                    messageID: context.assistantMessageID,
                    callID: context.toolCallID,
                  }
                  const target = yield* mutation.resolve({ path: input.workdir ?? ".", kind: "directory" })
                  if (target.externalDirectory)
                    yield* permission.assert({
                      ...LocationMutation.externalDirectoryPermission(target.externalDirectory),
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source,
                    })
                  for (const action of ["monitor", "bash"])
                    yield* permission.assert({
                      action,
                      resources: [input.command],
                      save: [input.command],
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source,
                    })
                  if ((yield* fs.stat(target.canonical)).type !== "Directory")
                    return yield* new Tool.Failure({ message: "Monitor working directory is unavailable" })
                  const entries = yield* config.entries()
                  const shell =
                    Object.assign({}, ...entries.flatMap((entry) => (entry.type === "document" ? [entry.info] : [])))
                      .shell ?? (process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh")
                  return yield* processes.execute({
                    sessionID: context.sessionID,
                    messageID: context.assistantMessageID,
                    callID: context.toolCallID,
                    checkpoint,
                    request: {
                      agent: context.agent,
                      command: input.command,
                      cwd: target.canonical,
                      shell,
                      description: input.description,
                      waitMs: 0,
                      timeoutMs: input.persistent ? 0 : (input.timeout_ms ?? MAX_TIMEOUT_MS),
                      monitor: { persistent: input.persistent ?? false },
                    },
                  })
                }),
              ).pipe(
                Effect.mapError(
                  (error) =>
                    new Tool.Failure({
                      message:
                        error instanceof SessionProcessStore.Failure || error instanceof Tool.Failure
                          ? error.message
                          : "Unable to start Monitor",
                    }),
                ),
              ),
          }),
        })
        .pipe(Effect.orDie)
    }),
  ),
})

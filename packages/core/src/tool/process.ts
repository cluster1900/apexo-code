export * as ProcessTool from "./process"

import { Effect, Layer, Schema } from "effect"
import { SessionTaskMessage } from "../session/task-message"
import { SessionProcess } from "@apexo/schema/session-process"
import { optional } from "@apexo/schema/schema"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { SessionProcessCompletion } from "../session/process-completion"
import { SessionProcessControl } from "../session/process-control"
import { SessionProcessStore } from "../session/process-store"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

export const node = makeLocationNode({
  name: "tool/process",
  deps: [
    SessionTaskMessage.node,
    ToolRegistry.node,
    PermissionV2.node,
    SessionProcessControl.node,
    SessionProcessCompletion.node,
  ],
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const messages = yield* SessionTaskMessage.Service
      const tools = yield* Tools.Service
      const permission = yield* PermissionV2.Service
      const control = yield* SessionProcessControl.Service
      const completions = yield* SessionProcessCompletion.Service
      const input = Schema.Struct({
        process_id: SessionProcess.ID,
        timeout_ms: optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 120_000 }))),
      })
      yield* tools
        .register(
          Object.fromEntries(
            (["process_output", "process_wait", "process_cancel"] as const).map((name) => [
              name,
              Tool.make({
                description:
                  name === "process_cancel"
                    ? "Cancel and join an owned native shell process or Monitor."
                    : name === "process_wait"
                      ? "Wait a bounded time for an owned native shell process or Monitor; timeout does not kill it. A completed wait consumes its pending completion notice."
                      : "Read retained live or terminal output of an owned native shell process or Monitor without starting it or consuming its completion notice.",
                input,
                output: SessionProcess.Detail,
                execute: (input, context) =>
                  Effect.gen(function* () {
                    yield* permission.assert({
                      sessionID: context.sessionID,
                      agent: context.agent,
                      action: name,
                      resources: [input.process_id],
                      save: ["*"],
                      source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                    })
                    if (name === "process_cancel") {
                      const process = yield* control.cancel(context.sessionID, input.process_id)
                      yield* completions.observed(context.sessionID, input.process_id)
                      return process
                    }
                    if (name === "process_wait") {
                      const outcome = yield* messages.interruptWait(
                        context.sessionID,
                        control.wait(context.sessionID, input.process_id, input.timeout_ms ?? 30_000),
                      )
                      if ("interruptedByMessage" in outcome)
                        return {
                          ...(yield* control.output(context.sessionID, input.process_id)),
                          interruptedByMessage: true,
                        }
                      const result = outcome.value
                      if (!result.timedOut && result.process.status !== "running")
                        yield* completions.observed(context.sessionID, input.process_id)
                      return result.process
                    }
                    return yield* control.output(context.sessionID, input.process_id)
                  }).pipe(
                    Effect.mapError(
                      (error) =>
                        new Tool.Failure({
                          message:
                            error instanceof SessionProcessStore.Failure
                              ? error.message
                              : "Native shell process operation failed",
                        }),
                    ),
                  ),
              }),
            ]),
          ),
        )
        .pipe(Effect.orDie)
    }),
  ),
})

export * as TaskTool from "./task"

import { createHash } from "node:crypto"
import { Task } from "@apexo/schema/task"
import { Config } from "../config"
import { ConfigTask } from "../config/task"
import { SessionMessage } from "../session/message"
import { SessionTaskMessage } from "../session/task-message"
import { Effect, Layer, Schema } from "effect"
import { optional } from "@apexo/schema/schema"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { SessionTaskCompletion } from "../session/task-completion"
import { SessionTask } from "../session/task"
import { SessionTaskStore } from "../session/task-store"
import { SessionSchema } from "../session/schema"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

export const node = makeLocationNode({
  name: "tool/task",
  deps: [
    Config.node,
    SessionTaskMessage.node,
    ToolRegistry.node,
    PermissionV2.node,
    SessionTask.node,
    SessionTaskCompletion.node,
  ],
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const config = yield* Config.Service
      const messages = yield* SessionTaskMessage.Service
      const tools = yield* Tools.Service
      const tasks = yield* SessionTask.Service
      const completions = yield* SessionTaskCompletion.Service
      const permission = yield* PermissionV2.Service
      const failure = (error: unknown) =>
        new Tool.Failure({
          message: error instanceof SessionTaskStore.Failure ? error.message : "Native Task operation failed",
        })
      const manage = Schema.Struct({
        task_id: SessionSchema.ID,
        timeout_ms: optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 120_000 }))),
      })
      yield* tools
        .register({
          ...(ConfigTask.activeMessages(yield* config.entries())
            ? {
                send_subagent_message: Tool.make({
                  description:
                    "Send a durable message to an owned child or descendant native Task. A completed direct child starts a new owned background run when the current parent can own background Tasks. Defaults to steer at the next safe turn; queue waits until idle; interject prioritizes delivery and interrupts only passive Task/process waits. Acceptance is not completion.",
                  input: Schema.Struct({
                    subagent_id: SessionSchema.ID,
                    text: Task.MessageInput.fields.text,
                    delivery: optional(Task.MessageDelivery),
                  }),
                  output: Task.MessageReceipt,
                  execute: (input, context) =>
                    tasks
                      .send(
                        context.sessionID,
                        input.subagent_id,
                        {
                          inputID: SessionMessage.ID.make(
                            `msg_taskmessage${createHash("sha256")
                              .update(
                                JSON.stringify([context.sessionID, context.assistantMessageID, context.toolCallID]),
                              )
                              .digest("hex")}`,
                          ),
                          text: input.text,
                          delivery: input.delivery,
                        },
                        context,
                      )
                      .pipe(Effect.mapError(failure)),
                }),
              }
            : {}),
          task: Tool.make({
            description:
              "Run one native subagent Task. background=true returns while independent work continues; completion is delivered when the parent is idle. task_id follows up the same completed owned child. resume_from creates a fresh child from a terminal direct child's durable transcript, saved Agent and model; do not combine it with task_id. isolation=worktree creates a retained native worktree including dirty tracked and untracked files; cwd selects an existing directory and cannot be combined with worktree. A resume retains the source placement and ignores new placement options. Nested Tasks require task.maxDepth greater than the current captured depth. Background Tasks during Goals are unavailable.",
            input: SessionTask.Input,
            output: SessionTask.Output,
            execute: (input, context) => tasks.execute(input, context).pipe(Effect.mapError(failure)),
          }),
          ...Object.fromEntries(
            (["task_output", "task_wait", "task_cancel"] as const).map((name) => [
              name,
              Tool.make({
                description:
                  name === "task_cancel"
                    ? "Cancel and join one owned native Task."
                    : name === "task_wait"
                      ? "Wait a bounded time for one owned native Task; timeout does not cancel it."
                      : "Read the durable result of one owned native Task.",
                input: manage,
                output: SessionTask.Output,
                execute: (input, context) =>
                  Effect.gen(function* () {
                    yield* permission.assert({
                      sessionID: context.sessionID,
                      agent: context.agent,
                      action: name,
                      resources: [input.task_id],
                      save: ["*"],
                      source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                    })
                    if (name === "task_cancel") return yield* tasks.cancel(context.sessionID, input.task_id)
                    if (name === "task_wait") {
                      const outcome = yield* messages.interruptWait(
                        context.sessionID,
                        tasks.wait(context.sessionID, input.task_id, input.timeout_ms ?? 30_000),
                      )
                      if ("interruptedByMessage" in outcome)
                        return {
                          ...(yield* tasks.output(context.sessionID, input.task_id)),
                          interruptedByMessage: true,
                        }
                      const result = outcome.value
                      if (!result.timedOut && result.task.status !== "running")
                        yield* completions.observed(result.task.parentSessionID, input.task_id)
                      return result.task
                    }
                    return yield* tasks.output(context.sessionID, input.task_id)
                  }).pipe(Effect.mapError(failure)),
              }),
            ]),
          ),
        })
        .pipe(Effect.orDie)
    }),
  ),
})

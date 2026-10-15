export * as GoalTool from "./goal"

import { Effect, Layer, Schema } from "effect"
import { Goal } from "@apexo/schema/goal"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { SessionGoal } from "../session/goal"
import { SessionGoalUsage } from "../session/goal-usage"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

export const node = makeLocationNode({
  name: "tool/goal",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const tools = yield* Tools.Service
      const goals = yield* SessionGoal.Service
      const permission = yield* PermissionV2.Service
      yield* tools
        .register({
          update_goal: Tool.make({
            description:
              "Report progress or a blocker for the explicitly active Goal. completed=true requests independent verification and cannot complete the Goal. Only the main worker may update it; never narrow the objective. plan_progress.complete marks zero-based immutable Task checklist ordinals; plan_progress.deviation appends one concise advisory note. Completion annotations never complete a Goal.",
            input: Goal.Update,
            output: Schema.Struct({
              status: Goal.Status,
              plan_progress: Schema.optional(Goal.PlanProgress),
              message: Schema.optional(Schema.String),
              verification_requested: Schema.Boolean,
            }),
            execute: (input, context) =>
              Effect.gen(function* () {
                const attempt = yield* SessionGoalUsage.Current
                if (!attempt || attempt.sessionID !== context.sessionID)
                  return yield* new Tool.Failure({ message: "No active Goal worker owns this Session" })
                yield* permission.assert({
                  action: "update_goal",
                  resources: [attempt.goalID],
                  save: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                })
                const info = yield* goals.update(attempt, input)
                return {
                  status: info.status,
                  plan_progress: info.planProgress,
                  message: info.message,
                  verification_requested: input.completed === true,
                }
              }).pipe(
                Effect.mapError((error) =>
                  error instanceof Tool.Failure
                    ? error
                    : new Tool.Failure({
                        message: error instanceof SessionGoal.Conflict ? error.message : "Unable to update this Goal attempt",
                      }),
                ),
              ),
          }),
        })
        .pipe(Effect.orDie)
    }),
  ),
  deps: [ToolRegistry.node, SessionGoal.node, PermissionV2.node],
})

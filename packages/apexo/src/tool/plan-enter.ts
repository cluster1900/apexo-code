import { Effect, Schema } from "effect"
import { MessageID, PartID } from "../session/schema"
import { SessionV1 } from "@apexo/core/v1/session"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({})

export const PlanEnterTool = Tool.define(
  "plan_enter",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const provider = yield* Provider.Service

    return {
      description: "Switch to plan mode before making changes. Use this when the task needs analysis first.",
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "plan_enter",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })
          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
          const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
          const model =
            lastUser?.info.role === "user" && lastUser.info.model ? lastUser.info.model : yield* provider.defaultModel()
          const msg: SessionV1.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "plan",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: "Plan mode is active. Analyze the task, inspect the workspace, and propose a plan before editing files.",
            synthetic: true,
          } satisfies SessionV1.TextPart)
          return {
            title: "Entering plan mode",
            output: "Plan mode enabled. Continue by analyzing the task without editing files.",
            metadata: { agent: "plan" },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export * as PlanEnter from "./plan-enter"

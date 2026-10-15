export * as FeedbackTool from "./feedback"

import { Effect, Layer, Schema } from "effect"
import { Feedback } from "@apexo/schema/feedback"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { SessionFeedback } from "../session/feedback"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

export const node = makeLocationNode({
  name: "tool/feedback",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const tools = yield* Tools.Service
      const database = yield* Database.Service
      const permission = yield* PermissionV2.Service
      const drafts = SessionFeedback.make(database.db)
      yield* tools
        .register({
          send_feedback: Tool.make({
            description:
              "Save or update a local feedback draft for this session. This tool never sends feedback, opens a UI, or stops the current turn. The user can review drafts with /feedback and open the issue form themselves. Use draft_id only when explicitly asked to update an existing draft; never include that ID in title, details or product_area. Write concise What happened, Repro and Cause sections. Use failure_mode only for model-behavior feedback. After saving, tell the user it is a local draft awaiting review.",
            input: Feedback.ToolSave,
            output: Schema.Struct({ draftID: Feedback.ID, revision: Schema.Number, message: Schema.String }),
            toModelOutput: ({ output }) => [{ type: "text", text: output.message }],
            execute: (input, context) =>
              Effect.gen(function* () {
                yield* permission.assert({
                  action: "send_feedback",
                  resources: ["*"],
                  save: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                })
                const draft = yield* drafts.saveText(context.sessionID, input)
                return { draftID: draft.id, revision: draft.revision, message: "Local feedback draft saved." }
              }).pipe(
                Effect.mapError(
                  (error) =>
                    new Tool.Failure({
                      message:
                        error instanceof SessionFeedback.Error ? error.message : "Unable to save this feedback draft",
                    }),
                ),
              ),
          }),
        })
        .pipe(Effect.orDie)
    }),
  ),
  deps: [ToolRegistry.node, PermissionV2.node, Database.node],
})

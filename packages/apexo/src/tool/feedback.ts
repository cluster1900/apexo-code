import { Effect, Schema } from "effect"
import { Feedback } from "@apexo/schema/feedback"
import { SessionFeedback } from "@apexo/core/session/feedback"
import { Tool } from "./tool"

export function feedbackTool(store?: SessionFeedback.Interface): Tool.Def {
  return {
    id: "send_feedback",
    description:
      "Save or update a local feedback draft for this session. This tool never sends feedback, opens a UI, or stops the current turn. The user can review drafts with /feedback and open the issue form themselves. Use draft_id only when explicitly asked to update an existing draft; never include that ID in title, details or product_area. Write concise What happened, Repro and Cause sections. Use failure_mode only for model-behavior feedback. After saving, tell the user it is a local draft awaiting review.",
    parameters: Feedback.ToolSave,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        if (!store) return yield* Effect.die(new Error("Feedback storage is unavailable"))
        const input = yield* Schema.decodeUnknownEffect(Feedback.ToolSave)(args).pipe(Effect.orDie)
        yield* ctx.ask({
          permission: "send_feedback",
          patterns: ["*"],
          always: ["*"],
          metadata: { action: "save-local-draft" },
        })
        const draft = yield* store.saveText(ctx.sessionID, input).pipe(Effect.orDie)
        return {
          title: "Local feedback draft",
          output: "Local feedback draft saved.",
          metadata: { draftID: draft.id, revision: draft.revision, local: true },
        }
      }),
  }
}

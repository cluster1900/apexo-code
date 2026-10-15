import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { WorkflowControl } from "@apexo/core/workflow/control"
import { WorkflowStore } from "@apexo/core/workflow/store"
import { SessionV2 } from "@apexo/core/session"
import { SessionGoal } from "@apexo/core/session/goal"
import { WorkflowNotFoundError } from "@apexo/protocol/groups/workflow"
import {
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "@apexo/protocol/errors"
import { Api } from "../api"

const errors = <A, E extends WorkflowStore.Failure | SessionV2.NotFoundError | SessionGoal.Error, R>(
  effect: Effect.Effect<A, E, R>,
) =>
  effect.pipe(
    Effect.mapError((error) => {
      if (error._tag === "Session.NotFoundError")
        return new SessionNotFoundError({ sessionID: error.sessionID, message: "Session not found" })
      if (error instanceof WorkflowStore.Failure) {
        if (error.code === "missing") return new WorkflowNotFoundError({ message: error.message })
        if (error.code === "invalid") return new InvalidRequestError({ message: error.message })
        if (error.code !== "storage") return new ConflictError({ message: error.message })
      }
      return new ServiceUnavailableError({ message: error.message })
    }),
  )
export const WorkflowHandler = HttpApiBuilder.group(Api, "server.workflow", (handlers) =>
  Effect.gen(function* () {
    const workflows = yield* WorkflowControl.Service
    return handlers
      .handle("workflow.related", (ctx) => errors(workflows.related(ctx.params.sessionID)))
      .handle("workflow.launch", (ctx) => errors(workflows.launch(ctx.params.sessionID, ctx.payload)))
      .handle("workflow.sources", (ctx) => errors(workflows.sources(ctx.params.sessionID)))
      .handle("workflow.validate", (ctx) => errors(workflows.validate(ctx.params.sessionID, ctx.payload.source)))
      .handle("workflow.list", (ctx) => errors(workflows.list(ctx.params.sessionID)))
      .handle("workflow.start", (ctx) => errors(workflows.start(ctx.params.sessionID, ctx.payload)))
      .handle("workflow.get", (ctx) => errors(workflows.get(ctx.params.sessionID, ctx.params.workflowID)))
      .handle("workflow.resume", (ctx) =>
        errors(workflows.resume(ctx.params.sessionID, ctx.params.workflowID, ctx.payload.agentBudget)),
      )
      .handle("workflow.pause", (ctx) => errors(workflows.stop(ctx.params.sessionID, ctx.params.workflowID)))
      .handle("workflow.stop", (ctx) => errors(workflows.stop(ctx.params.sessionID, ctx.params.workflowID, true)))
  }),
)

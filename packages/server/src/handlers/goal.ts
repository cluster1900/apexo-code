import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { SessionV2 } from "@apexo/core/session"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionGoalReports } from "@apexo/core/session/goal-reports"
import { GoalReportNotFoundError } from "@apexo/protocol/groups/goal"
import { SessionGoalControl } from "@apexo/core/session/goal-control"
import {
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "@apexo/protocol/errors"
import { Api } from "../api"

const errors = <A, E extends SessionGoal.Error | SessionV2.NotFoundError | SessionV2.PromptConflictError, R>(
  effect: Effect.Effect<A, E, R>,
) =>
  effect.pipe(
    Effect.mapError((error) =>
      error._tag === "Session.NotFoundError"
        ? new SessionNotFoundError({ sessionID: error.sessionID, message: "Session not found" })
        : error._tag === "Session.PromptConflictError"
          ? new ConflictError({ message: "Goal launch prompt conflicts with existing input" })
          : error._tag === "GoalConflict"
            ? new ConflictError({ message: error.message })
            : new ServiceUnavailableError({ message: error.message }),
    ),
  )

export const GoalHandler = HttpApiBuilder.group(Api, "server.goal", (handlers) =>
  Effect.gen(function* () {
    const goals = yield* SessionGoalControl.Service
    return handlers
      .handle("goal.get", (ctx) => errors(goals.get(ctx.params.sessionID).pipe(Effect.map((info) => info ?? null))))
      .handle("goal.create", (ctx) => errors(goals.create(ctx.params.sessionID, ctx.payload)))
      .handle("goal.start", (ctx) => errors(goals.start(ctx.params, ctx.payload)))
      .handle("goal.run", (ctx) => errors(goals.run(ctx.params)))
      .handle("goal.resume", (ctx) => errors(goals.run(ctx.params, true)))
      .handle("goal.pause", (ctx) => errors(goals.pause(ctx.params)))
      .handle("goal.clear", (ctx) => errors(goals.clear(ctx.params)))
      .handle("goal.reports", (ctx) =>
        errors(goals.reports(ctx.params)).pipe(
          Effect.flatMap((reports) => Effect.tryPromise({ try: reports.list, catch: reportError })),
        ),
      )
      .handle("goal.report", (ctx) =>
        errors(goals.reports(ctx.params)).pipe(
          Effect.flatMap((reports) =>
            Effect.tryPromise({ try: () => reports.read(ctx.params.reportID, ctx.params.file), catch: reportError }),
          ),
        ),
      )
      .handle("goal.cleanupReports", (ctx) => errors(goals.cleanupReports(ctx.params)))
  }),
)

function reportError(error: unknown) {
  if (error instanceof SessionGoalReports.Unavailable)
    return error.reason === "missing"
      ? new GoalReportNotFoundError({ message: "Goal report not found" })
      : new InvalidRequestError({ message: "Goal report failed validation" })
  return new ServiceUnavailableError({ message: "Goal report storage is unavailable" })
}

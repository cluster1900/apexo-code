import { SessionExecution } from "@apexo/core/session/execution"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { QuestionV2 } from "@apexo/core/question"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { SessionPlan } from "@apexo/core/session/plan"
import { QuestionNotFoundError, ConflictError, ForbiddenError, ServiceUnavailableError } from "@apexo/protocol/errors"
import { response } from "../location"

const unavailable = (_error: SessionPlan.Failure) =>
  new ServiceUnavailableError({ service: "plan", message: "Plan approvals are unavailable" })

function missingRequest(id: QuestionV2.ID) {
  return new QuestionNotFoundError({ requestID: id, message: `Question request not found: ${id}` })
}

export const QuestionHandler = HttpApiBuilder.group(Api, "server.question", (handlers) =>
  Effect.gen(function* () {
    const execution = yield* SessionExecution.Service
    const lifecycle = yield* SessionLifecycle.Service
    const withOwnedQuestion = Effect.fnUntraced(function* <A, E>(
      sessionID: QuestionV2.Request["sessionID"],
      requestID: QuestionV2.ID,
      use: (question: QuestionV2.Interface) => Effect.Effect<A, E>,
    ) {
      const question = yield* QuestionV2.Service
      const request = yield* question.find(sessionID, requestID)
      if (!request || request.sessionID !== sessionID) return yield* missingRequest(requestID)
      return yield* use(question)
    })

    return handlers
      .handle(
        "question.request.list",
        Effect.fn(function* () {
          const question = yield* QuestionV2.Service
          return yield* response(question.list().pipe(Effect.mapError(unavailable)))
        }),
      )
      .handle(
        "session.question.list",
        Effect.fn(function* (ctx) {
          const question = yield* QuestionV2.Service
          const requests = yield* question.list().pipe(Effect.mapError(unavailable))
          return { data: requests.filter((request) => request.sessionID === ctx.params.sessionID) }
        }),
      )
      .handle(
        "session.question.reply",
        Effect.fn(function* (ctx) {
          const resume = yield* withOwnedQuestion(ctx.params.sessionID, ctx.params.requestID, (question) =>
            question
              .reply({ requestID: ctx.params.requestID, answers: ctx.payload.answers })
              .pipe(Effect.catchTag("QuestionV2.NotFoundError", () => missingRequest(ctx.params.requestID))),
          ).pipe(
            Effect.catchTag("SessionPlanFailure", (error) =>
              Effect.fail(
                error.code === "conflict"
                  ? new ConflictError({ message: error.message })
                  : error.code === "denied"
                    ? new ForbiddenError({ message: error.message })
                    : unavailable(error),
              ),
            ),
          )
          if (resume) yield* lifecycle.owned(resume, execution.wake(resume.sessionID))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.question.reject",
        Effect.fn(function* (ctx) {
          yield* withOwnedQuestion(ctx.params.sessionID, ctx.params.requestID, (question) =>
            question
              .reject(ctx.params.requestID)
              .pipe(Effect.catchTag("QuestionV2.NotFoundError", () => missingRequest(ctx.params.requestID))),
          ).pipe(
            Effect.catchTag("SessionPlanFailure", (error) =>
              Effect.fail(
                error.code === "conflict"
                  ? new ConflictError({ message: error.message })
                  : error.code === "denied"
                    ? new ForbiddenError({ message: error.message })
                    : unavailable(error),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)

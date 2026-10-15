import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { SessionSideQuestion } from "@apexo/core/session/side-question"
import { SideQuestionManagement } from "@/session/side-question"
import { NotFoundError } from "@/storage/storage"
import { InstanceHttpApi } from "../api"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, notFound } from "../errors"

export const sideQuestionHandlers = HttpApiBuilder.group(InstanceHttpApi, "sideQuestion", (handlers) =>
  Effect.gen(function* () {
    const service = yield* SideQuestionManagement.Service
    const boundary = <A>(work: Effect.Effect<A, unknown>) =>
      work.pipe(
        Effect.mapError((error) => {
          if (error instanceof NotFoundError) return notFound(error.message)
          if (error instanceof SessionSideQuestion.Error) {
            if (error.code === "missing") return notFound(error.message)
            if (error.code === "invalid")
              return new InvalidRequestError({ message: error.message, kind: "sideQuestion" })
            if (error.code === "capacity")
              return new ConflictError({ message: error.message, resource: "sideQuestion" })
          }
          return new ServiceUnavailableError({ message: "The side question is unavailable", service: "sideQuestion" })
        }),
      )
    return handlers
      .handle("list", ({ params }) => boundary(service.list(params.sessionID)))
      .handle("ask", ({ params, payload }) => boundary(service.ask(params.sessionID, payload)))
      .handle("cancel", ({ params }) => boundary(service.cancel(params.sessionID, params.questionID)))
  }),
)

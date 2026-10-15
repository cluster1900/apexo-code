import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { SessionSideQuestion } from "@apexo/core/session/side-question"
import { SessionSideQuestionNative } from "@apexo/core/session/side-question-native"
import { SessionSchema } from "@apexo/core/session/schema"
import {
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "@apexo/protocol/errors"
import { Api } from "../api"

const boundary = <A, E>(sessionID: SessionSchema.ID, work: Effect.Effect<A, E>) =>
  work.pipe(
    Effect.mapError((error) => {
      if (error instanceof SessionSideQuestion.Error) {
        if (error.code === "missing") return new SessionNotFoundError({ sessionID, message: error.message })
        if (error.code === "invalid") return new InvalidRequestError({ message: error.message })
        if (error.code === "capacity") return new ConflictError({ message: error.message })
      }
      return new ServiceUnavailableError({ message: "The side question is unavailable" })
    }),
  )
export const SideQuestionHandler = HttpApiBuilder.group(Api, "server.sideQuestion", (handlers) =>
  Effect.gen(function* () {
    const side = yield* SessionSideQuestionNative.Service
    return handlers
      .handle("sideQuestion.list", (ctx) => boundary(ctx.params.sessionID, side.list(ctx.params.sessionID)))
      .handle("sideQuestion.ask", (ctx) => boundary(ctx.params.sessionID, side.ask(ctx.params.sessionID, ctx.payload)))
      .handle("sideQuestion.cancel", (ctx) =>
        boundary(ctx.params.sessionID, side.cancel(ctx.params.sessionID, ctx.params.questionID)),
      )
  }),
)

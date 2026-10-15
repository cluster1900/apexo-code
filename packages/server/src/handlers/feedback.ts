import { Database } from "@apexo/core/database/database"
import { SessionFeedback } from "@apexo/core/session/feedback"
import { FeedbackNotFoundError } from "@apexo/protocol/groups/feedback"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "@apexo/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

const boundary = <A>(work: Effect.Effect<A, SessionFeedback.Error>) =>
  work.pipe(
    Effect.mapError((error) => {
      if (error.code === "missing") return new FeedbackNotFoundError({ message: error.message })
      if (error.code === "invalid") return new InvalidRequestError({ message: error.message })
      if (error.code === "conflict" || error.code === "capacity") return new ConflictError({ message: error.message })
      return new ServiceUnavailableError({ message: "Feedback draft storage is unavailable", service: "feedback" })
    }),
  )

export const FeedbackHandler = HttpApiBuilder.group(Api, "server.feedback", (handlers) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const store = SessionFeedback.make(database.db)
    // Session placement and existence come from the Protocol's Session middleware.
    // User-operated draft management does not execute the model's feedback tool.
    return handlers
      .handle("feedback.list", (ctx) => boundary(store.list(ctx.params.sessionID)))
      .handle("feedback.save", (ctx) => boundary(store.save(ctx.params.sessionID, ctx.payload)))
      .handle("feedback.review", (ctx) =>
        boundary(store.review(ctx.params.sessionID, ctx.params.draftID, ctx.payload.revision)),
      )
      .handle("feedback.image", (ctx) =>
        boundary(store.image(ctx.params.sessionID, ctx.params.draftID, ctx.payload.revision, ctx.params.imageID)),
      )
      .handle("feedback.remove", (ctx) =>
        boundary(store.remove(ctx.params.sessionID, ctx.params.draftID, ctx.payload.revision)),
      )
  }),
)

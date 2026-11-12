import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { SessionCodeReview } from "@apexo/core/session/code-review"
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
      if (error instanceof SessionCodeReview.Failure) {
        if (error.code === "missing") return new SessionNotFoundError({ sessionID, message: error.message })
        if (error.code === "invalid") return new InvalidRequestError({ message: error.message })
        if (error.code === "conflict") return new ConflictError({ message: error.message })
      }
      return new ServiceUnavailableError({ message: "Code review is unavailable" })
    }),
  )
export const CodeReviewHandler = HttpApiBuilder.group(Api, "server.codeReview", (handlers) =>
  Effect.gen(function* () {
    const reviews = yield* SessionCodeReview.Service
    return handlers
      .handle("codeReview.start", (ctx) =>
        boundary(ctx.params.sessionID, reviews.start(ctx.params.sessionID, ctx.payload)),
      )
      .handle("codeReview.list", (ctx) =>
        boundary(ctx.params.sessionID, reviews.list(ctx.params.sessionID, ctx.query.after, ctx.query.limit)),
      )
      .handle("codeReview.get", (ctx) =>
        boundary(ctx.params.sessionID, reviews.detail(ctx.params.sessionID, ctx.params.reviewID)),
      )
      .handle("codeReview.diff", (ctx) =>
        boundary(
          ctx.params.sessionID,
          reviews.get(ctx.params.sessionID, ctx.params.reviewID).pipe(Effect.map((run) => run.captured?.files ?? [])),
        ),
      )
      .handle("codeReview.cancel", (ctx) =>
        boundary(ctx.params.sessionID, reviews.cancel(ctx.params.sessionID, ctx.params.reviewID)),
      )
  }),
)

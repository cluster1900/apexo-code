import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Database } from "@apexo/core/database/database"
import { SessionFeedback } from "@apexo/core/session/feedback"
import { SessionID } from "@apexo/schema/session-id"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { NotFoundError } from "@/storage/storage"
import { InstanceHttpApi } from "../api"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, notFound } from "../errors"

export const feedbackHandlers = HttpApiBuilder.group(InstanceHttpApi, "feedback", (handlers) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const sessions = yield* Session.Service
    const store = SessionFeedback.make(database.db)
    const scoped = <A>(id: SessionID, work: Effect.Effect<A, SessionFeedback.Error>) =>
      Effect.gen(function* () {
        const session = yield* sessions.get(id)
        if (session.directory !== (yield* InstanceState.directory))
          return yield* new NotFoundError({ message: "Session does not belong to this directory" })
        return yield* work
      }).pipe(
        Effect.mapError((error) => {
          if (error instanceof NotFoundError) return notFound(error.message)
          if (error instanceof SessionFeedback.Error) {
            if (error.code === "missing") return notFound(error.message)
            if (error.code === "invalid") return new InvalidRequestError({ message: error.message, kind: "feedback" })
            if (error.code === "conflict" || error.code === "capacity")
              return new ConflictError({ message: error.message, resource: "feedback" })
          }
          return new ServiceUnavailableError({ message: "Feedback draft storage is unavailable", service: "feedback" })
        }),
      )
    return handlers
      .handle("list", ({ params }) => scoped(params.sessionID, store.list(params.sessionID)))
      .handle("save", ({ params, payload }) => scoped(params.sessionID, store.save(params.sessionID, payload)))
      .handle("review", ({ params, payload }) =>
        scoped(params.sessionID, store.review(params.sessionID, params.draftID, payload.revision)),
      )
      .handle("image", ({ params, payload }) =>
        scoped(params.sessionID, store.image(params.sessionID, params.draftID, payload.revision, params.imageID)),
      )
      .handle("remove", ({ params, payload }) =>
        scoped(params.sessionID, store.remove(params.sessionID, params.draftID, payload.revision)),
      )
  }),
)

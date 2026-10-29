import { Computer } from "@apexo/core/computer"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "@apexo/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

const boundary = <A>(work: Effect.Effect<A, Computer.ComputerError | ConflictError>) =>
  work.pipe(
    Effect.mapError((error) => {
      if (error instanceof ConflictError) return error
      if (error.code === "invalid_action" || error.code === "stale_target") return new InvalidRequestError({ message: error.message })
      return new ServiceUnavailableError({ message: error.message, service: "computer" })
    }),
  )

export const ComputerHandler = HttpApiBuilder.group(Api, "server.computer", (handlers) =>
  Effect.succeed(
    handlers
      .handle("computer.list", Effect.fn(function* (ctx) {
        const computer = yield* Computer.Service
        return (yield* computer.list()).filter((item) => item.sessionID === ctx.params.sessionID)
      }))
      .handle("computer.open", Effect.fn(function* (ctx) {
        const computer = yield* Computer.Service
        return yield* boundary(computer.open({ sessionID: ctx.params.sessionID, ...(ctx.payload.backend ? { backend: ctx.payload.backend } : {}) }))
      }))
      .handle("computer.action", Effect.fn(function* (ctx) {
        const computer = yield* Computer.Service
        return yield* boundary(
          owned(computer, ctx.params.sessionID, ctx.params.computerSessionID).pipe(
            Effect.andThen(() => computer.act({ ...ctx.payload, computerSessionID: ctx.params.computerSessionID })),
            Effect.map((result) => ({ ...result, action: ctx.payload.action })),
          ),
        )
      }))
      .handle("computer.close", Effect.fn(function* (ctx) {
        const computer = yield* Computer.Service
        return yield* boundary(
          owned(computer, ctx.params.sessionID, ctx.params.computerSessionID)
            .pipe(Effect.andThen(() => computer.close(ctx.params.computerSessionID)))
            .pipe(Effect.as(HttpApiSchema.NoContent.make())),
        )
      }))
      .handle("computer.events", Effect.fn(function* (ctx) {
        const computer = yield* Computer.Service
        return yield* boundary(
          owned(computer, ctx.params.sessionID, ctx.params.computerSessionID).pipe(
            Effect.andThen(
              computer.replay({
                computerSessionID: ctx.params.computerSessionID,
                after: ctx.query.after,
                limit: ctx.query.limit ?? 50,
              }),
            ),
          ),
        )
      })),
  ),
)

function owned(computer: Computer.Interface, sessionID: string, computerSessionID: Parameters<Computer.Interface["close"]>[0]) {
  return Effect.gen(function* () {
    const info = (yield* computer.list()).find((item) => item.id === computerSessionID && item.sessionID === sessionID)
    if (info) return info
    return yield* new ConflictError({ message: "Computer session is not owned by this Session" })
  })
}

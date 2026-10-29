import { Browser } from "@apexo/core/browser"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "@apexo/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

const boundary = <A>(work: Effect.Effect<A, Browser.BrowserError | ConflictError>) =>
  work.pipe(
    Effect.mapError((error) => {
      if (error instanceof ConflictError) return error
      if (error.code === "invalid_url" || error.code === "invalid_action")
        return new InvalidRequestError({ message: error.message })
      if (error.code === "page_not_found" || error.code === "stale_target")
        return new ConflictError({ message: error.message })
      return new ServiceUnavailableError({ message: error.message, service: "browser" })
    }),
  )

export const BrowserHandler = HttpApiBuilder.group(Api, "server.browser", (handlers) =>
  Effect.succeed(
    handlers
      .handle("browser.list", Effect.fn(function* (ctx) {
        const browser = yield* Browser.Service
        const items = yield* browser.list()
        return items.filter((item) => item.sessionID === ctx.params.sessionID)
      }))
      .handle("browser.open", Effect.fn(function* (ctx) {
        const browser = yield* Browser.Service
        return yield* boundary(browser.open({ sessionID: ctx.params.sessionID, ...ctx.payload }))
      }))
      .handle("browser.action", Effect.fn(function* (ctx) {
        const browser = yield* Browser.Service
        return yield* boundary(
          owned(browser, ctx.params.sessionID, ctx.params.browserSessionID).pipe(
            Effect.andThen(() => browser.act({ ...ctx.payload, browserSessionID: ctx.params.browserSessionID })),
            Effect.map((result) => ({ browserSessionID: ctx.params.browserSessionID, ...result, action: ctx.payload.action })),
          ),
        )
      }))
      .handle("browser.close", Effect.fn(function* (ctx) {
        const browser = yield* Browser.Service
        return yield* boundary(
          owned(browser, ctx.params.sessionID, ctx.params.browserSessionID)
            .pipe(Effect.andThen(() => browser.close(ctx.params.browserSessionID)))
            .pipe(Effect.as(HttpApiSchema.NoContent.make())),
        )
      }))
      .handle("browser.events", Effect.fn(function* (ctx) {
        const browser = yield* Browser.Service
        return yield* boundary(
          owned(browser, ctx.params.sessionID, ctx.params.browserSessionID).pipe(
            Effect.andThen(
              browser.replay({
                browserSessionID: ctx.params.browserSessionID,
                after: ctx.query.after,
                limit: ctx.query.limit ?? 50,
              }),
            ),
          ),
        )
      }))
  )
)

function owned(
  browser: Browser.Interface,
  sessionID: Parameters<Browser.Interface["open"]>[0]["sessionID"],
  browserSessionID: Parameters<Browser.Interface["close"]>[0],
) {
  return Effect.gen(function* () {
    const info = (yield* browser.list()).find((item) => item.id === browserSessionID && item.sessionID === sessionID)
    if (info) return info
    return yield* new ConflictError({ message: "Browser session is not owned by this Session" })
  })
}

import { Effect, Layer } from "effect"
import { HttpMiddleware, HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { CorsConfig, isAllowedCorsOrigin } from "../cors"

// The preflight implementation overwrites Vary: Origin when it also echoes
// request headers. Preserve both cache keys when the allowed origin is dynamic.
export const corsVaryFix = HttpRouter.middleware(
  (effect) =>
    Effect.gen(function* () {
      const response = yield* effect
      const origin = response.headers["access-control-allow-origin"]
      if (!origin || origin === "*") return response
      const vary = response.headers["vary"]
      if (!vary) return HttpServerResponse.setHeader(response, "vary", "Origin")
      const tokens = vary.split(",").map((value) => value.trim().toLowerCase())
      if (tokens.includes("origin") || tokens.includes("*")) return response
      return HttpServerResponse.setHeader(response, "vary", `${vary}, Origin`)
    }),
  { global: true },
)

export const corsLayer = Layer.unwrap(
  Effect.map(CorsConfig, (options) =>
    Layer.mergeAll(
      corsVaryFix,
      HttpRouter.middleware(
        HttpMiddleware.cors({
          allowedOrigins: (origin) => isAllowedCorsOrigin(origin, options),
          maxAge: 86_400,
        }),
        { global: true },
      ),
    ),
  ),
)

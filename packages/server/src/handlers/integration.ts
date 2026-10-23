import { Catalog } from "@apexo/core/catalog"
import { Integration } from "@apexo/core/integration"
import { ProviderV2 } from "@apexo/core/provider"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { InvalidRequestError } from "@apexo/protocol/errors"
import { response } from "../location"

const authorize = <A, R>(effect: Effect.Effect<A, Integration.AuthorizationError, R>) =>
  effect.pipe(
    Effect.mapError(
      () =>
        new InvalidRequestError({
          message: "Authentication failed",
          kind: "integration_authorization",
        }),
    ),
  )

export const IntegrationHandler = HttpApiBuilder.group(Api, "server.integration", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "integration.connect.external",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(
            authorize(
              service.connection.external({
                integrationID: ctx.params.integrationID,
                methodID: ctx.payload.methodID,
              }),
            ),
          )
        }),
      )
      .handle(
        "integration.list",
        Effect.fn(function* () {
          const service = yield* Integration.Service
          return yield* response(service.list())
        }),
      )
      .handle(
        "integration.get",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(service.get(ctx.params.integrationID))
        }),
      )
      .handle(
        "integration.connect.key",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          const catalog = yield* Catalog.Service
          const provider = yield* catalog.provider.get(ProviderV2.ID.make(ctx.params.integrationID))
          const existing = yield* service.get(ctx.params.integrationID)
          const isAnthropic = provider?.api.type === "aisdk" && provider.api.package === "@ai-sdk/anthropic"
          const customBase = !isAnthropic ? provider?.api.url?.replace(/\/+$/, "") : undefined
          const shouldVerifyOnline =
            Boolean(customBase) &&
            (!existing || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/|$)/i.test(customBase!))
          if (shouldVerifyOnline && customBase) {
            const verify = yield* Effect.promise(() =>
              fetch(`${customBase}/models`, {
                method: "GET",
                headers: {
                  Authorization: `Bearer ${ctx.payload.key.trim()}`,
                  ...(provider?.request.headers ?? {}),
                },
                signal: AbortSignal.timeout(6000),
              }).then(
                (res) => ({ ok: res.ok || res.status === 404, status: res.status }),
                () => ({ ok: false, status: 0 }),
              ),
            )
            if (!verify.ok) {
              return yield* new InvalidRequestError({
                message:
                  verify.status > 0
                    ? `Invalid API key (HTTP ${verify.status})`
                    : "Invalid API key: endpoint verification failed",
                kind: "integration_authorization",
              })
            }
          }
          yield* authorize(
            service.connection.key({
              integrationID: ctx.params.integrationID,
              key: ctx.payload.key,
              label: ctx.payload.label,
              allowCustom: Boolean(provider),
            }),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "integration.connect.oauth",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(
            authorize(
              service.connection.oauth({
                integrationID: ctx.params.integrationID,
                methodID: ctx.payload.methodID,
                inputs: ctx.payload.inputs,
                label: ctx.payload.label,
              }),
            ),
          )
        }),
      )
      .handle(
        "integration.attempt.status",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(service.attempt.status(ctx.params.attemptID))
        }),
      )
      .handle(
        "integration.attempt.complete",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* service.attempt.complete({ attemptID: ctx.params.attemptID, code: ctx.payload.code }).pipe(
            Effect.mapError(
              (error) =>
                new InvalidRequestError({
                  message:
                    error._tag === "Integration.CodeRequired"
                      ? "Authorization code is required"
                      : "Authentication failed",
                  kind:
                    error._tag === "Integration.CodeRequired"
                      ? "integration_code_required"
                      : "integration_authorization",
                }),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "integration.attempt.cancel",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* service.attempt.cancel(ctx.params.attemptID)
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)

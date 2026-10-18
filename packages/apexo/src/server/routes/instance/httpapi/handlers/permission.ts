import { PermissionV1 } from "@apexo/core/v1/permission"
import { Permission } from "@/permission"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { PermissionNotFoundError } from "../errors"
import { AutoReview } from "@/permission/auto-review"

export const permissionHandlers = HttpApiBuilder.group(InstanceHttpApi, "permission", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Permission.Service

    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
      params: { requestID: PermissionV1.ID }
      payload: PermissionV1.ReplyBody
    }) {
      yield* svc
        .reply({
          requestID: ctx.params.requestID,
          reply: ctx.payload.reply,
          message: ctx.payload.message,
          always: ctx.payload.always,
        })
        .pipe(
          Effect.catchTag("Permission.NotFoundError", (error) =>
            Effect.fail(
              new PermissionNotFoundError({
                requestID: String(error.requestID),
                message: `Permission request not found: ${error.requestID}`,
              }),
            ),
          ),
        )
      return true
    })

    const review = Effect.fn("PermissionHttpApi.review")(function* (ctx: { params: { requestID: PermissionV1.ID } }) {
      const request = (yield* svc.list()).find((item) => item.id === ctx.params.requestID)
      if (!request)
        return yield* Effect.fail(
          new PermissionNotFoundError({
            requestID: String(ctx.params.requestID),
            message: `Permission request not found: ${ctx.params.requestID}`,
          }),
        )
      return yield* AutoReview.review({
        sessionID: request.sessionID,
        permission: request.permission,
        patterns: request.patterns,
        metadata: request.metadata,
      })
    })

    return handlers.handle("list", list).handle("reply", reply).handle("review", review)
  }),
)

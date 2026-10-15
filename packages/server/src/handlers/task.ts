import { SessionExecution } from "@apexo/core/session/execution"
import { SessionTask } from "@apexo/core/session/task"
import { SessionTaskControl } from "@apexo/core/session/task-control"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { TaskNotFoundError } from "@apexo/protocol/groups/task"
import { ConflictError, ForbiddenError, InvalidRequestError, ServiceUnavailableError } from "@apexo/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

const boundary = <A>(work: Effect.Effect<A, SessionTaskStore.Failure | SessionLifecycle.Closed>) =>
  work.pipe(
    Effect.mapError((error) => {
      if (error instanceof SessionLifecycle.Closed)
        return new ConflictError({ message: "Task ownership changed; reload the Session" })
      if (error.code === "missing") return new TaskNotFoundError({ message: "Task not found in this Session" })
      if (error.code === "busy")
        return new ConflictError({
          message: "Task worker is still starting; retry cancellation after it is registered",
        })
      if (error.code === "storage")
        return new ServiceUnavailableError({ message: "Task state is unavailable", service: "task" })
      return new ConflictError({ message: "Task ownership or continuation is unavailable; reload the Session" })
    }),
  )
export const TaskHandler = HttpApiBuilder.group(Api, "server.task", (handlers) =>
  Effect.gen(function* () {
    const execution = yield* SessionExecution.Service
    const tasks = yield* SessionTaskControl.Service
    return handlers
      .handle("task.message.send", (ctx) =>
        Effect.gen(function* () {
          const delivery = yield* SessionTask.Service
          return yield* delivery.send(
            ctx.params.sessionID,
            ctx.params.taskID,
            ctx.payload,
            undefined,
            execution.control,
          )
        }).pipe(
          Effect.mapError((error) => {
            if (error instanceof SessionTaskStore.Failure && error.code === "missing")
              return new TaskNotFoundError({ message: error.message })
            if (error instanceof SessionTaskStore.Failure && error.code === "invalid")
              return new InvalidRequestError({ message: error.message })
            if (error instanceof SessionTaskStore.Failure && error.code === "denied")
              return new ForbiddenError({ message: error.message })
            if (error._tag === "PermissionV2.BlockedError" || error._tag === "PermissionV2.CorrectedError")
              return new ForbiddenError({ message: "Task message permission denied" })
            return new ConflictError({ message: "Task delivery is unavailable or ownership changed" })
          }),
        ),
      )
      .handle("task.message.get", (ctx) =>
        Effect.gen(function* () {
          const delivery = yield* SessionTask.Service
          return yield* boundary(delivery.message(ctx.params.sessionID, ctx.params.taskID, ctx.params.inputID))
        }),
      )
      .handle("task.list", (ctx) => boundary(tasks.list(ctx.params.sessionID, ctx.query.limit)))
      .handle("task.output", (ctx) => boundary(tasks.output(ctx.params.sessionID, ctx.params.taskID)))
      .handle("task.wait", (ctx) =>
        boundary(tasks.wait(ctx.params.sessionID, ctx.params.taskID, ctx.payload.timeoutMs ?? 30_000)),
      )
      .handle("task.cancel", (ctx) =>
        boundary(tasks.cancel(ctx.params.sessionID, ctx.params.taskID)).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      )
  }),
)

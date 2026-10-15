import { SessionProcessCompletion } from "@apexo/core/session/process-completion"
import { SessionProcessControl } from "@apexo/core/session/process-control"
import { SessionProcessStore } from "@apexo/core/session/process-store"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { ProcessNotFoundError } from "@apexo/protocol/groups/process"
import { ConflictError, ServiceUnavailableError } from "@apexo/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

const boundary = <A>(work: Effect.Effect<A, SessionProcessStore.Failure | SessionLifecycle.Closed>) =>
  work.pipe(
    Effect.mapError((error) => {
      if (error instanceof SessionLifecycle.Closed)
        return new ConflictError({ message: "Shell process ownership changed; reload the Session" })
      if (error.code === "missing")
        return new ProcessNotFoundError({ message: "Shell process not found in this Session" })
      if (error.code === "busy")
        return new ConflictError({
          message: "Shell process worker is still starting; retry cancellation after it is registered",
        })
      if (error.code === "storage")
        return new ServiceUnavailableError({ message: "Shell process state is unavailable", service: "process" })
      return new ConflictError({
        message: "Shell process ownership or continuation is unavailable; reload the Session",
      })
    }),
  )
export const ProcessHandler = HttpApiBuilder.group(Api, "server.process", (handlers) =>
  Effect.gen(function* () {
    const processes = yield* SessionProcessControl.Service
    const completions = yield* SessionProcessCompletion.Service
    return handlers
      .handle("process.list", (ctx) => boundary(processes.list(ctx.params.sessionID, ctx.query.limit)))
      .handle("process.output", (ctx) => boundary(processes.output(ctx.params.sessionID, ctx.params.processID)))
      .handle("process.wait", (ctx) =>
        boundary(processes.wait(ctx.params.sessionID, ctx.params.processID, ctx.payload.timeoutMs ?? 30_000)),
      )
      .handle("process.cancel", (ctx) =>
        boundary(
          processes
            .cancel(ctx.params.sessionID, ctx.params.processID)
            .pipe(Effect.andThen(completions.observed(ctx.params.sessionID, ctx.params.processID))),
        ).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      )
  }),
)

import { SessionScheduleStore } from "@apexo/core/session/schedule-store"
import { SessionScheduleRecord } from "@apexo/core/session/schedule-record"
import { SessionScheduleRuntime } from "@apexo/core/session/schedule"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionRunCoordinator } from "@apexo/core/session/run-coordinator"
import { ScheduleNotFoundError } from "@apexo/protocol/groups/schedule"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "@apexo/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

const boundary = <A, R>(
  work: Effect.Effect<
    A,
    SessionScheduleRecord.Failure | SessionLifecycle.Closed | SessionRunCoordinator.ControlCancelled,
    R
  >,
) =>
  work.pipe(
    Effect.mapError((error) => {
      if (error instanceof SessionLifecycle.Closed || error instanceof SessionRunCoordinator.ControlCancelled)
        return new ConflictError({ message: "Schedule owner stopped or changed; refresh before retrying" })
      if (error.code === "missing") return new ScheduleNotFoundError({ message: "Schedule not found in this Session" })
      if (error.code === "storage")
        return new ServiceUnavailableError({ message: "Schedule state is unavailable", service: "schedule" })
      if (error.code === "invalid" || error.code === "denied")
        return new InvalidRequestError({ message: error.message })
      return new ConflictError({ message: error.message })
    }),
  )
export const ScheduleHandler = HttpApiBuilder.group(Api, "server.schedule", (handlers) =>
  Effect.gen(function* () {
    const store = yield* SessionScheduleStore.Service
    const lifecycle = yield* SessionLifecycle.Service
    const execution = yield* SessionExecution.Service
    return handlers
      .handle("schedule.list", ({ params }) =>
        boundary(
          lifecycle.read(
            params.sessionID,
            Effect.gen(function* () {
              const values = yield* store.list(params.sessionID)
              return yield* Effect.forEach(
                values.filter((value) => ["active", "paused"].includes(store.state(value, Date.now()).status)),
                (value) => store.detail(params.sessionID, value.id),
              )
            }),
          ),
        ),
      )
      .handle("schedule.get", ({ params }) =>
        boundary(lifecycle.read(params.sessionID, store.detail(params.sessionID, params.scheduleID))),
      )
      .handle("schedule.delete", ({ params }) =>
        boundary(
          lifecycle.run(
            params.sessionID,
            Effect.gen(function* () {
              yield* store.remove(params.sessionID, params.scheduleID)
              const runtime = yield* SessionScheduleRuntime.Service
              yield* runtime.signal(params.sessionID)
              return HttpApiSchema.NoContent.make()
            }),
          ),
        ),
      )
      .handle("schedule.pause", ({ params }) =>
        boundary(
          lifecycle.run(
            params.sessionID,
            Effect.gen(function* () {
              yield* store.pause(params.sessionID, params.scheduleID)
              const runtime = yield* SessionScheduleRuntime.Service
              yield* runtime.signal(params.sessionID)
              return yield* store.detail(params.sessionID, params.scheduleID)
            }),
          ),
        ),
      )
      .handle("schedule.resume", ({ params }) =>
        boundary(
          Effect.gen(function* () {
            const runtime = yield* SessionScheduleRuntime.Service
            yield* execution.control(params.sessionID, runtime.resume(params.sessionID, params.scheduleID))
            return yield* store.detail(params.sessionID, params.scheduleID)
          }),
        ),
      )
  }),
)

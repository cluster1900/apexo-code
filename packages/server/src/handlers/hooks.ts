import { HookPreferences } from "@apexo/core/hook-preferences"
import { HookSnapshotLocation } from "@apexo/core/hook-snapshot-location"
import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionRunCoordinator } from "@apexo/core/session/run-coordinator"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "@apexo/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const HooksHandler = HttpApiBuilder.group(Api, "server.hooks", (handlers) =>
  Effect.gen(function* () {
    const execution = yield* SessionExecution.Service
    return handlers
      .handle("hooks.get", ({ params }) =>
        Effect.gen(function* () {
          const snapshots = yield* HookSnapshotLocation.Service
          return yield* snapshots
            .inspect(params.sessionID)
            .pipe(
              Effect.mapError(() => new ServiceUnavailableError({ message: "Hook snapshot could not be inspected" })),
            )
        }),
      )
      .handle("hooks.reload", ({ params }) =>
        Effect.gen(function* () {
          const snapshots = yield* HookSnapshotLocation.Service
          return yield* execution
            .control(
              params.sessionID,
              snapshots.reload(params.sessionID).pipe(Effect.andThen(snapshots.inspect(params.sessionID))),
            )
            .pipe(
              Effect.mapError((error) => {
                if (error instanceof SessionRunCoordinator.ControlCancelled)
                  return new ConflictError({ message: "The Session stopped before hooks could reload" })
                if (error instanceof SessionHookSnapshot.Failure && error.code === "missing")
                  return new ConflictError({ message: "Hooks are captured when this Session first executes" })
                return new ServiceUnavailableError({ message: "Hook configuration could not reload" })
              }),
            )
        }),
      )
      .handle("hooks.trust", ({ params, payload }) =>
        Effect.gen(function* () {
          const snapshots = yield* HookSnapshotLocation.Service
          return yield* snapshots.trust(params.sessionID, payload).pipe(
            Effect.andThen(snapshots.inspect(params.sessionID)),
            Effect.mapError(
              () =>
                new ConflictError({
                  message: "Repository Hook trust changed or is unavailable; refresh before retrying",
                }),
            ),
          )
        }),
      )
      .handle("hooks.preference", ({ params, payload }) =>
        Effect.gen(function* () {
          const snapshots = yield* HookSnapshotLocation.Service
          return yield* snapshots.preference(params.sessionID, payload.hookID, payload.enabled).pipe(
            Effect.andThen(snapshots.inspect(params.sessionID)),
            Effect.mapError((error) => {
              if (error instanceof SessionHookSnapshot.Failure) {
                if (error.code === "missing_hook" || error.code === "read_only")
                  return new InvalidRequestError({ message: "This captured Hook cannot be configured" })
                if (error.code === "missing")
                  return new ConflictError({ message: "Hooks are captured when this Session first executes" })
                if (["closed", "released", "owner_closed", "owner_conflict"].includes(error.code))
                  return new ConflictError({ message: "The Session's captured Hooks are no longer available" })
              }
              if (error instanceof HookPreferences.Failure && error.code === "conflict")
                return new ConflictError({ message: "Saved Hook choices changed; refresh before retrying" })
              return new ServiceUnavailableError({ message: "Hook choices could not be saved" })
            }),
          )
        }),
      )
  }),
)

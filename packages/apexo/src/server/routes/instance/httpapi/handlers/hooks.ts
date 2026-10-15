import { SessionID } from "@apexo/schema/session-id"
import { CompatHookSnapshotLocation } from "@/plugin/hook-snapshot-location"
import { Session } from "@/session/session"
import { SessionRunState } from "@/session/run-state"
import { InstanceState } from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, notFound } from "../errors"

export const hooksHandlers = HttpApiBuilder.group(InstanceHttpApi, "hooks", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snapshots = yield* CompatHookSnapshotLocation.Service
    const runs = yield* SessionRunState.Service
    const authorize = (id: SessionID) =>
      Effect.gen(function* () {
        const session = yield* sessions.get(id).pipe(Effect.mapError(() => notFound("Session not found")))
        if (session.directory !== (yield* InstanceState.directory)) return yield* notFound("Session not found")
      })
    return handlers
      .handle("get", ({ params }) =>
        authorize(params.sessionID).pipe(
          Effect.andThen(snapshots.inspect(params.sessionID)),
          Effect.catchTag("HookSnapshotFailure", () =>
            Effect.fail(
              new ServiceUnavailableError({ message: "Hook snapshot could not be inspected", service: "hooks" }),
            ),
          ),
        ),
      )
      .handle("reload", ({ params }) =>
        authorize(params.sessionID).pipe(
          Effect.andThen(
            runs.control(
              params.sessionID,
              snapshots.reload(params.sessionID).pipe(Effect.andThen(snapshots.inspect(params.sessionID))),
            ),
          ),
          Effect.catchTag("RunnerCancelled", () =>
            Effect.fail(new ConflictError({ message: "The Session stopped before hooks could reload" })),
          ),
          Effect.catchTag("HookSnapshotFailure", (error) =>
            Effect.fail(
              error.code === "missing"
                ? new ConflictError({ message: "Hooks are captured when this Session first executes" })
                : new ServiceUnavailableError({ message: "Hook configuration could not reload", service: "hooks" }),
            ),
          ),
        ),
      )
      .handle("trust", ({ params, payload }) =>
        authorize(params.sessionID).pipe(
          Effect.andThen(snapshots.trust(params.sessionID, payload)),
          Effect.andThen(snapshots.inspect(params.sessionID)),
          Effect.catchTag("HookSnapshotFailure", () =>
            Effect.fail(
              new ConflictError({
                message: "Repository Hook trust changed or is unavailable; refresh before retrying",
              }),
            ),
          ),
        ),
      )
      .handle("preference", ({ params, payload }) =>
        authorize(params.sessionID).pipe(
          Effect.andThen(snapshots.preference(params.sessionID, payload.hookID, payload.enabled)),
          Effect.andThen(snapshots.inspect(params.sessionID)),
          Effect.catchTag("HookSnapshotFailure", (error) =>
            Effect.fail(
              error.code === "missing_hook" || error.code === "read_only"
                ? new InvalidRequestError({ message: "This captured Hook cannot be configured" })
                : new ConflictError({
                    message: "The Session's captured Hooks are unavailable; refresh before retrying",
                  }),
            ),
          ),
          Effect.catchTag("HookPreferences.Failure", (error) =>
            Effect.fail(
              error.code === "conflict"
                ? new ConflictError({ message: "Saved Hook choices changed; refresh before retrying" })
                : new ServiceUnavailableError({ message: "Hook choices could not be saved", service: "hooks" }),
            ),
          ),
        ),
      )
  }),
)

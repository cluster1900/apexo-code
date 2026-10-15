import { Database } from "@apexo/core/database/database"
import { LocationServiceMap } from "@apexo/core/location-services"
import { Location } from "@apexo/core/location"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionTable } from "@apexo/core/session/sql"
import { WorkspaceV2 } from "@apexo/core/workspace"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError, SessionNotFoundError } from "@apexo/protocol/errors"
import type { LocationServices } from "../location"

export class SessionLocationMiddleware extends HttpApiMiddleware.Service<
  SessionLocationMiddleware,
  { provides: LocationServices }
>()("@apexo/HttpApiSessionLocation", {
  error: [InvalidRequestError, SessionNotFoundError],
}) {}

const decodeSessionID = Schema.decodeUnknownEffect(SessionV2.ID)

export const sessionLocationLayer = Layer.effect(
  SessionLocationMiddleware,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const locations = yield* LocationServiceMap.Service
    const lifecycle = yield* SessionLifecycle.Service

    return SessionLocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const route = yield* HttpRouter.RouteContext
        const sessionID = yield* decodeSessionID(route.params.sessionID).pipe(
          Effect.mapError(
            () =>
              new InvalidRequestError({
                message: "Invalid session ID",
                field: "sessionID",
              }),
          ),
        )
        return yield* lifecycle
          .read(
            sessionID,
            Effect.gen(function* () {
              const row = yield* db
                .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
                .from(SessionTable)
                .where(eq(SessionTable.id, sessionID))
                .get()
                .pipe(Effect.orDie)
              if (!row)
                return yield* new SessionNotFoundError({
                  sessionID,
                  message: `Session not found: ${sessionID}`,
                })

              return yield* effect.pipe(
                Effect.provide(
                  locations.get(
                    Location.Ref.make({
                      directory: AbsolutePath.make(row.directory),
                      workspaceID: row.workspaceID ? WorkspaceV2.ID.make(row.workspaceID) : undefined,
                    }),
                  ),
                ),
              )
            }),
          )
          .pipe(
            Effect.catchTag("SessionLifecycle.Closed", () =>
              Effect.fail(new SessionNotFoundError({ sessionID, message: `Session not found: ${sessionID}` })),
            ),
          )
      }),
    )
  }),
)

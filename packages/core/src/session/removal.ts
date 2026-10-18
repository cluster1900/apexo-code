export * as SessionRemoval from "./removal"

import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { GoalCleanupTable } from "../goal/sql"
import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import { SessionV1 } from "../v1/session"
import { SessionLifecycle } from "./lifecycle"
import { SessionGoal } from "./goal"
import { SessionGoalCleanup } from "./goal-cleanup"
import { SessionHookSnapshot } from "./hook-snapshot"
import { SessionSchema } from "./schema"
import { SessionTable } from "./sql"
import { SessionStore } from "./store"

const make = Effect.gen(function* () {
  const lifecycle = yield* SessionLifecycle.Service
  const database = yield* Database.Service
  const events = yield* EventV2.Service
  const goals = yield* SessionGoal.Service
  const cleanup = yield* SessionGoalCleanup.Service
  const snapshots = yield* SessionHookSnapshot.Service
  const store = yield* SessionStore.Service
  const remove = (
    sessionID: SessionSchema.ID,
    ancestors: ReadonlySet<SessionSchema.ID>,
    expected?: SessionLifecycle.Claim,
  ): Effect.Effect<void, SessionLifecycle.Failure> => {
    if (ancestors.has(sessionID))
      return Effect.fail(new SessionLifecycle.Failure({ sessionID, message: "Session tree contains a cycle" }))
    return lifecycle.retire(
      sessionID,
      Effect.gen(function* () {
        // Lifecycle has drained admitted writes and joined native/compatibility owners before entering here.
        const row = yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get()
        if (row) {
          const goal = yield* goals
            .get(sessionID)
            .pipe(
              Effect.catchTag("GoalStorageError", (error) =>
                Effect.logWarning("Cannot decode deleted Session's Goal", { sessionID, error }).pipe(
                  Effect.as(undefined),
                ),
              ),
            )
          if (goal) yield* goals.pause({ sessionID, goalID: goal.id }, "user_paused", "Session deleted")
          yield* cleanup.prepareSession(sessionID)
          const children = yield* database.db
            .select({ id: SessionTable.id })
            .from(SessionTable)
            .where(eq(SessionTable.parent_id, sessionID))
            .all()
          for (const child of children) {
            const claim = yield* lifecycle
              .capture(child.id)
              .pipe(Effect.catchTag("SessionLifecycle.Closed", () => lifecycle.find(child.id)))
            if (!claim) continue
            const current = yield* database.db
              .select({ parent: SessionTable.parent_id })
              .from(SessionTable)
              .where(eq(SessionTable.id, child.id))
              .get()
            if (current?.parent !== sessionID) continue
            yield* remove(child.id, new Set(ancestors).add(sessionID), claim)
          }
          const session = yield* store.get(sessionID)
          if (!session) return yield* Effect.die("Session disappeared outside its deletion owner")
          yield* events.publish(
            SessionV1.Event.Deleted,
            {
              sessionID,
              info: SessionV1.SessionInfo.make({
                id: sessionID,
                slug: row.slug,
                projectID: row.project_id,
                directory: row.directory,
                path: row.path ?? undefined,
                workspaceID: row.workspace_id ?? undefined,
                parentID: row.parent_id ?? undefined,
                title: row.title,
                version: row.version,
                agent: row.agent ?? undefined,
                model: row.model
                  ? {
                      id: ModelV2.ID.make(row.model.id),
                      providerID: ProviderV2.ID.make(row.model.providerID),
                      variant: row.model.variant,
                    }
                  : undefined,
                cost: row.cost,
                tokens: {
                  input: row.tokens_input,
                  output: row.tokens_output,
                  reasoning: row.tokens_reasoning,
                  cache: { read: row.tokens_cache_read, write: row.tokens_cache_write },
                },
                time: {
                  created: row.time_created,
                  updated: row.time_updated,
                  archived: row.time_archived ?? undefined,
                },
              }),
            },
            { location: session.location },
          )
        }
        // Also finish a prior partially completed deletion whose projected row is already absent.
        yield* events.remove(sessionID)
        yield* snapshots.invalidate(sessionID)
        yield* cleanup.drain(sessionID)
        const pending = yield* database.db
          .select({ id: GoalCleanupTable.id })
          .from(GoalCleanupTable)
          .where(and(eq(GoalCleanupTable.session_id, sessionID), eq(GoalCleanupTable.reason, "session_deleted")))
          .get()
        // The Session is already gone. Report cleanup that cannot finish now (a live teardown barrier, a
        // substituted directory, a locked file) stays as a durable job that the background drain retries;
        // failing here would return a 500 for a deletion that already happened.
        if (pending)
          yield* Effect.logWarning("Session deleted; Goal report cleanup will retry", { sessionID, jobID: pending.id })
      }),
      expected,
    )
  }
  return { remove: (sessionID: SessionSchema.ID) => remove(sessionID, new Set()) }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/SessionRemoval") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    SessionLifecycle.node,
    Database.node,
    EventV2.node,
    SessionGoal.node,
    SessionGoalCleanup.node,
    SessionHookSnapshot.node,
    SessionStore.node,
  ],
})

export * as SessionExecutionStore from "./execution-store"

import { randomUUID } from "node:crypto"
import { and, eq, ne } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionSchema } from "./schema"
import { SessionExecutionTable } from "./execution-store.sql"

export type Lease = {
  readonly sessionID: SessionSchema.ID
  readonly ownerID: string
  readonly generation: number
  readonly attemptID: string
}

export class Failure extends Schema.TaggedErrorClass<Failure>()("SessionExecutionStore.Failure", {
  code: Schema.Literals(["missing", "stale", "storage"]),
  message: Schema.String,
}) {}

export interface Interface {
  readonly claim: (sessionID: SessionSchema.ID) => Effect.Effect<Lease, Failure>
  readonly assert: (lease: Lease) => Effect.Effect<void, Failure>
  readonly finish: (lease: Lease, status: "completed" | "failed" | "interrupted", error?: string) => Effect.Effect<void>
  readonly interruptStale: (sessionID: SessionSchema.ID) => Effect.Effect<boolean, Failure>
  readonly recoverable: Effect.Effect<ReadonlyArray<SessionSchema.ID>, Failure>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/v2/SessionExecutionStore") {}

/** Provider-turn assertion installed by the local execution owner. */
export const Current = Context.Reference<Effect.Effect<void, Failure>>("@apexo/v2/SessionExecutionOwner", {
  defaultValue: () => Effect.void,
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const ownerID = randomUUID()
    const storage = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.mapError(
          (error) =>
            (error instanceof Failure
              ? error
              : new Failure({ code: "storage", message: "Session execution state is unavailable" })) as Failure,
        ),
      )
    const read = (sessionID: SessionSchema.ID) =>
      storage(
        database.db.select().from(SessionExecutionTable).where(eq(SessionExecutionTable.session_id, sessionID)).get(),
      )
    const claim: Interface["claim"] = (sessionID) =>
      storage(
        database.db.transaction(
          () =>
            Effect.gen(function* () {
              const now = Date.now()
              const previous = yield* read(sessionID)
              const generation = (previous?.generation ?? 0) + 1
              const lease = {
                sessionID,
                ownerID,
                generation,
                attemptID: randomUUID(),
              }
              const values = {
                session_id: sessionID,
                owner_id: ownerID,
                generation,
                status: "running",
                attempt_id: lease.attemptID,
                started_at: now,
                heartbeat_at: now,
                ended_at: null,
                error: null,
              }
              yield* database.db
                .insert(SessionExecutionTable)
                .values(values)
                .onConflictDoUpdate({ target: SessionExecutionTable.session_id, set: values })
              return lease
            }),
          { behavior: "immediate" },
        ),
      )
    const assert: Interface["assert"] = (lease) =>
      storage(
        Effect.gen(function* () {
          const current = yield* database.db
            .update(SessionExecutionTable)
            .set({ heartbeat_at: Date.now() })
            .where(
              and(
                eq(SessionExecutionTable.session_id, lease.sessionID),
                eq(SessionExecutionTable.owner_id, lease.ownerID),
                eq(SessionExecutionTable.generation, lease.generation),
                eq(SessionExecutionTable.attempt_id, lease.attemptID),
                eq(SessionExecutionTable.status, "running"),
              ),
            )
            .returning({ sessionID: SessionExecutionTable.session_id })
            .get()
          if (!current)
            return yield* new Failure({ code: "stale", message: "Session execution owner is no longer current" })
        }),
      )
    const finish: Interface["finish"] = (lease, status, error) =>
      database.db
        .update(SessionExecutionTable)
        .set({ status, ended_at: Date.now(), error: error ?? null, heartbeat_at: Date.now() })
        .where(
          and(
            eq(SessionExecutionTable.session_id, lease.sessionID),
            eq(SessionExecutionTable.owner_id, lease.ownerID),
            eq(SessionExecutionTable.generation, lease.generation),
            eq(SessionExecutionTable.attempt_id, lease.attemptID),
            eq(SessionExecutionTable.status, "running"),
          ),
        )
        .run()
        .pipe(Effect.orDie, Effect.asVoid)
    const interruptStale: Interface["interruptStale"] = (sessionID) =>
      storage(
        Effect.gen(function* () {
          const now = Date.now()
          const updated = yield* database.db
            .update(SessionExecutionTable)
            .set({ status: "interrupted", ended_at: now, heartbeat_at: now })
            .where(
              and(
                eq(SessionExecutionTable.session_id, sessionID),
                ne(SessionExecutionTable.owner_id, ownerID),
                eq(SessionExecutionTable.status, "running"),
              ),
            )
            .returning({ sessionID: SessionExecutionTable.session_id })
            .get()
          return Boolean(updated)
        }),
      )
    const recoverable: Interface["recoverable"] = storage(
      database.db
        .select({ sessionID: SessionExecutionTable.session_id })
        .from(SessionExecutionTable)
        .where(eq(SessionExecutionTable.status, "running"))
        .all(),
    ).pipe(Effect.map((rows) => rows.map((row) => row.sessionID)))
    return Service.of({ claim, assert, finish, interruptStale, recoverable })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })

export * as SessionIncarnation from "./incarnation"

import { and, asc, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { EventTable } from "../event/sql"
import { SessionV1 } from "../v1/session"
import { SessionSchema } from "./schema"

/** The durable creation identity survives compaction and is removed with the Session aggregate. */
export const created = (db: Database.Interface["db"], sessionID: SessionSchema.ID) =>
  db
    .select({ id: EventTable.id })
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, sessionID),
        eq(
          EventTable.type,
          EventV2.versionedType(SessionV1.Event.Created.type, SessionV1.Event.Created.durable!.version),
        ),
      ),
    )
    .orderBy(asc(EventTable.seq))
    .get()
    .pipe(Effect.map((row) => row?.id))

export const createdInfo = (db: Database.Interface["db"], sessionID: SessionSchema.ID) =>
  db
    .select({ id: EventTable.id, data: EventTable.data })
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, sessionID),
        eq(
          EventTable.type,
          EventV2.versionedType(SessionV1.Event.Created.type, SessionV1.Event.Created.durable!.version),
        ),
      ),
    )
    .orderBy(asc(EventTable.seq))
    .get()
    .pipe(
      Effect.flatMap((row) =>
        row
          ? Schema.decodeUnknownEffect(SessionV1.Event.Created.data)(row.data).pipe(
              Effect.map((decoded) => ({ id: row.id, info: decoded.info })),
            )
          : Effect.succeed(undefined),
      ),
    )

export * as SessionHistoryCopy from "./history-copy"

import { and, asc, eq, inArray } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { AgentV2 } from "../agent"
import type { Database } from "../database/database"
import { EventV2 } from "../event"
import { EventTable } from "../event/sql"
import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import { SessionEvent } from "./event"
import { SessionIncarnation } from "./incarnation"
import { SessionMessage } from "./message"
import { SessionRevert } from "./revert"
import { SessionSchema } from "./schema"
import {
  MessageTable,
  SessionContextEpochTable,
  SessionInputTable,
  SessionMessageTable,
  TodoTable,
} from "./sql"
import { SessionTodo } from "@apexo/schema/session-todo"

type DB = Database.Interface["db"]

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SessionHistoryCopy.Conflict", {
  message: Schema.String,
}) {}

export interface Snapshot {
  readonly source: SessionEvent.HistoryCopy.Source
  readonly messages: ReadonlyArray<SessionMessage.Message>
  readonly todos: ReadonlyArray<SessionTodo.Info>
  readonly importedTodos?: ReadonlyArray<SessionTodo.Info>
  readonly initialAgent?: AgentV2.ID
  readonly initialModel?: ModelV2.Ref
}

const recover = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.catchDefect((error) => (error instanceof Conflict ? Effect.fail(error) : Effect.die(error))))

const recoverFork = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchDefect((error) =>
      error instanceof Conflict || error instanceof SessionRevert.MessageNotFoundError
        ? Effect.fail(error)
        : Effect.die(error),
    ),
  )

const todos = (db: DB, sessionID: SessionSchema.ID) =>
  db
    .select({
      content: TodoTable.content,
      status: TodoTable.status,
      priority: TodoTable.priority,
    })
    .from(TodoTable)
    .where(eq(TodoTable.session_id, sessionID))
    .orderBy(asc(TodoTable.position))
    .all()
    .pipe(Effect.orDie)

/** The caller owns admission and must prove source ownership and quiescence. */
export const capture = Effect.fn("SessionHistoryCopy.capture")(function* (db: DB, sessionID: SessionSchema.ID) {
  return yield* recover(
    db
      .transaction(
        () =>
          Effect.gen(function* () {
            const created = yield* SessionIncarnation.created(db, sessionID)
            if (!created) return yield* new Conflict({ message: "History source no longer exists" })
            yield* assertReady(db, sessionID)
            const rows = yield* db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.session_id, sessionID))
              .orderBy(asc(SessionMessageTable.seq))
              .all()
            if (!rows.length) return yield* new Conflict({ message: "History source has no durable transcript" })
            return {
              source: { sessionID, created, revision: yield* EventV2.latestSequence(db, sessionID) },
              messages: yield* Effect.forEach(rows, (row) =>
                Schema.decodeUnknownEffect(SessionMessage.Message)({ ...row.data, id: row.id, type: row.type }),
              ),
              todos: yield* todos(db, sessionID),
            } satisfies Snapshot
          }),
        { behavior: "immediate" },
      )
      .pipe(Effect.orDie),
  )
})

export const captureForFork = Effect.fn("SessionHistoryCopy.captureForFork")(function* (
  db: DB,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly messageID?: SessionMessage.ID
    readonly revertMessageID?: string
  },
) {
  return yield* recoverFork(
    db
      .transaction(
        () =>
          Effect.gen(function* () {
            const created = yield* SessionIncarnation.createdInfo(db, input.sessionID)
            if (!created) return yield* new Conflict({ message: "History source no longer exists" })
            yield* assertReady(db, input.sessionID)
            const rows = yield* db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.session_id, input.sessionID))
              .orderBy(asc(SessionMessageTable.seq))
              .all()
            if (!rows.length) {
              const legacyRow = yield* db
                .select({ id: MessageTable.id })
                .from(MessageTable)
                .where(eq(MessageTable.session_id, input.sessionID))
                .get()
              if (legacyRow) return yield* new Conflict({ message: "History source uses legacy transcript storage" })
            }
            const allMessages = yield* Effect.forEach(rows, (row) =>
              Schema.decodeUnknownEffect(SessionMessage.Message)({ ...row.data, id: row.id, type: row.type }),
            )
            const revertIndex = input.revertMessageID
              ? allMessages.findIndex((message) => message.id === input.revertMessageID)
              : -1
            const activeMessages = revertIndex >= 0 ? allMessages.slice(0, revertIndex) : allMessages
            const targetIndex = input.messageID
              ? activeMessages.findIndex((message) => message.id === input.messageID)
              : -1
            if (input.messageID && targetIndex < 0)
              return yield* new SessionRevert.MessageNotFoundError({
                sessionID: input.sessionID,
                messageID: input.messageID,
              })
            const slicedMessages = input.messageID ? activeMessages.slice(0, targetIndex) : activeMessages
            const truncated = input.messageID !== undefined || revertIndex >= 0
            const sourceTodos = yield* todos(db, input.sessionID)
            const firstAgentRecord = allMessages.find(
              (message): message is SessionMessage.AgentSwitched | SessionMessage.Assistant =>
                message.type === "agent-switched" || message.type === "assistant",
            )
            const firstModelRecord = allMessages.find(
              (message): message is SessionMessage.ModelSwitched | SessionMessage.Assistant =>
                message.type === "model-switched" || message.type === "assistant",
            )
            const initialAgent = created.info.agent
              ? AgentV2.ID.make(created.info.agent)
              : firstAgentRecord?.type === "assistant"
                ? AgentV2.ID.make(firstAgentRecord.agent)
                : undefined
            const initialModel = created.info.model
              ? ModelV2.Ref.make({
                  id: ModelV2.ID.make(created.info.model.id),
                  providerID: ProviderV2.ID.make(created.info.model.providerID),
                  variant: created.info.model.variant ? ModelV2.VariantID.make(created.info.model.variant) : undefined,
                })
              : firstModelRecord?.type === "assistant"
                ? firstModelRecord.model
                : undefined
            return {
              source: {
                sessionID: input.sessionID,
                created: created.id,
                revision: yield* EventV2.latestSequence(db, input.sessionID),
              },
              messages: slicedMessages,
              todos: sourceTodos,
              importedTodos: truncated ? [] : sourceTodos,
              initialAgent,
              initialModel,
            } satisfies Snapshot
          }),
        { behavior: "immediate" },
      )
      .pipe(Effect.orDie),
  )
})

export const verify = Effect.fn("SessionHistoryCopy.verify")(function* (db: DB, snapshot: Snapshot) {
  if (
    snapshot.source.created !== (yield* SessionIncarnation.created(db, snapshot.source.sessionID).pipe(Effect.orDie)) ||
    snapshot.source.revision !== (yield* EventV2.latestSequence(db, snapshot.source.sessionID)) ||
    JSON.stringify(snapshot.todos) !== JSON.stringify(yield* todos(db, snapshot.source.sessionID))
  )
    return yield* new Conflict({ message: "History source changed after selection" })
})

/** A partially committed copy is quarantined even if its transcript looks complete. */
export const assertReady = Effect.fn("SessionHistoryCopy.assertReady")(function* (
  db: DB,
  sessionID: SessionSchema.ID,
  expectedSource?: SessionEvent.HistoryCopy.Source,
) {
  const rows = yield* boundaries(db, sessionID)
  if (!rows.length) {
    if (expectedSource)
      return yield* new Conflict({ message: "Expected Session history import is missing; start a new child" })
    return
  }
  if (
    rows.length !== 2 ||
    rows[0].type !== EventV2.versionedType(SessionEvent.HistoryCopy.Started.type, 1) ||
    rows[1].type !== EventV2.versionedType(SessionEvent.HistoryCopy.Completed.type, 1)
  )
    return yield* new Conflict({ message: "Session history import is incomplete; start a new child" })
  const started = yield* Schema.decodeUnknownEffect(SessionEvent.HistoryCopy.Started.data)(rows[0].data).pipe(
    Effect.orDie,
  )
  const completed = yield* Schema.decodeUnknownEffect(SessionEvent.HistoryCopy.Completed.data)(rows[1].data).pipe(
    Effect.orDie,
  )
  if (
    (expectedSource !== undefined && JSON.stringify(completed.source) !== JSON.stringify(expectedSource)) ||
    JSON.stringify(started.source) !== JSON.stringify(completed.source) ||
    started.count !== completed.count ||
    rows[1].seq !== rows[0].seq + started.count + 1
  )
    return yield* new Conflict({ message: "Session history import has inconsistent completion evidence" })
})

/** Import into a fresh owned child before attaching its execution role or admitting a prompt. */
export const copy = Effect.fn("SessionHistoryCopy.copy")(function* (
  db: DB,
  events: EventV2.Interface,
  snapshot: Snapshot,
  sessionID: SessionSchema.ID,
) {
  if (sessionID === snapshot.source.sessionID)
    return yield* new Conflict({ message: "History copy requires a fresh Session" })
  yield* verify(db, snapshot)
  const previous = yield* boundaries(db, sessionID)
  if (previous.length) {
    yield* assertReady(db, sessionID)
    const completed = yield* Schema.decodeUnknownEffect(SessionEvent.HistoryCopy.Completed.data)(previous[1].data).pipe(
      Effect.orDie,
    )
    if (JSON.stringify(completed.source) !== JSON.stringify(snapshot.source))
      return yield* new Conflict({ message: "Session already imported different history" })
    return
  }
  const created = yield* SessionIncarnation.created(db, sessionID).pipe(Effect.orDie)
  if (!created) return yield* new Conflict({ message: "History target no longer exists" })
  const initial = yield* EventV2.latestSequence(db, sessionID)
  const timestamp = yield* DateTime.now
  const check = (expected: number) =>
    Effect.gen(function* () {
      yield* verify(db, snapshot)
      if (
        created !== (yield* SessionIncarnation.created(db, sessionID)) ||
        expected !== (yield* EventV2.latestSequence(db, sessionID)) ||
        (yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.session_id, sessionID)).get()) ||
        (yield* db
          .select()
          .from(SessionContextEpochTable)
          .where(eq(SessionContextEpochTable.session_id, sessionID))
          .get())
      )
        return yield* new Conflict({ message: "History target changed during import" })
    }).pipe(Effect.orDie)
  yield* recover(
    events.publish(
      SessionEvent.HistoryCopy.Started,
      {
        sessionID,
        timestamp,
        source: snapshot.source,
        count: snapshot.messages.length,
      },
      {
        commit: () =>
          Effect.gen(function* () {
            yield* check(initial)
            if (
              yield* db
                .select()
                .from(SessionMessageTable)
                .where(eq(SessionMessageTable.session_id, sessionID))
                .get()
                .pipe(Effect.orDie)
            )
              return yield* Effect.die(new Conflict({ message: "History target already has a transcript" }))
          }),
      },
    ),
  )
  for (const [index, message] of snapshot.messages.entries()) {
    const id = SessionMessage.ID.create()
    yield* recover(
      events.publish(
        SessionEvent.HistoryCopy.Message,
        {
          sessionID,
          timestamp,
          source: snapshot.source,
          sourceMessageID: message.id,
          message: message.type === "synthetic" ? { ...message, id, sessionID } : { ...message, id },
        },
        { commit: () => check(initial + index + 1) },
      ),
    )
  }
  yield* recover(
    events.publish(
      SessionEvent.HistoryCopy.Completed,
      {
        sessionID,
        timestamp,
        source: snapshot.source,
        count: snapshot.messages.length,
        todos: snapshot.importedTodos ?? snapshot.todos,
      },
      { commit: () => check(initial + snapshot.messages.length + 1) },
    ),
  )
})

const boundaries = (db: DB, sessionID: SessionSchema.ID) =>
  db
    .select()
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, sessionID),
        inArray(
          EventTable.type,
          [SessionEvent.HistoryCopy.Started, SessionEvent.HistoryCopy.Completed].map((event) =>
            EventV2.versionedType(event.type, 1),
          ),
        ),
      ),
    )
    .orderBy(asc(EventTable.seq))
    .all()
    .pipe(Effect.orDie)

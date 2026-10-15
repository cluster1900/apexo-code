import { expect } from "bun:test"
import { and, eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@apexo/core/database/database"
import { EventV2 } from "@apexo/core/event"
import { EventSequenceTable, EventTable } from "@apexo/core/event/sql"
import { MemoryCaptureSource } from "@apexo/core/memory-capture-source"
import { MemoryTranscript } from "@apexo/core/memory-transcript"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { SessionSchema } from "@apexo/core/session/schema"
import { MessageID, PartID, SessionV1 } from "@apexo/core/v1/session"
import { testEffect } from "../lib/effect"

const it = testEffect(Database.layerFromPath(":memory:"))
function history(sessionID: SessionSchema.ID): SessionV1.WithParts[] {
  const id = MessageID.ascending()
  const reply = MessageID.ascending()
  return [
    {
      info: {
        id,
        sessionID,
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
      },
      parts: [
        { id: PartID.ascending(), messageID: id, sessionID, type: "text", text: "Persist this completed request" },
      ],
    },
    {
      info: {
        id: reply,
        sessionID,
        role: "assistant",
        parentID: id,
        agent: "build",
        mode: "build",
        path: { cwd: "/tmp", root: "/tmp" },
        time: { created: 2, completed: 3 },
        modelID: ModelV2.ID.make("test"),
        providerID: ProviderV2.ID.make("test"),
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
      },
      parts: [
        { id: PartID.ascending(), messageID: reply, sessionID, type: "text", text: "Original assistant snapshot" },
      ],
    },
  ]
}

it.live("durable capture proof survives compacted history but rejects deletion and same-ID recreation", () =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const sources = MemoryCaptureSource.make(database.db)
    const sessionID = SessionSchema.ID.create()
    const createdID = EventV2.ID.create()
    yield* database.db.insert(EventSequenceTable).values({ aggregate_id: sessionID, seq: 1 }).run()
    yield* database.db
      .insert(EventTable)
      .values({
        id: createdID,
        aggregate_id: sessionID,
        seq: 1,
        type: EventV2.versionedType(SessionV1.Event.Created.type, SessionV1.Event.Created.durable!.version),
        data: {},
      })
      .run()
    const source = MemoryTranscript.decode(
      MemoryTranscript.turns(history(sessionID), false, yield* sources.stamp(sessionID))[0]!.source,
    )
    expect(source.createdEventID).toBe(createdID)
    const legacy = MemoryTranscript.decode(MemoryTranscript.turns(history(sessionID))[0]!.source)
    expect(
      yield* sources.validate(
        sessionID,
        legacy,
        Effect.die("verified legacy proof must survive compaction"),
        createdID,
      ),
    ).toBe(true)
    // Compaction may no longer project any original turn. The persisted creation proof remains authoritative.
    expect(yield* sources.validate(sessionID, source, Effect.die("must not require compacted transcript"))).toBe(true)
    yield* database.db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, sessionID)).run()
    expect(yield* sources.validate(sessionID, source, Effect.succeed(true))).toBe(false)
    yield* database.db.insert(EventSequenceTable).values({ aggregate_id: sessionID, seq: 1 }).run()
    yield* database.db
      .insert(EventTable)
      .values({
        id: EventV2.ID.create(),
        aggregate_id: sessionID,
        seq: 1,
        type: EventV2.versionedType(SessionV1.Event.Created.type, SessionV1.Event.Created.durable!.version),
        data: {},
      })
      .run()
    expect(yield* sources.validate(sessionID, source, Effect.succeed(true))).toBe(false)
    expect(yield* sources.validate(SessionSchema.ID.create(), source, Effect.succeed(true))).toBe(false)
  }),
)

it.live(
  "legacy capture proof compares the complete snapshot, including assistant content under reused user identity",
  () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const sources = MemoryCaptureSource.make(database.db)
      const sessionID = SessionSchema.ID.create()
      const messages = history(sessionID)
      const encoded = MemoryTranscript.turns(messages)[0]!.source
      const source = MemoryTranscript.decode(encoded)
      const matches = () =>
        Effect.sync(() => MemoryTranscript.turns(messages, true).some((turn) => turn.source === encoded))
      expect(yield* sources.validate(sessionID, source, matches())).toBe(true)
      const part = messages[1]!.parts[0]!
      if (part.type !== "text") throw new Error("text fixture required")
      part.text = "Replacement assistant content with the same original user fields"
      expect(yield* sources.validate(sessionID, source, matches())).toBe(false)
      expect(yield* sources.validate(sessionID, source, Effect.succeed(false))).toBe(false)
    }),
)

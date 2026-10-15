export * as MemoryCaptureSource from "./memory-capture-source"

import { Effect } from "effect"
import { Database } from "./database/database"
import { MemoryTranscript } from "./memory-transcript"
import { SessionSchema } from "./session/schema"
import { SessionIncarnation } from "./session/incarnation"

/** The durable Created event survives compaction and changes only after aggregate deletion/recreation. */
export function make(db: Database.Interface["db"]) {
  const stamp = (sessionID: SessionSchema.ID) => SessionIncarnation.created(db, sessionID)
  const validate = <E, R>(
    sessionID: SessionSchema.ID,
    source: ReturnType<typeof MemoryTranscript.decode>,
    legacy: Effect.Effect<boolean, E, R>,
    verifiedIncarnation?: string | null,
  ) =>
    Effect.gen(function* () {
      if (source.user.sessionID !== sessionID) return false
      if (source.createdEventID && verifiedIncarnation && source.createdEventID !== verifiedIncarnation) return false
      const incarnation = source.createdEventID ?? verifiedIncarnation
      if (!incarnation) return yield* legacy
      return (yield* stamp(sessionID)) === incarnation
    })
  return { stamp, validate }
}

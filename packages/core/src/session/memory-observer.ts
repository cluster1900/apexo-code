export * as SessionMemoryObserver from "./memory-observer"

import type { SessionCompaction } from "./compaction"
import { Context, Effect } from "effect"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"

/** The global execution owner binds this capability; Location services never discover global routing. */
export const Current = Context.Reference<
  | {
      readonly sessionID: SessionSchema.ID
      readonly capture: (stopped?: SessionMessage.ID, launch?: boolean) => Effect.Effect<void>
      readonly checkpoint: Effect.Effect<void>
      readonly beforeCompaction?: (boundary: SessionCompaction.MemoryBoundary) => Effect.Effect<void>
    }
  | undefined
>("@apexo/SessionMemoryObserver", { defaultValue: () => undefined })

export const capture = Effect.fnUntraced(function* (
  sessionID: SessionSchema.ID,
  stopped?: SessionMessage.ID,
  launch = true,
) {
  const current = yield* Current
  if (current?.sessionID === sessionID) yield* current.capture(stopped, launch)
})
export const checkpoint = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
  const current = yield* Current
  if (current?.sessionID === sessionID) yield* current.checkpoint
})

export const beforeCompaction = Effect.fnUntraced(function* (boundary: SessionCompaction.MemoryBoundary) {
  const current = yield* Current
  if (current?.sessionID === boundary.sessionID) yield* current.beforeCompaction?.(boundary) ?? Effect.void
})

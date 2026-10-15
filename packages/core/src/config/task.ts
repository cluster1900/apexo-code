export * as ConfigTask from "./task"

import { Schema } from "effect"

export const Info = Schema.Struct({
  activeMessages: Schema.optional(Schema.Boolean),
  maxDepth: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16 }))).annotate({
    description:
      "Maximum native Task child depth, captured at the first launch (default 1). Nested Tasks are foreground only.",
  }),
})

/** Invalid explicit selections block fallback without recovering other rejected settings. */
export function maxDepth(
  entries: readonly { type: string; taskInvalid?: boolean; info?: { task?: typeof Info.Type } }[],
) {
  const selected = entries.findLast(
    (entry) => entry.type === "document" && (entry.taskInvalid || entry.info?.task !== undefined),
  )
  return selected?.taskInvalid ? undefined : (selected?.info?.task?.maxDepth ?? 1)
}

export function activeMessages(
  entries: readonly { type: string; taskInvalid?: boolean; info?: { task?: typeof Info.Type } }[],
) {
  const selected = entries.findLast(
    (entry) => entry.type === "document" && (entry.taskInvalid || entry.info?.task !== undefined),
  )
  return !selected?.taskInvalid && selected?.info?.task?.activeMessages === true
}

export * as SessionExecutionPolicy from "./execution-policy"

import { Context, Effect } from "effect"
import { SessionInput } from "@apexo/schema/session-input"
import type { ToolRegistry } from "../tool/registry"
import { SessionSchema } from "./schema"

export type Policy = SessionInput.ExecutionPolicy

/** Supplied by the native runner or a privately owned foreground child launch. */
export const Current = Context.Reference<Map<SessionSchema.ID, Policy>>("@apexo/SessionExecutionPolicy", {
  defaultValue: () => new Map(),
})
export const forSession = (sessionID: SessionSchema.ID) => Effect.map(Current, (policies) => policies.get(sessionID))
/** Mutates only the map cloned for this native drain, never a process-global policy. */
export const select = (sessionID: SessionSchema.ID, policy: Policy | undefined) =>
  Effect.map(Current, (policies) => {
    if (policy) policies.set(sessionID, policy)
    else policies.delete(sessionID)
  })
export const provide = <A, E, R>(
  sessionID: SessionSchema.ID,
  policy: Policy | undefined,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.flatMap(Current, (current) => {
    const next = new Map(current)
    if (policy) next.set(sessionID, policy)
    else next.delete(sessionID)
    return effect.pipe(Effect.provideService(Current, next))
  })

/** These capabilities require an operator or an independently designed detached lifetime. */
export const unsupported = new Set([
  "question",
  "plan_enter",
  "plan_exit",
  "workflow",
  "goal",
  "create_goal",
  "update_goal",
  "monitor",
  "scheduler_create",
  "scheduler_update",
  "scheduler_delete",
  "mcp_elicitation",
  "memory_flush",
  "memory_dream",
])

export function materialize(base: ToolRegistry.Materialization): ToolRegistry.Materialization {
  const definitions = base.definitions.filter((tool) => !unsupported.has(tool.name.toLowerCase()))
  return {
    definitions,
    settle: (input) =>
      unsupported.has(input.call.name.toLowerCase())
        ? Effect.succeed({
            result: {
              type: "error" as const,
              value: "Tool requires an interactive operator or unsupported detached execution",
            },
          })
        : base.settle(input),
  }
}

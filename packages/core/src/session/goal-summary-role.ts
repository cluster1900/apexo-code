import type { SessionManagedChild } from "./managed-child"
import type { SessionMessage } from "./message"
export * as SessionGoalSummaryRole from "./goal-summary-role"

import { Context, Effect, Layer } from "effect"
import type { LLMEvent } from "@apexo/llm"
import { makeGlobalNode } from "../effect/app-node"
import type { SessionGoal } from "./goal"
import type { SessionSchema } from "./schema"

export type Role = {
  readonly owner: SessionManagedChild.Record
  readonly inputID: SessionMessage.ID
  readonly attempt: SessionGoal.Attempt
  readonly system: string
  readonly observe: (event: LLMEvent) => void
  readonly take: () => boolean
}

/** A completed Goal grants only one tool-free native child turn, never ordinary active-work authority. */
export class Service extends Context.Service<
  Service,
  {
    readonly get: (id: SessionSchema.ID) => Role | undefined
    readonly attach: (
      id: SessionSchema.ID,
      role: Omit<Role, "take">,
    ) => Effect.Effect<void, never, import("effect").Scope.Scope>
  }
>()("@apexo/SessionGoalSummaryRole") {}

export const node = makeGlobalNode({
  service: Service,
  layer: Layer.sync(Service, () => {
    const roles = new Map<SessionSchema.ID, Role>()
    return Service.of({
      get: (id) => roles.get(id),
      attach: (id, input) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            if (roles.has(id)) throw new Error("Goal summary Session already has an owner")
            const state = { consumed: false }
            const role = {
              ...input,
              take: () => {
                if (state.consumed) return false
                state.consumed = true
                return true
              },
            }
            roles.set(id, role)
            return role
          }),
          (role) =>
            Effect.sync(() => {
              if (roles.get(id) === role) roles.delete(id)
            }),
        ).pipe(Effect.asVoid),
    })
  }),
  deps: [],
})

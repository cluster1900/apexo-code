import { SessionChildPolicy } from "../session/child-policy"
import { SessionManagedChild } from "../session/managed-child"
import { SessionMessage } from "../session/message"
import { PermissionAuthority } from "../permission/authority"
export * as WorkflowRole from "./role"

import { Context, Effect, Layer, Stream } from "effect"
import { randomUUID } from "node:crypto"
import type { LLMEvent } from "@apexo/llm"
import { SessionGoalUsage } from "../session/goal-usage"
import { SessionID } from "@apexo/schema/session-id"
import { Workflow } from "@apexo/schema/workflow"
import { makeGlobalNode } from "../effect/app-node"
import { ToolRegistry } from "../tool/registry"

export type Role = {
  readonly owner: SessionManagedChild.Record
  readonly inputID: SessionMessage.ID
  readonly take: () => boolean
  readonly runID: Workflow.ID
  readonly readOnly: boolean
  readonly taskPolicy?: boolean
  readonly authority?: readonly PermissionAuthority.Snapshot[]
  readonly observe: (callID: string, tokens: number | undefined, finished: boolean) => void
}
export class Service extends Context.Service<
  Service,
  {
    readonly get: (sessionID: SessionID) => Role | undefined
    readonly attach: (
      sessionID: SessionID,
      role: Omit<Role, "take">,
    ) => Effect.Effect<void, never, import("effect").Scope.Scope>
  }
>()("@apexo/WorkflowRole") {}
export const node = makeGlobalNode({
  service: Service,
  deps: [],
  layer: Layer.sync(Service, () => {
    const roles = new Map<SessionID, Role>()
    return Service.of({
      get: (id) => roles.get(id),
      attach: (id, input) => {
        let taken = false
        const role: Role = {
          ...input,
          take: () => {
            if (taken) return false
            taken = true
            return true
          },
        }
        return Effect.acquireRelease(
          Effect.sync(() => {
            if (roles.has(id)) throw new Error("Workflow child already owned")
            roles.set(id, role)
          }),
          () =>
            Effect.sync(() => {
              if (roles.get(id) === role) roles.delete(id)
            }),
        )
      },
    })
  }),
})
export function materialize(role: Role, base: ToolRegistry.Materialization): ToolRegistry.Materialization {
  const definitions = base.definitions.filter((tool) =>
    SessionChildPolicy.allows(
      { workflow: true, readOnly: role.readOnly, taskPolicy: role.taskPolicy ?? false },
      tool.name,
    ),
  )
  return {
    definitions,
    settle: (input) =>
      definitions.some((tool) => tool.name === input.call.name)
        ? base.settle(input)
        : Effect.succeed({ result: { type: "error" as const, value: "Tool unavailable to this workflow child" } }),
  }
}

/** Observe the existing native transport; never initiate an additional provider call. */
export function track<E>(role: Role, source: Stream.Stream<LLMEvent, E>) {
  return Stream.unwrap(
    Effect.sync(() => {
      const id = randomUUID()
      const steps = new Map<number, number>()
      let total: number | undefined
      role.observe(id, undefined, false)
      return source.pipe(
        Stream.tap((event) =>
          Effect.sync(() => {
            if (event.type !== "step-finish" && event.type !== "finish") return
            const tokens = event.usage ? SessionGoalUsage.tokens(event.usage) : undefined
            if (tokens !== undefined) {
              if (event.type === "step-finish") steps.set(event.index, Math.max(steps.get(event.index) ?? 0, tokens))
              total = Math.max(
                total ?? 0,
                tokens,
                [...steps.values()].reduce((sum, value) => sum + value, 0),
              )
            }
            role.observe(id, total, event.type === "finish")
          }),
        ),
      )
    }),
  )
}

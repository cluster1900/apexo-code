import { SessionChildPolicy } from "./child-policy"
export * as SessionTaskRole from "./task-role"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { SessionHookSnapshot } from "./hook-snapshot"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionTaskStore } from "./task-store"
import { SessionGoal } from "./goal"
import { ToolRegistry } from "../tool/registry"

export type Role = {
  // A role alone is not durable authority. Schedule tools verify this exact launch and its origin.
  readonly launchID?: string
  readonly scheduledLaunchID?: string
  readonly hooks?: SessionHookSnapshot.Snapshot
  readonly inputID: SessionMessage.ID
  readonly record: SessionTaskStore.Record
  readonly attempt: SessionGoal.Attempt | undefined
  readonly observe: ((receipt: { callID: string; tokens?: number }) => void) | undefined
  readonly take: () => boolean
}
export class Service extends Context.Service<
  Service,
  {
    readonly get: (id: SessionSchema.ID) => Role | undefined
    readonly live: (id: SessionSchema.ID) => Effect.Effect<Role | undefined, SessionTaskStore.Failure>
    readonly attach: (id: SessionSchema.ID, role: Role) => Effect.Effect<void, never, import("effect").Scope.Scope>
  }
>()("@apexo/SessionTaskRole") {}
export const node = makeGlobalNode({
  service: Service,
  deps: [SessionTaskStore.node],
  layer: Layer.effect(
    Service,
    Effect.gen(function* () {
      const tasks = yield* SessionTaskStore.Service
      const roles = new Map<SessionSchema.ID, Role>()
      return Service.of({
        get: (id) => roles.get(id),
        live: (id) =>
          Effect.gen(function* () {
            const role = roles.get(id)
            if (!role) return
            const record = yield* tasks.owned(role.record.parentID, id)
            const launch = role.launchID ? yield* tasks.launch(role.launchID) : undefined
            if (
              roles.get(id) !== role ||
              !launch ||
              launch.owner !== tasks.owner ||
              launch.status !== "running" ||
              launch.sessionID !== id ||
              launch.parentID !== record.parentID ||
              launch.request.agent !== record.agent ||
              role.record.agent !== record.agent ||
              role.record.parentCreated !== record.parentCreated ||
              role.record.childCreated !== record.childCreated
            )
              return yield* new SessionTaskStore.Failure({ code: "stale", message: "Task hook owner is unavailable" })
            return role
          }),
        attach: (id, role) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              if (roles.has(id)) throw new Error("Task Session already has an owner")
              roles.set(id, role)
            }),
            () =>
              Effect.sync(() => {
                if (roles.get(id) === role) roles.delete(id)
              }),
          ),
      })
    }),
  ),
})

const restricted = new Set(["workflow", "update_goal"])
const delegationTools = new Set(["task", "task_output", "task_wait", "task_cancel"])
export function materialize(
  base: ToolRegistry.Materialization,
  scheduled = false,
  delegation?: SessionTaskStore.Delegation,
  sourcePolicy?: SessionChildPolicy.Policy,
): ToolRegistry.Materialization {
  const definitions = base.definitions.filter(
    (tool) =>
      (!sourcePolicy || SessionChildPolicy.allows(sourcePolicy, tool.name)) &&
      !restricted.has(tool.name) &&
      (!delegationTools.has(tool.name) || (delegation !== undefined && delegation.depth < delegation.maxDepth)) &&
      (scheduled || !tool.name.startsWith("scheduler_")),
  )
  return {
    definitions,
    settle: (input) =>
      definitions.some((tool) => tool.name === input.call.name)
        ? base.settle(input)
        : Effect.succeed({ result: { type: "error" as const, value: "Tool unavailable to this native Task child" } }),
  }
}

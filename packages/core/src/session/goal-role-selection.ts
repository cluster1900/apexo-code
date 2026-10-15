export * as SessionGoalRoleSelection from "./goal-role-selection"

import { Effect } from "effect"
import { Goal } from "@apexo/schema/goal"
import { Catalog } from "../catalog"
import { PermissionV2 } from "../permission"
import { AgentV2 } from "../agent"
import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import { ToolRegistry } from "../tool/registry"
import { SessionRunnerModel } from "./runner/model"
import { SessionSchema } from "./schema"

/** Capture Location services before creating the environment-free child executor. */
export const make = Effect.gen(function* () {
  const agents = yield* AgentV2.Service
  const models = yield* SessionRunnerModel.Service
  const tools = yield* ToolRegistry.Service
  const catalog = yield* Catalog.Service
  return Effect.fn("SessionGoalRoleSelection.resolve")(function* (
    session: SessionSchema.Info,
    parent: AgentV2.Selection,
    requested?: Goal.RoleModel,
    inherited: PermissionV2.Ruleset = [],
  ) {
    const current = yield* models.resolve(session)
    const fallback = (reason?: Goal.RoleExecution["fallback"]) => ({
      agent: parent,
      execution: {
        ...(requested ? { requested } : {}),
        agent: parent.id,
        model: {
          id: ModelV2.ID.make(current.id),
          providerID: ProviderV2.ID.make(current.provider),
          ...(session.model?.variant ? { variant: session.model.variant } : {}),
        },
        ...(reason ? { fallback: reason } : {}),
      } satisfies Goal.RoleExecution,
    })
    if (!requested) return fallback()
    const agent = yield* agents.get(AgentV2.ID.make(requested.agent_type))
    if (!agent) return fallback("agent_unavailable")
    // Use the same permission-filtered registrations as the native runner. Names in
    // configuration alone do not establish that a role can inspect its evidence.
    // Agent denies remain vetoes; later Session allowances must not erase them.
    // Resource-specific restrictions are still enforced when the child executes tools.
    const surfaces = yield* Effect.all([
      tools.materialize(agent.permissions),
      tools.materialize(parent.info?.permissions),
      tools.materialize([...(parent.info?.permissions ?? []), ...inherited]),
    ])
    if (
      ["read", "grep"].some((name) =>
        surfaces.some((surface) => !surface.definitions.some((tool) => tool.name === name)),
      )
    )
      return fallback("agent_incapable")
    const parts = requested.model.split("/")
    const desired = {
      id: ModelV2.ID.make(parts.length > 1 ? parts.slice(1).join("/") : parts[0]),
      providerID: ProviderV2.ID.make(parts.length > 1 ? parts[0] : current.provider),
    }
    const entry = yield* catalog.model.get(desired.providerID, desired.id)
    if (!entry?.capabilities.tools) return fallback("model_unavailable")
    const resolved = yield* models.resolve({ ...session, agent: agent.id, model: desired }).pipe(Effect.result)
    if (resolved._tag === "Failure") return fallback("model_unavailable")
    return {
      agent: { id: agent.id, info: agent },
      execution: {
        requested,
        agent: agent.id,
        model: {
          id: ModelV2.ID.make(resolved.success.id),
          providerID: ProviderV2.ID.make(resolved.success.provider),
        },
      } satisfies Goal.RoleExecution,
    }
  })
})

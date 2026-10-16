export * as WorkflowAgent from "./agent"

import { Effect, Scope } from "effect"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { PermissionV2 } from "../permission"
import { SessionSchema } from "../session/schema"
import { SessionID } from "@apexo/schema/session-id"
import { SessionStore } from "../session/store"
import { SessionRunnerModel } from "../session/runner/model"
import { WorkflowEngine } from "./engine"
import { WorkflowEffort } from "./effort"
import { WorkflowStore } from "./store"

/** Select through native Agent/Task policy; the Workflow journal owns exact retry identity. */
export const admit = Effect.fn("WorkflowAgent.admit")(function* (input: {
  agents: AgentV2.Interface
  permission: PermissionV2.Interface
  sessions: SessionStore.Interface
  models: SessionRunnerModel.Interface
  catalog: Catalog.Interface
  workflows: WorkflowStore.Interface
  parent: SessionSchema.Info
  parentAgent: AgentV2.ID
  task: Parameters<WorkflowEngine.Driver>[0]
  source?: WorkflowStore.ChildSelection
  place?: (
    selection: WorkflowStore.ChildSelection,
  ) => Effect.Effect<WorkflowStore.ChildSelection, WorkflowStore.Failure, Scope.Scope>
}) {
  const inherited = input.source?.inherited ?? !input.task.agent
  const delegated = !!input.source || !!input.task.agent
  const agent = yield* input.agents.resolve(input.source?.agent ?? input.task.agent ?? input.parentAgent)
  if (!agent || (delegated && agent.hidden) || (!inherited && agent.mode === "primary"))
    return yield* invalid("Requested Workflow subagent is unavailable")
  const state = yield* input.workflows.read(input.parent.id, input.task.runID)
  const saved = state.tasks.find((task) => task.key === input.task.key)?.selection
  if ((saved && saved.agent !== agent.id) || (input.task.sessionID && !saved))
    return yield* invalid("Workflow child selection no longer matches its owner")

  // Preserve the ceiling before a permission wait; later approvals cannot lift an earlier deny.
  const initial = yield* input.permission.capture(input.parent.id, input.parentAgent)
  if (delegated)
    yield* input.permission.assert({
      sessionID: input.parent.id,
      agent: input.parentAgent,
      action: "task",
      resources: [agent.id],
      save: [agent.id],
    })
  const requested =
    saved?.model ??
    input.source?.model ??
    input.task.stage.model ??
    (inherited ? input.parent.model : (agent.model ?? input.parent.model))
  const model = input.task.effort
    ? yield* WorkflowEffort.resolve(
        input.catalog.model,
        input.models,
        { ...input.parent, agent: agent.id },
        requested,
        input.task.effort,
        saved !== undefined,
      )
    : requested
  const resolved = yield* input.models.resolve({ ...input.parent, agent: agent.id, model })
  const available = model
    ? yield* input.catalog.model.get(model.providerID, model.id)
    : (yield* input.catalog.model.available()).find(
        (candidate) =>
          String(candidate.providerID) === String(resolved.provider) &&
          String(candidate.api.id) === String(resolved.id),
      )
  if (!available) return yield* invalid("Workflow selected agent model is unavailable")

  const fresh = yield* verify({
    agents: input.agents,
    permission: input.permission,
    sessions: input.sessions,
    parentID: input.parent.id,
    parentAgent: input.parentAgent,
    agent: agent.id,
    inherited,
    delegated,
  })
  const selection = saved ?? {
    agent: agent.id,
    model: model ?? { providerID: available.providerID, id: available.id },
    authority: [
      ...(input.source?.authority ?? []),
      { rules: agent.permissions, all: agent.permissions },
      ...initial,
      ...fresh,
    ],
    inherited,
    readOnly: input.source?.readOnly || input.task.stage.readOnly || false,
    taskPolicy: input.source?.taskPolicy,
    resume: input.source?.resume,
    placement: input.source?.placement,
  }
  const placed = input.place ? yield* input.place(selection) : selection
  if (!saved) yield* input.workflows.selectChild(input.parent.id, input.task.runID, input.task.key, placed)
  if (
    saved?.placement &&
    placed.placement &&
    (placed.placement.dev !== saved.placement.dev || placed.placement.ino !== saved.placement.ino)
  )
    yield* input.workflows.updatePlacement(input.parent.id, input.task.runID, input.task.key, placed.placement)
  return { selection: placed, authority: [...placed.authority, ...fresh] }
})

/** Recheck after asynchronous admission work and before every owned child drain. */
export const verify = Effect.fn("WorkflowAgent.verify")(function* (input: {
  agents: AgentV2.Interface
  permission: PermissionV2.Interface
  sessions: SessionStore.Interface
  parentID: SessionID
  parentAgent: AgentV2.ID
  agent: AgentV2.ID
  inherited?: boolean
  delegated?: boolean
}) {
  const agent = yield* input.agents.resolve(input.agent)
  if (!agent || (input.delegated !== false && agent.hidden) || (!input.inherited && agent.mode === "primary"))
    return yield* invalid("Selected Workflow subagent became unavailable")
  const parent = yield* input.sessions.get(input.parentID)
  if (!parent || (yield* input.agents.select(parent.agent)).id !== input.parentAgent)
    return yield* invalid("Workflow parent agent changed during child admission")
  const assess = yield* input.permission.inspect(input.parentID, input.parentAgent)
  if (input.delegated !== false && assess("task", [input.agent]) === "deny")
    return yield* invalid("Workflow subagent permission changed during admission")
  return yield* input.permission.capture(input.parentID, input.parentAgent)
})

function invalid(message: string) {
  return new WorkflowStore.Failure({ code: "invalid", message })
}

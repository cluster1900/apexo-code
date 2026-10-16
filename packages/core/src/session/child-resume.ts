import { SessionChildPlacement } from "./child-placement"
export * as SessionChildResume from "./child-resume"

import { Effect } from "effect"
import { PermissionV2 } from "../permission"
import { Database } from "../database/database"
import { SessionID } from "@apexo/schema/session-id"
import { SessionHistoryCopy } from "./history-copy"
import { SessionManagedChild } from "./managed-child"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"
import { SessionTaskStore } from "./task-store"
import { SessionTaskRole } from "./task-role"
import { SessionCommandSandbox } from "./command-sandbox"
import { WorkflowStore } from "../workflow/store"
import { WorkflowRole } from "../workflow/role"

/** Copies context across owners; it never lends or rewrites the source's execution capability. */
export const prepare = Effect.fn("SessionChildResume.prepare")(function* (input: {
  db: Database.Interface["db"]
  sourceID: SessionID
  parent: SessionSchema.Info
  sessions: SessionStore.Interface
  managed: SessionManagedChild.Interface
  tasks: SessionTaskStore.Interface
  taskRoles: Effect.Success<typeof SessionTaskRole.Service>
  roles: Effect.Success<typeof WorkflowRole.Service>
  workflows: WorkflowStore.Interface
  placement?: SessionChildPlacement.Interface
  permission: PermissionV2.Interface
  sandbox: SessionCommandSandbox.Interface
  active: Effect.Effect<ReadonlySet<SessionID>>
}) {
  const owned = Effect.gen(function* () {
    if (
      (yield* input.active).has(input.sourceID) ||
      input.taskRoles.get(input.sourceID) ||
      input.roles.get(input.sourceID)
    )
      return yield* invalid("Child resume source is still active")
    const session = yield* input.sessions.get(input.sourceID)
    if (!session || session.parentID !== input.parent.id)
      return yield* invalid("Child resume source must be an owned direct child")
    const task = yield* input.tasks.read(input.sourceID)
    if (task) {
      const record = yield* input.tasks.owned(input.parent.id, input.sourceID)
      const launch = yield* input.tasks.latest(input.parent.id, input.sourceID)
      if (!launch || !["completed", "failed", "cancelled"].includes(launch.status) || !record.model)
        return yield* invalid("Child resume source Task is not terminal with a saved model")
      return {
        kind: "task" as const,
        owner: `task:${launch.id}:${launch.status}`,
        workflowPolicy: record.sourcePolicy?.workflow ?? false,
        delegation: record.delegation,
        selection: {
          agent: record.agent,
          model: record.model,
          authority: record.authority,
          inherited: record.inherited ?? false,
          readOnly: record.sourcePolicy?.readOnly ?? false,
          taskPolicy: true,
          placement: record.placement,
        } satisfies WorkflowStore.ChildSelection,
      }
    }
    const record = yield* input.managed.owned(input.sourceID)
    if (record.parentID !== input.parent.id || record.owner.kind !== "workflow")
      return yield* invalid("Child resume source belongs to a different operation")
    const owner = record.owner
    const state = yield* input.workflows.read(input.parent.id, owner.runID)
    const entry = state.tasks.find((entry) => entry.key === owner.key && entry.sessionID === input.sourceID)
    if (!entry || (entry.status !== "done" && !["failed", "cancelled"].includes(state.info.status)))
      return yield* invalid("Child resume source has not finished")
    if (!entry.selection || entry.selection.readOnly === undefined)
      return yield* invalid("Child resume source has no saved capability and authority ceiling")
    return {
      kind: "workflow" as const,
      runID: owner.runID,
      key: owner.key,
      owner: `workflow:${owner.runID}:${owner.key}:${entry.status}`,
      selection: entry.selection,
      workflowPolicy: true,
      delegation: undefined,
    }
  })
  const initialSource = yield* owned
  const session = yield* input.sessions.get(input.sourceID)
  if (!session) return yield* invalid("Child resume source no longer exists")
  let reconstructed = false
  if (initialSource.selection.placement) {
    if (!input.placement || session.location.directory !== initialSource.selection.placement.directory)
      return yield* invalid("Child resume placement has no matching native admission")
    const recovered = yield* input.placement
      .recover(initialSource.selection.placement)
      .pipe(Effect.mapError((error) => invalid(error.message)))
    if (
      recovered.dev !== initialSource.selection.placement.dev ||
      recovered.ino !== initialSource.selection.placement.ino
    ) {
      reconstructed = true
      if (initialSource.kind === "task")
        yield* input.tasks
          .updatePlacement(input.parent.id, input.sourceID, recovered)
          .pipe(Effect.mapError((error) => invalid(error.message)))
      if (initialSource.kind === "workflow")
        yield* input.workflows
          .updatePlacement(input.parent.id, initialSource.runID, initialSource.key, recovered)
          .pipe(Effect.mapError((error) => invalid(error.message)))
    }
  } else if (
    session.location.directory !== input.parent.location.directory ||
    session.location.workspaceID !== input.parent.location.workspaceID
  )
    return yield* invalid("Child resume source placement is unavailable")
  const source = reconstructed ? yield* owned : initialSource
  const snapshot = yield* SessionHistoryCopy.capture(input.db, input.sourceID)
  const originalSandbox = yield* input.sandbox.get(input.sourceID)
  const parentSandbox = yield* input.sandbox.get(input.parent.id)
  if (
    originalSandbox.revision !== parentSandbox.revision &&
    (!source.selection.placement ||
      originalSandbox.profile !== parentSandbox.profile ||
      originalSandbox.network !== parentSandbox.network)
  )
    return yield* invalid("Child resume source has a different command sandbox binding")
  const verify = Effect.gen(function* () {
    const current = yield* owned
    if (JSON.stringify(current) !== JSON.stringify(source))
      return yield* invalid("Child resume source ownership changed after selection")
    yield* SessionHistoryCopy.verify(input.db, snapshot)
    if (
      (yield* input.sandbox.get(input.sourceID)).revision !== originalSandbox.revision ||
      (yield* input.sandbox.get(input.parent.id)).revision !== parentSandbox.revision
    )
      return yield* invalid("Child resume command sandbox binding changed")
    if (source.selection.placement && input.placement) {
      yield* input.placement.verify(source.selection.placement)
      return yield* input.placement.capture(session, source.selection.agent)
    }
    return yield* input.permission.capture(input.sourceID, source.selection.agent)
  })
  const current = yield* verify
  return {
    snapshot,
    authority: current,
    policy: {
      workflow: source.workflowPolicy,
      readOnly: source.selection.readOnly ?? false,
      taskPolicy: source.selection.taskPolicy ?? false,
    },
    delegation: source.delegation,
    selection: { ...source.selection, authority: [...source.selection.authority, ...current], resume: snapshot.source },
    verify,
  }
})

function invalid(message: string) {
  return new SessionHistoryCopy.Conflict({ message })
}

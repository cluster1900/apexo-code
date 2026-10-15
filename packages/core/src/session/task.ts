import { SessionChildPlacement } from "./child-placement"
import { SessionChildResume } from "./child-resume"
import { SessionHistoryCopy } from "./history-copy"
import { SessionManagedChild } from "./managed-child"
import { WorkflowStore } from "../workflow/store"
import type { SessionExecution } from "./execution"
import { SessionExecutionPolicy } from "./execution-policy"
export * as SessionTask from "./task"

import { createHash } from "node:crypto"
import { Cause, Context, Deferred, Effect, Exit, Layer, Schema, Scope } from "effect"
import { Task } from "@apexo/schema/task"
import { Model } from "@apexo/schema/model"
import { optional } from "@apexo/schema/schema"
import { AgentV2 } from "../agent"
import { BackgroundJob } from "../background-job"
import { Config } from "../config"
import { ConfigTask } from "../config/task"
import { HookObserver } from "../hook-observer"
import { HookSnapshotLocation } from "../hook-snapshot-location"
import { Catalog } from "../catalog"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { InstallationVersion } from "../installation/version"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { Slug } from "../util/slug"
import { SessionV1 } from "../v1/session"
import { WorkflowRole } from "../workflow/role"
import { SessionGoalRole } from "./goal-role"
import { SessionGoalUsage } from "./goal-usage"
import { SessionIncarnation } from "./incarnation"
import { SessionInput } from "./input"
import { SessionLifecycle } from "./lifecycle"
import { SessionMessage } from "./message"
import { SessionRunner } from "./runner"
import { SessionRunnerModel } from "./runner/model"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"
import { SessionTaskRole } from "./task-role"
import { SessionTaskStore } from "./task-store"
import { SessionTaskOrigin } from "./task-origin"
import { SessionScheduleAdmission } from "./schedule-admission"
import { SessionScheduleRecord } from "./schedule-record"
import { SessionTaskMessage } from "./task-message"
import type { Tool } from "../tool/tool"
import { SessionTaskControl } from "./task-control"
import { SessionTaskCompletion } from "./task-completion"
import { SessionGoal } from "./goal"
import { SessionCommandSandbox } from "./command-sandbox"

export const Input = Schema.Struct({
  description: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)),
  subagent_type: AgentV2.ID,
  task_id: optional(SessionSchema.ID),
  resume_from: optional(SessionSchema.ID),
  cwd: optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))),
  isolation: optional(Schema.Literals(["none", "worktree"])),
  background: optional(Schema.Boolean),
})
export const Output = Task.Detail
export type Output = Task.Detail
const make = Effect.gen(function* () {
  const placements = yield* SessionChildPlacement.Service
  const managed = yield* SessionManagedChild.Service
  const workflows = yield* WorkflowStore.Service
  const hooks = yield* HookSnapshotLocation.Service
  const config = yield* Config.Service
  const completions = yield* SessionTaskCompletion.Service
  const goals = yield* SessionGoal.Service
  const sandbox = yield* SessionCommandSandbox.Service
  const tasks = yield* SessionTaskStore.Service
  const control = yield* SessionTaskControl.Service
  const messages = yield* SessionTaskMessage.Service
  const roles = yield* SessionTaskRole.Service
  const goalRoles = yield* SessionGoalRole.Service
  const workflowRoles = yield* WorkflowRole.Service
  const sessions = yield* SessionStore.Service
  const lifecycle = yield* SessionLifecycle.Service
  const database = yield* Database.Service
  const events = yield* EventV2.Service
  const jobs = yield* BackgroundJob.Service
  const agents = yield* AgentV2.Service
  const models = yield* SessionRunnerModel.Service
  const catalog = yield* Catalog.Service
  const permission = yield* PermissionV2.Service
  const location = yield* Location.Service
  const ownerships = new Map<Scope.Closeable, string>()
  const lifetime = { closed: false }
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      lifetime.closed = true
      // Work scopes outlive tool returns, but never their Location. Join the existing executor first.
      for (const [scope, id] of ownerships) {
        yield* jobs.cancel(id)
        yield* Scope.close(scope, Exit.void)
      }
      ownerships.clear()
    }),
  )
  const launch = (
    input: typeof Input.Type,
    source: SessionTaskOrigin.Source,
    message?: {
      readonly input: Task.MessageInput
      readonly record: SessionTaskStore.Record
      readonly parentAgent: SessionSchema.Info["agent"]
      readonly previousLaunchID: string
    },
  ) => {
    const context =
      source.type === "schedule"
        ? { sessionID: source.admission.parentID, agent: source.admission.parentAgent }
        : source
    const scheduled = source.type === "schedule" ? source.admission : undefined
    return lifecycle.run(
      context.sessionID,
      Effect.gen(function* () {
        if (input.resume_from && input.task_id)
          return yield* new SessionTaskStore.Failure({
            code: "invalid",
            message: "resume_from creates a fresh child and cannot be combined with task_id",
          })
        const executionPolicy = yield* SessionExecutionPolicy.forSession(context.sessionID)
        if (executionPolicy && input.background)
          return yield* new SessionTaskStore.Failure({
            code: "denied",
            message: "Background Task is unavailable to headless inputs",
          })
        // Capture before any asynchronous permission/model admission: a Stop during launch revokes late notices.
        const checkpoint = input.background ? yield* completions.checkpoint(context.sessionID) : undefined
        const parentRole = roles.get(context.sessionID)
        if (workflowRoles.get(context.sessionID) || goalRoles.get(context.sessionID))
          return yield* new SessionTaskStore.Failure({
            code: "denied",
            message: "Nested Task is unavailable to this managed child",
          })
        const children = yield* SessionRunner.CurrentChildren
        if (!children)
          return yield* new SessionTaskStore.Failure({
            code: "invalid",
            message: "Task requires native child execution ownership",
          })
        const parent = yield* sessions.get(context.sessionID)
        if (
          !parent ||
          parent.location.directory !== location.directory ||
          parent.location.workspaceID !== location.workspaceID
        )
          return yield* new SessionTaskStore.Failure({
            code: "missing",
            message: "Task parent is unavailable in this Location",
          })
        const parentCreated = yield* SessionIncarnation.created(database.db, parent.id)
        if (!parentCreated)
          return yield* new SessionTaskStore.Failure({
            code: "missing",
            message: "Task parent creation proof is unavailable",
          })
        if (scheduled && (scheduled.parentCreated !== parentCreated || scheduled.processOwner !== tasks.owner))
          return yield* new SessionTaskStore.Failure({
            code: "stale",
            message: "Schedule occurrence ownership changed",
          })
        const privateParent = yield* tasks.read(parent.id)
        if (privateParent && (!parentRole || parentRole.record.childCreated !== privateParent.childCreated))
          return yield* new SessionTaskStore.Failure({
            code: "denied",
            message: "Nested Task requires its live parent Task capability",
          })
        if (parentRole && !privateParent)
          return yield* new SessionTaskStore.Failure({ code: "stale", message: "Parent Task authority is unavailable" })
        if (privateParent) yield* tasks.owned(privateParent.parentID, parent.id)
        if (
          privateParent &&
          (input.background ||
            !privateParent.delegation ||
            privateParent.delegation.depth >= privateParent.delegation.maxDepth)
        )
          return yield* new SessionTaskStore.Failure({
            code: "denied",
            message: "Nested Task requires foreground execution within its captured task.maxDepth",
          })
        const sandboxParent = yield* sandbox.capture(parent.id)
        const id =
          source.type === "tool"
            ? createHash("sha256")
                .update(JSON.stringify([parentCreated, source.assistantMessageID, source.toolCallID]))
                .digest("hex")
            : source.type === "operator"
              ? createHash("sha256")
                  .update(JSON.stringify(["operator", parentCreated, source.childCreated, source.inputID]))
                  .digest("hex")
              : source.admission.launchID
        const childID = input.task_id ?? scheduled?.childID ?? SessionSchema.ID.make(`ses_${id}`)
        const existing = input.task_id ? yield* tasks.owned(parent.id, childID) : yield* tasks.read(childID)
        if (existing) yield* tasks.owned(parent.id, childID)
        if (input.resume_from && existing && existing.resume?.sessionID !== input.resume_from)
          return yield* new SessionTaskStore.Failure({
            code: "invalid",
            message: "Task retry cannot change its resume source",
          })
        if (input.resume_from && !existing && !children.active)
          return yield* new SessionTaskStore.Failure({
            code: "invalid",
            message: "Task resume requires native source admission",
          })
        const resumed =
          input.resume_from && !existing && children.active
            ? yield* SessionChildResume.prepare({
                db: database.db,
                sourceID: input.resume_from,
                parent,
                sessions,
                managed,
                tasks,
                taskRoles: roles,
                roles: workflowRoles,
                workflows,
                permission,
                placement: placements,
                sandbox,
                active: children.active,
              }).pipe(
                Effect.catchTag("SessionHistoryCopy.Conflict", (error) =>
                  Effect.fail(new SessionTaskStore.Failure({ code: "invalid", message: error.message })),
                ),
              )
            : undefined
        const initialParentAuthority = resumed ? yield* permission.capture(parent.id, context.agent) : []
        const inheritedAgent = existing?.inherited ?? resumed?.selection.inherited ?? false

        // Only a new root selects configuration. A verified tree retains its private depth policy.
        const configuredDepth = !privateParent && !existing ? ConfigTask.maxDepth(yield* config.entries()) : undefined
        if (!privateParent && !existing && configuredDepth === undefined)
          return yield* new SessionTaskStore.Failure({
            code: "invalid",
            message: "Task configuration is invalid; task.maxDepth must be an integer from 1 to 16",
          })
        const freshDelegation: SessionTaskStore.Delegation | undefined =
          existing?.delegation ??
          (privateParent?.delegation
            ? { ...privateParent.delegation, depth: privateParent.delegation.depth + 1 }
            : configuredDepth !== undefined
              ? { rootID: parent.id, rootCreated: parentCreated, depth: 1, maxDepth: configuredDepth }
              : undefined)
        const delegation =
          freshDelegation && resumed?.delegation
            ? { ...freshDelegation, maxDepth: Math.min(freshDelegation.maxDepth, resumed.delegation.maxDepth) }
            : freshDelegation
        if (existing && existing.scheduleID !== scheduled?.origin.scheduleID)
          return yield* new SessionTaskStore.Failure({
            code: "denied",
            message: "Task follow-up cannot change its scheduling owner",
          })
        if (existing && !input.resume_from && existing.agent !== input.subagent_type)
          return yield* new SessionTaskStore.Failure({
            code: "invalid",
            message: "Task follow-up cannot change its selected agent",
          })
        const agent = yield* agents.resolve(existing?.agent ?? resumed?.selection.agent ?? input.subagent_type)
        if (!agent || agent.hidden || (!inheritedAgent && agent.mode === "primary"))
          return yield* new SessionTaskStore.Failure({ code: "invalid", message: "Requested subagent is unavailable" })
        yield* permission.assert({
          sessionID: parent.id,
          agent: context.agent,
          action: "task",
          resources: [agent.id],
          save: [agent.id],
          source:
            source.type === "tool"
              ? { type: "tool", messageID: source.assistantMessageID, callID: source.toolCallID }
              : scheduled?.permissionSource,
        })
        const inherited = [
          ...(resumed?.selection.authority ?? []),
          ...initialParentAuthority,
          ...(scheduled?.authority ?? []),
          ...(yield* permission.capture(parent.id, context.agent)),
        ]
        const selected = existing?.model ?? resumed?.selection.model ?? scheduled?.model ?? agent.model ?? parent.model
        // Native credential resolution can perform remote I/O, so it precedes mutation admission.
        const resolved = yield* models.resolve({ ...parent, agent: agent.id, model: selected })
        const catalogModel = selected
          ? yield* catalog.model.get(selected.providerID, selected.id)
          : (yield* catalog.model.available()).find(
              (model) =>
                String(model.providerID) === String(resolved.provider) && String(model.api.id) === String(resolved.id),
            )
        if (!catalogModel)
          return yield* new SessionTaskStore.Failure({
            code: "invalid",
            message: "Task effective model is unavailable",
          })
        const model: Model.Ref = selected ?? {
          id: catalogModel.id,
          providerID: catalogModel.providerID,
          variant:
            catalogModel.request.variant === undefined ? undefined : Model.VariantID.make(catalogModel.request.variant),
        }
        const attempt = (yield* SessionGoalUsage.Current) ?? parentRole?.attempt
        if (input.background && (attempt || (yield* goals.get(parent.id))?.status === "active"))
          return yield* new SessionTaskStore.Failure({
            code: "invalid",
            message: "Background Tasks are unavailable during Goal execution; use foreground Task",
          })
        if (input.background && !children.notify)
          return yield* new SessionTaskStore.Failure({
            code: "invalid",
            message: "Background Task requires owned completion delivery",
          })
        const observe = (yield* SessionGoalUsage.Observer) ?? parentRole?.observe
        const placement = yield* placements
          .prepare({
            parent,
            parentAgent: context.agent,
            agent: agent.id,
            inherited: inheritedAgent,
            model,
            childID,
            sandbox: sandboxParent,
            saved: existing?.placement ?? resumed?.selection.placement,
            cwd: existing || resumed ? undefined : input.cwd,
            worktree: !existing && !resumed && input.isolation === "worktree",
          })
          .pipe(Effect.mapError((error) => new SessionTaskStore.Failure({ code: "invalid", message: error.message })))
        const checkPlacement =
          placement?.verify.pipe(
            Effect.mapError((error) => new SessionTaskStore.Failure({ code: "stale", message: error.message })),
          ) ?? Effect.void
        const checkResumeOwner = Effect.gen(function* () {
          if (!resumed) return
          const sender = yield* sessions.get(parent.id)
          const selectedAgent = yield* agents.resolve(agent.id)
          const assess = yield* permission.inspect(parent.id, context.agent)
          if (
            !sender ||
            (yield* agents.select(sender.agent)).id !== context.agent ||
            !selectedAgent ||
            selectedAgent.hidden ||
            (!inheritedAgent && selectedAgent.mode === "primary") ||
            JSON.stringify(selectedAgent.permissions) !== JSON.stringify(agent.permissions) ||
            assess("task", [agent.id]) === "deny" ||
            JSON.stringify(yield* permission.capture(parent.id, context.agent)) !==
              JSON.stringify(initialParentAuthority) ||
            JSON.stringify(yield* resumed.verify) !== JSON.stringify(resumed.authority)
          )
            return yield* new SessionTaskStore.Failure({
              code: "stale",
              message: "Task resume authority changed during admission",
            })
        })
        const checkMessageOwner = Effect.gen(function* () {
          if (!message) return
          const assess = yield* permission.inspect(parent.id, context.agent)
          if (assess("send_subagent_message", [childID]) === "deny" || assess("task", [agent.id]) === "deny")
            return yield* new SessionTaskStore.Failure({
              code: "denied",
              message: "Task wake permission changed during admission",
            })
          if (source.type === "operator") {
            const currentAgent = yield* agents.resolve(agent.id)
            if (
              !currentAgent ||
              currentAgent.hidden ||
              (!inheritedAgent && currentAgent.mode === "primary") ||
              JSON.stringify(currentAgent.permissions) !== JSON.stringify(agent.permissions) ||
              JSON.stringify(yield* permission.capture(parent.id, context.agent)) !== JSON.stringify(inherited)
            )
              return yield* new SessionTaskStore.Failure({
                code: "stale",
                message: "Operator wake policy changed during admission",
              })
          }
          const current = yield* tasks.owned(parent.id, childID)
          const sender = yield* sessions.get(parent.id)
          if (
            current.parentCreated !== message.record.parentCreated ||
            current.childCreated !== message.record.childCreated ||
            !sender ||
            sender.agent !== message.parentAgent ||
            roles.get(parent.id) !== parentRole ||
            (yield* goals.get(parent.id))?.status === "active" ||
            !ConfigTask.activeMessages(yield* config.entries())
          )
            return yield* new SessionTaskStore.Failure({
              code: "stale",
              message: "Task wake sender authority changed during admission",
            })
        })
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const ownership = { transferred: false }
            const work = yield* Effect.acquireRelease(
              Effect.gen(function* () {
                const scope = yield* Scope.make()
                if (lifetime.closed) {
                  yield* Scope.close(scope, Exit.void)
                  return yield* Effect.interrupt
                }
                ownerships.set(scope, id)
                return scope
              }),
              (scope) =>
                ownership.transferred
                  ? Effect.void
                  : Scope.close(scope, Exit.void).pipe(
                      Effect.andThen(completions.discard(id)),
                      Effect.ensuring(Effect.sync(() => ownerships.delete(scope))),
                    ),
            )
            const childClaim = yield* lifecycle.capture(childID)
            const setup = yield* lifecycle
              .owned(
                childClaim,
                lifecycle.child(
                  parent.id,
                  childID,
                  Effect.gen(function* () {
                    if (parentCreated !== (yield* SessionIncarnation.created(database.db, parent.id)))
                      return yield* new SessionTaskStore.Failure({
                        code: "missing",
                        message: "Task parent incarnation changed",
                      })
                    yield* checkPlacement
                    yield* checkResumeOwner
                    if (!existing) {
                      if (yield* sessions.get(childID))
                        return yield* new SessionTaskStore.Failure({
                          code: "invalid",
                          message: "Task child ID is already in use",
                        })
                      const now = Date.now()
                      const publication = yield* sandbox.prepareChild(placement?.sandbox ?? sandboxParent, childID)
                      yield* checkPlacement
                      yield* checkResumeOwner
                      const childCreated = publication.eventID
                      yield* events.publish(
                        SessionV1.Event.Created,
                        {
                          sessionID: childID,
                          info: SessionV1.SessionInfo.make({
                            id: childID,
                            parentID: parent.id,
                            projectID: placement?.record.projectID ?? parent.projectID,
                            directory: placement?.record.directory ?? parent.location.directory,
                            workspaceID: placement ? undefined : parent.location.workspaceID,
                            slug: Slug.create(),
                            version: InstallationVersion,
                            title: input.description,
                            agent: agent.id,
                            model,
                            cost: 0,
                            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                            time: { created: now, updated: now },
                          }),
                        },
                        {
                          id: childCreated,
                          location: placement ? { directory: placement.record.directory } : parent.location,
                          // Created listeners can admit prompts, so authority must already be committed.
                          commit: () =>
                            publication.commit.pipe(
                              Effect.andThen(
                                tasks.commitCreated(
                                  {
                                    sessionID: childID,
                                    parentID: parent.id,
                                    parentCreated,
                                    ...(scheduled ? { scheduleID: scheduled.origin.scheduleID } : {}),
                                    childCreated,
                                    delegation,
                                    agent: agent.id,
                                    ...(resumed
                                      ? {
                                          inherited: inheritedAgent,
                                          sourcePolicy: resumed.policy,
                                          resume: resumed.snapshot.source,
                                        }
                                      : {}),
                                    model,
                                    ...(placement ? { placement: placement.record } : {}),
                                    authority: [
                                      { rules: agent.permissions, all: agent.permissions },
                                      ...inherited,
                                      ...(placement?.authority ?? []),
                                    ],
                                    createdAt: now,
                                  },
                                  scheduled ? { origin: scheduled.origin, launchID: id } : undefined,
                                ),
                              ),
                              Effect.orDie,
                            ),
                        },
                      )
                    }
                    yield* checkPlacement
                    yield* checkResumeOwner
                    if (resumed) {
                      yield* SessionHistoryCopy.copy(database.db, events, resumed.snapshot, childID)
                      yield* checkPlacement
                      yield* checkResumeOwner
                    } else if (existing?.resume)
                      yield* SessionHistoryCopy.assertReady(database.db, childID, existing.resume)
                    const record = yield* tasks.owned(parent.id, childID)
                    const prior = yield* tasks.launch(id)
                    const begin = tasks.begin({
                      id,
                      sessionID: childID,
                      parentID: parent.id,
                      ...(scheduled ? { origin: scheduled.origin } : {}),
                      request: {
                        description: input.description,
                        prompt: input.prompt,
                        agent: agent.id,
                        taskID: input.task_id,
                        resumeFrom: input.resume_from,
                        cwd: input.cwd,
                        isolation: input.isolation,
                        executionPolicy,
                        activeMessages: !executionPolicy && ConfigTask.activeMessages(yield* config.entries()),
                        ...(input.background ? { background: true } : {}),
                      },
                    })
                    const launch = yield* message
                      ? database.db.transaction(
                          () =>
                            Effect.gen(function* () {
                              yield* checkMessageOwner
                              const previous = yield* tasks.latest(parent.id, childID)
                              if (previous?.id !== message.previousLaunchID || previous.status !== "completed")
                                return yield* new SessionTaskStore.Failure({
                                  code: "stale",
                                  message: "Completed Task changed before wake admission",
                                })
                              return yield* begin
                            }),
                          { behavior: "immediate" },
                        )
                      : begin
                    if (prior) return { launch, record, started: false }
                    yield* Effect.addFinalizer((exit) =>
                      tasks
                        .finish({
                          id,
                          sessionID: childID,
                          parentID: parent.id,
                          status: Exit.isFailure(exit) && !Cause.hasInterrupts(exit.cause) ? "failed" : "cancelled",
                          message: "Task launch closed before successful settlement",
                        })
                        .pipe(
                          Effect.catch((error) =>
                            Effect.logWarning("Task launch finalizer could not retain its receipt", error),
                          ),
                          Effect.asVoid,
                        ),
                    )
                    if (message) {
                      yield* Effect.addFinalizer(() => messages.close(id, "interrupted"))
                      yield* messages.initial(id, message.input, () => checkMessageOwner.pipe(Effect.orDie))
                      return { launch, record, started: true }
                    }
                    yield* SessionInput.admit(database.db, events, {
                      id: SessionMessage.ID.make(`msg_task${id}`),
                      sessionID: childID,
                      prompt: { text: input.prompt },
                      delivery: "steer",
                      executionPolicy,
                    })
                    return { launch, record, started: true }
                  }),
                ),
              )
              .pipe(Effect.provideService(Scope.Scope, work))
            if (!setup.started) return yield* control.receipt(parent.id, childID, setup.launch.id)
            const hook = yield* hooks.get(parent.id)
            const completion = yield* control.settlement(id).pipe(Effect.provideService(Scope.Scope, work))
            const ticket =
              checkpoint && children.notify
                ? yield* completions.issue(id, setup.record, checkpoint, children.notify(parent.id))
                : undefined
            const ready = Deferred.makeUnsafe<void>()
            const consumed = { value: false }
            const run = Effect.scoped(
              Effect.gen(function* () {
                yield* Deferred.await(ready)
                if (scheduled) {
                  const fence = yield* SessionTaskOrigin.Current
                  if (!fence || fence.occurrenceID !== scheduled.origin.occurrenceID || !fence.current())
                    return yield* Effect.interrupt
                }
                yield* roles.attach(childID, {
                  hooks: hook,
                  launchID: id,
                  inputID: message?.input.inputID ?? SessionMessage.ID.make(`msg_task${id}`),
                  record: message
                    ? {
                        ...setup.record,
                        authority: [
                          ...setup.record.authority,
                          { rules: agent.permissions, all: agent.permissions },
                          ...inherited,
                        ],
                      }
                    : scheduled
                      ? { ...setup.record, authority: [...setup.record.authority, ...inherited] }
                      : setup.record,
                  ...(scheduled ? { scheduledLaunchID: id } : {}),
                  attempt,
                  observe,
                  take: () => {
                    if (consumed.value) return false
                    consumed.value = true
                    return true
                  },
                })
                yield* Effect.addFinalizer(() => lifecycle.owned(childClaim, children.interrupt(childID)))
                yield* messages.open(id)
                const role = yield* roles.live(childID)
                if (!role) return yield* Effect.interrupt
                yield* HookObserver.observe({
                  directory: location.directory,
                  event: "SubagentStart",
                  sessionID: parent.id,
                  registry: role.hooks?.registry,
                  selection: role.hooks?.selection,
                  matcher: role.record.agent,
                  payload: {
                    subagent_id: childID,
                    subagentId: childID,
                    subagent_type: role.record.agent,
                    subagentType: role.record.agent,
                    description: input.description,
                  },
                })
                yield* checkPlacement
                yield* checkResumeOwner
                if (source.type === "operator") yield* checkMessageOwner
                const result = yield* children.run(childID).pipe(Effect.exit)
                if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause)
                const context = yield* sessions.context(childID)
                const reply = context.findLast((message) => message.type === "assistant")
                if (!reply || reply.type !== "assistant" || reply.error || !reply.time.completed)
                  return yield* new SessionTaskStore.Failure({
                    code: "invalid",
                    message: "Task child did not finish successfully",
                  })
                yield* tasks.finish({
                  id,
                  sessionID: childID,
                  parentID: parent.id,
                  status: "completed",
                  replyID: reply.id,
                  ...(scheduled
                    ? {
                        summary: reply.content
                          .filter((part) => part.type === "text")
                          .map((part) => part.text)
                          .join("\n")
                          .slice(0, 600),
                      }
                    : {}),
                })
                return reply.content
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("\n")
              }),
            ).pipe(
              Effect.onExit((exit) =>
                messages.close(
                  id,
                  Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) ? "cancelled" : "interrupted",
                ),
              ),
              Effect.onExit((exit) =>
                Exit.isSuccess(exit)
                  ? Effect.void
                  : tasks
                      .finish({
                        id,
                        sessionID: childID,
                        parentID: parent.id,
                        status: Cause.hasInterrupts(exit.cause) ? "cancelled" : "failed",
                        message: Cause.hasInterrupts(exit.cause) ? "Task execution cancelled" : "Task execution failed",
                      })
                      .pipe(
                        Effect.catch((error) =>
                          Effect.logWarning("Task terminal receipt could not be retained", error),
                        ),
                        Effect.asVoid,
                      ),
              ),
              Effect.ensuring(completion.finish),
              Effect.ensuring(
                Scope.close(work, Exit.void).pipe(Effect.ensuring(Effect.sync(() => ownerships.delete(work)))),
              ),
              Effect.onExit(() => (ticket ? completions.ready(ticket) : Effect.void)),
            )
            yield* lifecycle.owned(
              childClaim,
              jobs.start({
                id,
                type: "task",
                title: input.description,
                metadata: {
                  sessionId: childID,
                  parentSessionId: parent.id,
                  nativeTask: true,
                  ...(input.background ? { background: true } : {}),
                },
                run,
              }),
            )
            ownership.transferred = true
            yield* Deferred.succeed(ready, undefined)
            if (input.background && !scheduled) return yield* control.receipt(parent.id, childID, setup.launch.id)
            yield* restore(jobs.wait({ id }).pipe(Effect.andThen(completion.wait))).pipe(
              Effect.onInterrupt(() => jobs.cancel(id)),
            )
            return yield* control.receipt(parent.id, childID, setup.launch.id)
          }),
        )
      }).pipe(Effect.scoped),
    )
  }
  const execute = (
    input: typeof Input.Type,
    context: Omit<Extract<SessionTaskOrigin.Source, { type: "tool" }>, "type">,
  ) => launch(input, { ...context, type: "tool" })
  const send = (
    parentID: SessionSchema.ID,
    childID: SessionSchema.ID,
    input: Task.MessageInput,
    context?: Tool.Context,
    operatorControl?: SessionExecution.Interface["control"],
  ) =>
    lifecycle.run(
      parentID,
      Effect.gen(function* () {
        if (!SessionTaskMessage.validText(input.text))
          return yield* new SessionTaskStore.Failure({
            code: "invalid",
            message: "Task message must contain 1 to 32768 UTF-8 bytes",
          })
        if (!ConfigTask.activeMessages(yield* config.entries()))
          return yield* new SessionTaskStore.Failure({ code: "denied", message: "Active Task delivery is disabled" })
        if (
          (yield* SessionExecutionPolicy.forSession(parentID)) ||
          workflowRoles.get(parentID) ||
          goalRoles.get(parentID)
        )
          return yield* new SessionTaskStore.Failure({
            code: "denied",
            message: "Active Task delivery is unavailable to this managed input",
          })
        const parent = yield* sessions.get(parentID)
        if (!parent)
          return yield* new SessionTaskStore.Failure({ code: "missing", message: "Parent Session is unavailable" })
        const senderRole = roles.get(parentID)
        const privateParent = yield* tasks.read(parentID)
        if (privateParent && !roles.get(parentID))
          return yield* new SessionTaskStore.Failure({ code: "stale", message: "Parent Task has no live owner" })
        if (privateParent) yield* tasks.owned(privateParent.parentID, parentID)
        const record = yield* tasks.owned(parentID, childID)
        const agent = context?.agent ?? (yield* agents.select(parent.agent)).id
        yield* permission.assert({
          sessionID: parentID,
          agent,
          action: "send_subagent_message",
          resources: [childID],
          save: ["*"],
          ...(context
            ? { source: { type: "tool" as const, messageID: context.assistantMessageID, callID: context.toolCallID } }
            : {}),
        })
        if (!ConfigTask.activeMessages(yield* config.entries()))
          return yield* new SessionTaskStore.Failure({
            code: "denied",
            message: "Active Task delivery was disabled during permission evaluation",
          })
        if (
          (yield* SessionExecutionPolicy.forSession(parentID)) ||
          workflowRoles.get(parentID) ||
          goalRoles.get(parentID) ||
          (privateParent && roles.get(parentID) !== senderRole)
        )
          return yield* new SessionTaskStore.Failure({
            code: "stale",
            message: "Sender ownership changed during admission",
          })
        const previous = yield* messages.retry(parentID, childID, input)
        if (previous) return previous
        const latest = yield* tasks.latest(parentID, childID)
        if (latest?.status === "completed" && (context || operatorControl)) {
          // This is an explicit new owned run, never an advisory wake of an old launch.
          const wake = launch(
            {
              description: latest.request.description,
              prompt: input.text,
              subagent_type: record.agent,
              task_id: childID,
              background: true,
            },
            context
              ? { type: "tool", ...context }
              : {
                  type: "operator",
                  sessionID: parentID,
                  agent,
                  inputID: input.inputID,
                  childCreated: record.childCreated,
                },
            { input, record, parentAgent: parent.agent, previousLaunchID: latest.id },
          ).pipe(
            Effect.catchTag("SessionTaskFailure", (error) =>
              messages
                .retry(parentID, childID, input)
                .pipe(Effect.flatMap((receipt) => (receipt ? Effect.void : Effect.fail(error)))),
            ),
          )
          // Operator requests join the existing parent control lane. Running-child delivery stays direct.
          if (context) yield* wake
          else if (operatorControl)
            yield* operatorControl(
              parentID,
              Effect.gen(function* () {
                const retried = yield* messages.retry(parentID, childID, input)
                if (retried) return
                yield* wake
              }),
            )
          return yield* messages.receipt(parentID, childID, input.inputID)
        }
        return yield* messages.send(parentID, childID, input, context ? undefined : { agent: parent.agent })
      }),
    )
  const scheduled = (occurrenceID: SessionTaskOrigin.OccurrenceID) =>
    Effect.gen(function* () {
      const admission = yield* SessionScheduleAdmission.admission(database.db, occurrenceID, tasks.owner).pipe(
        Effect.mapError((error) =>
          error instanceof SessionScheduleRecord.Failure
            ? new SessionTaskStore.Failure({ code: error.code, message: error.message })
            : new SessionTaskStore.Failure({ code: "storage", message: "Schedule occurrence is unavailable" }),
        ),
      )
      const inherited = yield* PermissionV2.Inherited
      return yield* launch(
        {
          description: admission.description,
          prompt: admission.prompt,
          subagent_type: admission.agent,
          task_id: admission.taskID,
          background: true,
        },
        { type: "schedule", admission },
      ).pipe(
        Effect.provideService(
          PermissionV2.Inherited,
          new Map(inherited).set(admission.parentID, [
            ...(inherited.get(admission.parentID) ?? []),
            ...admission.authority,
          ]),
        ),
      )
    })
  return {
    execute,
    scheduled,
    send,
    message: messages.receipt,
    output: control.output,
    wait: control.wait,
    cancel: control.cancel,
    list: control.list,
  }
})
export type Interface = Effect.Success<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionTask") {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    SessionChildPlacement.node,
    Config.node,
    SessionManagedChild.node,
    WorkflowStore.node,
    HookSnapshotLocation.node,
    SessionCommandSandbox.node,
    SessionTaskStore.node,
    SessionTaskControl.node,
    SessionTaskMessage.node,
    SessionTaskCompletion.node,
    SessionGoal.node,
    SessionTaskRole.node,
    SessionGoalRole.node,
    WorkflowRole.node,
    SessionStore.node,
    SessionLifecycle.node,
    Database.node,
    EventV2.node,
    BackgroundJob.node,
    AgentV2.node,
    SessionRunnerModel.node,
    Catalog.node,
    PermissionV2.node,
    Location.node,
  ],
})

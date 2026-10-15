import { SessionManagedChild } from "./managed-child"
import { GoalAttemptTable } from "../goal/sql"
import { SessionCommandSandbox } from "./command-sandbox"
import { SessionLifecycle } from "./lifecycle"
export * as SessionGoalRunner from "./goal-runner"

import { LLM, LLMClient, Message, SystemPart } from "@apexo/llm"
import { Cause, Context, Effect, Exit, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Goal } from "@apexo/schema/goal"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { Config } from "../config"
import { ConfigGoal } from "../config/goal"
import { Database } from "../database/database"
import { makeLocationNode, type LocationNode } from "../effect/app-node"
import { llmClient } from "../effect/app-node-platform"
import { Global } from "../global"
import { PermissionV2 } from "../permission"
import { AppProcess } from "../process"
import { EventV2 } from "../event"
import { InstallationVersion } from "../installation/version"
import { Slug } from "../util/slug"
import { SessionV1 } from "../v1/session"
import { SessionInput } from "./input"
import { SessionMessage } from "./message"
import type { Children } from "./runner/index"
import { SessionGoalProgress } from "./goal-progress"
import { SessionGoal } from "./goal"
import { SessionGoalSummary } from "./goal-summary"
import { SessionGoalReview } from "./goal-review"
import { SessionGoalRole } from "./goal-role"
import { SessionGoalRoleSelection } from "./goal-role-selection"
import { ToolRegistry } from "../tool/registry"
import { SessionGoalUsage } from "./goal-usage"
import { SessionGoalFiles } from "./goal-files"
import { SessionGoalCleanup } from "./goal-cleanup"
import { SessionGoalChanges } from "./goal-changes"
import { SessionGoalEvaluation } from "./goal-evaluation"
import { SessionRunnerModel } from "./runner/model"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"
import { SessionTable } from "./sql"

const make = Effect.gen(function* () {
  const lifecycle = yield* SessionLifecycle.Service
  const managed = yield* SessionManagedChild.Service
  const sandbox = yield* SessionCommandSandbox.Service
  const goals = yield* SessionGoal.Service
  const summaries = yield* SessionGoalSummary.Service
  const cleanup = yield* SessionGoalCleanup.Service
  const roles = yield* SessionGoalRole.Service
  const events = yield* EventV2.Service
  const store = yield* SessionStore.Service
  const database = yield* Database.Service
  const global = yield* Global.Service
  const config = yield* Config.Service
  const models = yield* SessionRunnerModel.Service
  const agents = yield* AgentV2.Service
  const selectRole = yield* SessionGoalRoleSelection.make
  const llm = yield* LLMClient.Service
  const processes = yield* AppProcess.Service
  const changes = SessionGoalChanges.make(processes)
  const reviews = SessionGoalReview.make(goals)

  const evidence = (sessionID: SessionSchema.ID) =>
    store.context(sessionID).pipe(
      Effect.map((messages) =>
        SessionGoalEvaluation.bounded(
          JSON.stringify(
            messages.map((message) => {
              // Snapshot/patch fields are host-generated and are not permission-filtered review evidence.
              if (message.type !== "assistant") return message
              return { ...message, snapshot: undefined }
            }),
          ),
          240_000,
        ),
      ),
    )

  const review = Effect.fn("SessionGoalRunner.review")(function* (
    session: SessionSchema.Info,
    target: SessionGoal.Target,
    kind: SessionGoalReview.Request["kind"],
    children: Children,
    strategyAttempt?: SessionGoal.Attempt & { info: Goal.Info },
  ) {
    const sandboxParent = yield* sandbox.capture(session.id).pipe(Effect.orDie)
    const settings = Config.latest(yield* config.entries(), "goal")
    const info = yield* goals.get(session.id)
    if (!info || info.id !== target.goalID) return { applied: false, info: undefined }
    const parent = yield* agents.select(session.agent)
    const permissions = yield* store.permissions(session.id)
    const inherited = (permissions ?? []).map((rule) => ({
      action: rule.permission,
      resource: rule.pattern,
      effect: rule.action,
    }))
    const canRead = (file: string) =>
      PermissionV2.evaluate("read", file, parent.info?.permissions ?? [], inherited).effect === "allow"
    const captured =
      kind === "verifying"
        ? yield* changes.capture({
            directory: session.location.directory,
            baseline: info.changesBaselineCommit,
            createdAt: info.createdAt,
            canRead,
          })
        : undefined
    const execute: SessionGoalReview.Execute = (request) =>
      Effect.scoped(
        Effect.gen(function* () {
          if (request.kind === "evaluating") return yield* Effect.die("Goal evaluation does not create a child")
          const authority = yield* managed.capture(session.id, {
            kind: "goal",
            goalID: target.goalID,
            attemptID: request.attempt.attemptID,
            role: request.kind,
          })
          const observer = yield* SessionGoalUsage.Observer
          const selection = yield* selectRole(session, parent, request.roleModel, inherited)
          const agent = selection.agent.id
          const modelRef = selection.execution.model
          const roleExecution = selection.execution
          const previousClaim = request.previousSessionID
            ? yield* lifecycle.capture(request.previousSessionID).pipe(Effect.orDie)
            : undefined
          const prior = request.previousSessionID ? yield* store.get(request.previousSessionID) : undefined
          const childID = prior?.parentID === session.id ? prior.id : SessionSchema.ID.create()
          const selectedClaim =
            prior?.parentID === session.id ? previousClaim! : yield* lifecycle.capture(childID).pipe(Effect.orDie)
          const setup = yield* lifecycle
            .owned(
              selectedClaim,
              lifecycle.child(
                session.id,
                childID,
                Effect.gen(function* () {
                  if (!(yield* store.get(session.id))) return yield* Effect.die("Parent Session no longer exists")
                  if (prior?.parentID === session.id) {
                    const current = yield* goals.check(request.attempt)
                    const owner = yield* managed.owned(childID)
                    if (
                      request.kind !== "verifying" ||
                      current.verification?.previous?.sessionID !== childID ||
                      owner.parentID !== session.id ||
                      owner.owner.kind !== "goal" ||
                      owner.owner.goalID !== target.goalID ||
                      owner.owner.role !== "verifying"
                    )
                      return yield* Effect.die("Goal review child ownership changed")
                    const origin = yield* database.db
                      .select()
                      .from(GoalAttemptTable)
                      .where(eq(GoalAttemptTable.id, owner.owner.attemptID))
                      .get()
                    if (origin?.goal_id !== target.goalID || origin.kind !== "verifying")
                      return yield* Effect.die("Goal review origin no longer exists")
                    yield* managed.require(childID, session.id, owner.owner)
                  }
                  if (!prior || prior.parentID !== session.id) {
                    const prepared = yield* sandbox.prepareChild(sandboxParent, childID).pipe(Effect.orDie)
                    const now = Date.now()
                    yield* events.publish(
                      SessionV1.Event.Created,
                      {
                        sessionID: childID,
                        info: SessionV1.SessionInfo.make({
                          id: childID,
                          parentID: session.id,
                          projectID: session.projectID,
                          directory: session.location.directory,
                          workspaceID: session.location.workspaceID,
                          slug: Slug.create(),
                          version: InstallationVersion,
                          title: `Goal ${request.kind}`,
                          agent,
                          model: modelRef,
                          metadata: {
                            goalReview: JSON.stringify({
                              ...request.attempt,
                              kind: request.kind,
                            }),
                          },
                          cost: 0,
                          tokens: {
                            input: 0,
                            output: 0,
                            reasoning: 0,
                            cache: { read: 0, write: 0 },
                          },
                          time: { created: now, updated: now },
                        }),
                      },
                      {
                        location: session.location,
                        id: prepared.eventID,
                        commit: () =>
                          prepared.commit.pipe(
                            Effect.andThen(goals.check(request.attempt)),
                            Effect.andThen(managed.commitCreated(authority, childID, prepared.eventID)),
                            Effect.orDie,
                          ),
                      },
                    )
                  }
                  if (prior?.parentID === session.id) yield* sandbox.inherit(sandboxParent, childID).pipe(Effect.orDie)
                  // A resumed first verifier retains its own transcript, but receives a fresh durable attempt and files.
                  yield* database.db
                    .update(SessionTable)
                    .set({
                      metadata: {
                        goalReview: JSON.stringify({
                          ...request.attempt,
                          kind: request.kind,
                        }),
                      },
                      agent,
                      model: modelRef,
                    })
                    .where(eq(SessionTable.id, childID))
                    .run()
                    .pipe(Effect.orDie)
                  yield* store.setPermissions({
                    sessionID: childID,
                    permissions: [
                      ...(parent.info?.permissions ?? []).map((rule) => ({
                        permission: rule.action,
                        pattern: rule.resource,
                        action: rule.effect,
                      })),
                      ...(permissions ?? []),
                    ],
                  })
                  const reportID = yield* goals.reserveReport(request.attempt)
                  const files = yield* Effect.tryPromise(() =>
                    SessionGoalFiles.create({
                      data: global.data,
                      reportID,
                      owner: target,
                      kind:
                        request.kind === "strategizing"
                          ? "strategizing"
                          : request.kind === "planning"
                            ? "planning"
                            : "verifying",
                      objective: request.objective,
                      evidence: request.content,
                      plan: info.plan,
                      workerScratch: info.plannerFiles?.workerScratch,
                      ...(captured
                        ? {
                            changes: SessionGoalChanges.materialize(
                              captured,
                              (file) =>
                                canRead(file) &&
                                PermissionV2.evaluate("read", file, selection.agent.info?.permissions ?? [], inherited)
                                  .effect === "allow",
                            ),
                          }
                        : {}),
                    }),
                  )
                  yield* Effect.addFinalizer(() => Effect.sync(files.close))
                  const owner = yield* managed.owned(childID)
                  const inputID = SessionMessage.ID.create()
                  yield* roles.attach(childID, {
                    owner,
                    inputID,
                    attempt: request.attempt,
                    system: `${request.system}\n${files.system}\nUse goal_report_write for the assigned report files.`,
                    files,
                    advisory: request.kind === "strategizing",
                    observe: (receipt) => observer?.(receipt),
                  })
                  // Runs in the global coordinator; parent teardown waits for the child before revoking file capabilities.
                  const childClaim = yield* lifecycle.capture(childID)
                  yield* Effect.addFinalizer(() => lifecycle.owned(childClaim, children.interrupt(childID)))
                  yield* SessionInput.admit(database.db, events, {
                    id: inputID,
                    sessionID: childID,
                    prompt: { text: request.content },
                    delivery: "steer",
                  })
                  return {
                    files,
                    run: yield* lifecycle.bind(childID, children.run(childID)),
                  }
                }),
              ),
            )
            .pipe(Effect.orDie)
          yield* setup.run.pipe(Effect.orDie)
          yield* goals.check(request.attempt)
          return {
            ...(yield* Effect.tryPromise(setup.files.finish)),
            sessionID: childID,
            execution: roleExecution,
          }
        }),
      )
    const useCurrentModelOnly = ConfigGoal.useCurrentModelOnly(
      settings?.use_current_model_only,
      process.env.GROK_GOAL_USE_CURRENT_MODEL_ONLY,
    )
    if (kind === "strategizing") {
      if (!strategyAttempt) return { applied: false, info }
      return {
        applied: true,
        info: yield* reviews.strategize({
          attempt: strategyAttempt,
          evidence: yield* evidence(session.id),
          execute,
          ...(!useCurrentModelOnly ? { roleModel: settings?.strategist_model } : {}),
        }),
      }
    }
    const model = yield* models.resolve(session)
    const verifierCount = Math.min(
      5,
      Math.max(1, Number.parseInt(process.env.GROK_GOAL_VERIFIER_N ?? "", 10) || settings?.verifier_count || 3),
    )
    return yield* reviews.run({
      target,
      kind,
      evidence: yield* evidence(session.id),
      execute,
      verifierCount,
      plannerModel: settings?.planner_model,
      skepticModels: settings?.skeptic_models,
      useCurrentModelOnly,
      stream: (request) =>
        llm.stream(
          LLM.request({
            model,
            system: [SystemPart.make(request.system)],
            messages: [Message.user(request.content)],
            tools: [],
          }),
        ),
    })
  })

  return {
    open: Effect.fn("SessionGoalRunner.open")(function* (sessionID: SessionSchema.ID, children?: Children) {
      const initial = yield* goals.get(sessionID)
      if (!initial || initial.status !== "active") return
      const target = { sessionID, goalID: initial.id }
      if (!children) {
        yield* goals.pause(target, "infra_paused", "Goal execution requires the process-global Session coordinator")
        return
      }
      if (initial.phase !== "idle") {
        yield* goals.recover(target, initial.revision)
        return
      }
      yield* cleanup
        .backfill(target, Config.latest(yield* config.entries(), "goal")?.report_retention_days)
        .pipe(Effect.orDie)
      const state = {
        info: initial,
        attempt: undefined as SessionGoal.Attempt | undefined,
      }
      yield* Effect.addFinalizer((exit) => {
        const interrupted = Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)
        return (
          state.attempt
            ? goals.pauseAttempt(
                state.attempt,
                interrupted ? "user_paused" : "infra_paused",
                "Native Goal drain stopped",
              )
            : goals.pauseRevision(
                target,
                state.info.revision,
                interrupted ? "user_paused" : "infra_paused",
                "Native Goal drain stopped",
              )
        ).pipe(Effect.catch(() => Effect.void))
      })
      return {
        prepare: Effect.fn("SessionGoalRunner.prepare")(function* () {
          while (true) {
            const next = yield* goals.next(target)
            if (!next) return
            if (next === "executing") {
              const attempt = yield* goals.begin(target, next)
              state.attempt = attempt
              state.info = attempt.info
              const settings = Config.latest(yield* config.entries(), "goal")
              const configured = process.env.GROK_GOAL_STRATEGIST_EVERY?.trim()
              const every =
                configured && /^\d+$/.test(configured) && Number(configured) <= 4_294_967_295
                  ? Number(configured)
                  : (settings?.strategist_every ?? 5)
              const claim = yield* goals.claimStrategy(attempt, Math.max(1, every))
              if (claim.claimed) {
                const session = yield* store.get(sessionID)
                if (!session) return
                const result = yield* review(session, target, "strategizing", children, {
                  ...attempt,
                  info: claim.info,
                })
                if (result.info) state.info = result.info
                if (state.info.status !== "active") return
              }
              return { ...attempt, info: state.info }
            }
            const session = yield* store.get(sessionID)
            if (!session) return
            const result = yield* review(session, target, next, children)
            if (result.info) state.info = result.info
            if (result.applied && result.info?.status === "complete") {
              const summarized = yield* summaries.run(session, target, yield* evidence(session.id), children)
              if (summarized) state.info = summarized
            }
            if (!result.applied || result.info?.status !== "active") return
          }
        }),
        finish: Effect.fn("SessionGoalRunner.finish")(function* (failure?: string) {
          if (!state.attempt) return
          state.info = yield* goals.finish(state.attempt, {
            evaluate: !failure,
            failure,
          })
          state.attempt = undefined
        }),
      }
    }),
  }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/v2/SessionGoalRunner") {}
export const node: LocationNode<Service> = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    SessionLifecycle.node,
    SessionCommandSandbox.node,
    SessionManagedChild.node,
    SessionGoal.node,
    SessionGoalSummary.node,
    SessionGoalCleanup.node,
    SessionGoalRole.node,
    EventV2.node,
    SessionStore.node,
    Database.node,
    Global.node,
    Config.node,
    SessionRunnerModel.node,
    AgentV2.node,
    ToolRegistry.node,
    Catalog.node,
    llmClient,
    AppProcess.node,
  ],
})

export function system(info: Goal.Info) {
  return `The user started this persistent Goal. Preserve its entire original objective.\nOriginal objective: ${info.objective}\nPlan: ${info.plan ?? "No plan"}\nUnmet requirements: ${JSON.stringify(info.unmet)}\nNext step: ${info.evaluation?.next_step ?? SessionGoalProgress.next(info) ?? "Perform concrete work toward the objective"}\nAdvisory plan progress: ${JSON.stringify(SessionGoalProgress.context(info))}\nUse update_goal.plan_progress to mark completed task ordinals or append a concise deviation. Never modify the original plan or its reports. Progress is not completion evidence.\nTokens used: ${info.tokensUsed}; budget: ${info.tokenBudget ?? "unset"}.\n${info.plannerFiles ? `Worker scratch: ${info.plannerFiles.workerScratch}. Never modify independent review reports.` : ""}${info.strategy?.status === "advised" && info.strategy.workerRound === info.workerRounds ? `\nStrategy advice (advisory; preserve all original requirements): ${info.strategy.recommendation}\n${info.strategy.files?.strategy ? `Full strategy report: ${info.strategy.files.strategy.path}` : ""}` : ""}\nContinue concrete work until every requirement is satisfied. Independent verification is required for completion.`
}

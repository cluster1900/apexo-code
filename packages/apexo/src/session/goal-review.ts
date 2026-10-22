import { Cause, Context, Effect, Layer, Option, Stream } from "effect"
import path from "node:path"
import { Database } from "@apexo/core/database/database"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionGoalReview } from "@apexo/core/session/goal-review"
import { SessionGoalUsage } from "@apexo/core/session/goal-usage"
import { SessionGoalFiles } from "@apexo/core/session/goal-files"
import { SessionGoalChanges } from "@apexo/core/session/goal-changes"
import { AppProcess } from "@apexo/core/process"
import { Global } from "@apexo/core/global"
import { Goal } from "@apexo/schema/goal"
import { Model } from "@apexo/schema/model"
import { ModelV2 } from "@apexo/core/model"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import { Provider } from "@/provider/provider"
import { Permission } from "@/permission"
import { LLM } from "./llm"
import { Session } from "./session"
import type { SessionPrompt } from "./prompt"
import { SessionGoalRole } from "./goal-role"

export interface Interface {
  readonly run: (input: {
    target: SessionGoal.Target
    kind: Exclude<SessionGoalReview.Request["kind"], "strategizing">
    evidence: string
    prompt: Pick<SessionPrompt.Interface, "prompt" | "cancel">
  }) => Effect.Effect<SessionGoalReview.Result, SessionGoal.Error>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/SessionGoalModel") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const config = yield* Config.Service
    const flags = yield* RuntimeFlags.Service
    const global = yield* Global.Service
    const process = yield* AppProcess.Service
    const reviews = SessionGoalReview.make(SessionGoal.make(database.db))

    return Service.of({
      run: (input) =>
        Effect.gen(function* () {
          const settings = yield* config.get()
          const instance = yield* InstanceState.context
          const permitted = (absolute: string, rules: Agent.Info["permission"]) =>
            Permission.evaluate("read", path.relative(instance.worktree, absolute), rules).action === "allow" &&
            Permission.evaluate("read", absolute, rules).action !== "deny"
          // Lazily capture once inside the owned verification attempt; every panel member sees the same snapshot.
          const changes = yield* Effect.cached(
            Effect.gen(function* () {
              const parent = yield* sessions.get(input.target.sessionID)
              const latest = yield* sessions.findMessage(parent.id, (message) => message.info.role === "user")
              const user = Option.isSome(latest) ? latest.value.info : undefined
              const inherited = user?.role === "user" ? yield* agents.get(user.agent) : undefined
              const info = yield* SessionGoal.make(database.db).get(parent.id)
              return yield* SessionGoalChanges.make(process).capture({
                directory: parent.directory,
                baseline: info?.id === input.target.goalID ? info.changesBaselineCommit : undefined,
                createdAt: info?.id === input.target.goalID ? info.createdAt : undefined,
                canRead: (absolute) =>
                  !!inherited && permitted(absolute, Permission.merge(inherited.permission, parent.permission ?? [])),
              })
            }),
          )
          return yield* reviews
            .run({
              ...input,
              verifierCount:
                flags.grokGoalVerifierCount ?? Math.max(1, Math.min(5, settings.goal?.verifier_count ?? 3)),
              plannerModel: settings.goal?.planner_model,
              skepticModels: settings.goal?.skeptic_models,
              useCurrentModelOnly: flags.grokGoalUseCurrentModelOnly ?? settings.goal?.use_current_model_only ?? false,
              execute: (request) =>
                Effect.gen(function* () {
                  const parent = yield* sessions.get(input.target.sessionID)
                  const latest = yield* sessions.findMessage(parent.id, (message) => message.info.role === "user")
                  const user = Option.isSome(latest) ? latest.value.info : undefined
                  if (!user || user.role !== "user")
                    return yield* Effect.fail(new Error("A goal review requires the session's selected model"))
                  const inherited = yield* agents.get(user.agent)
                  if (!inherited) return yield* Effect.fail(new Error("The goal's agent is no longer available"))
                  const current: Model.Ref = {
                    id: user.model.modelID,
                    providerID: user.model.providerID,
                    ...(user.model.variant ? { variant: Model.VariantID.make(user.model.variant) } : {}),
                  }
                  const selected = yield* resolveRole(request.roleModel, current, inherited, agents, provider)
                  const run = (selection: typeof selected, resume: boolean) =>
                    Effect.scoped(
                      Effect.gen(function* () {
                        const info = yield* SessionGoal.make(database.db).check(request.attempt)
                        if (request.kind === "evaluating")
                          return yield* Effect.fail(new Error("Evaluator cannot open report files"))
                        const material =
                          request.kind === "verifying"
                            ? SessionGoalChanges.materialize(yield* changes, (file) =>
                                [
                                  selection.agent.permission,
                                  Permission.merge(inherited.permission, parent.permission ?? []),
                                ].every((rules) => permitted(path.resolve(parent.directory, file), rules)),
                              )
                            : undefined
                        const reportID = yield* SessionGoal.make(database.db).reserveReport(request.attempt)
                        const files = yield* Effect.tryPromise(() =>
                          SessionGoalFiles.create({
                            data: global.data,
                            reportID,
                            owner: request.attempt,
                            kind: request.kind === "planning" ? "planning" : "verifying",
                            objective: info.objective,
                            evidence: request.content,
                            plan: info.plan,
                            workerScratch: info.plannerFiles?.workerScratch,
                            changes: material,
                          }),
                        )
                        yield* Effect.addFinalizer(() => Effect.sync(files.close))
                        const role = {
                          ...request,
                          system: `${request.system}\n\n${files.system}`,
                          outputSchema: undefined,
                          reports: {
                            paths: files.allowed,
                            write: (target: string, content: string) =>
                              Effect.gen(function* () {
                                yield* SessionGoal.make(database.db).check(request.attempt)
                                yield* Effect.tryPromise(() => files.write(target, content))
                                yield* SessionGoal.make(database.db).check(request.attempt)
                              }),
                          },
                          parentPermission: Permission.merge(inherited.permission, parent.permission ?? []),
                        }
                        const previous =
                          resume && request.previousSessionID
                            ? yield* sessions.get(request.previousSessionID)
                            : undefined
                        if (previous && previous.parentID !== parent.id)
                          return yield* Effect.fail(new Error("Goal reviewer session belongs to another parent"))
                        const child =
                          previous ??
                          (yield* sessions.create({
                            parentID: parent.id,
                            title: `Goal ${request.kind} (${request.attempt.goalID})`,
                            agent: selection.agent.name,
                            permission: parent.permission,
                          }))
                        // Refresh inherited restrictions before resuming an old skeptic.
                        yield* sessions.setPermission({ sessionID: child.id, permission: parent.permission ?? [] })
                        const result = yield* input.prompt
                          .prompt({
                            sessionID: child.id,
                            model: {
                              modelID: selection.execution.model.id,
                              providerID: selection.execution.model.providerID,
                            },
                            agent: selection.agent.name,
                            variant: selection.execution.model.variant,
                            system: role.system,
                            parts: [{ type: "text", text: request.content }],
                          })
                          .pipe(
                            Effect.provideService(SessionGoalRole.Current, role),
                            // The ordinary session runner is process-scoped; the review owns its cancellation.
                            Effect.ensuring(input.prompt.cancel(child.id)),
                          )
                        if (result.info.role !== "assistant" || result.info.error || result.info.finish !== "stop") {
                          const detail =
                            result.info.role === "assistant" && result.info.error
                              ? "data" in result.info.error &&
                                result.info.error.data &&
                                typeof result.info.error.data === "object" &&
                                "message" in result.info.error.data &&
                                typeof result.info.error.data.message === "string"
                                ? result.info.error.data.message
                                : result.info.error.name
                              : undefined
                          return yield* Effect.fail(
                            new Error(
                              detail
                                ? `Goal reviewer session failed: ${detail}`
                                : "Goal reviewer session ended without a final response",
                            ),
                          )
                        }
                        if (
                          request.kind === "planning" &&
                          !(yield* Effect.promise(() => Bun.file(files.paths.plan).exists()))
                        ) {
                          const raw = result.parts
                            .flatMap((part) => (part.type === "text" || part.type === "reasoning" ? [part.text] : []))
                            .join("\n")
                            .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
                            .trim()
                          const fallbackPlan = raw
                            ? (() => {
                                try {
                                  const parsed = JSON.parse(raw) as { plan?: unknown }
                                  if (typeof parsed?.plan === "string" && parsed.plan.trim()) return parsed.plan.trim()
                                } catch {}
                                return raw
                              })()
                            : `# Goal Plan\n\n## Goal Kind\ncode-change\n\n## Objective\n${info.objective}\n\n## Acceptance Criteria\n- ${info.objective}\n\n## Task Checklist\n- [ ] ${info.objective}\n\n## Verification Plan\n- Verify all requirements for: ${info.objective}`
                          yield* role.reports.write(files.paths.plan, fallbackPlan)
                        }
                        if (request.kind === "verifying") {
                          const hasVerdict = yield* Effect.promise(() => Bun.file(files.paths.verdict).exists())
                          const hasDetails = yield* Effect.promise(() => Bun.file(files.paths.details).exists())
                          if (!hasVerdict || !hasDetails) {
                            const raw = result.parts
                              .flatMap((part) =>
                                part.type === "text" || part.type === "reasoning" ? [part.text] : [],
                              )
                              .join("\n")
                              .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
                              .trim()
                            const jsonMatch = /\{[\s\S]*"achieved"\s*:[\s\S]*\}/.exec(raw)
                            if (!hasVerdict && jsonMatch) {
                              yield* role.reports.write(files.paths.verdict, jsonMatch[0])
                            }
                            if (!hasDetails && (hasVerdict || jsonMatch)) {
                              yield* role.reports.write(
                                files.paths.details,
                                raw || "# Verification Findings\nVerified against objective and captured evidence.",
                              )
                            }
                          }
                        }
                        return {
                          sessionID: child.id,
                          execution: selection.execution,
                          ...(yield* Effect.tryPromise(files.finish)),
                        }
                      }),
                    )
                  return yield* run(selected, true).pipe(
                    Effect.catchCause((cause) => {
                      if (!request.roleModel || selected.execution.fallback || Cause.hasInterrupts(cause))
                        return Effect.failCause(cause)
                      const error = Cause.squash(cause)
                      if (error instanceof SessionGoal.StorageError || error instanceof SessionGoal.Conflict)
                        return Effect.failCause(cause)
                      return Effect.gen(function* () {
                        // Budget, cancellation, and ownership are rechecked before the one inherited-model retry.
                        yield* SessionGoal.make(database.db).check(request.attempt)
                        return yield* run(
                          {
                            agent: inherited,
                            execution: {
                              requested: request.roleModel!,
                              model: current,
                              agent: inherited.name,
                              fallback: "spawn_failed",
                            },
                          },
                          false,
                        )
                      })
                    }),
                  )
                }),
              stream: (request) => {
                // Resolve model state inside the owned attempt, so resolution failures pause it too.
                const context = Effect.gen(function* () {
                  const session = yield* sessions.get(input.target.sessionID)
                  const latest = yield* sessions.findMessage(session.id, (message) => message.info.role === "user")
                  const user = Option.isSome(latest) ? latest.value.info : undefined
                  if (!user || user.role !== "user")
                    return yield* Effect.fail(new Error("A goal review requires the session's selected model"))
                  const agent = yield* agents.get(user.agent)
                  if (!agent) return yield* Effect.fail(new Error("The goal's agent is no longer available"))
                  const model = yield* provider.getModel(user.model.providerID, user.model.modelID)
                  return llm.stream({
                    user,
                    sessionID: session.id,
                    parentSessionID: session.parentID,
                    model,
                    agent,
                    permission: session.permission,
                    tools: {},
                    toolChoice: "none",
                    retries: 0,
                    outputSchema: request.outputSchema,
                    system: [request.system],
                    messages: [{ role: "user", content: request.content }],
                  })
                })
                return Stream.unwrap(context)
              },
            })
            .pipe(Effect.provideService(SessionGoalUsage.Current, undefined))
        }),
    })
  }),
)

function resolveRole(
  requested: Goal.RoleModel | undefined,
  current: Goal.RoleExecution["model"],
  inherited: Agent.Info,
  agents: Agent.Interface,
  provider: Provider.Interface,
): Effect.Effect<{ agent: Agent.Info; execution: Goal.RoleExecution }> {
  return Effect.gen(function* () {
    const fallback = (reason?: Goal.RoleExecution["fallback"]) => ({
      agent: inherited,
      execution: {
        model: current,
        agent: inherited.name,
        ...(requested ? { requested } : {}),
        ...(reason ? { fallback: reason } : {}),
      } satisfies Goal.RoleExecution,
    })
    if (!requested) return fallback()
    const agent = yield* agents.get(requested.agent_type)
    if (!agent) return fallback("agent_unavailable")
    if (Permission.disabled(["read", "grep"], agent.permission).size) return fallback("agent_incapable")
    const model = requested.model.includes("/")
      ? Provider.parseModel(requested.model)
      : { providerID: current.providerID, modelID: ModelV2.ID.make(requested.model) }
    const resolved = yield* provider.getModel(model.providerID, model.modelID).pipe(Effect.result)
    if (resolved._tag === "Failure") return fallback("model_unavailable")
    const variant =
      agent.variant ??
      (model.providerID === current.providerID && model.modelID === current.id ? current.variant : undefined)
    return {
      agent,
      execution: {
        requested,
        model: {
          id: model.modelID,
          providerID: model.providerID,
          ...(variant && resolved.success.variants?.[variant] ? { variant: Model.VariantID.make(variant) } : {}),
        },
        agent: agent.name,
      } satisfies Goal.RoleExecution,
    }
  })
}

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    Database.node,
    Session.node,
    Agent.node,
    Provider.node,
    LLM.node,
    Config.node,
    RuntimeFlags.node,
    Global.node,
    AppProcess.node,
  ],
})

export * as SessionGoalModel from "./goal-review"

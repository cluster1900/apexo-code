import { SessionGoalProgress } from "@apexo/core/session/goal-progress"
import { Cause, Effect, Exit } from "effect"
import { SessionGoalCleanup } from "@apexo/core/session/goal-cleanup"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionGoalUsage } from "@apexo/core/session/goal-usage"
import { SessionGoalEvaluation } from "@apexo/core/session/goal-evaluation"
import { SessionV1 } from "@apexo/core/v1/session"
import { SessionGoalModel } from "./goal-review"
import type { SessionPrompt } from "./prompt"

/** Called only inside the Session's exclusive local runner. It never creates or resumes a goal. */
export const open = Effect.fn("SessionGoalRun.open")(function* (
  target: SessionGoal.Target,
  goals: SessionGoal.Interface,
  models: SessionGoalModel.Interface,
  cleanup: ReturnType<typeof SessionGoalCleanup.make>,
  prompt: Pick<SessionPrompt.Interface, "prompt" | "cancel">,
  reportRetentionDays?: number,
) {
  yield* cleanup.backfill(target, reportRetentionDays)
  const initial = yield* goals.get(target.sessionID)
  if (!initial || initial.id !== target.goalID || initial.status !== "active") return
  if (initial.phase !== "idle") {
    // The new exclusive drain has no active attempt. Old in-flight state must be resumed explicitly.
    yield* goals.recover(target, initial.revision)
    return
  }
  const state = { info: initial, attempt: undefined as SessionGoal.Attempt | undefined, worked: false }
  yield* Effect.addFinalizer((exit) => {
    const interrupted = Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)
    const reason = interrupted ? "user_paused" : "infra_paused"
    const message = interrupted ? "Goal execution interrupted" : "Goal execution ended before settling its work"
    return (
      state.attempt
        ? goals.pauseAttempt(state.attempt, reason, message)
        : goals.pauseRevision(target, state.info.revision, reason, message)
    ).pipe(
      Effect.catchTag("GoalConflict", () => Effect.succeed(undefined)),
      Effect.catch((error) => Effect.logError("Could not settle Goal execution", error)),
    )
  })
  return {
    get attempt() {
      return state.attempt
    },
    get worked() {
      return state.worked
    },
    markWorked: () => {
      state.worked = true
    },
    prepare: (messages: SessionV1.WithParts[], children: readonly SessionV1.WithParts[] = []) =>
      Effect.gen(function* () {
        if (state.attempt) {
          const checked = yield* goals.check(state.attempt).pipe(Effect.result)
          if (checked._tag === "Failure") {
            if (checked.failure instanceof SessionGoal.Conflict) return
            return yield* Effect.fail(checked.failure)
          }
          state.info = checked.success
          return state.info
        }
        while (true) {
          const next = yield* goals.next(target).pipe(Effect.result)
          if (next._tag === "Failure") {
            if (next.failure instanceof SessionGoal.Conflict) return
            return yield* Effect.fail(next.failure)
          }
          if (!next.success) return
          if (next.success === "executing") {
            return yield* Effect.uninterruptible(
              Effect.gen(function* () {
                const attempt = yield* goals.begin(target, "executing")
                state.attempt = attempt
                state.info = attempt.info
                state.worked = false
                return attempt.info
              }),
            )
          }
          const review = yield* models
            .run({
              target,
              prompt,
              kind: next.success,
              evidence:
                next.success === "evaluating"
                  ? SessionGoalEvaluation.transcript(
                      [...messages, ...children]
                        .toSorted((a, b) => a.info.time.created - b.info.time.created)
                        .flatMap((message) =>
                          message.parts.flatMap((part) => {
                            const role = children.includes(message) ? "agent_message" : message.info.role
                            if (part.type === "text" && !part.ignored)
                              return [{ role: part.synthetic ? "agent_message" : role, text: part.text }]
                            if (part.type === "tool" && part.state.status === "completed")
                              return [{ role: "tool", text: `${part.tool} (${part.callID}): ${part.state.output}` }]
                            if (part.type === "tool" && part.state.status === "error")
                              return [{ role: "tool", text: `${part.tool} (${part.callID}): ${part.state.error}` }]
                            return []
                          }),
                        ),
                    )
                  : JSON.stringify({ messages: reviewMessages(messages), childMessages: reviewMessages(children) }),
            })
            .pipe(Effect.provideService(SessionGoalUsage.Current, undefined))
          if (review.info) state.info = review.info
          if (!review.applied || review.info?.status !== "active") return
        }
      }),
    finish: (failure?: string) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          if (!state.attempt) return false
          const result = yield* goals.finish(state.attempt, { evaluate: !failure, failure }).pipe(Effect.result)
          if (result._tag === "Failure") {
            if (result.failure instanceof SessionGoal.Conflict) return false
            return yield* Effect.fail(result.failure)
          }
          state.attempt = undefined
          state.worked = false
          state.info = result.success
          return result.success.status === "active"
        }),
      ),
    system:
      () => `The user explicitly started this persistent goal. Preserve its full original scope through steering and compaction.
Original objective: ${state.info.objective}
Plan: ${state.info.plan ?? "No separate plan"}
${state.info.plannerFiles ? `Plan file: ${state.info.plannerFiles.plan.path}\nOriginal objective file: ${state.info.plannerFiles.objective.path}\nPrivate worker scratch: ${state.info.plannerFiles.workerScratch}\nYou may store working evidence in the worker scratch directory. Do not modify the original objective, plan or independent review reports. The original objective remains authoritative.` : ""}
Unmet or unverified requirements: ${JSON.stringify(state.info.unmet)}
Independent evaluator next step: ${state.info.evaluation?.next_step ?? SessionGoalProgress.next(state.info) ?? "Perform concrete work toward the full objective"}
Advisory plan progress: ${JSON.stringify(SessionGoalProgress.context(state.info))}
Use update_goal.plan_progress to mark completed task ordinals or append a concise deviation. These annotations never change the plan or prove completion.
Tokens used: ${state.info.tokensUsed}; budget: ${state.info.tokenBudget ?? "not set"}.
Continue concrete work until the original objective is fully satisfied. Report progress honestly. Completion claims require independent verification. Do not start another goal or change its scope.`,
  }
})

export * as SessionGoalRun from "./goal-run"

function reviewMessages(messages: readonly SessionV1.WithParts[]) {
  return messages.map((message) => ({
    // Session summary diffs and snapshot metadata are host-generated, without the reviewer's read permission.
    // Changed-file evidence is supplied separately through the permission-filtered Goal capture.
    info: { ...message.info, ...(message.info.role === "user" ? { summary: undefined } : {}) },
    parts: message.parts.filter((part) => !["patch", "step-start", "step-finish"].includes(part.type)),
  }))
}

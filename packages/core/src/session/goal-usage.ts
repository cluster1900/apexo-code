export * as SessionGoalUsage from "./goal-usage"

import { randomUUID } from "node:crypto"
import { Context, Effect, Stream } from "effect"
import type { LLMEvent, Usage } from "@apexo/llm"
import { SessionGoal } from "./goal"

export const Current = Context.Reference<SessionGoal.Attempt | undefined>("@apexo/SessionGoal/CurrentAttempt", {
  defaultValue: () => undefined,
})

/** Collect actual transport receipts without billing a child session's aggregate a second time. */
export const Observer = Context.Reference<((receipt: { callID: string; tokens?: number }) => void) | undefined>(
  "@apexo/SessionGoal/UsageObserver",
  { defaultValue: () => undefined },
)

/** Every actual transport invocation gets its own ledger entry, including retries and child sessions. */
export function track<E>(
  goals: SessionGoal.Interface,
  attempt: SessionGoal.Attempt,
  source: () => Stream.Stream<LLMEvent, E>,
) {
  return trackChecked(goals, attempt, source, goals.check(attempt))
}

export function trackTerminal<E>(
  goals: SessionGoal.Interface,
  attempt: SessionGoal.Attempt,
  source: () => Stream.Stream<LLMEvent, E>,
) {
  return trackChecked(goals, attempt, source, goals.checkSummary(attempt, true))
}

function trackChecked<E>(
  goals: SessionGoal.Interface,
  attempt: SessionGoal.Attempt,
  source: () => Stream.Stream<LLMEvent, E>,
  check: Effect.Effect<unknown, SessionGoal.Error>,
) {
  return Stream.unwrap(
    Effect.gen(function* () {
      const checked = yield* check
      const currentGoal =
        checked && typeof checked === "object" && "tokensUsed" in checked
          ? (checked as { tokensUsed: number; tokenBudget?: number })
          : undefined
      const budgetRemaining =
        currentGoal?.tokenBudget !== undefined
          ? Math.max(0, currentGoal.tokenBudget - currentGoal.tokensUsed)
          : undefined
      const callID = randomUUID()
      const observer = yield* Observer
      observer?.({ callID })
      const steps = new Map<number, number>()
      const cumulative = { tokens: 0, reported: false }
      return source().pipe(
        Stream.tap((event) =>
          Effect.gen(function* () {
            if ((event.type !== "step-finish" && event.type !== "finish") || !event.usage) return
            const rawCount = tokens(event.usage)
            if (rawCount === undefined)
              return yield* new SessionGoal.Conflict({
                code: "invalid",
                message: "Provider returned invalid goal usage",
              })
            const generated = Math.max(event.usage.outputTokens ?? 0, event.usage.reasoningTokens ?? 0)
            const count =
              budgetRemaining !== undefined &&
              (event.usage.inputTokens ?? 0) >= 256 &&
              rawCount > budgetRemaining
                ? Math.min(rawCount, Math.max(1, generated > 0 ? Math.min(generated, budgetRemaining) : budgetRemaining))
                : rawCount
            if (event.type === "step-finish") steps.set(event.index, Math.max(steps.get(event.index) ?? 0, count))
            cumulative.reported = true
            const sum = Math.max(
              cumulative.tokens,
              count,
              [...steps.values()].reduce((acc, value) => acc + value, 0),
            )
            cumulative.tokens =
              budgetRemaining !== undefined && (event.usage.inputTokens ?? 0) >= 256 && sum > budgetRemaining
                ? Math.min(sum, Math.max(1, budgetRemaining))
                : sum
            // Settle received usage even when cancellation raced with the provider response.
            yield* goals.usage(attempt, callID, cumulative.tokens).pipe(Effect.uninterruptible)
            observer?.({ callID, tokens: cumulative.tokens })
          }),
        ),
        Stream.ensuring(
          Effect.suspend(() =>
            cumulative.reported
              ? Effect.void
              : goals.usageMissing(attempt).pipe(
                  Effect.catchTag("GoalConflict", () => Effect.void),
                  Effect.catch((error) => Effect.logError("Could not record missing goal usage", error)),
                ),
          ),
        ),
      )
    }),
  )
}

export function tokens(value: Usage) {
  const fields = [
    value.inputTokens,
    value.outputTokens,
    value.nonCachedInputTokens,
    value.cacheReadInputTokens,
    value.cacheWriteInputTokens,
    value.reasoningTokens,
    value.totalTokens,
  ]
  if (
    !fields.some((item) => item !== undefined) ||
    fields.some((item) => item !== undefined && (!Number.isSafeInteger(item) || item < 0))
  )
    return
  const total = Math.max(
    value.totalTokens ?? 0,
    Math.max(
      value.inputTokens ?? 0,
      (value.nonCachedInputTokens ?? 0) + (value.cacheReadInputTokens ?? 0) + (value.cacheWriteInputTokens ?? 0),
    ) + Math.max(value.outputTokens ?? 0, value.reasoningTokens ?? 0),
  )
  return Number.isSafeInteger(total) ? total : undefined
}

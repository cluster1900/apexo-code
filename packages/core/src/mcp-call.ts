export * as McpCall from "./mcp-call"

import { Cause, Effect, Exit, Semaphore } from "effect"
import type { ElicitResult } from "@modelcontextprotocol/sdk/types.js"
import { McpElicitation } from "./mcp-elicitation"
import { SessionLifecycle } from "./session/lifecycle"
import type { Tool } from "./tool/tool"

/** One shared MCP connection generation, including unarmed resource/catalog requests. */
export const make = Effect.gen(function* () {
  const forms = yield* McpElicitation.Service
  const lifecycle = yield* SessionLifecycle.Service
  return (input: {
    server: string
    timeout: number
    enabled: boolean
    current: () => boolean
    close: () => Promise<void>
    runForm: (effect: ReturnType<McpElicitation.Interface["ask"]>) => Promise<ElicitResult>
    humanTimeout?: number
    hardTimeout?: number
  }) => {
    const gate = Semaphore.makeUnsafe(1)
    const state = {
      retired: false,
      active: undefined as
        | undefined
        | {
            context: Tool.Context
            claim: SessionLifecycle.Claim | undefined
            allow: boolean
            token: object
            controller: AbortController
            hardDeadline: number
            pending: boolean
            pause: () => void
            resume: () => void
          },
    }
    const run = <A>(operation: (signal: AbortSignal, timeout: number) => Promise<A>, context?: Tool.Context) => {
      if (!input.enabled)
        return Effect.tryPromise({
          try: (signal) => operation(signal, input.timeout),
          catch: (error) => (error instanceof Error ? error : new Error("MCP request failed")),
        })
      return gate.withPermit(
        Effect.gen(function* () {
          if (state.retired || !input.current())
            return yield* Effect.fail(new Error("MCP connection changed; reconnect before retrying"))
          const allow = context ? yield* McpElicitation.Interactive : false
          const claim = context ? yield* SessionLifecycle.current(context.sessionID) : undefined
          const controller = new AbortController()
          const budget = {
            remaining: input.timeout,
            started: performance.now(),
            timer: undefined as ReturnType<typeof setTimeout> | undefined,
            paused: false,
            closed: false,
          }
          const resume = () => {
            if (budget.closed) return
            if (!budget.paused && budget.timer !== undefined) return
            budget.paused = false
            budget.started = performance.now()
            budget.timer = setTimeout(() => controller.abort("timed_out"), Math.max(0, budget.remaining))
          }
          const pause = () => {
            if (budget.paused) return
            budget.remaining -= performance.now() - budget.started
            if (budget.remaining <= 0) controller.abort("timed_out")
            clearTimeout(budget.timer)
            budget.timer = undefined
            budget.paused = true
          }
          const hardTimeout = input.enabled ? (input.hardTimeout ?? 15 * 60_000) : input.timeout
          const hardDeadline = Date.now() + hardTimeout
          const hard = setTimeout(() => controller.abort("timed_out"), hardTimeout)
          const invocation = context
            ? { context, claim, allow, token: {}, controller, hardDeadline, pending: false, pause, resume }
            : undefined
          state.active = invocation
          resume()
          return yield* Effect.tryPromise({
            try: (signal) =>
              operation(
                AbortSignal.any([signal, controller.signal]),
                input.enabled ? Math.max(1, hardDeadline - Date.now()) : input.timeout,
              ),
            catch: (error) => (error instanceof Error ? error : new Error("MCP request failed")),
          }).pipe(
            Effect.flatMap((value) =>
              controller.signal.aborted ? Effect.fail(new Error("MCP request timed out")) : Effect.succeed(value),
            ),
            Effect.onExit((exit) =>
              Effect.uninterruptible(
                Effect.gen(function* () {
                  const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
                  // The SDK may win the hard-cap timer race (ErrorCode.RequestTimeout).
                  const cancelled =
                    controller.signal.aborted ||
                    (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) ||
                    (error instanceof Error && "code" in error && error.code === -32001)
                  budget.closed = true
                  clearTimeout(budget.timer)
                  clearTimeout(hard)
                  state.active = undefined
                  if (cancelled) state.retired = true
                  if (invocation)
                    yield* forms.cancelInvocation(
                      invocation.token,
                      cancelled
                        ? controller.signal.reason === "timed_out" ||
                          (error instanceof Error && "code" in error && error.code === -32001)
                          ? "timed_out"
                          : "interrupted"
                        : !input.current()
                          ? "disconnected"
                          : "call_completed",
                    )
                  if (cancelled) {
                    controller.abort("interrupted")
                    yield* Effect.tryPromise(input.close).pipe(Effect.timeout("5 seconds"), Effect.ignore)
                  }
                }),
              ),
            ),
          )
        }),
      )
    }
    return {
      retired: () => state.retired,
      request: <A>(operation: (signal: AbortSignal, timeout: number) => Promise<A>) => run(operation),
      tool: <A>(context: Tool.Context, operation: (signal: AbortSignal, timeout: number) => Promise<A>) =>
        run(operation, context),
      handle: async (
        params: { mode?: "form" | "url"; message: string; requestedSchema?: unknown },
        signal: AbortSignal,
      ): Promise<ElicitResult> => {
        const owner = state.active
        if (
          !input.enabled ||
          state.retired ||
          !input.current() ||
          !owner?.allow ||
          !owner.claim ||
          !lifecycle.available(owner.claim) ||
          owner.controller.signal.aborted
        )
          throw new Error("MCP forms require an active interactive tool invocation")
        if ((params.mode ?? "form") !== "form" || !("requestedSchema" in params))
          throw new Error("Only MCP form elicitation is supported")
        if (owner.pending) throw new Error("An MCP form is already pending for this call")
        owner.pending = true
        try {
          return await input.runForm(
            forms.ask({
              ...owner.context,
              server: input.server,
              message: params.message,
              schema: params.requestedSchema,
              invocation: owner.token,
              claim: owner.claim,
              signal,
              ownerSignal: owner.controller.signal,
              deadlineAt: Math.min(Date.now() + (input.humanTimeout ?? 5 * 60_000), owner.hardDeadline),
              pause: owner.pause,
              resume: owner.resume,
              abort: (reason) => owner.controller.abort(reason),
            }),
          )
        } finally {
          owner.pending = false
          owner.resume()
        }
      },
    }
  }
})
export type Interface = ReturnType<Effect.Success<typeof make>>

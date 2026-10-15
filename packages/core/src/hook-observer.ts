export * as HookObserver from "./hook-observer"

import { Context, Effect } from "effect"
import { HostHooks } from "./hooks"
import { HookDispatch } from "./hook-dispatch"
import { HookPreferences } from "./hook-preferences"

export type Invocation = { sessionID: string; callID: string; toolName: string; toolInput: unknown }
export const CurrentTool = Context.Reference<Invocation | undefined>("@apexo/HookObserver/CurrentTool", {
  defaultValue: () => undefined,
})

export const observe = Effect.fn("HookObserver.observe")(
  (input: {
    directory: string
    event: "PermissionDenied" | "Notification" | "StopCancelled" | "PreCompact" | "PostCompact" | "SubagentStart"
    sessionID: string
    payload: Record<string, unknown>
    matcher?: string
    enabled?: boolean
    registry?: HostHooks.Inspection
    selection?: HookPreferences.Selection
  }) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const controller = new AbortController()
        const pending = (async () => {
          const signal = controller.signal
          if (
            !(
              input.enabled ??
              (process.env.APEXO_RUNTIME_PROFILE === "grok-build" ||
                input.registry?.sources.some((source) => !source.host))
            )
          )
            return
          const discovered = input.registry
          if (!discovered) return
          const choices = HostHooks.choices(discovered, input.event, input.selection, input.matcher)
          if (choices instanceof HookPreferences.Failure)
            console.warn("[hooks] Observer skipped user handlers because captured choices are unavailable", {
              event: input.event,
              code: choices.code,
            })
          const body = JSON.stringify({
            ...input.payload,
            hook_event_name: input.event,
            hookEventName: input.event.replace(
              /[A-Z]/g,
              (letter, index) => `${index ? "_" : ""}${letter.toLowerCase()}`,
            ),
            session_id: input.sessionID,
            sessionId: input.sessionID,
            cwd: input.directory,
          })
          for (const source of discovered.sources) {
            const groups = source.hooks[input.event]
            if (!Array.isArray(groups)) continue
            for (const [groupIndex, raw] of groups.entries()) {
              const group = record(raw)
              if (
                typeof group.matcher === "string" &&
                input.matcher &&
                !HostHooks.matches(group.matcher, input.matcher)
              )
                continue
              if (!Array.isArray(group.hooks)) continue
              for (const [handlerIndex, raw] of group.hooks.entries()) {
                if (signal.aborted) return
                const hook = record(raw)
                const id = HostHooks.key(source, input.event, groupIndex, handlerIndex, hook)
                if (
                  choices instanceof HookPreferences.Failure
                    ? choices.code === "conflict" || source.policy !== "managed"
                    : HostHooks.blocked(source, hook, id, choices.disabled)
                )
                  continue
                const timeout =
                  typeof hook.timeout === "number" && Number.isFinite(hook.timeout)
                    ? Math.max(100, hook.timeout * 1000)
                    : 5_000
                await HookDispatch.run(
                  hook,
                  body,
                  source.root,
                  input.directory,
                  timeout,
                  source.host,
                  input.event,
                  signal,
                  HostHooks.name(hook, `${source.name}:${input.event}:${groupIndex}:${handlerIndex}`),
                  source.data,
                  source.projectAuthority,
                ).catch(() => "")
              }
            }
          }
        })()
        return { controller, pending }
      }),
      ({ controller, pending }) =>
        Effect.promise((signal) => {
          signal.addEventListener("abort", () => controller.abort(), { once: true })
          return pending
        }),
      ({ controller, pending }) =>
        Effect.promise(async () => {
          controller.abort()
          // The interrupt signal stops dispatch; its settlement joins child process cleanup.
          await pending.catch(() => undefined)
        }),
    ),
)

export function deniedPayload(invocation: Invocation) {
  const encoded = JSON.stringify(invocation.toolInput) ?? ""
  const truncated = encoded.length > 64 * 1024
  const value = truncated ? encoded.slice(0, 64 * 1024) : invocation.toolInput
  return {
    toolName: invocation.toolName,
    tool_name: invocation.toolName,
    toolUseId: invocation.callID,
    tool_use_id: invocation.callID,
    toolInput: value,
    tool_input: value,
    toolInputTruncated: truncated,
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

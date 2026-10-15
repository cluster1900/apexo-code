import { apply } from "./hook-policy"
import path from "node:path"
import { Schema } from "effect"
import type { Hooks } from "@apexo/plugin"
import { Global } from "@apexo/core/global"
import { PluginStore } from "@apexo/core/plugin-store"
import { PluginBundle } from "@apexo/core/plugin-bundle"
import { ConfigHooks } from "@apexo/core/config/hooks"
import { HostHooks } from "@apexo/core/hooks"
import { HookPreferences } from "@apexo/core/hook-preferences"
import { HookDispatch } from "@apexo/core/hook-dispatch"

export type HookLifecycle = {
  started: Set<string>
  sources: Map<string, { sessions: Map<string, Promise<string[]>>; prompts: Map<string, string[]> }>
}

// Only first-party bundle adapters accept this private dispatch capability.
// Rebinding returns functions over the same receipt state; it never mutates a
// shared current-selection slot or changes third-party plugin callbacks.
const selections = new WeakMap<Hooks, (selection: HookPreferences.Selection) => Hooks>()
export function usesSelection(hook: Hooks, name: keyof Hooks) {
  return selections.has(hook) && typeof hook[name] === "function"
}
export function withSelection(hook: Hooks, selection: HookPreferences.Selection) {
  return selections.get(hook)?.(selection) ?? hook
}

const supported = new Set<string>(ConfigHooks.Events)
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export async function loadBundleHooks(
  directory: string,
  store = path.join(Global.Path.data, "plugins"),
  home?: string,
  hostEnabled = home !== undefined,
  selection?: HookPreferences.Selection,
): Promise<Hooks[]> {
  const plugins = await PluginStore.active(store)
  const host = hostEnabled ? await HostHooks.discover(directory, home) : { sources: [], diagnostics: [] }
  for (const diagnostic of host.diagnostics) console.warn("[host-hooks]", diagnostic)
  const sources = [
    ...(await Promise.all(
      plugins.map(async (plugin) => ({
        name: plugin.item.name,
        root: plugin.root,
        hooks: ConfigHooks.normalize((await PluginBundle.read(plugin.root, plugin.item.name)).hooks),
        host: false,
        pluginID: plugin.item.id,
      })),
    )),
    ...host.sources,
  ]
  return hooksFromSources(directory, sources, undefined, selection)
}

export async function hooksFromSources(
  directory: string,
  sources: HostHooks.Source[],
  lifecycle?: HookLifecycle,
  selection?: HookPreferences.Selection,
): Promise<Hooks[]> {
  const denied = new Set<string>()
  return Promise.all(
    sources.map(async (bundle): Promise<Hooks> => {
      const retained = new Map<string, HookPreferences.Selection>()
      const execute = async (
        event: string,
        payload: Record<string, unknown>,
        tool?: string,
        selected?: HookPreferences.Selection,
      ) => {
        if (!supported.has(event)) return []
        const groups = bundle.hooks[event]
        if (!Array.isArray(groups)) return []
        const id = typeof payload.session_id === "string" ? payload.session_id : undefined
        if (id && selected) retained.set(id, selected)
        const choices = HostHooks.choices(
          { sources: [bundle], diagnostics: [], projectTrusted: false },
          event,
          selected ?? selection ?? (id ? retained.get(id) : undefined),
          tool,
        )
        if (choices instanceof HookPreferences.Failure) throw choices
        const results: Record<string, unknown>[] = []
        for (const [groupIndex, group] of groups.entries()) {
          const data = record(group)
          if (tool && typeof data.matcher === "string" && data.matcher !== "*") {
            if (!HostHooks.matches(data.matcher, tool)) continue
          }
          if (!Array.isArray(data.hooks)) continue
          for (const [handlerIndex, raw] of data.hooks.entries()) {
            const hook = record(raw)
            if (
              HostHooks.blocked(
                bundle,
                hook,
                HostHooks.key(bundle, event, groupIndex, handlerIndex, hook),
                choices.disabled,
              )
            )
              continue
            const input = JSON.stringify({ ...payload, hook_event_name: event, cwd: directory })
            const seconds =
              typeof hook.timeout === "number" && Number.isFinite(hook.timeout)
                ? hook.timeout
                : event === "PostToolUse" || event === "Stop"
                  ? 600
                  : event === "UserPromptSubmit"
                    ? 30
                    : event === "SessionEnd"
                      ? 1.5
                      : 5
            const timeout = Math.max(100, seconds * 1000)
            const output = await HookDispatch.run(
              hook,
              input,
              bundle.root,
              directory,
              timeout,
              bundle.host,
              event,
              undefined,
              HostHooks.name(hook, `${bundle.name}:${event}:${groupIndex}:${handlerIndex}`),
              bundle.data,
              bundle.projectAuthority,
            ).catch((error: unknown) => {
              if (!bundle.host) throw error
              console.warn("[host-hooks] Hook failed; continuing", { source: bundle.name, event, error })
              return ""
            })
            if (!output) continue
            const parsed = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(output)
            if (parsed._tag === "None") {
              if (!bundle.host) throw new Error("Invalid plugin hook JSON")
              console.warn("[host-hooks] Invalid hook JSON; continuing", { source: bundle.name, event })
              continue
            }
            const result = record(parsed.value)
            if (
              (!bundle.host || ["PreToolUse", "UserPromptSubmit", "PostToolUse", "Stop"].includes(event)) &&
              (result.continue === false ||
                result.decision === "block" ||
                record(result.hookSpecificOutput).permissionDecision === "deny")
            )
              throw new Error(
                typeof result.reason === "string"
                  ? result.reason
                  : typeof record(result.hookSpecificOutput).permissionDecisionReason === "string"
                    ? String(record(result.hookSpecificOutput).permissionDecisionReason)
                    : `Hook ${bundle.name} blocked ${event}`,
              )
            results.push(result)
          }
        }
        return results
      }
      const observe = (
        event: string,
        payload: Record<string, unknown>,
        tool?: string,
        selected?: HookPreferences.Selection,
      ) =>
        execute(event, payload, tool, selected).catch((error: unknown) => {
          console.warn("[host-hooks] Observer failed", { source: bundle.name, event, error })
          return []
        })
      const failures = new Set<string>()
      const key = `${bundle.root}\0${bundle.name}`
      const state = lifecycle?.sources.get(key) ?? {
        sessions: new Map<string, Promise<string[]>>(),
        prompts: new Map<string, string[]>(),
      }
      lifecycle?.sources.set(key, state)
      const sessions = state.sessions
      const prompts = state.prompts
      const begin = (sessionID: string, selected?: HookPreferences.Selection) => {
        const existing = sessions.get(sessionID)
        if (existing) return existing
        // Reload replaces configuration without restarting the Session lifecycle.
        if (lifecycle?.started.has(sessionID)) return Promise.resolve([])
        const started = execute("SessionStart", { session_id: sessionID, source: "startup" }, undefined, selected).then(
          (results) =>
            results.flatMap((item) =>
              typeof record(item.hookSpecificOutput).additionalContext === "string"
                ? [String(record(item.hookSpecificOutput).additionalContext)]
                : [],
            ),
        )
        sessions.set(sessionID, started)
        return started
      }
      const bind = (selected?: HookPreferences.Selection): Hooks => ({
        "experimental.chat.system.transform": async (input, output) => {
          if (input.sessionID)
            output.system.push(...(await begin(input.sessionID, selected)), ...(prompts.get(input.sessionID) ?? []))
        },
        "chat.message": async (input, output) => {
          await begin(input.sessionID, selected)
          const results = await execute(
            "UserPromptSubmit",
            {
              session_id: input.sessionID,
              prompt: output.parts
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n"),
            },
            undefined,
            selected,
          )
          prompts.set(
            input.sessionID,
            results.flatMap((item) =>
              typeof record(item.hookSpecificOutput).additionalContext === "string"
                ? [String(record(item.hookSpecificOutput).additionalContext)]
                : [],
            ),
          )
        },
        "tool.execute.before": async (input, output) => {
          const results = await execute(
            "PreToolUse",
            { session_id: input.sessionID, tool_name: input.tool, tool_input: output.args },
            input.tool,
            selected,
          ).catch((error: unknown) => {
            denied.add(`${input.sessionID}:${input.callID}`)
            throw error
          })
          for (const result of results) {
            const specific = record(result.hookSpecificOutput)
            if (!bundle.host && specific.updatedInput)
              throw new Error("Plugin hook input rewrites require a new permission check and are not supported")
            if (bundle.host) apply(output.args, specific)
          }
        },
        "tool.execute.after": async (input, output) => {
          const results = await execute(
            "PostToolUse",
            {
              session_id: input.sessionID,
              tool_name: input.tool,
              tool_input: input.args,
              tool_response: output.output,
            },
            input.tool,
            selected,
          )
          const replacement = results
            .map((result) => record(result.hookSpecificOutput).updatedToolOutput)
            .findLast((value) => value !== undefined)
          if (replacement !== undefined)
            output.output = Array.from(typeof replacement === "string" ? replacement : JSON.stringify(replacement))
              .slice(0, 64 * 1024)
              .join("")
          const context = results.flatMap((result) =>
            typeof record(result.hookSpecificOutput).additionalContext === "string"
              ? [String(record(result.hookSpecificOutput).additionalContext)]
              : [],
          )
          if (context.length) output.output += `\n${context.join("\n")}`
        },
        "experimental.session.compacting": async (input) => {
          await observe("PreCompact", { session_id: input.sessionID, source: "unknown" }, undefined, selected)
        },
        event: async ({ event }) => {
          if (event.type === "session.compacted")
            await observe(
              "PostCompact",
              { session_id: event.properties.sessionID, source: "unknown" },
              undefined,
              selected,
            )
          if (event.type === "session.error")
            await observe(
              "StopFailure",
              { session_id: event.properties.sessionID, error: event.properties.error },
              undefined,
              selected,
            )
          if (event.type === "message.part.updated") {
            const part = event.properties.part
            if (
              part.type === "tool" &&
              part.state.status === "error" &&
              part.metadata?.permissionDenied !== true &&
              !failures.has(part.id) &&
              !denied.has(`${part.sessionID}:${part.callID}`)
            ) {
              failures.add(part.id)
              await observe(
                "PostToolUseFailure",
                {
                  session_id: part.sessionID,
                  tool_name: part.tool,
                  tool_use_id: part.callID,
                  tool_input: part.state.input,
                  error: part.state.error,
                },
                part.tool,
                selected,
              )
            }
          }
          if (!bundle.host && event.type === "session.status" && event.properties.status.type === "idle")
            await execute("Stop", { session_id: event.properties.sessionID }, undefined, selected).catch((error) =>
              console.warn("[plugin-hooks] Stop hook failed", { plugin: bundle.name, error }),
            )
        },
        dispose: async () => {
          for (const sessionID of sessions.keys())
            await execute("SessionEnd", { session_id: sessionID, reason: "reload" }).catch((error) =>
              console.warn("[plugin-hooks] SessionEnd hook failed", { plugin: bundle.name, error }),
            )
          sessions.clear()
          prompts.clear()
          failures.clear()
          denied.clear()
          retained.clear()
        },
      })
      const hook = bind(selection)
      if (
        Object.keys(bundle.hooks).some(
          (event) =>
            HostHooks.choices({ sources: [bundle], diagnostics: [], projectTrusted: false }, event) instanceof
            HookPreferences.Failure,
        )
      )
        selections.set(hook, bind)
      return hook
    }),
  )
}

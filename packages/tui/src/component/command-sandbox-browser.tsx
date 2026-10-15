/** @jsxImportSource @opentui/solid */
import type { ColorInput } from "@opentui/core"
import type { SandboxStatus } from "@apexo/sdk/v2/client"
import { Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useBindings } from "../keymap"

export type CommandSandboxActions = { get: (signal: AbortSignal) => Promise<SandboxStatus | undefined> }
export function CommandSandboxBrowser(props: {
  actions: CommandSandboxActions
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  onClose: () => void
  height?: number
}) {
  const lifetime = new AbortController()
  const [state, setState] = createStore({
    status: undefined as SandboxStatus | undefined,
    pending: false,
    loaded: false,
    error: false,
  })
  const load = async () => {
    if (state.pending) return
    setState({ pending: true, error: false })
    await props.actions
      .get(lifetime.signal)
      .then((status) => {
        if (!lifetime.signal.aborted) setState({ status, loaded: true })
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  onMount(() => void load())
  onCleanup(() => lifetime.abort())
  useBindings(() => ({
    priority: 2,
    bindings: [
      { key: "r", desc: "Refresh status", group: "Command sandbox", cmd: () => void load() },
      { key: "escape", desc: "Close", group: "Command sandbox", cmd: props.onClose },
    ],
  }))
  return (
    <box flexDirection="column" height={props.height ?? 19} flexShrink={0} padding={1} gap={1}>
      <text fg={props.theme().highlight}>Command sandbox · r refresh · esc back</text>
      <text wrapMode="word">Applies only to native commands on macOS, not all agent activity.</text>
      <text wrapMode="word" fg={props.theme().muted}>
        This terminal creates Sessions through the compatibility flow. Select a native command sandbox in the native App
        before creating a Session.
      </text>
      <Show when={state.status}>
        {(status) => (
          <>
            <text>Stored profile: {status().profile ?? "unavailable"} · immutable for this Session</text>
            <text>
              Backend: {status().backend.availability} · network: {status().network ?? "unknown"}
            </text>
            <text wrapMode="word">
              {status().latestExecution
                ? `Last confirmed command exited with code ${status().latestExecution!.exitCode}. This is a past execution receipt.`
                : "No confirmed command execution in this process."}
            </text>
            <Show when={status().failure}>
              {(failure) => (
                <text wrapMode="word" fg={props.theme().error}>
                  {failure().message}
                </text>
              )}
            </Show>
          </>
        )}
      </Show>
      <Show when={state.loaded && !state.status}>
        <text>No Session selected. New Sessions default to off.</text>
      </Show>
      <Show when={state.pending}>
        <text>Loading…</text>
      </Show>
      <Show when={state.error}>
        <text wrapMode="word" fg={props.theme().error}>
          Could not read command sandbox status. The server may not support this feature. Press r to retry.
        </text>
      </Show>
    </box>
  )
}

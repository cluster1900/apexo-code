/** @jsxImportSource @opentui/solid */
import type { ColorInput } from "@opentui/core"
import type { SandboxCatalog, SandboxStatus } from "@apexo/sdk/v2/client"
import { Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useBindings } from "../keymap"

export type CommandSandboxActions = {
  get: (signal: AbortSignal) => Promise<SandboxStatus | undefined>
  catalog?: (signal: AbortSignal) => Promise<SandboxCatalog | undefined>
  native?: (signal: AbortSignal) => Promise<boolean> | boolean
  selected?: () => string
  select?: (profile: string) => void
}
export function CommandSandboxBrowser(props: {
  actions: CommandSandboxActions
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  onClose: () => void
  height?: number
}) {
  const lifetime = new AbortController()
  const [state, setState] = createStore({
    status: undefined as SandboxStatus | undefined,
    catalog: undefined as SandboxCatalog | undefined,
    native: false,
    selected: props.actions.selected?.() ?? "off",
    pending: false,
    loaded: false,
    error: false,
  })
  const load = async () => {
    if (state.pending) return
    setState({ pending: true, error: false })
    const catalogPromise = props.actions.catalog?.(lifetime.signal).catch(() => undefined) ?? Promise.resolve(undefined)
    const nativePromise =
      Promise.resolve(props.actions.native?.(lifetime.signal)).catch(() => false) ?? Promise.resolve(false)
    await Promise.all([props.actions.get(lifetime.signal), catalogPromise, nativePromise])
      .then(([status, catalog, native]) => {
        if (!lifetime.signal.aborted)
          setState({
            status,
            catalog,
            native: Boolean(native),
            selected: props.actions.selected?.() ?? state.selected,
            loaded: true,
          })
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
  const isNative = () => state.native || Boolean(state.status?.profile && state.status.profile !== "off")
  const canSelect = () => isNative() && Boolean(props.actions.select)
  const profileNames = () => {
    const names = state.catalog?.profiles.map((item) => item.name) ?? [
      "off",
      "workspace",
      "read-only",
      "strict",
      "devbox",
    ]
    return names.includes("off") ? names : ["off", ...names]
  }
  const cycleProfile = () => {
    if (!canSelect()) return
    const list = profileNames()
    if (!list.length) return
    const current = props.actions.selected?.() ?? state.selected
    const idx = list.indexOf(current)
    const next = list[(idx + 1) % list.length]!
    setState("selected", next)
    props.actions.select?.(next)
  }
  useBindings(() => ({
    priority: 2,
    bindings: [
      { key: "r", desc: "Refresh status", group: "Command sandbox", cmd: () => void load() },
      ...(canSelect()
        ? [
            { key: "p", desc: "Cycle new Session profile", group: "Command sandbox", cmd: cycleProfile },
            { key: "tab", desc: "Cycle new Session profile", group: "Command sandbox", cmd: cycleProfile },
          ]
        : []),
      { key: "escape", desc: "Close", group: "Command sandbox", cmd: props.onClose },
    ],
  }))
  return (
    <box flexDirection="column" height={props.height} flexShrink={0} paddingLeft={1} paddingRight={1} paddingBottom={1} gap={1}>
      <box flexDirection="column">
        <text fg={props.theme().highlight}>
          Command sandbox · r refresh{canSelect() ? " · p/tab profile" : ""} · esc back
        </text>
        <text wrapMode="word">Applies only to native commands on macOS, not all agent activity.</text>
        <text wrapMode="word" fg={props.theme().muted}>
          {isNative()
            ? canSelect()
              ? "Command sandbox profile is sealed when the Session is created. Press p or tab to select the profile for new Sessions."
              : "Command sandbox profile is sealed when the Session is created. Choose a profile in the App before creating a new Session."
            : "This terminal creates Sessions through the compatibility flow. Select a native command sandbox in the native App before creating a Session."}
        </text>
      </box>
      <box flexDirection="column">
        <Show when={canSelect()}>
          <text fg={props.theme().highlight}>
            New Session profile: {state.selected} (press p or tab to cycle)
          </text>
        </Show>
        <Show when={state.status}>
          {(status) => (
            <>
              <text>
                Stored profile: {status().profile ?? "unavailable"}
                {status().base && status().base !== status().profile ? ` (extends ${status().base})` : ""} · immutable for
                this Session
              </text>
              <text>
                Backend: {status().backend.availability} · network:{" "}
                {status().allowDomains?.length
                  ? `allowlist (${status().allowDomains!.join(", ")})`
                  : (status().network ?? "unknown")}
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
          <text>No Session selected. New Sessions default to {state.selected}.</text>
        </Show>
      </box>
      <Show when={state.catalog && !state.error ? state.catalog : undefined}>
        {(catalog) => (
          <box flexDirection="column">
            <text wrapMode="word" fg={props.theme().muted}>
              Available profiles:{" "}
              {catalog()
                .profiles.map((item) => (item.builtin ? item.name : `${item.name} (${item.base})`))
                .join(", ")}
            </text>
            <Show when={catalog().failure}>
              {(failure) => (
                <text wrapMode="word" fg={props.theme().error}>
                  {failure().message}
                </text>
              )}
            </Show>
          </box>
        )}
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

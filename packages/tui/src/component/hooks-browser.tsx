/** @jsxImportSource @opentui/solid */
import type { ColorInput } from "@opentui/core"
import type { HostHooksSnapshot } from "@apexo/sdk/v2/client"
import { For, Show, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useBindings } from "../keymap"

export type HooksActions = {
  get: (signal: AbortSignal) => Promise<HostHooksSnapshot>
  reload: (signal: AbortSignal) => Promise<HostHooksSnapshot>
  trust?: (repository: NonNullable<HostHooksSnapshot["repository"]>, signal: AbortSignal) => Promise<HostHooksSnapshot>
  preference: (hookID: string, enabled: boolean, signal: AbortSignal) => Promise<HostHooksSnapshot>
}

export function HooksBrowser(props: {
  actions: HooksActions
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  onClose: () => void
  height?: number
}) {
  const lifetime = new AbortController()
  const [state, setState] = createStore({
    snapshot: undefined as HostHooksSnapshot | undefined,
    selected: 0,
    pending: false,
    reloading: false,
    error: false,
  })
  const load = async (reload = false) => {
    if (state.pending || (reload && !state.snapshot?.captured)) return
    setState({ pending: true, reloading: reload, error: false })
    await props.actions[reload ? "reload" : "get"](lifetime.signal)
      .then((snapshot) => {
        if (!lifetime.signal.aborted) setState("snapshot", reconcile(snapshot))
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState({ pending: false, reloading: false })
      })
  }
  const preference = async () => {
    const hook = state.snapshot?.inspection?.hooks[state.selected]
    if (
      state.pending ||
      state.snapshot?.preferenceFailure ||
      !hook?.configurable ||
      !hook.configuredEnabled ||
      hook.effectiveDisabled === undefined
    )
      return
    setState({ pending: true, error: false })
    await props.actions
      .preference(hook.id, hook.effectiveDisabled, lifetime.signal)
      .then((snapshot) => {
        if (!lifetime.signal.aborted) setState("snapshot", reconcile(snapshot))
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  const trust = async () => {
    const repository = state.snapshot?.repository
    if (state.pending || !repository || !props.actions.trust) return
    setState({ pending: true, error: false })
    await props.actions
      .trust({ ...repository, trusted: !repository.trusted }, lifetime.signal)
      .then((snapshot) => {
        if (!lifetime.signal.aborted) setState("snapshot", reconcile(snapshot))
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
      {
        key: "up",
        desc: "Previous hook",
        group: "Hooks",
        cmd: () => setState("selected", (index) => Math.max(0, index - 1)),
      },
      {
        key: "down",
        desc: "Next hook",
        group: "Hooks",
        cmd: () =>
          setState("selected", (index) =>
            Math.min(Math.max(0, (state.snapshot?.inspection?.hooks.length ?? 0) - 1), index + 1),
          ),
      },
      { key: "t", desc: "Change repository Hook trust", group: "Hooks", cmd: () => void trust() },
      { key: "space", desc: "Enable or disable hook", group: "Hooks", cmd: () => void preference() },
      { key: "escape", desc: "Close hooks", group: "Hooks", cmd: props.onClose },
      { key: "r", desc: "Refresh snapshot", group: "Hooks", cmd: () => void load() },
      { key: "l", desc: "Reload configuration", group: "Hooks", cmd: () => void load(true) },
    ],
  }))
  return (
    <box flexDirection="column" height={props.height ?? 22} padding={1} gap={1}>
      <text fg={props.theme().highlight}>Hooks</text>
      <text fg={props.theme().muted}>
        ↑/↓ select · space enable/disable · r refresh snapshot · l reload · esc close
      </text>
      <text fg={props.theme().muted}>Reload waits for a safe boundary. It does not start model work.</text>
      <text fg={props.theme().muted}>
        Choices are saved globally and applied to this session. Other captured sessions keep their choices until reload.
      </text>
      <Show when={state.snapshot?.preferenceFailure}>
        <text fg={props.theme().error}>
          Saved hook choices are unavailable. Repair preferences in Apexo’s data folder, then refresh. Existing
          effective choices are kept.
        </text>
      </Show>
      <Show when={state.pending}>
        <text fg={props.theme().muted}>
          {state.reloading ? "Waiting for a safe boundary to reload…" : "Loading snapshot…"}
        </text>
      </Show>
      <Show when={state.error}>
        <text fg={props.theme().error}>
          Operation failed. The previous snapshot is kept; refresh to check its state.
        </text>
      </Show>
      <scrollbox flexGrow={1}>
        <Show when={state.snapshot?.repository}>
          {(repository) => (
            <box flexDirection="column" marginBottom={1}>
              <text fg={props.theme().highlight}>Repository hook trust</text>
              <text fg={props.theme().text}>{repository().root}</text>
              <text fg={props.theme().muted}>
                Allow root hooks in sessions inside this repository. Reload after allowing. Revoking prevents new
                invocations.
              </text>
              <text fg={props.theme().muted}>
                {repository().allowed ? "Project hook sources are trusted." : "Project hook sources are not trusted."}
              </text>
              <text fg={props.theme().highlight}>
                {repository().trusted ? "t Revoke repository hook trust" : "t Allow repository hooks"}
              </text>
            </box>
          )}
        </Show>
        <Show when={state.snapshot}>
          {(snapshot) => (
            <>
              <Show
                when={snapshot().captured}
                fallback={
                  <text fg={props.theme().muted}>
                    Hook configuration has not been captured yet. It is captured when this session first runs.
                  </text>
                }
              >
                <text fg={props.theme().text}>Snapshot generation: {snapshot().generation}</text>
                <Show when={snapshot().inspection}>
                  {(inspection) => (
                    <>
                      <text fg={props.theme().muted}>
                        {inspection().projectTrusted
                          ? "Project hook sources are trusted."
                          : "Project hook sources are not trusted."}
                      </text>
                      <Show when={!inspection().hooks.length}>
                        <text fg={props.theme().muted}>No hooks in this snapshot.</text>
                      </Show>
                      <For each={inspection().hooks}>
                        {(hook, index) => (
                          <box flexDirection="column" marginTop={1}>
                            <text fg={index() === state.selected ? props.theme().highlight : props.theme().text}>
                              {index() === state.selected ? "> " : "  "}
                              {hook.name} · {hook.event} · {hook.type}
                            </text>
                            <text fg={props.theme().muted}>Source: {hook.source}</text>
                            <Show when={hook.matcher}>
                              <text fg={props.theme().muted}>Matcher: {hook.matcher}</text>
                            </Show>
                            <Show when={hook.effectiveDisabled !== undefined}>
                              <text fg={props.theme().text}>
                                This session: {hook.effectiveDisabled ? "disabled" : "enabled"}
                              </text>
                            </Show>
                            <Show when={hook.savedDisabled !== undefined}>
                              <text fg={props.theme().muted}>
                                Saved choice: {hook.savedDisabled ? "disabled" : "use configuration"}
                              </text>
                            </Show>
                            <Show when={!hook.configuredEnabled}>
                              <text fg={props.theme().muted}>Disabled by configuration.</text>
                            </Show>
                            <Show when={hook.pendingChange}>
                              <text fg={props.theme().muted}>
                                The saved choice differs. Reload to apply it to this session.
                              </text>
                            </Show>
                            <Show when={hook.readOnlyReason === "managed"}>
                              <text fg={props.theme().muted}>Managed by policy.</text>
                            </Show>
                            <Show when={!hook.supported}>
                              <text fg={props.theme().error}>This handler is not supported.</text>
                            </Show>
                          </box>
                        )}
                      </For>
                      <For each={inspection().diagnostics}>
                        {(diagnostic) => <text fg={props.theme().muted}>{diagnostic}</text>}
                      </For>
                    </>
                  )}
                </Show>
              </Show>
            </>
          )}
        </Show>
      </scrollbox>
    </box>
  )
}

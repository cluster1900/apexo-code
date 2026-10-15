/** @jsxImportSource @opentui/solid */
import { type ColorInput } from "@opentui/core"
import { For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { MemoryHealthInfo } from "@apexo/sdk/v2"
import { useBindings } from "../keymap"

export function MemoryHealthPanel(props: {
  load: (signal: AbortSignal) => Promise<MemoryHealthInfo>
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput }
  height: number
}) {
  const abort = new AbortController()
  const [state, setState] = createStore({
    info: undefined as MemoryHealthInfo | undefined,
    loading: false,
    error: false,
  })
  const refresh = async () => {
    if (state.loading) return
    setState({ loading: true, error: false })
    await props
      .load(abort.signal)
      .then((info) => {
        if (!abort.signal.aborted) setState("info", info)
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ error: true, info: undefined })
      })
      .finally(() => {
        if (!abort.signal.aborted) setState("loading", false)
      })
  }
  onMount(() => void refresh())
  onCleanup(() => abort.abort())
  useBindings(() => ({
    priority: 1,
    bindings: [{ key: "r", desc: "Refresh memory diagnostics", group: "Memory", cmd: () => void refresh() }],
  }))
  return (
    <box flexDirection="column" height={props.height} width="100%">
      <text fg={props.theme().text}>Memory diagnostics · r refresh · esc back</text>
      <text fg={props.theme().muted}>Read status without running capture, Dream, or cleanup.</text>
      <Show when={state.loading}>
        <text fg={props.theme().muted}>Loading…</text>
      </Show>
      <Show when={state.error}>
        <text fg={props.theme().error}>Could not load diagnostics. Press r to retry.</text>
      </Show>
      <scrollbox height={props.height - 4} width="100%" focused>
        <Show when={state.info}>
          {(info) => (
            <>
              <Show when={!info().enabled}>
                <text fg={props.theme().muted}>Memory is disabled.</text>
              </Show>
              <Show when={info().backend !== "v2"}>
                <text fg={props.theme().muted}>Diagnostics require a Memory V2 session.</text>
              </Show>
              <For each={info().scopes}>
                {(scope) => (
                  <box flexDirection="column" marginBottom={1}>
                    <text fg={props.theme().text}>
                      {scope.scope}: {scope.state}
                      {scope.reason ? ` (${scope.reason})` : ""}
                    </text>
                    <Show when={scope.snapshot}>
                      {(value) => (
                        <>
                          <text
                            fg={props.theme().text}
                          >{`Capture: ${value().pendingCaptureJobs} pending, ${value().runningCaptureJobs} running, ${value().publishingCaptureJobs} publishing, ${value().retryCaptureJobs} retry, ${value().failedCaptureJobs} failed, ${value().completedCaptureJobs} completed`}</text>
                          <text
                            fg={props.theme().text}
                          >{`Observations: ${value().pendingObservations} visible, ${value().hiddenPendingObservations} hidden, ${value().quarantinedObservations} quarantined; oldest age: ${value().oldestPendingAgeSecs ?? "unknown"} seconds`}</text>
                          <text
                            fg={props.theme().text}
                          >{`Dream: ${value().dreamLease}; snapshot: ${value().dreamSnapshotSize}; saved plan: ${value().dreamPlanPending}; another check: ${value().hasCoalescedTrigger}`}</text>
                          <text
                            fg={props.theme().text}
                          >{`Maintenance: ${value().archiveCount} archives, ${value().tombstoneCount} tombstones, ${value().pendingDeletions} pending deletions`}</text>
                          <text
                            fg={props.theme().muted}
                          >{`Last success: ${value().lastSuccessAt === null ? "none" : new Date(value().lastSuccessAt!).toISOString()}; last failure: ${value().lastFailureAt === null ? "none" : new Date(value().lastFailureAt!).toISOString()}`}</text>
                        </>
                      )}
                    </Show>
                  </box>
                )}
              </For>
            </>
          )}
        </Show>
      </scrollbox>
    </box>
  )
}

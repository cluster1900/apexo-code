/** @jsxImportSource @opentui/solid */
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import type { ColorInput, ScrollBoxRenderable } from "@opentui/core"
import { createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { MemoryOperation } from "@apexo/schema/memory-operation"
import type {
  MemoryOperationInfo,
  MemoryOperationMigrationPreview,
  MemoryOperationRecoveryPreview,
} from "@apexo/sdk/v2"
import type { MemoryOperationCommand, MemoryOperationsActions } from "../util/memory-operations"
import { MemoryActionError, memoryError } from "../util/session-memory"
import { useBindings } from "../keymap"

type Preview =
  | { kind: "migration"; value: MemoryOperationMigrationPreview }
  | { kind: "recovery"; value: MemoryOperationRecoveryPreview }
const reasons = {
  no_plan: "No prepared plan is available to discard.",
  unknown_owner: "The plan's owner cannot be proven. This recovery is unavailable; nothing was changed.",
  live_owner: "The plan still has a live owner. Wait for that work to settle.",
  foreign_owner: "Ownership belongs to another host and cannot be verified here.",
  capture_active: "A capture claim is active or unproven. Clear is unavailable.",
  partial_publication: "The plan was partly published. Review an explicit clear instead of discarding it.",
  scope_empty: "The selected scope has no Memory store to clear.",
}
const results = {
  completed: "Completed",
  no_work: "No work needed",
  disabled: "Memory is disabled",
  denied: "Permission denied",
  retry_required: "Explicit retry required",
  failed: "Failed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
  conflict: "State changed",
}
function resultText(result: NonNullable<MemoryOperationInfo["result"]>) {
  return result.status === "retry_required" && (result.deferred ?? 0) > 0
    ? `Deferred notes: ${result.deferred ?? 0} · Unplaced notes archived: ${result.unplaceable ?? 0}`
    : results[result.status]
}
export function MemoryOperations(props: {
  actions: (owner: AbortSignal) => MemoryOperationsActions
  onClose: () => void
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  height?: number
}) {
  const dimensions = useTerminalDimensions()
  let detail: ScrollBoxRenderable | undefined
  const owner = new AbortController()
  const actions = props.actions(owner.signal)
  const [state, setState] = createStore({
    items: [] as MemoryOperationInfo[],
    selected: undefined as string | undefined,
    scope: "workspace" as "workspace" | "global",
    preview: undefined as Preview | undefined,
    confirm: false,
    pending: false,
    error: "",
    uncertain: undefined as MemoryOperationCommand | undefined,
  })
  const selected = createMemo(() => state.items.find((row) => row.id === state.selected))
  // Fullscreen Dialog starts one quarter-screen down, with one row of inner padding.
  // Reserve that inset and a bottom row so the fixed action footer remains visible.
  const height = () =>
    props.height ?? Math.max(1, Math.min(32, dimensions().height - Math.ceil(dimensions().height / 4) - 2))
  const rows = () => Math.max(2, Math.min(5, height() - 12))
  const offset = () => Math.max(0, state.items.findIndex((row) => row.id === state.selected) - rows() + 1)
  const observation = { version: 0, reading: false, timer: undefined as ReturnType<typeof setTimeout> | undefined }
  const idle = () => !owner.signal.aborted && !state.pending && !state.uncertain
  const refresh = async () => {
    if (observation.reading || owner.signal.aborted) return
    observation.reading = true
    const version = observation.version
    await actions
      .list(owner.signal)
      .then((items) => {
        if (owner.signal.aborted || state.pending || version !== observation.version) return
        setState("items", items)
        setState("selected", (id) => (items.some((row) => row.id === id) ? id : items[0]?.id))
      })
      .catch((error) => {
        if (!owner.signal.aborted && version === observation.version)
          setState(
            "error",
            memoryError(error, "Could not refresh operations. The last readable receipts are retained."),
          )
      })
      .finally(() => {
        observation.reading = false
      })
  }
  const poll = async () => {
    await refresh()
    if (!owner.signal.aborted)
      observation.timer = setTimeout(poll, state.items.some((row) => row.state !== "finished") ? 750 : 2000)
  }
  const execute = async (command: MemoryOperationCommand) => {
    if (owner.signal.aborted || state.pending) return
    observation.version++
    setState({ pending: true, error: "", confirm: false, uncertain: command })
    await actions
      .execute(command, owner.signal)
      .then((row) => {
        if (owner.signal.aborted) return
        setState({
          items: [row, ...state.items.filter((item) => item.id !== row.id)],
          selected: row.id,
          preview: undefined,
          uncertain: undefined,
        })
      })
      .catch((error) => {
        if (owner.signal.aborted) return
        setState(
          "error",
          memoryError(
            error,
            "Request outcome is unknown. Refresh receipts or repeat the same request; a new operation was not started automatically.",
          ),
        )
        if (error instanceof MemoryActionError && error.code !== "failed" && error.code !== "unavailable")
          setState({ uncertain: undefined, preview: undefined })
      })
      .finally(() => {
        if (!owner.signal.aborted) setState("pending", false)
      })
  }
  const preview = async (kind: "relocation" | "carryover" | "discard" | "clear") => {
    if (!idle()) return
    observation.version++
    setState({ pending: true, preview: undefined, confirm: false, error: "" })
    await (
      kind === "relocation" || kind === "carryover"
        ? actions
            .migrationPreview(kind, state.scope, owner.signal)
            .then((value): Preview => ({ kind: "migration", value }))
        : actions
            .recoveryPreview(kind, state.scope, owner.signal)
            .then((value): Preview => ({ kind: "recovery", value }))
    )
      .then((value) => {
        if (!owner.signal.aborted) setState("preview", value)
      })
      .catch((error) => {
        if (!owner.signal.aborted)
          setState(
            "error",
            error instanceof MemoryActionError && error.code === "forbidden"
              ? "This action is unavailable for this Session’s Memory backend or permission policy."
              : memoryError(error, "Could not preview this operation. No action was admitted."),
          )
      })
      .finally(() => {
        if (!owner.signal.aborted) setState("pending", false)
      })
  }
  const confirm = () => {
    const value = state.preview
    if (!idle() || !value?.value.available) return
    if (!state.confirm) {
      setState("confirm", true)
      return
    }
    void execute(
      value.kind === "migration"
        ? { kind: "migration", id: MemoryOperation.ID.create(), preview: value.value }
        : { kind: "recovery", id: MemoryOperation.ID.create(), preview: value.value },
    )
  }
  onMount(() => void poll())
  onCleanup(() => {
    owner.abort()
    clearTimeout(observation.timer)
  })
  useBindings(() => ({
    priority: 1,
    bindings: [
      { key: "escape", desc: "Close Memory operations", group: "Memory", cmd: props.onClose },
      { key: "pageup", desc: "Scroll Memory details up", group: "Memory", cmd: () => detail?.scrollBy(-6) },
      { key: "pagedown", desc: "Scroll Memory details down", group: "Memory", cmd: () => detail?.scrollBy(6) },
    ],
  }))
  useKeyboard((key) => {
    if (key.ctrl || key.meta) return
    if (key.name === "r" && !state.pending) {
      key.preventDefault()
      observation.version++
      void refresh()
      return
    }
    if (key.name === "u" && state.uncertain && !state.pending) {
      key.preventDefault()
      void execute(state.uncertain)
      return
    }
    if (!idle()) return
    if (key.name === "up" || key.name === "down") {
      key.preventDefault()
      const index = state.items.findIndex((row) => row.id === state.selected)
      setState({
        selected:
          state.items[Math.max(0, Math.min(state.items.length - 1, index + (key.name === "down" ? 1 : -1)))]?.id,
        preview: undefined,
        confirm: false,
      })
    }
    if (key.name === "s") {
      key.preventDefault()
      setState({ scope: state.scope === "workspace" ? "global" : "workspace", preview: undefined, confirm: false })
    }
    if (key.name === "f" || key.name === "d") {
      key.preventDefault()
      void execute({ kind: key.name === "f" ? "flush" : "dream", id: MemoryOperation.ID.create() })
    }
    if (["l", "i", "p", "c"].includes(key.name)) {
      key.preventDefault()
      void preview(
        key.name === "l" ? "relocation" : key.name === "i" ? "carryover" : key.name === "p" ? "discard" : "clear",
      )
    }
    if (key.name === "return" || (key.name === "y" && state.confirm)) {
      key.preventDefault()
      confirm()
    }
    if (key.name === "n") {
      key.preventDefault()
      setState({ preview: undefined, confirm: false })
    }
    if (key.name === "x" && selected()?.ownership === "local" && selected()?.state !== "finished") {
      key.preventDefault()
      void execute({ kind: "cancel", operationID: selected()!.id })
    }
    if (key.name === "t" && selected() && selected()!.ownership !== "local") {
      key.preventDefault()
      void execute({ kind: "retry", id: MemoryOperation.ID.create(), retryOf: selected()!.id })
    }
  })
  return (
    <box height={height()} flexDirection="column" gap={1}>
      <text fg={props.theme().text} flexShrink={0}>
        Memory operations · {state.scope} ·{" "}
        {state.pending
          ? "Working…"
          : state.uncertain
            ? "Request outcome unknown"
            : state.confirm
              ? "Ready · Confirm with y"
              : "Ready"}
      </text>
      <text fg={props.theme().muted} flexShrink={0}>
        Opening this view does not start work. Closing it does not cancel work.
      </text>
      <box flexDirection="column" flexShrink={0}>
        <For each={state.items.slice(offset(), offset() + rows())}>
          {(row) => (
            <text fg={row.id === state.selected ? props.theme().highlight : props.theme().text}>
              {row.id === state.selected ? "› " : "  "}
              {row.kind} · {row.state} · {row.ownership} · {row.result ? resultText(row.result) : "Awaiting result"}
            </text>
          )}
        </For>
        <Show when={!state.items.length}>
          <text fg={props.theme().muted}>
            No operation receipts yet. Capture appears here after an eligible completed turn.
          </text>
        </Show>
      </box>
      <scrollbox
        ref={(value) => {
          detail = value
        }}
        flexGrow={1}
        flexBasis={0}
        minHeight={2}
      >
        <Show when={state.error}>
          <text fg={props.theme().error}>{state.error}</text>
        </Show>
        <Show
          keyed
          when={state.preview}
          fallback={
            <Show when={selected()}>
              {(row) => (
                <box flexDirection="column">
                  <text fg={props.theme().muted}>{row().id}</text>
                  <Show when={row().ownership === "unverified"}>
                    <text fg={props.theme().text}>
                      Ownership is unverified. This does not mean the worker is dead; the server decides whether
                      explicit retry is safe.
                    </text>
                  </Show>
                  <Show when={row().result}>
                    {(result) => (
                      <>
                        <text fg={props.theme().text}>
                          {resultText(result())} · Processed: {result().processed ?? 0} · Topics: {result().topics ?? 0}
                        </text>
                        <Show
                          when={
                            (result().status !== "retry_required" || (result().deferred ?? 0) === 0) &&
                            (result().deferred !== undefined || result().unplaceable !== undefined)
                          }
                        >
                          <text fg={props.theme().muted}>
                            Deferred notes: {result().deferred ?? 0} · Unplaced notes archived:{" "}
                            {result().unplaceable ?? 0}
                          </text>
                        </Show>
                        <Show when={result().shadow}>
                          <text fg={props.theme().muted}>Shadow validation only; no topics were published.</text>
                        </Show>
                        <Show when={result().committed}>
                          <text fg={props.theme().text}>
                            The action was durably committed. Filesystem settlement may still require an explicit retry.
                          </text>
                        </Show>
                        <Show when={result().reason}>
                          <text fg={props.theme().error}>
                            {result().reason === "historical_capture_ownership"
                              ? "Older capture history cannot be attributed safely. Start a new Session to capture memory."
                              : "The original source, mode or scope is no longer eligible. No fresh source was substituted."}
                          </text>
                        </Show>
                      </>
                    )}
                  </Show>
                </box>
              )}
            </Show>
          }
        >
          {(value) => (
            <box flexDirection="column">
              <text fg={props.theme().text}>
                {value.kind === "migration" ? "Migration preview" : "Recovery preview"} · {value.value.scope} ·
                Generation: {value.value.generation}
              </text>
              <Show when={value.kind === "recovery"}>
                {(() => {
                  const item = value
                  return item.kind === "recovery" ? (
                    <>
                      <text fg={props.theme().text}>
                        {item.value.action} · Files: {item.value.files} · Plans: {item.value.plans}
                      </text>
                      <Show when={item.value.reason}>
                        <text fg={props.theme().error}>{item.value.reason ? reasons[item.value.reason] : ""}</text>
                      </Show>
                    </>
                  ) : undefined
                })()}
              </Show>
              <Show when={value.kind === "migration"}>
                <text fg={props.theme().text}>
                  {value.kind === "migration" && value.value.kind === "relocation"
                    ? "Copy the fixed legacy scope to its canonical location without switching backend."
                    : "Import the fixed legacy scope into Memory V2. Original files remain unchanged."}
                </text>
              </Show>
              <Show when={!value.value.available}>
                <text fg={props.theme().error}>This preview is unavailable. No action can be confirmed.</text>
              </Show>
              <Show when={state.confirm}>
                <text fg={props.theme().error}>
                  {value.kind === "recovery" && value.value.action === "clear"
                    ? "Clear the reviewed notes and prepared plans in this scope? This cannot be undone. y confirms; n goes back."
                    : "Apply exactly this reviewed preview? y confirms; n goes back."}
                </text>
              </Show>
            </box>
          )}
        </Show>
      </scrollbox>
      <box flexDirection="column" flexShrink={0}>
        <text fg={idle() ? props.theme().muted : props.theme().error}>
          f extract · d Dream · s scope · l relocate · i import
        </text>
        <text fg={idle() ? props.theme().muted : props.theme().error}>
          p discard preview · c clear preview · enter review/confirm · n back
        </text>
        <text fg={props.theme().muted}>↑↓ select · t retry · x cancel · r refresh · u repeat · PgUp/PgDn · esc</text>
      </box>
    </box>
  )
}

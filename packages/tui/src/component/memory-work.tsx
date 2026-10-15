/** @jsxImportSource @opentui/solid */
import { useKeyboard } from "@opentui/solid"
import type { ColorInput } from "@opentui/core"
import { onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { MemoryWorkInfo } from "@apexo/sdk/v2"
import { useBindings } from "../keymap"

export type MemoryWorkActions = {
  get: (signal: AbortSignal) => Promise<MemoryWorkInfo | null>
  start: (kind: "flush" | "dream", signal: AbortSignal) => Promise<MemoryWorkInfo>
  cancel: (id: string, signal: AbortSignal) => Promise<MemoryWorkInfo>
}
export function MemoryWork(props: {
  actions: MemoryWorkActions
  kind?: "flush" | "dream"
  onClose: () => void
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  height?: number
}) {
  const abort = new AbortController()
  const [state, setState] = createStore({ info: null as MemoryWorkInfo | null, pending: false, error: false })
  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = async () => {
    await props.actions
      .get(abort.signal)
      .then((info) => {
        if (!abort.signal.aborted && !state.pending) setState({ info, error: false })
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!abort.signal.aborted) timer = setTimeout(refresh, state.info?.state === "running" ? 400 : 2000)
      })
  }
  const start = async (kind: "flush" | "dream") => {
    if (state.pending || state.info?.state === "running") return
    setState({ pending: true, error: false })
    await props.actions
      .start(kind, abort.signal)
      .then((info) => {
        if (!abort.signal.aborted) setState("info", info)
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!abort.signal.aborted) setState("pending", false)
      })
  }
  const cancel = async () => {
    const info = state.info
    if (!info || info.state !== "running" || state.pending) return
    setState({ pending: true, error: false })
    await props.actions
      .cancel(info.id, abort.signal)
      .then((info) => {
        if (!abort.signal.aborted) setState("info", info)
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!abort.signal.aborted) setState("pending", false)
      })
  }
  onMount(() => {
    if (props.kind) void start(props.kind)
    void refresh()
  })
  onCleanup(() => {
    abort.abort()
    clearTimeout(timer)
  })
  useBindings(() => ({
    priority: 1,
    bindings: [{ key: "escape", desc: "Close memory operations", group: "Memory", cmd: props.onClose }],
  }))
  useKeyboard((key) => {
    if (key.ctrl || key.meta) return
    if (key.name === "f") {
      key.preventDefault()
      void start("flush")
    }
    if (key.name === "d") {
      key.preventDefault()
      void start("dream")
    }
    if (key.name === "x") {
      key.preventDefault()
      void cancel()
    }
  })
  const messages = {
    completed: "Memory operation completed.",
    shadow: "Plan validated. No topics or archives were written.",
    no_work: "No new memory to save.",
    disabled: "Memory is disabled for this session.",
    busy: "Work is already running. Try again when it finishes.",
    denied: "Permission denied for these memory notes.",
    conflict: "Memory changed. Your changes were preserved; try again.",
    cancelled: "Memory operation cancelled.",
    failed: "Memory operation failed. You can try again.",
    retry_required: "This operation requires an explicit retry. Its original request will be preserved.",
    timed_out: "Memory operation timed out. You can try again.",
    too_soon: "No new memory to save.",
    too_few_sessions: "No new memory to save.",
  }
  return (
    <box height={props.height ?? 16} width="100%" flexDirection="column" gap={1}>
      <text fg={props.theme().text}>Memory operations · f extract · d consolidate · x cancel · esc close</text>
      <text fg={props.theme().muted}>Work continues after closing. Reopen from /memory to see the result.</text>
      <Show
        when={state.info}
        fallback={
          <text fg={props.theme().muted}>
            {state.pending ? "Loading…" : "No memory operation has run in this session."}
          </text>
        }
      >
        {(info) => (
          <>
            <text fg={props.theme().text}>{info().kind === "flush" ? "Extract memory" : "Consolidate memory"}</text>
            <text fg={props.theme().highlight}>
              {info().state !== "running" &&
              info().result?.status === "retry_required" &&
              (info().result?.deferred ?? 0) > 0
                ? `Deferred notes: ${info().result?.deferred ?? 0} · Unplaced notes archived: ${info().result?.unplaceable ?? 0}`
                : info().state === "running"
                  ? info().kind === "flush"
                    ? "Extracting durable knowledge…"
                    : "Consolidating saved notes…"
                  : info().result?.status === "conflict" && info().result?.reason === "historical_capture_ownership"
                    ? "This session’s older capture history cannot be attributed safely. Start a new session to capture memory."
                    : messages[info().result?.status ?? "failed"]}
            </text>
            <Show when={info().result?.path}>
              <text wrapMode="char" fg={props.theme().muted}>
                {info().result?.path}
              </text>
            </Show>
            <Show when={info().result?.processed !== undefined}>
              <text fg={props.theme().muted}>Records processed: {info().result?.processed}</text>
            </Show>
            <Show
              when={
                (info().state === "running" ||
                  info().result?.status !== "retry_required" ||
                  (info().result?.deferred ?? 0) === 0) &&
                (info().result?.deferred !== undefined || info().result?.unplaceable !== undefined)
              }
            >
              <text fg={props.theme().muted}>
                Deferred notes: {info().result?.deferred ?? 0} · Unplaced notes archived:{" "}
                {info().result?.unplaceable ?? 0}
              </text>
            </Show>
            <Show when={info().result?.chars !== undefined}>
              <text fg={props.theme().muted}>Characters written: {info().result?.chars}</text>
            </Show>
            <Show when={info().result?.topics !== undefined}>
              <text fg={props.theme().muted}>Topics: {info().result?.topics}</text>
            </Show>
          </>
        )}
      </Show>
      <Show when={state.error}>
        <text fg={props.theme().error}>Could not update memory operation status. Try again.</text>
      </Show>
    </box>
  )
}

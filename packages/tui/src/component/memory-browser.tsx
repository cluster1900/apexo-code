/** @jsxImportSource @opentui/solid */
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { type ColorInput, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { MemoryNoteSummary, MemoryNoteDetail, MemoryModeInfo } from "@apexo/sdk/v2"
import { MemoryHealthPanel } from "./memory-health"
import { useClipboard } from "../context/clipboard"
import { memoryError } from "../util/session-memory"
import { useBindings } from "../keymap"

export type MemoryBrowserActions = {
  native?: boolean
  operations?: (owner: AbortSignal) => import("../util/memory-operations").MemoryOperationsActions
  health?: (signal: AbortSignal) => Promise<import("@apexo/sdk/v2").MemoryHealthInfo>
  review?: import("./memory-review").MemoryReviewActions
  work?: import("./memory-work").MemoryWorkActions
  status: (signal: AbortSignal) => Promise<MemoryModeInfo>
  toggle: (enabled: boolean, signal: AbortSignal) => Promise<MemoryModeInfo>
  list: (search: string, signal: AbortSignal) => Promise<MemoryNoteSummary[]>
  get: (path: string, signal: AbortSignal) => Promise<MemoryNoteDetail>
  forget: (input: { path: string; hash: string }, signal: AbortSignal) => Promise<unknown>
}

export function MemoryBrowser(props: {
  actions: MemoryBrowserActions
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  onClose: () => void
  onWork?: () => void
  height?: number
}) {
  const dimensions = useTerminalDimensions()
  const clipboard = useClipboard()
  let preview: ScrollBoxRenderable | undefined
  const [state, setState] = createStore({
    health: false,
    items: [] as MemoryNoteSummary[],
    detail: undefined as MemoryNoteDetail | undefined,
    selected: 0,
    query: "",
    filtering: false,
    preview: false,
    confirm: false,
    pending: false,
    loading: false,
    error: "",
    notice: "",
    reload: 0,
    mode: undefined as MemoryModeInfo | undefined,
  })
  const selected = createMemo(() => state.items[state.selected]?.path)
  const height = () => props.height ?? Math.max(12, Math.min(30, dimensions().height - 10))
  const rows = () => Math.max(2, Math.min(6, height() - 8))
  const offset = () => Math.max(0, state.selected - rows() + 1)
  const split = () => dimensions().width >= 64
  createEffect(() => {
    if (state.health) return
    const actions = props.actions
    state.reload
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      await actions
        .status(abort.signal)
        .then((mode) => {
          if (!abort.signal.aborted && !state.pending) setState("mode", mode)
        })
        .catch((error) => {
          if (!abort.signal.aborted)
            setState({
              error: memoryError(error, "Could not load memory state. Press r to refresh."),
              mode: undefined,
              items: [],
              detail: undefined,
              confirm: false,
            })
        })
        .finally(() => {
          if (!abort.signal.aborted) timer = setTimeout(refresh, state.mode?.busy ? 250 : 2000)
        })
    }
    void refresh()
    onCleanup(() => {
      abort.abort()
      clearTimeout(timer)
    })
  })
  createEffect(() => {
    if (state.health) return
    const actions = props.actions
    const query = state.query
    state.reload
    if (!state.mode?.enabled) {
      setState({ items: [], selected: 0, detail: undefined, filtering: false, confirm: false, preview: false })
      return
    }
    const abort = new AbortController()
    setState({ loading: true, confirm: false, error: "" })
    void actions
      .list(query, abort.signal)
      .then((items) => {
        if (abort.signal.aborted) return
        setState({ items, selected: 0 })
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setState({
            error: memoryError(error, "Could not load notes. Press r to refresh."),
            items: [],
            detail: undefined,
            confirm: false,
          })
      })
      .finally(() => {
        if (!abort.signal.aborted) setState("loading", false)
      })
    onCleanup(() => abort.abort())
  })
  createEffect(() => {
    if (state.health) return
    const actions = props.actions
    const path = selected()
    state.reload
    const abort = new AbortController()
    setState({ detail: undefined, confirm: false, notice: "" })
    if (path)
      void actions
        .get(path, abort.signal)
        .then((detail) => {
          if (!abort.signal.aborted) setState("detail", detail)
        })
        .catch((error) => {
          if (!abort.signal.aborted)
            setState({
              error: memoryError(error, "Could not read this note. Press r to refresh."),
              detail: undefined,
              confirm: false,
            })
        })
    onCleanup(() => abort.abort())
  })
  createEffect(() => {
    const content = state.detail?.content
    if (!content) return
    const term = state.query.split(/\s+/u).find(Boolean)?.toLowerCase()
    const line = term ? content.split("\n").findIndex((line) => line.toLowerCase().includes(term)) : 0
    preview?.scrollTo(Math.max(0, line))
  })
  const abort = new AbortController()
  onCleanup(() => abort.abort())
  const toggle = async () => {
    if (!state.mode?.canToggle || state.pending) return
    const enabled = !state.mode.enabled
    if (enabled && state.mode.busy) return
    setState({ pending: true, confirm: false, error: "" })
    await props.actions
      .toggle(enabled, abort.signal)
      .then((mode) => {
        if (!abort.signal.aborted) setState("mode", mode)
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setState({
            error: memoryError(error, "Could not change memory state. Press r to refresh."),
            mode: undefined,
            items: [],
            detail: undefined,
            confirm: false,
          })
      })
      .finally(() => {
        if (abort.signal.aborted) return
        setState("pending", false)
        setState("reload", (value) => value + 1)
      })
  }
  const forget = async () => {
    const note = state.detail
    if (!note?.hash || !note.deletable || state.pending) return
    setState({ pending: true, error: "" })
    await props.actions
      .forget({ path: note.path, hash: note.hash }, abort.signal)
      .then(() => {
        if (abort.signal.aborted) return
        setState({ detail: undefined, confirm: false })
        setState("reload", (value) => value + 1)
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setState({ detail: undefined, error: "Deletion failed or the note changed. Press r to preview it again." })
      })
      .finally(() => {
        if (!abort.signal.aborted) setState({ pending: false, confirm: false })
      })
  }
  // DialogProvider also binds Escape. Resolve the local back action in the
  // keymap before the containing dialog closes, including while an input owns focus.
  useBindings(() => ({
    priority: 1,
    bindings: [
      {
        key: "escape",
        desc: "Back in memory browser",
        group: "Memory",
        cmd: () => {
          if (state.health) {
            setState("health", false)
            return
          }
          if (state.pending) return
          if (state.filtering) {
            setState("filtering", false)
            return
          }
          if (state.confirm) {
            setState("confirm", false)
            return
          }
          if (state.preview) {
            setState("preview", false)
            return
          }
          props.onClose()
        },
      },
    ],
  }))
  useBindings(() => ({
    enabled: !!props.actions.health && !state.health && !state.pending && !state.filtering,
    priority: 1,
    bindings: [{ key: "h", desc: "Memory diagnostics", group: "Memory", cmd: () => setState("health", true) }],
  }))
  useKeyboard((key) => {
    if (key.name === "escape") return
    if (state.health) return
    if (state.pending) {
      key.preventDefault()
      return
    }
    if (state.filtering) {
      if (key.name !== "return") return
      key.preventDefault()
      setState("filtering", false)
      return
    }
    if (key.ctrl || key.meta) return
    if (key.name === "t") {
      key.preventDefault()
      void toggle()
      return
    }
    if (key.name === "o" && props.onWork) {
      key.preventDefault()
      props.onWork()
      return
    }
    if (!state.mode?.enabled && key.name !== "r") return
    if (["up", "down", "j", "k", "pageup", "pagedown"].includes(key.name)) {
      key.preventDefault()
      const direction = ["up", "k", "pageup"].includes(key.name) ? -1 : 1
      const amount = key.name.startsWith("page") ? 10 : 1
      if (state.preview) {
        preview?.scrollBy(direction * amount)
        return
      }
      setState("selected", (value) => Math.max(0, Math.min(state.items.length - 1, value + direction * amount)))
      return
    }
    if (key.name === "/" || key.sequence === "/") {
      key.preventDefault()
      setState({ filtering: true, confirm: false })
      return
    }
    if (key.name === "return") {
      key.preventDefault()
      setState("preview", true)
      return
    }
    if (key.name === "r") {
      key.preventDefault()
      setState("reload", (value) => value + 1)
      return
    }
    if (key.name === "backspace") {
      key.preventDefault()
      setState("query", "")
      return
    }
    if (key.name === "y" && selected()) {
      key.preventDefault()
      void clipboard.write?.(selected()!).then(
        () => setState("notice", "Path copied"),
        () => setState("error", "Could not copy path"),
      )
      return
    }
    if (key.name === "x" && state.detail?.deletable) {
      key.preventDefault()
      if (state.confirm) {
        void forget()
        return
      }
      setState("confirm", true)
    }
  })
  return (
    <box height={height()} width="100%" flexDirection="column">
      <Show
        when={state.health}
        fallback={
          <box height={height()} width="100%" flexDirection="column">
            <text height={1} flexShrink={0} fg={props.theme().text}>
              {"Memory · ↑↓ select · / search · enter preview · x delete" +
                (props.onWork ? " · o operations" : "") +
                (props.actions.health ? " · h health" : "") +
                " · esc back"}
            </text>
            <text height={1} flexShrink={0} fg={props.theme().text}>
              {!state.mode
                ? "Loading memory state…"
                : !state.mode.enabled && state.mode.busy
                  ? "Memory is off; wait for the current turn, then press t to enable"
                  : state.mode.enabled
                    ? "Memory enabled for this session · t disable"
                    : "Memory disabled; saved notes are kept · t enable"}
            </text>
            <Show
              when={state.filtering}
              fallback={
                <text height={1} flexShrink={0} fg={props.theme().muted}>
                  {state.query ? `Filter: ${state.query}` : "Global / Workspace / Sessions · y copy path · r refresh"}
                </text>
              }
            >
              <box height={1} flexShrink={0}>
                <input
                  focused
                  value={state.query}
                  placeholder="Search names and contents"
                  onInput={(value) => setState("query", value)}
                />
              </box>
            </Show>
            <Show when={props.actions.native}>
              <text fg={props.theme().muted}>
                Browse notes here; open operations for capture, Dream, migration and reviewed recovery.
              </text>
            </Show>
            <Show when={state.error}>
              <text height={1} flexShrink={0} fg={props.theme().error}>
                {state.error}
              </text>
            </Show>
            <Show when={state.confirm}>
              <text height={1} flexShrink={0} fg={props.theme().error}>
                Delete {state.detail?.name}? Press x again to confirm, Esc to cancel.
              </text>
            </Show>
            <Show when={state.notice}>
              <text height={1} flexShrink={0} fg={props.theme().muted}>
                {state.notice}
              </text>
            </Show>
            <Show when={state.mode?.enabled}>
              <box flexDirection={split() ? "row" : "column"} height={height() - 7} flexShrink={0} width="100%">
                <Show when={split() || !state.preview}>
                  <box width={split() ? "42%" : "100%"} flexDirection="column">
                    <Show when={state.loading}>
                      <text fg={props.theme().muted}>Loading…</text>
                    </Show>
                    <Show when={!state.loading && !state.items.length}>
                      <text fg={props.theme().muted}>No matching memory notes.</text>
                    </Show>
                    <For each={state.items.slice(offset(), offset() + rows())}>
                      {(note) => (
                        <text
                          fg={selected() === note.path ? props.theme().highlight : props.theme().text}
                          onMouseUp={() => {
                            if (!state.pending)
                              setState(
                                "selected",
                                state.items.findIndex((item) => item.path === note.path),
                              )
                          }}
                        >
                          {selected() === note.path ? "› " : "  "}
                          {note.source}: {note.name}
                        </text>
                      )}
                    </For>
                  </box>
                </Show>
                <Show when={split() || state.preview}>
                  <box width={split() ? "58%" : "100%"} flexDirection="column">
                    <text height={1} flexShrink={0} fg={props.theme().muted}>
                      {state.detail?.name ?? "Preview"}
                    </text>
                    <scrollbox
                      ref={(value) => {
                        preview = value
                      }}
                      height={height() - 9}
                      width="100%"
                    >
                      <text fg={props.theme().text}>{state.detail?.content ?? ""}</text>
                    </scrollbox>
                    <Show when={state.detail?.truncated}>
                      <text fg={props.theme().muted}>First 256 KiB only; deletion unavailable.</text>
                    </Show>
                  </box>
                </Show>
              </box>
            </Show>
          </box>
        }
      >
        <MemoryHealthPanel load={props.actions.health!} theme={props.theme} height={height()} />
      </Show>
    </box>
  )
}

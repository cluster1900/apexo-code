/** @jsxImportSource @opentui/solid */
import { useKeyboard } from "@opentui/solid"
import type { ColorInput, TextareaRenderable } from "@opentui/core"
import { onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useBindings } from "../keymap"

export type MemoryReviewActions = {
  save: (content: string, scope: "global" | "workspace", signal: AbortSignal) => Promise<{ path: string }>
  rewrite: (content: string, signal: AbortSignal) => Promise<{ content: string }>
}

export function MemoryReview(props: {
  actions: MemoryReviewActions
  content?: string
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  onClose: () => void
  height?: number
}) {
  let editor: TextareaRenderable | undefined
  const requests = { rewrite: undefined as AbortController | undefined }
  const lifetime = new AbortController()
  const [state, setState] = createStore({
    raw: props.content?.trim() ?? "",
    rewritten: "",
    enhanced: false,
    editing: !props.content?.trim(),
    rewriting: false,
    saving: false,
    error: "",
    saved: "",
    scope: "global" as "global" | "workspace",
  })
  const content = () => (state.enhanced ? state.rewritten : state.raw)
  const rewrite = async () => {
    if (!state.raw.trim()) return
    requests.rewrite?.abort()
    const abort = new AbortController()
    requests.rewrite = abort
    setState({ editing: false, rewriting: true, error: "" })
    await props.actions
      .rewrite(state.raw, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) setState("rewritten", result.content)
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("error", "Rewrite failed; the original note is still available")
      })
      .finally(() => {
        if (!abort.signal.aborted) setState("rewriting", false)
      })
  }
  const save = async () => {
    if (state.saving || !content().trim()) return
    requests.rewrite?.abort()
    setState({ saving: true, rewriting: false, error: "" })
    await props.actions
      .save(content(), state.scope, lifetime.signal)
      .then((result) => {
        if (!lifetime.signal.aborted) setState("saved", result.path)
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", "Save failed; your draft is kept. Try again.")
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("saving", false)
      })
  }
  onMount(() => {
    if (state.raw) void rewrite()
  })
  onCleanup(() => {
    lifetime.abort()
    requests.rewrite?.abort()
  })
  useBindings(() => ({
    priority: 1,
    bindings: [
      {
        key: "escape",
        desc: "Close memory review",
        group: "Memory",
        cmd: () => {
          if (!state.saving) props.onClose()
        },
      },
    ],
  }))
  useKeyboard((key) => {
    if (key.name === "escape") return
    if (state.saving) {
      key.preventDefault()
      return
    }
    if (state.saved) {
      if (key.name === "return") props.onClose()
      return
    }
    if (state.editing) {
      if (key.ctrl && key.name === "s") {
        key.preventDefault()
        setState("raw", editor?.plainText ?? state.raw)
        void rewrite()
      }
      return
    }
    if (key.ctrl || key.meta) return
    if (key.name === "return" || key.name === "y") {
      key.preventDefault()
      void save()
      return
    }
    if (key.name === "tab" && state.rewritten) {
      key.preventDefault()
      setState("enhanced", !state.enhanced)
      return
    }
    if (key.name === "e") {
      key.preventDefault()
      requests.rewrite?.abort()
      setState({ raw: content(), enhanced: false, rewritten: "", editing: true, rewriting: false, error: "" })
      return
    }
    if (key.name === "r" && !state.rewriting) {
      key.preventDefault()
      void rewrite()
      return
    }
    if (key.name === "g" || key.name === "w") {
      key.preventDefault()
      setState("scope", key.name === "g" ? "global" : "workspace")
    }
  })
  return (
    <box width="100%" height={props.height ?? 18} flexDirection="column" gap={1}>
      <text fg={props.theme().text}>Review memory note · esc cancel</text>
      <Show
        when={!state.saved}
        fallback={<text fg={props.theme().highlight}>Memory saved to {state.saved} · enter close</text>}
      >
        <text fg={props.theme().muted}>
          {state.editing
            ? "Edit note · ctrl+s review"
            : "enter/y save · e edit · tab original/rewrite · r rewrite · g global / w workspace"}
        </text>
        <text fg={props.theme().muted}>
          Scope: {state.scope} · {state.enhanced ? "Rewritten note" : "Original note"}
        </text>
        <Show
          when={state.editing}
          fallback={
            <scrollbox flexGrow={1}>
              <text fg={props.theme().text}>{content()}</text>
            </scrollbox>
          }
        >
          <textarea
            ref={(value: TextareaRenderable) => {
              editor = value
            }}
            focused
            initialValue={state.raw}
            flexGrow={1}
            textColor={props.theme().text}
            focusedTextColor={props.theme().text}
          />
        </Show>
        <Show when={state.rewriting}>
          <text fg={props.theme().muted}>Rewriting… You can still save the original.</text>
        </Show>
        <Show when={state.rewritten && !state.editing && !state.rewriting}>
          <text fg={props.theme().muted}>Rewritten note available · tab switches the preview.</text>
        </Show>
        <Show when={state.saving}>
          <text fg={props.theme().muted}>Saving memory note…</text>
        </Show>
        <Show when={state.error}>
          <text fg={props.theme().error}>{state.error}</text>
        </Show>
      </Show>
    </box>
  )
}

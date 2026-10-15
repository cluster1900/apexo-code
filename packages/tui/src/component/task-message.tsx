/** @jsxImportSource @opentui/solid */
import { useKeyboard } from "@opentui/solid"
import type { ColorInput, TextareaRenderable } from "@opentui/core"
import { createSignal, onCleanup, Show } from "solid-js"
import type { taskMessageDraft } from "@apexo/sdk/v2/task-message"
import { useBindings } from "../keymap"

export function TaskMessage(props: {
  target: () => string
  draft: ReturnType<typeof taskMessageDraft>
  available: () => boolean
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput }
  onClose: () => void
}) {
  const draft = props.draft
  const [state, setState] = createSignal(draft?.state())
  const abort = new AbortController()
  const unsubscribe = draft?.subscribe(setState)
  let editor: TextareaRenderable | undefined
  const refresh = () => draft?.refresh(AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]))
  const timer = setInterval(() => void refresh(), 2_000)
  void refresh()
  onCleanup(() => {
    abort.abort()
    clearInterval(timer)
    unsubscribe?.()
  })
  useBindings(() => ({
    priority: 3,
    bindings: [
      {
        key: "escape",
        desc: "Back to Tasks",
        group: "Task message",
        cmd: () => {
          props.onClose()
        },
      },
    ],
  }))
  useKeyboard((key) => {
    const current = state()
    if (!current || key.name === "escape") return
    if (key.name === "tab" && props.available() && !current.input && !current.pending) {
      key.preventDefault()
      draft?.edit(
        current.text,
        current.delivery === "steer" ? "queue" : current.delivery === "queue" ? "interject" : "steer",
      )
    }
    if (!key.ctrl) return
    if (key.name === "r") {
      key.preventDefault()
      void refresh()
    }
    if (key.name === "s") {
      key.preventDefault()
      if (props.available()) void draft?.send(AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]))
    }
    if (key.name === "n" && props.available() && current.receipt && !current.pending) {
      key.preventDefault()
      draft?.next()
      editor?.setText("")
    }
  })
  const errors = {
    invalid: "Enter a nonblank message, at most 32,768 UTF-8 bytes.",
    forbidden: "Messaging disabled or denied by current permissions, Agent or Goal. Text kept.",
    missing: "Task unavailable to this parent. Text and message ID kept.",
    conflict: "Task or message changed. Refresh receipt before retrying the same message.",
    uncertain: "Delivery unconfirmed. Text and ID kept. Refresh or retry the same message; do not send a new copy.",
  }
  const receipts = {
    admitted: "Accepted; waiting for the child to read it.",
    promoted: "Delivered to child. This does not mean the Task completed.",
    cancelled: "Cancelled before delivery.",
    interrupted: "Interrupted before delivery.",
  }
  return (
    <box id="task-message-editor" flexDirection="column" flexGrow={1} width="100%">
      <text fg={props.theme().text}>Message this Task · esc back</text>
      <text fg={props.theme().muted}>{props.target()}</text>
      <Show when={state()} fallback={<text fg={props.theme().error}>Too many unresolved message receipts.</text>}>
        {(current) => (
          <>
            <text fg={props.theme().muted}>
              Requires Task messaging enabled. Completed Tasks continue in the same child.
            </text>
            <text fg={props.theme().text}>
              Delivery: {current().delivery}
              {!current().input && !current().pending && props.available() ? " · Tab change" : ""}
            </text>
            <text fg={props.theme().muted}>
              {current().delivery === "steer"
                ? "Next safe provider-turn boundary."
                : current().delivery === "queue"
                  ? "When this Task would otherwise become idle."
                  : "Priority at safe boundary; may end a passive wait. Does not cancel model work."}
            </text>
            <textarea
              id="task-message-text"
              ref={(value) => {
                editor = value
              }}
              initialValue={current().text}
              focused={!current().input && !current().pending && props.available()}
              height={4}
              width="100%"
              textColor={props.theme().text}
              focusedTextColor={props.theme().text}
              onContentChange={() => draft?.edit(editor?.plainText ?? "")}
            />
            <Show when={current().input}>{(input) => <text fg={props.theme().muted}>{input().inputID}</text>}</Show>
            <Show when={current().receipt}>
              {(receipt) => <text fg={props.theme().text}>{receipts[receipt().status]}</text>}
            </Show>
            <Show when={current().issue}>{(issue) => <text fg={props.theme().error}>{errors[issue()]}</text>}</Show>
            <Show when={!props.available()}>
              <text fg={props.theme().muted}>This Task cannot accept new messages.</text>
            </Show>
            <text id="task-message-actions" fg={props.theme().muted}>
              {current().pending
                ? "Sending…"
                : current().receipt
                  ? props.available()
                    ? "Ctrl+R receipt · Ctrl+N new message"
                    : "Ctrl+R receipt"
                  : current().input
                    ? "Ctrl+S retry same message · Ctrl+R receipt"
                    : "Ctrl+S send message"}
            </text>
          </>
        )}
      </Show>
    </box>
  )
}

/** @jsxImportSource @opentui/solid */
import { createEffect, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { MemoryCaptureActivity } from "@apexo/sdk/v2"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { memoryCaptureText } from "../util/memory-capture"
import { useBindings } from "../keymap"

export function MemoryCaptureNotifications(props: { sessionID: () => string }) {
  const sdk = useSDK()
  const theme = useTheme()
  const dialog = useDialog()
  const [state, setState] = createStore({ events: [] as MemoryCaptureActivity["data"][] })
  createEffect(() => {
    const id = props.sessionID()
    setState("events", [])
    onCleanup(
      sdk.event.on("event", (event) => {
        if (event.payload.type !== "memory.capture.activity" || event.payload.properties.sessionID !== id) return
        const info = event.payload.properties
        setState("events", (entries) => [...entries.slice(-19), info])
      }),
    )
  })
  const open = () =>
    dialog.replace(() => {
      dialog.setSize("large")
      return (
        <box flexDirection="column" padding={2}>
          <text fg={theme.theme.text}>Memory capture diagnostics · esc close</text>
          <text fg={theme.theme.textMuted}>Recent live notifications; not saved in session replay.</text>
          <scrollbox height={20} focused>
            <For each={state.events}>{(event) => <text fg={theme.theme.text}>{memoryCaptureText(event)}</text>}</For>
          </scrollbox>
        </box>
      )
    })
  useBindings(() => ({
    enabled: state.events.length > 0 && dialog.stack.length === 0,
    priority: 1,
    bindings: [{ key: "ctrl+alt+m", desc: "Memory capture diagnostics", group: "Memory", cmd: open }],
  }))
  return (
    <box flexDirection="column">
      <Show when={state.events.at(-1)}>
        {(event) => (
          <text fg={theme.theme.textMuted} onMouseUp={open}>
            {memoryCaptureText({ ...event(), memories: undefined })} · ctrl+alt+m details
          </text>
        )}
      </Show>
    </box>
  )
}

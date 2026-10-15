import { createStore } from "solid-js/store"
import { Show, createEffect, onCleanup } from "solid-js"
import { nativeMemoryActions } from "../util/session-memory"
import type { MemoryBrowserActions } from "./memory-browser"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { MemoryOperations } from "./memory-operations"
import { MemoryBrowser } from "./memory-browser"
import { DialogMemoryWork } from "./dialog-memory-work"

export function DialogMemory(props: { sessionID: string; operations?: boolean }) {
  const sdk = useSDK()
  const theme = useTheme()
  const dialog = useDialog()
  createEffect(() => dialog.setSize("large"))
  const compatibility: MemoryBrowserActions = {
    health: async (signal) =>
      (await sdk.client.experimental.memory.health({ sessionID: props.sessionID }, { throwOnError: true, signal }))
        .data,
    status: async (signal) =>
      (await sdk.client.experimental.memory.status({ sessionID: props.sessionID }, { throwOnError: true, signal }))
        .data,
    toggle: async (enabled, signal) =>
      (
        await sdk.client.experimental.memory.toggle(
          { sessionID: props.sessionID, memoryModeUpdate: { enabled } },
          { throwOnError: true, signal },
        )
      ).data,
    list: async (search, signal) =>
      (
        await sdk.client.experimental.memory.list(
          { sessionID: props.sessionID, search },
          { throwOnError: true, signal },
        )
      ).data,
    get: async (path, signal) =>
      (await sdk.client.experimental.memory.get({ sessionID: props.sessionID, path }, { throwOnError: true, signal }))
        .data,
    forget: (note, signal) =>
      sdk.client.experimental.memory.forget(
        { sessionID: props.sessionID, memoryNoteForget: note },
        { throwOnError: true, signal },
      ),
  }
  const [state, setState] = createStore<{ actions?: MemoryBrowserActions; failed: boolean; operations: boolean }>({
    failed: false,
    operations: props.operations ?? false,
  })
  createEffect(() => {
    let active = true
    void sdk
      .transport()
      .then((transport) => {
        if (active)
          setState(
            "actions",
            transport.kind === "native" ? nativeMemoryActions(sdk.client, async () => props.sessionID) : compatibility,
          )
      })
      .catch(() => {
        if (active) setState("failed", true)
      })
    onCleanup(() => {
      active = false
    })
  })
  return (
    <box flexDirection="column">
      <Show
        when={state.actions}
        fallback={
          <text fg={theme.theme.textMuted}>
            {state.failed ? "Memory management is unavailable." : "Loading memory management…"}
          </text>
        }
      >
        <Show
          when={state.operations && state.actions?.operations}
          fallback={
            <MemoryBrowser
              theme={() => ({
                text: theme.theme.text,
                muted: theme.theme.textMuted,
                error: theme.theme.error,
                highlight: theme.theme.primary,
              })}
              onClose={() => dialog.clear()}
              onWork={
                state.actions?.operations
                  ? () => setState("operations", true)
                  : () => dialog.replace(() => <DialogMemoryWork sessionID={props.sessionID} />)
              }
              actions={state.actions!}
            />
          }
        >
          <MemoryOperations
            actions={state.actions!.operations!}
            onClose={() => setState("operations", false)}
            theme={() => ({
              text: theme.theme.text,
              muted: theme.theme.textMuted,
              error: theme.theme.error,
              highlight: theme.theme.primary,
            })}
          />
        </Show>
      </Show>
    </box>
  )
}

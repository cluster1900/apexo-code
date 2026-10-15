import { createEffect } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { MemoryWork } from "./memory-work"

export function DialogMemoryWork(props: { sessionID: string; kind?: "flush" | "dream" }) {
  const sdk = useSDK()
  const theme = useTheme()
  const dialog = useDialog()
  createEffect(() => dialog.setSize("large"))
  return (
    <MemoryWork
      kind={props.kind}
      onClose={() => dialog.clear()}
      theme={() => ({
        text: theme.theme.text,
        muted: theme.theme.textMuted,
        error: theme.theme.error,
        highlight: theme.theme.primary,
      })}
      actions={{
        get: async (signal) =>
          (
            await sdk.client.experimental.memory.operation(
              { sessionID: props.sessionID },
              { throwOnError: true, signal },
            )
          ).data,
        start: async (kind, signal) =>
          (
            await sdk.client.experimental.memory.start(
              { sessionID: props.sessionID, memoryWorkStart: { kind } },
              { throwOnError: true, signal },
            )
          ).data,
        cancel: async (id, signal) =>
          (
            await sdk.client.experimental.memory.cancel(
              { sessionID: props.sessionID, memoryWorkCancel: { id } },
              { throwOnError: true, signal },
            )
          ).data,
      }}
    />
  )
}

import { createEffect } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { MemoryReview } from "./memory-review"

export function DialogMemoryReview(props: { sessionID: string; content?: string }) {
  const sdk = useSDK()
  const theme = useTheme()
  const dialog = useDialog()
  createEffect(() => dialog.setSize("large"))
  return (
    <MemoryReview
      content={props.content}
      onClose={() => dialog.clear()}
      theme={() => ({
        text: theme.theme.text,
        muted: theme.theme.textMuted,
        error: theme.theme.error,
        highlight: theme.theme.primary,
      })}
      actions={{
        save: async (content, scope, signal) =>
          (
            await sdk.client.experimental.memory.remember(
              { sessionID: props.sessionID, memoryReviewSave: { content, scope } },
              { throwOnError: true, signal },
            )
          ).data,
        rewrite: async (content, signal) =>
          (
            await sdk.client.experimental.memory.rewrite(
              { sessionID: props.sessionID, memoryReviewRewrite: { content } },
              { throwOnError: true, signal },
            )
          ).data,
      }}
    />
  )
}

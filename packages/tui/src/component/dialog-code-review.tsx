import { createEffect } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { CodeReviewBrowser } from "./code-review-browser"

export function DialogCodeReview(props: { sessionID: string }) {
  const sdk = useSDK()
  const theme = useTheme()
  const dialog = useDialog()
  createEffect(() => dialog.setSize("large"))
  return (
    <box>
      <CodeReviewBrowser
        onClose={() => dialog.clear()}
        theme={() => ({
          text: theme.theme.text,
          muted: theme.theme.textMuted,
          error: theme.theme.error,
          highlight: theme.theme.primary,
        })}
        actions={{
          available: async () => (await sdk.transport()).kind === "native",
          list: async (after, signal) =>
            (
              await sdk.client.v2.codeReview.list(
                { sessionID: props.sessionID, ...(after ? { after } : {}) },
                { signal, throwOnError: true },
              )
            ).data,
          get: async (reviewID, signal) =>
            (
              await sdk.client.v2.codeReview.get(
                { sessionID: props.sessionID, reviewID },
                { signal, throwOnError: true },
              )
            ).data,
          start: async (codeReviewInput, signal) =>
            (
              await sdk.client.v2.codeReview.start(
                { sessionID: props.sessionID, codeReviewInput },
                { signal, throwOnError: true },
              )
            ).data,
          cancel: async (reviewID, signal) =>
            (
              await sdk.client.v2.codeReview.cancel(
                { sessionID: props.sessionID, reviewID },
                { signal, throwOnError: true },
              )
            ).data,
        }}
      />
    </box>
  )
}

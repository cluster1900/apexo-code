import { createEffect } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { FeedbackBrowser } from "./feedback-browser"

export function DialogFeedback(props: { sessionID: string }) {
  const sdk = useSDK()
  const theme = useTheme()
  const dialog = useDialog()
  const api = async () => ((await sdk.transport()).kind === "native" ? sdk.client.v2.feedback : sdk.client.feedback)
  createEffect(() => dialog.setSize("large"))
  return (
    <FeedbackBrowser
      onClose={() => dialog.clear()}
      theme={() => ({
        text: theme.theme.text,
        muted: theme.theme.textMuted,
        error: theme.theme.error,
        highlight: theme.theme.primary,
      })}
      actions={{
        list: async (signal) =>
          (await (await api()).list({ sessionID: props.sessionID }, { signal, throwOnError: true })).data,
        save: async (feedbackSave, signal) =>
          (await (await api()).save({ sessionID: props.sessionID, feedbackSave }, { signal, throwOnError: true })).data,
        review: async (draftID, revision, signal) =>
          (
            await (await api()).review(
              { sessionID: props.sessionID, draftID, feedbackReview: { revision } },
              { signal, throwOnError: true },
            )
          ).data,
        image: async (draftID, revision, imageID, signal) =>
          (
            await (await api()).image(
              { sessionID: props.sessionID, draftID, imageID, feedbackReview: { revision } },
              { signal, throwOnError: true },
            )
          ).data,
        remove: async (draftID, revision, signal) =>
          (await api()).remove(
            { sessionID: props.sessionID, draftID, feedbackReview: { revision } },
            { signal, throwOnError: true },
          ),
      }}
    />
  )
}

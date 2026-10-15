import type { SideQuestionInput } from "@apexo/sdk/v2/client"
import { createEffect } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { SideQuestionBrowser } from "./side-question-browser"

export function DialogSideQuestion(props: {
  sessionID: string
  question?: string
  images?: SideQuestionInput["images"]
}) {
  const sdk = useSDK()
  const theme = useTheme()
  const dialog = useDialog()
  const api = async () =>
    (await sdk.transport()).kind === "native" ? sdk.client.v2.sideQuestion : sdk.client.sideQuestion
  createEffect(() => dialog.setSize("large"))
  return (
    <SideQuestionBrowser
      question={props.question}
      images={props.images}
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
        ask: async (sideQuestionInput, signal) =>
          (
            await (await api()).ask(
              { sessionID: props.sessionID, sideQuestionInput },
              { signal, throwOnError: true },
            )
          ).data,
        cancel: async (questionID, signal) =>
          (
            await (await api()).cancel(
              { sessionID: props.sessionID, questionID },
              { signal, throwOnError: true },
            )
          ).data,
      }}
    />
  )
}

import { createEffect } from "solid-js"
import type { GoalStart } from "@apexo/sdk/v2/client"
import { useSDK } from "../context/sdk"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { goalActions, SessionGoal } from "./session-goal"

export function DialogGoal(props: { sessionID: string; objective?: string; selection?: GoalStart }) {
  const sdk = useSDK()
  const local = useLocal()
  const theme = useTheme()
  const dialog = useDialog()
  createEffect(() => dialog.setSize("large"))
  return (
    <SessionGoal
      objective={props.objective}
      onClose={() => dialog.clear()}
      theme={() => ({
        text: theme.theme.text,
        muted: theme.theme.textMuted,
        error: theme.theme.error,
        highlight: theme.theme.primary,
      })}
      actions={goalActions(
        sdk.client,
        async () => props.sessionID,
        () => {
          if (props.selection) return props.selection
          const model = local.model.current()
          const agent = local.agent.current()
          if (!model || !agent) return
          return {
            agent: agent.name,
            model: { id: model.modelID, providerID: model.providerID, variant: local.model.variant.current() },
          }
        },
        async () => (await sdk.transport()).kind,
      )}
    />
  )
}

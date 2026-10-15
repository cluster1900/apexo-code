import { createEffect } from "solid-js"
import { useSDK } from "../context/sdk"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useRoute } from "../context/route"
import { WorkflowBrowser, workflowActions } from "./workflow-browser"

export function DialogWorkflow(props: { sessionID: string; command?: string }) {
  const sdk = useSDK()
  const local = useLocal()
  const theme = useTheme()
  const dialog = useDialog()
  const route = useRoute()
  createEffect(() => dialog.setSize("large"))
  const actions = workflowActions(sdk.client, async () => props.sessionID, () => {
    const model = local.model.current()
    const agent = local.agent.current()
    if (!model || !agent) return
    return { agent: agent.name, model: { id: model.modelID, providerID: model.providerID, variant: local.model.variant.current() } }
  })
  return <WorkflowBrowser command={props.command} onClose={() => dialog.clear()} theme={() => ({ text: theme.theme.text, muted: theme.theme.textMuted, error: theme.theme.error, highlight: theme.theme.primary })} actions={{ ...actions, openChild: (sessionID) => { dialog.clear(); route.navigate({ type: "session", sessionID }) } }} />
}

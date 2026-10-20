import { Show } from "solid-js"
import { Button } from "@apexo/ui/button"
import { useDialog } from "@apexo/ui/context/dialog"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

export function createSessionWorkflow(
  sessionID: () => string | undefined,
  selection: () => { agent?: string; model?: { id: string; providerID: string; variant?: string } } | undefined,
) {
  const dialog = useDialog()
  const command = useCommand()
  const language = useLanguage()
  const open = async (input = "") => {
    const id = sessionID()
    if (!id) return false
    const { WorkflowDialog } = await import("./workflow-dialog")
    dialog.show(() => <WorkflowDialog sessionID={id} command={input} selection={selection()} />)
    return true
  }
  command.register("session-workflow", () => [
    {
      id: "session.workflow",
      title: language.t("workflow.title"),
      description: language.t("workflow.description"),
      slash: "workflow",
      slashAliases: ["workflows"],
      disabled: !sessionID(),
      onSelect: () => void open(),
    },
    {
      id: "session.deep-research",
      title: language.t("workflow.research"),
      description: language.t("workflow.description"),
      slash: "deep-research",
      disabled: !sessionID(),
      onSelect: () => void open("/deep-research"),
    },
  ])
  return { available: () => !!sessionID(), open }
}
export function WorkflowButton(props: { workflow: ReturnType<typeof createSessionWorkflow> }) {
  const language = useLanguage()
  return (
    <Show when={props.workflow.available()}>
      <Button data-action="session-workflow" size="small" variant="ghost" onClick={() => void props.workflow.open()}>
        {language.t("workflow.title")}
      </Button>
    </Show>
  )
}

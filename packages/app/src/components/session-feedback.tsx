import { Show } from "solid-js"
import { Button } from "@apexo/ui/button"
import { useDialog } from "@apexo/ui/context/dialog"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

export function createSessionFeedback(sessionID: () => string | undefined) {
  const dialog = useDialog()
  const command = useCommand()
  const language = useLanguage()
  const open = async () => {
    const id = sessionID()
    if (!id) return
    const { FeedbackDialog } = await import("./feedback-dialog")
    dialog.show(() => <FeedbackDialog sessionID={id} />)
  }
  command.register("session-feedback", () => [
    {
      id: "session.feedback",
      title: language.t("feedback.title"),
      slash: "feedback",
      disabled: !sessionID(),
      onSelect: () => void open(),
    },
  ])
  return { available: () => !!sessionID(), open }
}

export function FeedbackButton(props: { feedback: ReturnType<typeof createSessionFeedback> }) {
  const language = useLanguage()
  return (
    <Show when={props.feedback.available()}>
      <Button data-action="session-feedback" size="small" variant="ghost" onClick={() => void props.feedback.open()}>
        {language.t("feedback.title")}
      </Button>
    </Show>
  )
}

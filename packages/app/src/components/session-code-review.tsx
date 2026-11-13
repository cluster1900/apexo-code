import { Button } from "@apexo/ui/button"
import { useDialog } from "@apexo/ui/context/dialog"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

export function createSessionCodeReview(sessionID: () => string | undefined) {
  const dialog = useDialog()
  const command = useCommand()
  const language = useLanguage()
  const open = async (focus = "") => {
    const id = sessionID()
    if (!id) return
    const { CodeReviewDialog } = await import("./code-review-dialog")
    dialog.show(() => <CodeReviewDialog sessionID={id} currentSessionID={sessionID} focus={focus} />)
  }
  command.register("session-code-review", () => [
    {
      id: "session.code-review",
      title: language.t("codeReview.title"),
      description: language.t("codeReview.description"),
      slash: "review",
      slashAliases: ["reviews"],
      disabled: !sessionID(),
      onSelect: () => void open(),
      onSlash: (args) => void open(args),
    },
  ])
  return { available: () => !!sessionID(), open }
}
export function CodeReviewButton(props: { review: ReturnType<typeof createSessionCodeReview> }) {
  const language = useLanguage()
  return (
    <Button
      data-action="session-code-review"
      size="small"
      variant="ghost"
      disabled={!props.review.available()}
      onClick={() => void props.review.open()}
    >
      {language.t("codeReview.title")}
    </Button>
  )
}

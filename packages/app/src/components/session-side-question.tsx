import type { ImageAttachmentPart } from "@/context/prompt"
import type { SideQuestionInput } from "@apexo/sdk/v2/client"
import { blobDataUrl } from "@/utils/draft-store"
import { Show } from "solid-js"
import { Button } from "@apexo/ui/button"
import { useDialog } from "@apexo/ui/context/dialog"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

export function createSessionSideQuestion(sessionID: () => string | undefined) {
  const dialog = useDialog()
  const command = useCommand()
  const language = useLanguage()
  const open = async (question = "", attachments: ImageAttachmentPart[] = []) => {
    const id = sessionID()
    if (!id) return false
    const { SideQuestionDialog } = await import("./side-question-dialog")
    const images = await Promise.all(
      attachments.map(async (image) => ({
        mediaType: image.mime as NonNullable<SideQuestionInput["images"]>[number]["mediaType"],
        data: (await blobDataUrl(image.blob, image.mime)).split(",")[1]!,
      })),
    )
    dialog.show(() => (
      <SideQuestionDialog sessionID={id} question={question} images={images} autoAsk={!!question.trim()} />
    ))
    return true
  }
  command.register("session-btw", () => [
    {
      id: "session.btw",
      title: language.t("btw.title"),
      slash: "btw",
      disabled: !sessionID(),
      onSelect: () => void open(),
    },
  ])
  return { available: () => !!sessionID(), open }
}
export function SideQuestionButton(props: { sideQuestion: ReturnType<typeof createSessionSideQuestion> }) {
  const language = useLanguage()
  return (
    <Show when={props.sideQuestion.available()}>
      <Button data-action="session-btw" size="small" variant="ghost" onClick={() => void props.sideQuestion.open()}>
        {language.t("btw.title")}
      </Button>
    </Show>
  )
}

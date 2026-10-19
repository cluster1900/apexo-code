import { Show } from "solid-js"
import { Button } from "@apexo/ui/button"
import { useDialog } from "@apexo/ui/context/dialog"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

export function createSessionHooks(sessionID: () => string | undefined) {
  const dialog = useDialog()
  const command = useCommand()
  const language = useLanguage()
  const open = async () => {
    const id = sessionID()
    if (!id) return
    const { HooksDialog } = await import("./hooks-dialog")
    dialog.show(() => <HooksDialog sessionID={id} />)
  }
  command.register("session-hooks", () => [
    {
      id: "session.hooks",
      title: language.t("hooks.title"),
      description: language.t("hooks.description"),
      slash: "hooks",
      disabled: !sessionID(),
      onSelect: () => void open(),
    },
  ])
  return { available: () => !!sessionID(), open }
}

export function HooksButton(props: { hooks: ReturnType<typeof createSessionHooks> }) {
  const language = useLanguage()
  return (
    <Show when={props.hooks.available()}>
      <Button data-action="session-hooks" size="small" variant="ghost" onClick={() => void props.hooks.open()}>
        {language.t("hooks.title")}
      </Button>
    </Show>
  )
}

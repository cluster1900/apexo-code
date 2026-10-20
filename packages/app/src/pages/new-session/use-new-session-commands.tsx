import { useDialog } from "@apexo/ui/context/dialog"
import { useGrokCommands } from "@/components/grok-commands"
import { useSettingsCommand } from "@/components/settings-dialog"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

export function useNewSessionCommands(input: {
  restoreFocus: () => void
  project: {
    empty: () => boolean
    open: () => void
  }
}) {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const grok = useGrokCommands(() => undefined)

  useSettingsCommand()
  command.register("new-session", () => [
    ...grok.commands(),
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: async () => {
        const { DialogSelectFile } = await import("@/components/dialog-select-file")
        void dialog.show(() => <DialogSelectFile />)
      },
    },
    {
      id: "input.focus",
      title: language.t("command.input.focus"),
      category: language.t("command.category.view"),
      keybind: "ctrl+l",
      onSelect: input.restoreFocus,
    },
    {
      id: "project.select",
      title: language.t("session.new.project.search"),
      category: language.t("command.category.project"),
      keybind: "mod+shift+o",
      disabled: input.project.empty(),
      onSelect: input.project.open,
    },
  ])
}

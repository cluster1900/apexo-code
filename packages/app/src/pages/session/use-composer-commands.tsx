import { useCommand, type CommandOption } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLocal, type ModelSelection } from "@/context/local"
import { useDialog } from "@apexo/ui/context/dialog"
import { getCursorPosition, setCursorPosition } from "@/components/prompt-input/editor-dom"
import { DialogGrokList } from "@/components/grok-commands"
import { resolveEffort } from "@apexo/sdk/v2/grok-commands"
import { resolveModelArgs } from "@/utils/model-args"
import { showToast } from "@/utils/toast"
import { useSessionLayout } from "./session-layout"
import { createSessionOwnership } from "./session-ownership"

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useComposerCommands = (input: { model?: ModelSelection } = {}) => {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const { sessionKey } = useSessionLayout()
  const sessionOwnership = createSessionOwnership(sessionKey)
  const model = input.model ?? local.model
  const modelCommand = withCategory(language.t("command.category.model"))
  const agentCommand = withCategory(language.t("command.category.agent"))

  const chooseModel = async () => {
    const owner = sessionOwnership.capture()
    const editor = document.querySelector<HTMLElement>('[data-component="prompt-input"]')
    const selection = window.getSelection()
    const cursor =
      editor && selection?.rangeCount && editor.contains(selection.anchorNode) ? getCursorPosition(editor) : null
    const restoreComposer = () => {
      // Kobalte restores focus during its teardown effect; defer past it so the
      // composer keeps focus and the caret returns to where the user left it.
      requestAnimationFrame(() => {
        const editor = document.querySelector<HTMLElement>('[data-component="prompt-input"]')
        if (!editor) return
        editor.focus()
        if (cursor !== null) setCursorPosition(editor, cursor)
      })
    }
    const { DialogSelectModel } = await import("@/components/dialog-select-model")
    owner.run(() => {
      void dialog.show(() => <DialogSelectModel model={model} />, restoreComposer)
    })
  }

  command.register("composer", () => [
    modelCommand({
      id: "model.choose",
      title: language.t("command.model.choose"),
      description: language.t("command.model.choose.description"),
      keybind: "mod+'",
      slash: "model",
      slashAliases: ["models", "mo", "m"],
      onSelect: chooseModel,
      onSlash: (args) => {
        const found = resolveModelArgs(args, model.list(), model.current()?.provider.id)
        if (!found) return showToast({ title: language.t("grok.model.missing", { query: args }) })
        const variants = Object.keys(found.model.variants ?? {})
        const variant = found.effort ? resolveEffort(found.effort, variants) : undefined
        if (found.effort && !variant)
          return showToast({
            title: language.t("grok.effort.unavailable", { level: found.effort, levels: variants.join(", ") || "—" }),
          })
        model.set({ providerID: found.model.provider.id, modelID: found.model.id }, { recent: true })
        // Both writes run as queued transitions in call order, so the variant lands on the new model.
        if (variant) model.variant.set(variant)
        showToast({
          title: language.t("grok.model.set", { model: variant ? `${found.model.name} · ${variant}` : found.model.name }),
        })
      },
    }),
    modelCommand({
      id: "model.variant.cycle",
      title: language.t("command.model.variant.cycle"),
      description: language.t("command.model.variant.cycle.description"),
      keybind: "shift+mod+d",
      slash: "variants",
      onSelect: () => model.variant.cycle(),
    }),
    agentCommand({
      id: "agent.cycle",
      title: language.t("command.agent.cycle"),
      description: language.t("command.agent.cycle.description"),
      keybind: "mod+.",
      slash: "agent",
      disabled: !local.agent.visible(),
      onSelect: () => local.agent.move(1),
    }),
    agentCommand({
      // Grok Build `/config-agents` (alias `/agents`) opens the agents modal; nothing changes until a pick.
      id: "agent.choose",
      title: language.t("grok.agents"),
      slash: "agents",
      slashAliases: ["config-agents", "personas"],
      onSelect: () =>
        dialog.show(() => (
          <DialogGrokList
            title={language.t("grok.agents")}
            items={local.agent.list().map((agent) => ({
              title: agent.name,
              value: agent.name,
              detail:
                agent.name === local.agent.current()?.name
                  ? language.t("grok.agents.current")
                  : agent.description?.split("\n")[0]?.slice(0, 60),
            }))}
            onSelect={(item) => local.agent.set(item.value)}
          />
        )),
    }),
    agentCommand({
      id: "agent.cycle.reverse",
      title: language.t("command.agent.cycle.reverse"),
      description: language.t("command.agent.cycle.reverse.description"),
      keybind: "shift+mod+.",
      disabled: !local.agent.visible(),
      onSelect: () => local.agent.move(-1),
    }),
  ])
}

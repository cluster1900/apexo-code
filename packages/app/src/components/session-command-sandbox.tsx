import type { SandboxProfile } from "@apexo/sdk/v2/client"
import { createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@apexo/ui/button"
import { useDialog } from "@apexo/ui/context/dialog"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

export function createSessionCommandSandbox(sessionID: () => string | undefined) {
  const sdk = useSDK()
  const dialog = useDialog()
  const command = useCommand()
  const language = useLanguage()
  const [state, setState] = createStore({ profile: "off" as SandboxProfile })
  createEffect(() => {
    sessionID()
    sdk().scope
    sdk().directory
    setState("profile", "off")
  })
  const open = async () => {
    const id = sessionID()
    const context = sdk()
    const { CommandSandboxDialog } = await import("./command-sandbox-dialog")
    dialog.show(() => (
      <CommandSandboxDialog
        sessionID={id}
        profile={() => state.profile}
        select={(profile) => {
          if (!id && !sessionID() && sdk().scope === context.scope && sdk().directory === context.directory)
            setState("profile", profile)
        }}
      />
    ))
  }
  command.register("session-command-sandbox", () => [
    {
      id: "session.sandbox",
      title: language.t("commandSandbox.title"),
      description: language.t("commandSandbox.scope"),
      slash: "sandbox",
      onSelect: () => void open(),
    },
  ])
  return { profile: () => state.profile, open }
}

export function CommandSandboxButton(props: { sandbox: ReturnType<typeof createSessionCommandSandbox> }) {
  const language = useLanguage()
  return (
    <Button
      data-action="session-command-sandbox"
      size="small"
      variant="ghost"
      onClick={() => void props.sandbox.open()}
    >
      {language.t("commandSandbox.title")}
    </Button>
  )
}

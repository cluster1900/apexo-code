import { createEffect, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { McpAttachmentResult } from "@apexo/sdk/v2/mcp-attachment"
import { Button } from "@apexo/ui/button"
import { useDialog } from "@apexo/ui/context/dialog"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

export function createSessionMcpAttachments(
  sessionID: () => string | undefined,
  attach: (prepared: NonNullable<McpAttachmentResult["prepared"]>) => void,
) {
  const sdk = useSDK()
  const dialog = useDialog()
  const command = useCommand()
  const language = useLanguage()
  const [state, setState] = createStore({ native: false, active: true })
  onCleanup(() => setState("active", false))
  createEffect(() => {
    const scope = sdk()
    let active = true
    setState("native", false)
    void scope.protocol
      .then((protocol) => {
        if (active) setState("native", protocol === "v2")
      })
      .catch(() => {})
    onCleanup(() => {
      active = false
    })
  })
  const available = () => state.native && !!sessionID()
  const open = async () => {
    const id = sessionID()
    const scope = sdk()
    if (!id || !available()) return
    const { McpAttachmentPicker } = await import("./mcp-attachment-picker")
    if (!state.active || sessionID() !== id || sdk() !== scope) return
    dialog.show(() => (
      <McpAttachmentPicker
        sessionID={id}
        active={() => state.active && sessionID() === id && sdk() === scope}
        attach={attach}
      />
    ))
  }
  command.register("session-mcp-attachments", () => [
    {
      id: "session.mcpResources",
      title: language.t("mcp.resources.title"),
      slash: "resources",
      disabled: !available(),
      onSelect: () => void open(),
    },
  ])
  return { available, open }
}
export function McpAttachmentsButton(props: { attachments: ReturnType<typeof createSessionMcpAttachments> }) {
  const language = useLanguage()
  return (
    <Show when={props.attachments.available()}>
      <Button data-action="mcp-resources" size="small" variant="ghost" onClick={() => void props.attachments.open()}>
        {language.t("mcp.resources.title")}
      </Button>
    </Show>
  )
}

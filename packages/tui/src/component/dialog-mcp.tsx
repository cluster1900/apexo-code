import type { McpPreparedAttachment } from "./mcp-resource-picker"
import { createEffect } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { McpBrowser, mcpActions } from "./mcp-browser"

export function DialogMcp(props: {
  sessionID: () => string | undefined
  onAttach: (prepared: McpPreparedAttachment) => void
}) {
  const sdk = useSDK()
  const theme = useTheme()
  const dialog = useDialog()
  createEffect(() => dialog.setSize("large"))
  return (
    <McpBrowser
      actions={mcpActions(sdk.client, sdk.directory, props.sessionID)}
      onAttach={props.onAttach}
      theme={() => ({
        text: theme.theme.text,
        muted: theme.theme.textMuted,
        error: theme.theme.error,
        highlight: theme.theme.primary,
      })}
      onClose={() => dialog.clear()}
    />
  )
}

import { createEffect } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { PluginsBrowser, pluginsActions } from "./plugins-browser"

export function DialogPlugins() {
  const sdk = useSDK()
  const theme = useTheme()
  const dialog = useDialog()
  createEffect(() => dialog.setSize("large"))
  return (
    <PluginsBrowser
      theme={() => ({
        text: theme.theme.text,
        muted: theme.theme.textMuted,
        error: theme.theme.error,
        highlight: theme.theme.primary,
      })}
      onClose={() => dialog.clear()}
      actions={pluginsActions(sdk.client, sdk.directory)}
    />
  )
}

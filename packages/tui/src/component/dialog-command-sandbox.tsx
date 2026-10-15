import { createEffect } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { CommandSandboxBrowser } from "./command-sandbox-browser"

export function DialogCommandSandbox(props: { sessionID?: string }) {
  const sdk = useSDK()
  const theme = useTheme()
  const dialog = useDialog()
  createEffect(() => dialog.setSize("large"))
  return (
    <box flexDirection="column">
      <CommandSandboxBrowser
        onClose={() => dialog.clear()}
        theme={() => ({
          text: theme.theme.text,
          muted: theme.theme.textMuted,
          error: theme.theme.error,
          highlight: theme.theme.primary,
        })}
        actions={{
          get: async (signal) =>
            props.sessionID
              ? (await sdk.client.v2.session.sandbox({ sessionID: props.sessionID }, { signal, throwOnError: true }))
                  .data
              : undefined,
        }}
      />
    </box>
  )
}

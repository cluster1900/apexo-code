import { createEffect } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { HooksBrowser } from "./hooks-browser"

export function DialogHooks(props: { sessionID: string }) {
  const sdk = useSDK()
  const theme = useTheme()
  const dialog = useDialog()
  const api = async () => ((await sdk.transport()).kind === "native" ? sdk.client.v2.hooks : sdk.client.hooks)
  createEffect(() => dialog.setSize("large"))
  return (
    <HooksBrowser
      onClose={() => dialog.clear()}
      theme={() => ({
        text: theme.theme.text,
        muted: theme.theme.textMuted,
        error: theme.theme.error,
        highlight: theme.theme.primary,
      })}
      actions={{
        get: async (signal) =>
          (await (await api()).get({ sessionID: props.sessionID }, { signal, throwOnError: true })).data,
        trust: async (hostHooksRepositoryTrust, signal) =>
          (
            await (await api()).trust(
              {
                sessionID: props.sessionID,
                hostHooksRepositoryTrust: {
                  root: hostHooksRepositoryTrust.root,
                  token: hostHooksRepositoryTrust.token,
                  trusted: hostHooksRepositoryTrust.trusted,
                },
              },
              { signal, throwOnError: true },
            )
          ).data,
        preference: async (hookID, enabled, signal) =>
          (
            await (await api()).preference(
              { sessionID: props.sessionID, hostHooksPreference: { hookID, enabled } },
              { signal, throwOnError: true },
            )
          ).data,
        reload: async (signal) =>
          (await (await api()).reload({ sessionID: props.sessionID }, { signal, throwOnError: true })).data,
      }}
    />
  )
}

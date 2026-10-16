import type { SandboxProfile, SandboxStatus } from "@apexo/sdk/v2/client"
import { For, Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

export function CommandSandboxDialog(props: {
  sessionID?: string
  profile: () => SandboxProfile
  select: (profile: SandboxProfile) => void
}) {
  const sdk = useSDK()()
  const language = useLanguage()
  const lifetime = new AbortController()
  const [state, setState] = createStore({
    status: undefined as SandboxStatus | undefined,
    native: false,
    pending: false,
    loaded: false,
    error: false,
  })
  const profiles = ["off", "workspace", "read-only"] as const
  const profileKey = {
    off: "commandSandbox.off",
    workspace: "commandSandbox.workspace",
    "read-only": "commandSandbox.readOnly",
  } as const
  const backendKey = {
    unchecked: "commandSandbox.unchecked",
    available: "commandSandbox.available",
    unsupported: "commandSandbox.unsupported",
    unavailable: "commandSandbox.unavailable",
  } as const
  const load = async () => {
    if (state.pending) return
    setState({ pending: true, error: false })
    try {
      if (!props.sessionID) {
        const protocol = await sdk.protocol
        if (!lifetime.signal.aborted) setState({ native: protocol === "v2", loaded: true })
        return
      }
      const result = await sdk.client.v2.session.sandbox(
        { sessionID: props.sessionID },
        { signal: lifetime.signal, throwOnError: true },
      )
      if (!lifetime.signal.aborted) setState({ status: result.data, loaded: true })
    } catch {
      if (!lifetime.signal.aborted) setState("error", true)
    } finally {
      if (!lifetime.signal.aborted) setState("pending", false)
    }
  }
  onMount(() => void load())
  onCleanup(() => lifetime.abort())
  return (
    <Dialog title={language.t("commandSandbox.title")}>
      <div class="flex flex-col gap-4 px-6 pb-6 text-14-regular text-text-base" data-component="command-sandbox-dialog">
        <p>{language.t("commandSandbox.scope")}</p>
        <p class="text-text-weak">{language.t("commandSandbox.limits")}</p>
        <Show
          when={!props.sessionID}
          fallback={
            <>
              <p>{language.t("commandSandbox.immutable")}</p>
              <Show when={state.status}>
                {(status) => (
                  <>
                    <p data-status="sandbox-profile">
                      {language.t("commandSandbox.stored", {
                        profile: status().profile
                          ? status().profile === "off" ||
                            status().profile === "workspace" ||
                            status().profile === "read-only"
                            ? language.t(profileKey[status().profile as keyof typeof profileKey])
                            : status().profile!
                          : language.t("commandSandbox.unknown"),
                      })}
                    </p>
                    <p>
                      {language.t("commandSandbox.backend", {
                        status: language.t(backendKey[status().backend.availability]),
                      })}
                    </p>
                    <p>
                      {status().network === "off"
                        ? language.t("commandSandbox.networkOff")
                        : status().network === "unrestricted"
                          ? language.t("commandSandbox.networkUnrestricted")
                          : language.t("commandSandbox.networkUnknown")}
                    </p>
                    <p>
                      {status().latestExecution
                        ? language.t("commandSandbox.receipt", { code: status().latestExecution!.exitCode })
                        : language.t("commandSandbox.noReceipt")}
                    </p>
                    <Show when={status().failure}>
                      {(failure) => (
                        <p role="alert" class="text-text-critical-base">
                          {failure().message}
                        </p>
                      )}
                    </Show>
                  </>
                )}
              </Show>
              <Button size="small" variant="secondary" disabled={state.pending} onClick={() => void load()}>
                {language.t("commandSandbox.refresh")}
              </Button>
            </>
          }
        >
          <p>{language.t("commandSandbox.newHint")}</p>
          <Show when={state.loaded && !state.native}>
            <p>{language.t("commandSandbox.creationUnavailable")}</p>
          </Show>
          <div class="flex flex-wrap gap-2" role="group" aria-label={language.t("commandSandbox.title")}>
            <For each={profiles}>
              {(profile) => (
                <Button
                  data-profile={profile}
                  aria-pressed={props.profile() === profile}
                  variant={props.profile() === profile ? "primary" : "secondary"}
                  disabled={!state.native || state.pending}
                  onClick={() => props.select(profile)}
                >
                  {language.t(profileKey[profile])}
                </Button>
              )}
            </For>
          </div>
          <p>
            {language.t(
              props.profile() === "workspace"
                ? "commandSandbox.workspaceHint"
                : props.profile() === "read-only"
                  ? "commandSandbox.readOnlyHint"
                  : "commandSandbox.offHint",
            )}
          </p>
        </Show>
        <Show when={state.pending}>
          <p>{language.t("commandSandbox.loading")}</p>
        </Show>
        <Show when={state.error}>
          <p role="alert" class="text-text-critical-base">
            {language.t("commandSandbox.error")}
          </p>
        </Show>
      </div>
    </Dialog>
  )
}

import type { SandboxCatalog, SandboxProfile, SandboxProfileInfo, SandboxStatus } from "@apexo/sdk/v2/client"
import { For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

const builtinProfiles: readonly SandboxProfileInfo[] = [
  { name: "off", builtin: true, network: "unrestricted", allowDomains: [] },
  { name: "workspace", builtin: true, base: "workspace", network: "off", allowDomains: [] },
  { name: "read-only", builtin: true, base: "read-only", network: "off", allowDomains: [] },
  { name: "strict", builtin: true, base: "strict", network: "off", allowDomains: [] },
  { name: "devbox", builtin: true, base: "devbox", network: "unrestricted", allowDomains: [] },
]

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
    catalog: undefined as SandboxCatalog | undefined,
    native: false,
    pending: false,
    loaded: false,
    error: false,
  })
  const profileKey = {
    off: "commandSandbox.off",
    workspace: "commandSandbox.workspace",
    "read-only": "commandSandbox.readOnly",
    strict: "commandSandbox.strict",
    devbox: "commandSandbox.devbox",
  } as const
  const profileLabel = (profile: string) =>
    profile in profileKey ? language.t(profileKey[profile as keyof typeof profileKey]) : profile
  const profiles = createMemo(() =>
    state.catalog && state.catalog.profiles.length > 0 ? state.catalog.profiles : builtinProfiles,
  )
  const selectedProfile = createMemo(() => profiles().find((item) => item.name === props.profile()))
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
        await sdk.protocol
        const catalog = await sdk.client.v2.sandbox
          .catalog(undefined, { signal: lifetime.signal, throwOnError: true })
          .then((res) => res.data)
          .catch(() => undefined)
        if (!lifetime.signal.aborted) setState({ native: true, catalog, loaded: true })
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
    <Dialog title={language.t("commandSandbox.title")} size="large" fit>
      <div class="flex flex-col gap-4 px-6 pt-2 pb-6 text-14-regular text-text-base" data-component="command-sandbox-dialog">
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
                      {status().profile && status().base && status().base !== status().profile
                        ? language.t("commandSandbox.storedWithBase", {
                            profile: profileLabel(status().profile!),
                            base: profileLabel(status().base!),
                          })
                        : language.t("commandSandbox.stored", {
                            profile: status().profile
                              ? profileLabel(status().profile!)
                              : language.t("commandSandbox.unknown"),
                          })}
                    </p>
                    <p>
                      {language.t("commandSandbox.backend", {
                        status: language.t(backendKey[status().backend.availability]),
                      })}
                    </p>
                    <p data-status="sandbox-network">
                      {status().allowDomains?.length
                        ? language.t("commandSandbox.networkAllowlist", {
                            domains: status().allowDomains!.join(", "),
                          })
                        : status().network === "off"
                          ? language.t("commandSandbox.networkOff")
                          : status().network === "unrestricted"
                            ? language.t("commandSandbox.networkUnrestricted")
                            : language.t("commandSandbox.networkUnknown")}
                    </p>
                    <p>
                      {status().latestExecution
                        ? language.t("commandSandbox.receipt", { code: status().latestExecution!.exitCode })
                        : status().profile === "off"
                          ? language.t("commandSandbox.offHint")
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
              <Button
                size="small"
                variant="secondary"
                class="self-start"
                disabled={state.pending}
                onClick={() => void load()}
              >
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
            <For each={profiles()}>
              {(item) => (
                <Button
                  data-profile={item.name}
                  aria-pressed={props.profile() === item.name}
                  variant={props.profile() === item.name ? "primary" : "secondary"}
                  disabled={!state.native || state.pending}
                  onClick={() => props.select(item.name)}
                >
                  {profileLabel(item.name)}
                </Button>
              )}
            </For>
          </div>
          <p>
            {props.profile() === "workspace"
              ? language.t("commandSandbox.workspaceHint")
              : props.profile() === "read-only"
                ? language.t("commandSandbox.readOnlyHint")
                : props.profile() === "strict"
                  ? language.t("commandSandbox.strictHint")
                  : props.profile() === "devbox"
                    ? language.t("commandSandbox.devboxHint")
                    : props.profile() === "off"
                      ? language.t("commandSandbox.offHint")
                      : language.t("commandSandbox.customHint", {
                          profile: props.profile(),
                          base: profileLabel(selectedProfile()?.base ?? "workspace"),
                        })}
          </p>
          <Show when={selectedProfile()}>
            {(profile) => (
              <p data-status="sandbox-network">
                {profile().allowDomains.length > 0
                  ? language.t("commandSandbox.networkAllowlist", {
                      domains: profile().allowDomains.join(", "),
                    })
                  : profile().network === "off"
                    ? language.t("commandSandbox.networkOff")
                    : language.t("commandSandbox.networkUnrestricted")}
              </p>
            )}
          </Show>
          <Show when={state.catalog?.failure}>
            {(failure) => (
              <p role="alert" class="text-text-critical-base">
                {failure().message}
              </p>
            )}
          </Show>
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

import { For, Show, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { HostHooksSnapshot } from "@apexo/sdk/v2/client"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

export function HooksDialog(props: { sessionID: string }) {
  const sdk = useSDK()()
  const api = sdk.protocol.then((protocol) => (protocol === "v2" ? sdk.client.v2.hooks : sdk.client.hooks))
  const language = useLanguage()
  const lifetime = new AbortController()
  const [state, setState] = createStore({
    snapshot: undefined as HostHooksSnapshot | undefined,
    pending: false,
    reloading: false,
    error: false,
  })
  const load = async (reload = false) => {
    if (state.pending) return
    setState({ pending: true, reloading: reload, error: false })
    await (
      await api
    )
      [reload ? "reload" : "get"]({ sessionID: props.sessionID }, { signal: lifetime.signal, throwOnError: true })
      .then((result) => {
        if (!lifetime.signal.aborted) setState("snapshot", reconcile(result.data))
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState({ pending: false, reloading: false })
      })
  }
  const preference = async (hookID: string, enabled: boolean) => {
    if (state.pending) return
    setState({ pending: true, error: false })
    await (
      await api
    )
      .preference(
        { sessionID: props.sessionID, hostHooksPreference: { hookID, enabled } },
        { signal: lifetime.signal, throwOnError: true },
      )
      .then((result) => {
        if (!lifetime.signal.aborted) setState("snapshot", reconcile(result.data))
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  const trust = async () => {
    const repository = state.snapshot?.repository
    if (state.pending || !repository) return
    setState({ pending: true, error: false })
    await (
      await api
    )
      .trust(
        {
          sessionID: props.sessionID,
          hostHooksRepositoryTrust: { root: repository.root, token: repository.token, trusted: !repository.trusted },
        },
        { signal: lifetime.signal, throwOnError: true },
      )
      .then((result) => {
        if (!lifetime.signal.aborted) setState("snapshot", reconcile(result.data))
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  onMount(() => void load())
  onCleanup(() => lifetime.abort())
  return (
    <Dialog title={language.t("hooks.title")} size="large">
      <div data-component="hooks-dialog" class="min-h-0 max-h-[60vh] overflow-y-auto px-6 pb-6 space-y-4">
        <p class="text-12-regular text-text-weak">{language.t("hooks.description")}</p>
        <p class="text-12-regular text-text-weak">{language.t("hooks.preference.hint")}</p>
        <Show when={state.snapshot?.repository}>
          {(repository) => (
            <section data-component="hooks-repository" class="rounded-md border border-border-base p-3 space-y-2">
              <p class="text-14-medium">{language.t("hooks.repository.title")}</p>
              <p data-component="hooks-repository-root" class="text-12-regular break-all">
                {repository().root}
              </p>
              <p class="text-12-regular">{language.t("hooks.repository.hint")}</p>
              <p data-component="hooks-repository-status">
                {language.t(repository().allowed ? "hooks.trusted" : "hooks.untrusted")}
              </p>
              <Button data-action="hooks-repository-trust" disabled={state.pending} onClick={() => void trust()}>
                {language.t(repository().trusted ? "hooks.repository.revoke" : "hooks.repository.grant")}
              </Button>
            </section>
          )}
        </Show>
        <div class="flex gap-2">
          <Button data-action="hooks-refresh" disabled={state.pending} onClick={() => void load()}>
            {language.t("hooks.refresh")}
          </Button>
          <Button
            data-action="hooks-reload"
            disabled={state.pending || !state.snapshot?.captured}
            onClick={() => void load(true)}
          >
            {language.t("hooks.reload")}
          </Button>
        </div>
        <Show when={state.pending}>
          <p role="status">{language.t(state.reloading ? "hooks.reloading" : "hooks.loading")}</p>
        </Show>
        <Show when={state.error}>
          <p role="alert">{language.t("hooks.error")}</p>
        </Show>
        <Show when={state.snapshot}>
          {(snapshot) => (
            <>
              <Show
                when={snapshot().captured}
                fallback={<p data-component="hooks-uncaptured">{language.t("hooks.uncaptured")}</p>}
              >
                <p data-component="hooks-generation">
                  {language.t("hooks.generation", { generation: snapshot().generation })}
                </p>
                <Show when={snapshot().preferenceFailure}>
                  <p role="alert" data-component="hooks-preference-error">
                    {language.t("hooks.preference.error")}
                  </p>
                </Show>
                <Show when={snapshot().inspection}>
                  {(inspection) => (
                    <>
                      <p>{language.t(inspection().projectTrusted ? "hooks.trusted" : "hooks.untrusted")}</p>
                      <Show when={!inspection().hooks.length}>
                        <p>{language.t("hooks.empty")}</p>
                      </Show>
                      <For each={inspection().hooks}>
                        {(hook) => (
                          <section
                            data-hook-name={hook.name}
                            data-hook-id={hook.id}
                            class="rounded-md border border-border-base p-3 space-y-1"
                          >
                            <p class="text-14-medium">{hook.name}</p>
                            <p class="text-12-regular">
                              {hook.event} · {hook.type}
                            </p>
                            <p class="text-12-regular break-all">
                              {language.t("hooks.source", { source: hook.source })}
                            </p>
                            <Show when={hook.matcher}>
                              <p class="text-12-regular">{language.t("hooks.matcher", { matcher: hook.matcher! })}</p>
                            </Show>
                            <Show when={hook.effectiveDisabled !== undefined}>
                              <p data-component="hooks-effective" class="text-12-regular">
                                {language.t(
                                  hook.effectiveDisabled
                                    ? "hooks.preference.effectiveDisabled"
                                    : "hooks.preference.effectiveEnabled",
                                )}
                              </p>
                            </Show>
                            <Show when={hook.savedDisabled !== undefined}>
                              <p data-component="hooks-saved" class="text-12-regular">
                                {language.t(
                                  hook.savedDisabled
                                    ? "hooks.preference.savedDisabled"
                                    : "hooks.preference.savedConfiguration",
                                )}
                              </p>
                            </Show>
                            <Show when={!hook.configuredEnabled}>
                              <p class="text-12-regular">{language.t("hooks.preference.configuredDisabled")}</p>
                            </Show>
                            <Show when={hook.pendingChange}>
                              <p data-component="hooks-pending-choice" class="text-12-regular">
                                {language.t("hooks.preference.pending")}
                              </p>
                            </Show>
                            <Show when={hook.readOnlyReason === "managed"}>
                              <p class="text-12-regular">{language.t("hooks.preference.managed")}</p>
                            </Show>
                            <Show when={hook.configurable && hook.configuredEnabled}>
                              <Button
                                data-action="hooks-preference"
                                disabled={
                                  state.pending ||
                                  !!snapshot().preferenceFailure ||
                                  hook.effectiveDisabled === undefined
                                }
                                onClick={() => void preference(hook.id, !!hook.effectiveDisabled)}
                              >
                                {language.t(hook.effectiveDisabled ? "plugins.enable" : "plugins.disable")}
                              </Button>
                            </Show>
                            <Show when={!hook.supported}>
                              <p class="text-12-regular">{language.t("hooks.unsupported")}</p>
                            </Show>
                          </section>
                        )}
                      </For>
                      <For each={inspection().diagnostics}>
                        {(diagnostic) => <p class="text-12-regular text-text-weak">{diagnostic}</p>}
                      </For>
                    </>
                  )}
                </Show>
              </Show>
            </>
          )}
        </Show>
      </div>
    </Dialog>
  )
}

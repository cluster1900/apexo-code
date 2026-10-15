import { Show, createMemo, createResource, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Select } from "@apexo/ui/select"
import { useLanguage } from "@/context/language"
import { usePlatform, type RuntimeProfile } from "@/context/platform"

export function SettingsRuntimeProfile() {
  const platform = usePlatform()
  const language = useLanguage()
  const [state, setState] = createStore({ saving: false, error: false })
  const [profile, { mutate, refetch }] = createResource(
    () => platform.platform === "desktop" && !!platform.getRuntimeProfile,
    () =>
      platform.getRuntimeProfile!().catch(() => {
        setState("error", true)
        return undefined
      }),
  )
  const options = createMemo(() => [
    { value: "apexo" as const, label: language.t("settings.profile.apexo") },
    { value: "grok-build" as const, label: language.t("settings.profile.grokBuild") },
  ])
  const label = (value: RuntimeProfile) => options().find((option) => option.value === value)!.label
  const change = async (value: RuntimeProfile) => {
    if (state.saving || !platform.setRuntimeProfile || !profile()?.supported) return
    setState({ saving: true, error: false })
    await platform
      .setRuntimeProfile(value)
      .then(mutate)
      .catch(() => setState("error", true))
    setState("saving", false)
  }
  onMount(() => {
    const refresh = () => {
      void refetch()
    }
    window.addEventListener("focus", refresh)
    onCleanup(() => window.removeEventListener("focus", refresh))
  })
  return (
    <Show when={platform.platform === "desktop" && platform.getRuntimeProfile}>
      <div data-component="settings-runtime-profile" class="flex flex-col gap-2">
        <h3 class="text-14-medium text-text-strong">{language.t("settings.profile.title")}</h3>
        <p class="text-12-regular text-text-weak">{language.t("settings.profile.description")}</p>
        <Show when={profile()}>
          {(current) => (
            <>
              <Show
                when={current().supported}
                fallback={<p class="text-12-regular text-text-weak">{language.t("settings.profile.unsupported")}</p>}
              >
                <div class="flex items-center justify-between gap-4">
                  <span data-field="runtime-profile-active" class="text-12-regular text-text-weak">
                    {language.t("settings.profile.active", { profile: label(current().active!) })}
                  </span>
                  <Select
                    data-action="settings-runtime-profile"
                    options={options()}
                    current={options().find((option) => option.value === current().preferred)}
                    value={(option) => option.value}
                    label={(option) => option.label}
                    onSelect={(option) => option && void change(option.value)}
                    disabled={state.saving}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                    aria-label={language.t("settings.profile.title")}
                  />
                </div>
                <Show when={current().preferred !== current().active}>
                  <p data-field="runtime-profile-pending" role="status" class="text-12-regular text-text-weak">
                    {language.t("settings.profile.pending", { profile: label(current().preferred) })}
                  </p>
                </Show>
              </Show>
            </>
          )}
        </Show>
        <Show when={state.error}>
          <p role="alert" class="text-12-regular text-text-danger-base">
            {language.t("settings.profile.error")}
          </p>
        </Show>
      </div>
    </Show>
  )
}

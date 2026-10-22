import { docsGuides, docsURL, releaseNotesURL, tutorialTopics } from "@apexo/sdk/v2/grok-commands"
import { useDialog } from "@apexo/ui/context/dialog"
import { ButtonV2 } from "@apexo/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@apexo/ui/v2/dialog-v2"
import { DividerV2 } from "@apexo/ui/v2/divider-v2"
import { For, Show } from "solid-js"
import { useSettingsDialog } from "./settings-dialog"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { showToast } from "@/utils/toast"

const ISSUES_URL = "https://github.com/cluster1900/apexo-code/issues"

export function DialogHelpV2() {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const openShortcuts = useSettingsDialog("shortcuts")

  const guides = () => [
    ...docsGuides.map((guide) => ({ title: guide.title, url: guide.url })),
    { title: language.t("grok.docs.web"), url: docsURL },
    { title: language.t("grok.releaseNotes"), url: releaseNotesURL(platform.version ?? "") },
    { title: "GitHub Issues", url: ISSUES_URL },
  ]

  return (
    <Dialog size="large" fit>
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>{language.t("sidebar.help")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex max-h-[min(560px,calc(100vh-160px))] w-full flex-col gap-5 overflow-y-auto px-4 pt-4 pb-2">
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <div class="text-[13px] font-[530] text-v2-text-text-base">{language.t("grok.docs")}</div>
            <ButtonV2
              type="button"
              variant="outline"
              size="small"
              data-action="help-open-shortcuts"
              onClick={openShortcuts}
            >
              {language.t("settings.tab.shortcuts")}
            </ButtonV2>
          </div>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <For each={guides()}>
              {(guide) => (
                <button
                  type="button"
                  data-action="help-open-guide"
                  class="flex items-center justify-between gap-2 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2 text-left text-[12px] font-[480] text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-v2-border-border-focus"
                  onClick={() => platform.openExternal(guide.url)}
                >
                  <span class="truncate">{guide.title}</span>
                  <span class="shrink-0 text-v2-text-text-muted" aria-hidden="true">
                    ↗
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <div class="text-[13px] font-[530] text-v2-text-text-base">{language.t("grok.tutorial")}</div>
          <div class="flex flex-col gap-2">
            <For each={tutorialTopics}>
              {(topic, index) => (
                <div
                  data-slot="help-tutorial-topic"
                  class="flex flex-col gap-1 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2.5"
                >
                  <div class="text-[12px] font-[530] text-v2-text-text-base">
                    {index() + 1}. {topic.title}
                  </div>
                  <div class="text-[12px] leading-relaxed text-v2-text-text-muted">{topic.body}</div>
                </div>
              )}
            </For>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2
          type="button"
          variant="outline"
          data-action="help-check-updates"
          onClick={() => {
            if (!platform.checkUpdate) {
              showToast({
                title: language.t("desktop.menu.checkForUpdates"),
                description: language.t("desktop.updater.upToDate", { version: platform.version ?? "dev" }),
              })
              return
            }
            void platform
              .checkUpdate()
              .then((res) => {
                if (res.updateAvailable && res.version) {
                  showToast({
                    title: language.t("toast.update.title"),
                    description: language.t("toast.update.description", { version: res.version }),
                  })
                  return
                }
                showToast({
                  title: language.t("desktop.menu.checkForUpdates"),
                  description: language.t("desktop.updater.upToDate", { version: platform.version ?? "dev" }),
                })
              })
              .catch(() => {
                showToast({
                  title: language.t("desktop.menu.checkForUpdates"),
                  description: language.t("desktop.updater.upToDate", { version: platform.version ?? "dev" }),
                })
              })
          }}
        >
          {language.t("desktop.menu.checkForUpdates")}
        </ButtonV2>
        <ButtonV2 type="button" variant="outline" data-action="help-close" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}

export function useHelpDialog() {
  const dialog = useDialog()
  return () => {
    void dialog.show(() => <DialogHelpV2 />)
  }
}

import { Plugins } from "../plugins"
import { NativeMcpManager } from "../native-mcp-manager"
import { Component, createMemo, createSignal } from "solid-js"
import { Dialog } from "@apexo/ui/v2/dialog-v2"
import { TabsV2 } from "@apexo/ui/v2/tabs-v2"
import { Icon } from "@apexo/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SDKProvider } from "@/context/sdk"
import { SettingsGeneralV2 } from "./general"
import { SettingsKeybinds } from "../settings-keybinds"
import { SettingsProvidersV2 } from "./providers"
import { SettingsModelsV2 } from "./models"
import "./settings-v2.css"
import { SettingsServersV2 } from "./servers"
import { useDialog } from "@apexo/ui/context/dialog"
import { useHelpDialog } from "../dialog-help-v2"
import { useLayout } from "@/context/layout"
import { useTabs } from "@/context/tabs"
import { useServerSync } from "@/context/server-sync"

export const DialogSettings: Component<{
  sessionID?: string
  defaultValue?: string
}> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const layout = useLayout()
  const tabs = useTabs()
  const serverSync = useServerSync()
  const help = useHelpDialog()
  const [tab, setTab] = createSignal(props.defaultValue ?? "general")
  const directory = createMemo(() => {
    const route = layout.route()
    if (route.type === "dir-new-sesssion") return route.dir
    if (route.type === "draft") {
      const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
      return draft?.type === "draft" ? draft.directory : undefined
    }
    if (route.type === "session") return serverSync().session.get(route.sessionId)?.directory
    return undefined
  })

  const showProviders = () => {
    void dialog.show(() => <DialogSettings sessionID={props.sessionID} defaultValue="providers" />)
  }

  return (
    <Dialog size="x-large" variant="settings" class="settings-v2-dialog">
      <button
        type="button"
        class="settings-v2-close-button"
        aria-label={language.t("common.close")}
        onClick={() => dialog.close()}
      >
        <Icon name="close" size="small" />
      </button>
      <TabsV2
        orientation="vertical"
        variant="settings"
        value={tab()}
        onChange={(value) => setTab(value)}
        class="settings-v2"
      >
        <TabsV2.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-3 w-full">
              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <TabsV2.SectionTitle>{language.t("settings.section.desktop")}</TabsV2.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <TabsV2.Trigger value="general">
                      <Icon name="sliders" />
                      {language.t("settings.tab.general")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {language.t("settings.tab.shortcuts")}
                    </TabsV2.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <TabsV2.SectionTitle>{language.t("settings.section.server")}</TabsV2.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <TabsV2.Trigger value="servers">
                      <Icon name="server" />
                      {language.t("status.popover.tab.servers")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="providers">
                      <Icon name="providers" />
                      {language.t("settings.providers.title")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="plugins">
                      <Icon name="dot-grid" />
                      {language.t("plugins.title")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="mcp">
                      <Icon name="mcp" />
                      {language.t("settings.mcp.title")}
                    </TabsV2.Trigger>
                    <TabsV2.Trigger value="models">
                      <Icon name="models" />
                      {language.t("settings.models.title")}
                    </TabsV2.Trigger>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-2 w-full">
              <button
                type="button"
                data-action="settings-open-help"
                class="flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-13-regular text-text-weak hover:text-text-strong hover:bg-surface-base-hover transition-colors"
                onClick={help}
              >
                <Icon name="help" size="small" />
                <span>{language.t("sidebar.help")}</span>
              </button>
              <div class="settings-v2-nav-footer">
                <span>{language.t("app.name.desktop")}</span>
                <span>v{platform.version}</span>
              </div>
            </div>
          </div>
        </TabsV2.List>
        <TabsV2.Content value="general" class="settings-v2-panel">
          <SettingsGeneralV2 sessionID={props.sessionID} />
        </TabsV2.Content>
        <TabsV2.Content value="shortcuts" class="settings-v2-panel">
          <SettingsKeybinds v2 />
        </TabsV2.Content>
        <TabsV2.Content value="servers" class="settings-v2-panel">
          <SettingsServersV2 />
        </TabsV2.Content>
        <TabsV2.Content value="providers" class="settings-v2-panel">
          <SettingsProvidersV2 directory={directory} onBack={showProviders} />
        </TabsV2.Content>
        <TabsV2.Content value="plugins">
          <Plugins />
        </TabsV2.Content>
        <TabsV2.Content value="mcp" class="settings-v2-panel">
          <SDKProvider
            directory={() =>
              directory() ||
              serverSync().data.path.directory ||
              serverSync().data.project.find((p) => p.worktree && p.worktree !== "/")?.worktree ||
              "/"
            }
          >
            <NativeMcpManager allowManageConfig />
          </SDKProvider>
        </TabsV2.Content>
        <TabsV2.Content value="models" class="settings-v2-panel">
          <SettingsModelsV2 />
        </TabsV2.Content>
      </TabsV2>
    </Dialog>
  )
}

import { usePluginsDialog } from "./plugins-dialog"
import { useHelpDialog } from "./dialog-help-v2"
import { useParams } from "@solidjs/router"
import { onCleanup } from "solid-js"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { showToast } from "@/utils/toast"
import { useDialog } from "@apexo/ui/context/dialog"
import { useTheme } from "@apexo/ui/theme/context"

export function useSettingsDialog(defaultValue?: string) {
  const dialog = useDialog()
  const params = useParams<{ id?: string }>()
  let run = 0
  let dead = false

  onCleanup(() => {
    dead = true
  })

  return () => {
    const current = ++run
    const sessionID = params.id
    void import("@/components/settings-v2").then((module) => {
      if (dead || run !== current) return
      void dialog.show(() => <module.DialogSettings sessionID={sessionID} defaultValue={defaultValue} />)
    })
  }
}

export function useSettingsCommand() {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettings()
  const theme = useTheme()
  const show = useSettingsDialog()
  const plugins = usePluginsDialog()
  const help = useHelpDialog()

  const cycleTheme = () => {
    const ids = theme.ids()
    if (ids.length === 0) return
    const currentIndex = ids.indexOf(theme.themeId())
    const nextThemeId = ids[currentIndex === -1 ? 0 : (currentIndex + 1) % ids.length]!
    theme.setTheme(nextThemeId)
    showToast({
      title: language.t("toast.theme.title"),
      description: theme.name(nextThemeId),
    })
  }

  command.register("settings", () => [
    {
      id: "plugins.open",
      title: language.t("plugins.title"),
      category: language.t("command.category.settings"),
      slash: "plugins",
      slashAliases: ["marketplace"],
      onSelect: plugins,
    },
    {
      id: "settings.open",
      title: language.t("command.settings.open"),
      category: language.t("command.category.settings"),
      keybind: "mod+comma",
      slash: "settings",
      slashAliases: ["config", "preferences", "prefs"],
      onSelect: show,
    },
    {
      id: "help.open",
      title: language.t("sidebar.help"),
      category: language.t("command.category.settings"),
      keybind: "f1",
      slash: "help",
      onSelect: help,
    },
    {
      id: "app.checkUpdates",
      title: language.t("desktop.menu.checkForUpdates"),
      category: language.t("command.category.settings"),
      onSelect: () => {
        if (!platform.checkUpdate) {
          showToast({
            title: language.t("desktop.menu.checkForUpdates"),
            description: language.t("desktop.updater.unavailable" as never, { version: platform.version ?? "dev" }),
            actions: [
              {
                label: language.t("grok.releaseNotes"),
                onClick: () => platform.openExternal("https://github.com/cluster1900/apexo-code/releases"),
              },
            ],
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
              description: language.t("desktop.updater.unavailable" as never, { version: platform.version ?? "dev" }),
            })
          })
      },
    },
    {
      id: "provider.connect",
      title: language.t("command.provider.connect"),
      category: language.t("command.category.provider"),
      slash: "connect",
      slashAliases: ["login"],
      onSelect: () => {
        void import("@/components/dialog-connect-provider").then((x) => {
          void dialog.show(() => <x.DialogConnectProvider />)
        })
      },
    },
    {
      id: "app.exit",
      title: language.t("grok.exit.title"),
      category: language.t("command.category.settings"),
      slash: "exit",
      slashAliases: ["quit"],
      onSelect: () =>
        platform.runDesktopMenuAction ? void platform.runDesktopMenuAction("app.quit") : window.close(),
    },
    {
      id: "session.toggle.timestamps",
      title: language.t("grok.timestamps.title"),
      category: language.t("command.category.settings"),
      slash: "timestamps",
      slashAliases: ["toggle-timestamps"],
      onSelect: () => {
        const visible = document.documentElement.dataset.timestamps !== "show"
        document.documentElement.dataset.timestamps = visible ? "show" : "hide"
        localStorage.setItem("apexo.timestamps", visible ? "show" : "hide")
        showToast({ title: language.t(visible ? "grok.timestamps.shown" : "grok.timestamps.hidden") })
      },
    },
    {
      id: "theme.cycle",
      title: language.t("command.theme.cycle"),
      category: language.t("command.category.theme"),
      slash: "themes",
      slashAliases: ["theme", "t"],
      onSelect: cycleTheme,
    },
    {
      id: "reasoning.toggle",
      title: language.t("command.reasoning.toggle"),
      category: language.t("command.category.view"),
      slash: "thinking",
      slashAliases: ["toggle-thinking"],
      onSelect: () => settings.general.setShowReasoningSummaries(!settings.general.showReasoningSummaries()),
    },
  ])

  return show
}


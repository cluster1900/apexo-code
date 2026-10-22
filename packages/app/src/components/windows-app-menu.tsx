import { Show, type JSX } from "solid-js"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useDialog } from "@apexo/ui/context/dialog"
import { DropdownMenu } from "@apexo/ui/dropdown-menu"
import { Icon } from "@apexo/ui/icon"
import { IconButton } from "@apexo/ui/icon-button"
import { IconButtonV2 } from "@apexo/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@apexo/ui/v2/icon"

import { useCommand } from "@/context/command"
import { DESKTOP_MENU, desktopMenuVisible, type DesktopMenuAction, type DesktopMenuEntry } from "@/desktop-menu"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"

export function WindowsAppMenu(props: {
  command: ReturnType<typeof useCommand>
  platform: ReturnType<typeof usePlatform>
  variant?: "legacy" | "v2"
}) {
  let lastFocused: HTMLElement | undefined
  const language = useLanguage()
  const dialog = useDialog()

  const rememberFocus = () => {
    const active = document.activeElement
    lastFocused = active instanceof HTMLElement ? active : undefined
  }
  const commandDisabled = (id: string) => {
    const option = props.command.options.find((option) => option.id === id)
    if (!option) return true
    return option.disabled ?? false
  }
  const runCommand = (id: string) => {
    if (commandDisabled(id)) return
    props.command.trigger(id)
  }
  const newSessionKeybind = () => props.command.keybind("tab.new") || props.command.keybind("session.new")
  const newSessionDisabled = () => commandDisabled("tab.new") && commandDisabled("session.new")
  const runNewSession = () => {
    if (!commandDisabled("tab.new")) {
      runCommand("tab.new")
      return
    }
    runCommand("session.new")
  }
  const openAboutDialog = () => {
    const version = props.platform.version ?? "dev"
    const channel = import.meta.env.VITE_APEXO_CHANNEL ?? (import.meta.env.DEV ? "dev" : "stable")
    dialog.show(() => (
      <Dialog fit title={language.t("desktop.menu.about", { appName: "Apexo" })} class="w-full max-w-[380px] mx-auto">
        <div class="flex flex-col gap-3 px-6 pb-5 text-13-regular text-text-base">
          <div class="text-14-medium text-text-strong">{language.t("app.name.desktop")}</div>
          <div class="text-text-weak">
            {language.t("error.page.version", { version: `${version} (${channel})` })}
          </div>
          <div class="flex flex-wrap justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="large"
              onClick={() => {
                dialog.close()
                runCommand("app.checkUpdates")
              }}
            >
              {language.t("desktop.menu.checkForUpdates")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="large"
              onClick={() => props.platform.openExternal("https://github.com/cluster1900/apexo-code/releases")}
            >
              {language.t("grok.releaseNotes")}
            </Button>
            <Button type="button" variant="primary" size="large" onClick={() => dialog.close()}>
              {language.t("common.close")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }
  const runAction = (action: DesktopMenuAction) => {
    if (action.startsWith("edit.") && lastFocused?.isConnected) lastFocused.focus({ preventScroll: true })
    void props.platform.runDesktopMenuAction?.(action)
  }
  const runEntry = (entry: DesktopMenuEntry) => {
    if (entry.type === "separator") return
    if (entry.role === "about") {
      openAboutDialog()
      return
    }
    if (entry.command === "session.new") {
      runNewSession()
      return
    }
    if (entry.command) {
      runCommand(entry.command)
      return
    }
    if (entry.action) {
      runAction(entry.action)
      return
    }
    if (entry.href) props.platform.openExternal(entry.href)
  }

  return (
    <DropdownMenu gutter={4} modal={false} placement="bottom-start">
      {props.variant === "v2" ? (
        <div
          data-component="desktop-icon-button"
          class="flex h-7 w-9 shrink-0 items-center justify-center rounded-[6px] px-1"
        >
          <DropdownMenu.Trigger
            as={IconButtonV2}
            variant="ghost-muted"
            size="large"
            icon={<IconV2 name="menu" />}
            aria-label={language.t("desktop.menu.ariaLabel")}
            onPointerDown={rememberFocus}
            onKeyDown={rememberFocus}
          />
        </div>
      ) : (
        <DropdownMenu.Trigger
          as={IconButton}
          icon="menu"
          variant="ghost"
          class="titlebar-icon rounded-md shrink-0"
          aria-label={language.t("desktop.menu.ariaLabel")}
          onPointerDown={rememberFocus}
          onKeyDown={rememberFocus}
        />
      )}
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="desktop-app-menu">
          <DropdownMenu.Group>
            <DesktopMenuItem label={language.t("desktop.menu.app")} onSelect={openAboutDialog} />
            <DesktopMenuItem
              label={language.t("sidebar.nav.projectsAndSessions")}
              keybind={props.command.keybind("home.toggle") || props.command.keybind("sidebar.toggle")}
              disabled={commandDisabled("home.toggle") && commandDisabled("sidebar.toggle")}
              onSelect={() => {
                if (!commandDisabled("home.toggle")) {
                  runCommand("home.toggle")
                  return
                }
                runCommand("sidebar.toggle")
              }}
            />
            <DesktopMenuItem
              label={language.t("desktop.menu.newSession")}
              keybind={newSessionKeybind()}
              disabled={newSessionDisabled()}
              onSelect={runNewSession}
            />
            <DropdownMenu.Separator />
            {DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "windows")).map((menu) => (
              <DesktopMenuSubmenu label={language.t(menu.labelKey)}>
                {menu.items
                  ?.filter((entry) => desktopMenuVisible(entry, "windows"))
                  .map((entry) =>
                    entry.type === "separator" ? (
                      <DropdownMenu.Separator />
                    ) : (
                      <DesktopMenuItem
                        label={entry.labelKey ? language.t(entry.labelKey, { appName: "Apexo" }) : ""}
                        keybind={
                          entry.command === "session.new"
                            ? newSessionKeybind()
                            : entry.command
                              ? props.command.keybind(entry.command)
                              : entry.accelerator?.windows
                        }
                        disabled={
                          entry.command === "session.new"
                            ? newSessionDisabled()
                            : entry.command
                              ? commandDisabled(entry.command)
                              : false
                        }
                        onSelect={() => runEntry(entry)}
                      />
                    ),
                  )}
              </DesktopMenuSubmenu>
            ))}
          </DropdownMenu.Group>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

function DesktopMenuSubmenu(props: { label: string; children: JSX.Element }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger>
        <span data-slot="dropdown-menu-item-label">{props.label}</span>
        <span data-slot="desktop-app-menu-chevron">
          <Icon name="chevron-right" size="small" />
        </span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent class="desktop-app-menu">{props.children}</DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  )
}

function DesktopMenuItem(props: { label: string; keybind?: string; disabled?: boolean; onSelect: () => void }) {
  return (
    <DropdownMenu.Item disabled={props.disabled} onSelect={props.onSelect}>
      <DropdownMenu.ItemLabel>{props.label}</DropdownMenu.ItemLabel>
      <Show when={props.keybind}>
        <span data-slot="desktop-app-menu-keybind">{props.keybind}</span>
      </Show>
    </DropdownMenu.Item>
  )
}

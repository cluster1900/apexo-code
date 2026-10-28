import { useDialog } from "@apexo/ui/context/dialog"
import { Tooltip } from "@apexo/ui/tooltip"
import { ButtonV2 } from "@apexo/ui/v2/button-v2"
import { Icon as IconV2 } from "@apexo/ui/v2/icon"
import { IconButtonV2 } from "@apexo/ui/v2/icon-button-v2"
import { KeybindV2 } from "@apexo/ui/v2/keybind-v2"
import { TooltipV2 } from "@apexo/ui/v2/tooltip-v2"
import { WordmarkV2 } from "@apexo/ui/v2/wordmark-v2"
import { Show, createMemo, createSignal, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import createPresence from "solid-presence"
import { terminalTooltipKeybind } from "@/components/command-tooltip-keybind"
import { PromptInputV2Composer } from "@/components/prompt-input-v2"
import { PromptGitStatus, PromptWorkspaceSelector } from "@/components/prompt-workspace-selector"
import {
  PromptProjectAddButton,
  PromptProjectSelector,
  type PromptProjectController,
} from "@/components/prompt-project-selector"
import { StatusPopoverV2 } from "@/components/status-popover"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useTerminal } from "@/context/terminal"
import { useProviders } from "@/hooks/use-providers"
import { focusTerminalById } from "@/pages/session/helpers"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"
import { useSessionLayout } from "@/pages/session/session-layout"
import { Persist, persisted } from "@/utils/persist"
import type { NewSessionDraftController } from "./new-session-draft-controller"
import type { NewSessionWorkspaceController } from "./new-session-workspace-controller"

const providerTipDismissalDuration = 30 * 24 * 60 * 60 * 1000

export function NewSessionView(props: {
  input: NewSessionDraftController["input"]
  project: PromptProjectController
  workspace: NewSessionWorkspaceController
}) {
  return (
    <div class="@container relative flex flex-col min-h-0 h-full flex-1">
      <div
        data-component="session-new-design"
        class="relative flex-1 min-h-0 overflow-hidden rounded-[10px] bg-v2-background-bg-deep"
      >
        <div class="absolute inset-x-0 top-[25.375%] flex justify-center px-6">
          <div class={NEW_SESSION_CONTENT_WIDTH}>
            <WordmarkV2 class="h-auto w-full text-v2-background-bg-inverse" />
            <div class="mt-8 flex flex-col gap-8">
              <PromptInputV2Composer controller={props.input} />
              <NoProviderOnboardingCard />
              <Show when={props.project.empty()}>
                <PromptProjectAddButton controller={props.project} />
              </Show>
              <Show when={props.project.selected()}>
                <div class="flex min-h-7 min-w-0 flex-col items-center justify-center gap-0 text-v2-text-text-faint sm:flex-row">
                  <PromptProjectSelector controller={props.project} placement="bottom" />
                  <Show
                    when={props.workspace.bar.visible()}
                    fallback={
                      <PromptGitStatus branch={props.workspace.bar.branch()} noGit={!props.workspace.project.git()} />
                    }
                  >
                    <PromptWorkspaceSelector
                      value={props.workspace.selection.value()}
                      projectRoot={props.workspace.project.root()}
                      workspaces={props.workspace.project.workspaces()}
                      branch={props.workspace.bar.branch()}
                      onChange={props.workspace.selection.set}
                      onDone={props.input.restoreFocus}
                    />
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </div>
        <ProviderTip />
      </div>
    </div>
  )
}

export function NewSessionStatus(props: { mount: Accessor<HTMLElement | null>; visible: Accessor<boolean> }) {
  const language = useLanguage()
  const command = useCommand()
  const terminal = useTerminal()
  const { view } = useSessionLayout()
  const terminalKeybind = createMemo(() => terminalTooltipKeybind(command))
  const toggleTerminal = () => {
    const next = !view().terminal.opened()
    view().terminal.toggle()
    if (!next) return
    const id = terminal.active()
    if (!id) return
    focusTerminalById(id)
  }

  return (
    <Show when={props.mount()} keyed>
      {(mount) => (
        <Portal mount={mount}>
          <div class="flex items-center gap-2">
            <Show when={props.visible()}>
              <Tooltip placement="bottom" value={language.t("status.popover.trigger")}>
                <StatusPopoverV2 />
              </Tooltip>
            </Show>
            <TooltipV2
              class="shrink-0"
              placement="bottom"
              value={
                <>
                  {language.t("command.terminal.toggle")}
                  <Show when={terminalKeybind().length > 0}>
                    <KeybindV2 keys={terminalKeybind()} variant="neutral" />
                  </Show>
                </>
              }
            >
              <IconButtonV2
                type="button"
                variant="ghost-muted"
                size="large"
                class="!w-9 shrink-0"
                state={view().terminal.opened() ? "pressed" : undefined}
                onClick={toggleTerminal}
                aria-label={language.t("command.terminal.toggle")}
                aria-expanded={view().terminal.opened()}
                aria-controls="terminal-panel"
                icon={<IconV2 name="terminal" />}
              />
            </TooltipV2>
          </div>
        </Portal>
      )}
    </Show>
  )
}

function useProviderReady(directory: Accessor<string>) {
  const serverSync = useServerSync()
  return createMemo(() =>
    directory() ? serverSync().child(directory())[0].provider_ready : serverSync().data.ready,
  )
}

function NoProviderOnboardingCard() {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useSDK()
  const providerReady = useProviderReady(() => sdk().directory)
  const providers = useProviders(() => sdk().directory)
  const [persistedState, setPersistedState, , persistedReady] = persisted(
    Persist.global("new-session.provider-onboarding"),
    createStore({ dismissed: false }),
  )
  const hasExplicitProvider = createMemo(() =>
    providers
      .connected()
      .some((p) => p.source === "api" || p.source === "config" || p.source === "custom"),
  )
  const visible = createMemo(
    () =>
      providerReady() &&
      persistedReady() &&
      (providers.connected().length === 0 || (!hasExplicitProvider() && !persistedState.dismissed)),
  )

  const openConnectProvider = () => {
    setPersistedState("dismissed", true)
    void import("@/components/dialog-connect-provider").then(({ DialogConnectProvider }) => {
      void dialog.show(() => <DialogConnectProvider directory={() => sdk().directory} />)
    })
  }

  const openCustomProvider = () => {
    setPersistedState("dismissed", true)
    void import("@/components/dialog-custom-provider").then(({ DialogCustomProvider }) => {
      void dialog.show(() => <DialogCustomProvider onBack={() => dialog.close()} />)
    })
  }

  return (
    <Show when={visible()}>
      <div
        data-component="provider-onboarding-card"
        class="flex flex-col gap-3 rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-base p-4"
      >
        <div class="flex flex-col gap-1">
          <div class="text-[14px] font-medium text-v2-text-text-base">{language.t("home.onboarding.provider.title")}</div>
          <div class="text-[13px] text-v2-text-text-muted">{language.t("home.onboarding.provider.description")}</div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <ButtonV2 variant="contrast" size="normal" onClick={openConnectProvider}>
            {language.t("command.provider.connect")}
          </ButtonV2>
          <ButtonV2 variant="neutral" size="normal" onClick={openCustomProvider}>
            {language.t("provider.custom.title")}
          </ButtonV2>
        </div>
      </div>
    </Show>
  )
}

function ProviderTip() {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useSDK()
  const providerReady = useProviderReady(() => sdk().directory)
  const providers = useProviders(() => sdk().directory)
  const [persistedState, setPersistedState, , persistedReady] = persisted(
    Persist.global("new-session.provider-tip"),
    createStore({ dismissedAt: 0 }),
  )
  const visible = createMemo(
    () =>
      providerReady() &&
      persistedReady() &&
      providers.paid().length === 0 &&
      Date.now() - persistedState.dismissedAt >= providerTipDismissalDuration,
  )
  const [ref, setRef] = createSignal<HTMLDivElement>()
  const presence = createPresence({
    show: visible,
    element: () => ref() ?? null,
  })
  const openProviders = () => {
    void import("@/components/dialog-connect-provider").then(({ DialogConnectProvider }) => {
      void dialog.show(() => <DialogConnectProvider directory={() => sdk().directory} />)
    })
  }

  return (
    <Show when={presence.present()}>
      <div class="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-10">
        <div
          ref={setRef}
          data-component="provider-tip"
          data-visible={visible()}
          class="group/provider-tip pointer-events-auto relative flex h-6 max-w-full items-center transition-[opacity,transform] duration-[250ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none"
          classList={{ "data-[visible=false]:animate-out fade-out slide-out-to-bottom-4": true }}
        >
          <button
            type="button"
            class="flex h-6 min-w-0 items-center rounded-[4px] pl-1.5 text-[13px] leading-none tracking-[-0.04px] text-v2-text-text-faint transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-muted focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus"
            onClick={openProviders}
          >
            <span class="truncate">{language.t("home.providerTip")}</span>
            <span class="flex size-6 shrink-0 items-center justify-center" aria-hidden="true">
              <IconV2 name="chevron-down" size="small" class="-rotate-90" />
            </span>
          </button>
          <TooltipV2
            class="hover-reveal absolute left-full top-0 flex h-6 w-7 items-center justify-end delay-0 duration-0 group-hover/provider-tip:delay-[250ms] group-hover/provider-tip:duration-150 group-hover/provider-tip:opacity-100 focus-within:delay-0 focus-within:duration-0 focus-within:opacity-100"
            placement="top"
            openDelay={1000}
            value={language.t("common.dismiss")}
          >
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded-[4px] text-v2-icon-icon-muted transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-icon-icon-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus"
              aria-label={language.t("common.dismiss")}
              onClick={() => setPersistedState("dismissedAt", Date.now())}
            >
              <IconV2 name="xmark-small" />
            </button>
          </TooltipV2>
        </div>
      </div>
    </Show>
  )
}

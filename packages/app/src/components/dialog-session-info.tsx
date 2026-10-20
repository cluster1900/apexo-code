import type { Message } from "@apexo/sdk/v2/client"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"
import { For, createMemo } from "solid-js"
import { getSessionContext } from "@/components/session/session-context-metrics"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useProviders } from "@/hooks/use-providers"
import { showToast } from "@/utils/toast"

/**
 * Grok Build `/session-info` (aliases `/status`, `/info`): auth, model, turn count and context usage for the open
 * session. `c` copies the session ID and `y` copies the whole block.
 */
export function DialogSessionInfo(props: { sessionID: string }) {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const providers = useProviders(() => sdk().directory)
  const session = () => sync().session.get(props.sessionID)
  const messages = () => (sync().data.message[props.sessionID] ?? []) as Message[]
  const context = createMemo(() => getSessionContext(messages(), [...providers.all().values()]))
  const providerID = () => context()?.message.providerID ?? session()?.model?.providerID
  const number = (value: number) => value.toLocaleString(language.intl())

  const rows = createMemo(() => {
    const provider = providers.all().get(providerID() ?? "")
    const usage = context()
    return [
      { label: language.t("grok.sessionInfo.id"), value: props.sessionID },
      { label: language.t("grok.sessionInfo.title"), value: session()?.title || "—" },
      {
        label: language.t("grok.sessionInfo.auth"),
        value: provider
          ? `${provider.name} · ${language.t(`grok.sessionInfo.auth.${provider.source}` as "grok.sessionInfo.auth.api")}`
          : (providerID() ?? "—"),
      },
      { label: language.t("grok.sessionInfo.model"), value: usage?.modelLabel ?? session()?.model?.id ?? "—" },
      { label: language.t("grok.sessionInfo.agent"), value: session()?.agent ?? "—" },
      {
        label: language.t("grok.sessionInfo.turns"),
        value: number(messages().filter((message) => message.role === "user").length),
      },
      {
        label: language.t("grok.sessionInfo.context"),
        value: !usage
          ? "—"
          : usage.limit
            ? `${number(usage.total)} / ${number(usage.limit)} (${usage.usage}%)`
            : number(usage.total),
      },
    ]
  })

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    showToast({ variant: "success", icon: "circle-check", title: language.t("grok.sessionInfo.copied") })
  }
  const copyID = () => void copy(props.sessionID).catch(() => undefined)
  const copyAll = () =>
    void copy(rows().map((row) => `${row.label}: ${row.value}`).join("\n")).catch(() => undefined)

  makeEventListener(document, "keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable='true']")) return
    if (event.key === "c") copyID()
    if (event.key === "y") copyAll()
  })

  return (
    <Dialog title={language.t("grok.sessionInfo")}>
      <div class="px-4 pb-4 flex flex-col gap-3" data-component="session-info">
        <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-border-weak-base bg-surface-inset-base/30 p-3.5 text-13-regular">
          <For each={rows()}>
            {(row) => (
              <>
                <span class="text-text-weak">{row.label}</span>
                <span class="text-text-strong font-mono break-all select-text" data-session-info={row.label}>
                  {row.value}
                </span>
              </>
            )}
          </For>
        </div>
        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={copyAll}>
            {language.t("grok.sessionInfo.copyAll")}
          </Button>
          <Button variant="primary" data-action="session-info-copy-id" onClick={copyID}>
            {language.t("grok.sessionInfo.copyId")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

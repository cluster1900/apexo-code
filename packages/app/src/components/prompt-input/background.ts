import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"

export function createForegroundShellBackground(sessionID: () => string | undefined) {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const [state, setState] = createStore({ pending: false })
  const available = createMemo(() => {
    const message = sync().data.message[sessionID() ?? ""]?.findLast((item) => item.role === "assistant")
    if (!message) return false
    return (
      sync().data.part[message.id]?.some(
        (part) =>
          part.type === "tool" &&
          part.tool === "run_terminal_cmd" &&
          part.state.status === "running" &&
          part.state.metadata?.foreground === true &&
          part.state.metadata?.background !== true,
      ) ?? false
    )
  })
  const run = async () => {
    const id = sessionID()
    if (!id || !available() || state.pending) return
    setState("pending", true)
    await sdk()
      .client.experimental.session.background({ sessionID: id }, { throwOnError: true })
      .catch((error: unknown) =>
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setState("pending", false))
  }
  return {
    available,
    pending: () => state.pending,
    run,
    onKeyDown(event: KeyboardEvent) {
      if (
        !event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "b" ||
        !available()
      )
        return false
      event.preventDefault()
      event.stopPropagation()
      void run()
      return true
    },
  }
}

import { createEffect, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { MemoryCaptureActivity } from "@apexo/sdk/v2"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useDialog } from "@apexo/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

export function createMemoryCaptureNotifications(sessionID: () => string | undefined) {
  const sdk = useSDK()
  const [state, setState] = createStore({ events: [] as MemoryCaptureActivity["data"][] })
  createEffect(() => {
    const id = sessionID()
    const source = sdk()
    setState("events", [])
    if (!id) return
    onCleanup(
      source.event.on("memory.capture.activity", (event) => {
        if (event.properties.sessionID !== id) return
        setState("events", (entries) => [...entries.slice(-19), event.properties])
      }),
    )
  })
  return { events: () => state.events }
}

export function MemoryCaptureNotifications(props: { capture: ReturnType<typeof createMemoryCaptureNotifications> }) {
  const language = useLanguage()
  const dialog = useDialog()
  const open = () =>
    dialog.show(() => (
      <Dialog title={language.t("memory.capture.title")} size="large">
        <div
          data-component="memory-capture-notifications"
          class="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 pb-6 max-h-[60vh]"
        >
          <p>{language.t("memory.capture.description")}</p>
          <For each={props.capture.events()}>
            {(event) => (
              <section class="flex flex-col gap-2" data-activity={event.activity}>
                <h3 class="font-medium">{language.t(`memory.capture.${event.activity}`)}</h3>
                <p>
                  {language.t("memory.capture.range", {
                    from: event.fromTurn,
                    through: event.throughTurn,
                    attempt: event.attempt,
                  })}
                </p>
                <For each={event.memories}>
                  {(memory) => (
                    <article class="flex flex-col gap-1 border-l-2 pl-3 break-words">
                      <p>{memory.statement}</p>
                      <Show when={memory.body}>
                        <p class="whitespace-pre-wrap">{memory.body}</p>
                      </Show>
                      <code class="break-all text-xs">{memory.path}</code>
                    </article>
                  )}
                </For>
              </section>
            )}
          </For>
        </div>
      </Dialog>
    ))
  return (
    <Show when={props.capture.events().at(-1)}>
      {(event) => (
        <Button data-action="memory-capture-notifications" size="small" variant="ghost" onClick={open}>
          <span role="status">
            {language.t("memory.capture.status", { status: language.t(`memory.capture.${event().activity}`) })}
          </span>
        </Button>
      )}
    </Show>
  )
}

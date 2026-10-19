import { For, Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { SideQuestionEntry, SideQuestionInput } from "@apexo/sdk/v2/client"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

export function SideQuestionDialog(props: {
  sessionID: string
  question?: string
  images?: SideQuestionInput["images"]
  autoAsk?: boolean
}) {
  const language = useLanguage()
  const sdk = useSDK()()
  const api = sdk.protocol.then((protocol) =>
    protocol === "v2" ? sdk.client.v2.sideQuestion : sdk.client.sideQuestion,
  )
  let imageInput: HTMLInputElement | undefined
  const clearImages = () => {
    setState({ images: [], imageError: false })
    if (imageInput) imageInput.value = ""
  }
  const lifetime = new AbortController()
  const [state, setState] = createStore({
    question: props.question ?? "",
    images: (props.images ?? []) as NonNullable<SideQuestionInput["images"]>,
    items: [] as SideQuestionEntry[],
    pending: false,
    error: false,
    imageError: false,
  })
  const refresh = async () => {
    await (
      await api
    )
      .list({ sessionID: props.sessionID }, { signal: lifetime.signal, throwOnError: true })
      .then((result) => {
        if (!lifetime.signal.aborted) setState("items", result.data)
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
  }
  const ask = async () => {
    if (state.pending || !state.question.trim()) return
    setState({ pending: true, error: false })
    await (
      await api
    )
      .ask(
        { sessionID: props.sessionID, sideQuestionInput: { question: state.question, images: state.images } },
        { signal: lifetime.signal, throwOnError: true },
      )
      .then(async () => {
        if (!lifetime.signal.aborted) {
          setState("question", "")
          clearImages()
          await refresh()
        }
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  const cancel = async (questionID: string) => {
    await (
      await api
    )
      .cancel({ sessionID: props.sessionID, questionID }, { signal: lifetime.signal, throwOnError: true })
      .then(refresh)
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
  }
  const attach = async (files: FileList | null) => {
    if (!files) return
    const selected = [...files]
    if (
      selected.length > 20 ||
      selected.reduce((sum, file) => sum + file.size, 0) > 50_000_000 ||
      selected.some((file) => !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type))
    ) {
      clearImages()
      setState("imageError", true)
      return
    }
    const images = await Promise.all(
      selected.map(async (file) => ({
        mediaType: file.type as NonNullable<SideQuestionInput["images"]>[number]["mediaType"],
        data: await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).split(",")[1]!)
          reader.onerror = reject
          reader.readAsDataURL(file)
        }),
      })),
    ).catch(() => undefined)
    if (lifetime.signal.aborted) return
    if (!images) {
      clearImages()
      setState("imageError", true)
      return
    }
    setState({ images, imageError: false })
  }
  onMount(() => {
    if (props.autoAsk) void ask()
    else void refresh()
  })
  const timer = setInterval(() => {
    if (state.items.some((item) => item.status === "running")) void refresh()
  }, 1000)
  onCleanup(() => {
    lifetime.abort()
    clearInterval(timer)
  })
  return (
    <Dialog title={language.t("btw.title")} size="large" fit>
      <div data-testid="btw-panel" class="min-h-0 max-h-[65vh] overflow-y-auto px-6 pt-2 pb-6 space-y-4">
        <p class="text-13-regular text-text-weak">{language.t("btw.description")}</p>
        <label class="flex flex-col gap-1.5 text-13-medium text-text-strong">
          {language.t("btw.question")}
          <textarea
            data-testid="btw-question"
            class="w-full min-h-24 rounded-md border border-border-base bg-surface-inset-base p-2.5 text-14-regular text-text-base"
            value={state.question}
            onInput={(event) => setState("question", event.currentTarget.value)}
          />
        </label>
        <div class="flex flex-col gap-1.5">
          <span class="text-13-medium text-text-strong">{language.t("btw.images")}</span>
          <input
            ref={imageInput}
            data-testid="btw-images"
            type="file"
            class="sr-only"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={(event) => void attach(event.currentTarget.files)}
          />
          <div class="flex items-center gap-2">
            <Button variant="secondary" size="small" onClick={() => imageInput?.click()}>
              {language.t("feedback.images.add")}
            </Button>
            <Show when={state.images.length}>
              <span class="text-12-regular text-text-weak">{language.t("btw.attached", { count: state.images.length })}</span>
              <Button variant="ghost" size="small" onClick={clearImages}>
                {language.t("btw.clearImages")}
              </Button>
            </Show>
          </div>
        </div>
        <Show when={state.imageError}>
          <p role="alert" class="text-text-critical-base">{language.t("btw.imageError")}</p>
        </Show>
        <div class="flex items-center gap-2">
          <Button data-testid="btw-ask" variant="primary" disabled={state.pending || !state.question.trim()} onClick={() => void ask()}>
            {language.t("btw.ask")}
          </Button>
          <Button data-testid="btw-refresh" variant="ghost" onClick={() => void refresh()}>
            {language.t("btw.refresh")}
          </Button>
        </div>
        <Show when={state.error}>
          <p role="alert">{language.t("btw.error")}</p>
        </Show>
        <For each={state.items.toReversed()}>
          {(entry) => (
            <section data-testid="btw-entry" data-status={entry.status} class="border rounded p-3 space-y-2">
              <p class="font-medium whitespace-pre-wrap">{entry.question}</p>
              <p class="text-text-weak">
                {language.t(`btw.status.${entry.status}`)} · {entry.model}
              </p>
              <Show when={entry.status === "running"}>
                <Button data-testid="btw-cancel" onClick={() => void cancel(entry.id)}>
                  {language.t("btw.cancel")}
                </Button>
              </Show>
              <Show when={entry.answer}>
                <div data-testid="btw-answer" class="whitespace-pre-wrap break-words">
                  {entry.answer}
                </div>
              </Show>
              <Show when={entry.status === "failed"}>
                <p role="alert">{language.t("btw.failed")}</p>
              </Show>
            </section>
          )}
        </For>
      </div>
    </Dialog>
  )
}

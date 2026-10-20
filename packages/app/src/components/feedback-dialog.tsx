import { For, Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Feedback } from "@apexo/schema/feedback"
import { feedbackExport, feedbackImageDataUrl, feedbackImageSnapshot } from "@apexo/sdk/v2/feedback-images"
import type { FeedbackDraft, FeedbackImageInput, FeedbackIssue } from "@apexo/sdk/v2/client"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"

export function FeedbackDialog(props: { sessionID: string; initialMessage?: string }) {
  const language = useLanguage()
  const platform = usePlatform()
  const sdk = useSDK()()
  const api = sdk.protocol.then((protocol) => (protocol === "v2" ? sdk.client.v2.feedback : sdk.client.feedback))
  const lifetime = new AbortController()
  let picker: HTMLInputElement | undefined
  const initial = props.initialMessage?.trim() ?? ""
  const empty = {
    title: "",
    details: "",
    product_area: "",
    type: "bug" as Feedback.Input["type"],
    task_category: undefined as Feedback.Input["task_category"],
    failure_mode: undefined as Feedback.Input["failure_mode"],
  }
  const [state, setState] = createStore({
    items: [] as FeedbackDraft[],
    input: { ...empty, title: initial, details: initial },
    selected: undefined as FeedbackDraft | undefined,
    issue: undefined as FeedbackIssue | undefined,
    images: [] as { key: string; input: FeedbackImageInput; preview: string; name: string; size: number }[],
    imageError: false,
    loading: false,
    pending: false,
    error: false,
    confirm: false,
    saved: false,
    copied: false,
  })
  const load = async () => {
    setState({ loading: true, error: false })
    await (
      await api
    )
      .list({ sessionID: props.sessionID }, { throwOnError: true, signal: lifetime.signal })
      .then((result) => {
        if (!lifetime.signal.aborted) setState("items", result.data)
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("loading", false)
      })
  }
  const select = async (draft?: FeedbackDraft) => {
    setState({
      selected: draft,
      input: draft
        ? {
            title: draft.title,
            details: draft.details,
            product_area: draft.product_area ?? "",
            type: draft.type,
            task_category: draft.task_category,
            failure_mode: draft.failure_mode,
          }
        : { ...empty },
      issue: undefined,
      confirm: false,
      saved: false,
      error: false,
      copied: false,
      imageError: false,
      images: (draft?.images ?? []).map((image) => ({
        key: image.id,
        input: { id: image.id },
        preview: "",
        name: image.fileName,
        size: image.size,
      })),
    })
    if (!draft?.images?.length) return
    setState("pending", true)
    await Promise.all(
      draft.images.map(async (image) => {
        const result = await (
          await api
        ).image(
          {
            sessionID: props.sessionID,
            draftID: draft.id,
            imageID: image.id,
            feedbackReview: { revision: draft.revision },
          },
          { throwOnError: true, signal: lifetime.signal },
        )
        return {
          key: image.id,
          input: { id: image.id },
          preview: feedbackImageDataUrl(result.data),
          name: image.fileName,
          size: image.size,
        }
      }),
    )
      .then((images) => {
        if (!lifetime.signal.aborted && state.selected?.id === draft.id && state.selected.revision === draft.revision)
          setState("images", images)
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  const addImages = async (files: readonly (Blob & { readonly name?: string })[]) => {
    if (state.pending) return
    setState({ pending: true, imageError: false })
    await Promise.resolve()
      .then(async () => {
        if (
          !files.length ||
          state.images.length + files.length > Feedback.MaxImages ||
          state.images.reduce((total, image) => total + image.size, 0) +
            files.reduce((total, file) => total + file.size, 0) >
            Feedback.MaxImageTotalBytes
        )
          throw new Error("feedback_image_limit")
        const images = await Promise.all(
          files.map(async (file) => {
            const input = await feedbackImageSnapshot(file)
            return {
              key: crypto.randomUUID(),
              input,
              preview: feedbackImageDataUrl(input),
              name: input.fileName ?? language.t("feedback.images.unnamed"),
              size: file.size,
            }
          }),
        )
        if (!lifetime.signal.aborted) {
          setState("images", [...state.images, ...images])
          edited()
        }
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("imageError", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  const pasteImage = async () => {
    if (state.pending) return
    setState({ pending: true, imageError: false })
    await Promise.resolve()
      .then(async () => {
        if (platform.readClipboardImage) {
          const image = await platform.readClipboardImage()
          if (!image) throw new Error("feedback_clipboard_image")
          return [image]
        }
        const items = await navigator.clipboard.read()
        return Promise.all(
          items.map(async (item) => {
            const type = item.types.find((type) => ["image/png", "image/jpeg", "image/gif"].includes(type))
            if (!type) throw new Error("feedback_clipboard_image")
            return item.getType(type)
          }),
        )
      })
      .then(async (images) => {
        if (lifetime.signal.aborted) return
        setState("pending", false)
        await addImages(images)
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("imageError", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  const save = async (review: boolean) => {
    if (state.pending || !state.input.title.trim() || (!state.input.details.trim() && !state.images.length)) return
    setState({ pending: true, error: false, issue: undefined, confirm: false })
    await (
      await api
    )
      .save(
        {
          sessionID: props.sessionID,
          feedbackSave: {
            ...state.input,
            draft_id: state.selected?.id,
            revision: state.selected?.revision,
            images: state.images.map((image) => image.input),
          },
        },
        { throwOnError: true, signal: lifetime.signal },
      )
      .then(async (result) => {
        if (lifetime.signal.aborted) return
        setState({ selected: result.data, saved: true })
        setState(
          "images",
          (result.data.images ?? []).map((image, index) => ({
            key: image.id,
            input: { id: image.id },
            preview: state.images[index]?.preview ?? "",
            name: image.fileName,
            size: image.size,
          })),
        )
        if (review) {
          const issue = await (
            await api
          ).review(
            { sessionID: props.sessionID, draftID: result.data.id, feedbackReview: { revision: result.data.revision } },
            { throwOnError: true, signal: lifetime.signal },
          )
          if (!lifetime.signal.aborted) setState("issue", issue.data)
        }
        await load()
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  const remove = async () => {
    const draft = state.selected
    if (!draft || state.pending) return
    setState({ pending: true, error: false })
    await (
      await api
    )
      .remove(
        { sessionID: props.sessionID, draftID: draft.id, feedbackReview: { revision: draft.revision } },
        { throwOnError: true, signal: lifetime.signal },
      )
      .then(async () => {
        if (!lifetime.signal.aborted) {
          select()
          await load()
        }
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  const edited = () => setState({ issue: undefined, saved: false, confirm: false, copied: false })
  const download = async () => {
    const issue = state.issue
    if (!issue || state.pending) return
    setState({ pending: true, error: false })
    await Promise.all(
      (issue.draft.images ?? []).map(
        async (image) =>
          (
            await (
              await api
            ).image(
              {
                sessionID: props.sessionID,
                draftID: issue.draft.id,
                imageID: image.id,
                feedbackReview: { revision: issue.draft.revision },
              },
              { throwOnError: true, signal: lifetime.signal },
            )
          ).data,
      ),
    )
      .then((images) => {
        if (lifetime.signal.aborted) return
        const exported = feedbackExport(issue, images, {
          manual: language.t("feedback.images.manual"),
          download: language.t("feedback.images.download"),
        })
        const url = URL.createObjectURL(new Blob([exported.content], { type: exported.mime }))
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = `${issue.draft.id}.${exported.extension}`
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  onMount(() => void load())
  onCleanup(() => lifetime.abort())
  const field =
    "w-full rounded-md border border-border-base bg-background-base px-3 py-2 text-14-regular text-text-strong"
  return (
    <Dialog title={language.t("feedback.title")} size="large">
      <div
        data-component="feedback-dialog"
        class="min-h-0 max-h-[60vh] overflow-y-auto px-6 pb-6 space-y-4"
        onPaste={(event) => {
          const files = Array.from(event.clipboardData?.files ?? [])
          if (!files.length) {
            if (platform.readClipboardImage && !event.clipboardData?.getData("text/plain")) {
              event.preventDefault()
              void pasteImage()
            }
            return
          }
          event.preventDefault()
          void addImages(files)
        }}
      >
        <p class="text-12-regular text-text-weak">{language.t("feedback.description")}</p>
        <div class="flex flex-wrap gap-2">
          <Button data-action="feedback-new" size="small" disabled={state.pending} onClick={() => select()}>
            {language.t("feedback.new")}
          </Button>
          <Button size="small" disabled={state.loading || state.pending} onClick={() => void load()}>
            {language.t("feedback.refresh")}
          </Button>
        </div>
        <Show when={state.loading}>
          <p role="status">{language.t("feedback.loading")}</p>
        </Show>
        <Show when={!state.loading && !state.items.length}>
          <p class="text-12-regular text-text-weak">{language.t("feedback.empty")}</p>
        </Show>
        <div class="flex flex-wrap gap-2">
          <For each={state.items}>
            {(draft) => (
              <Button
                size="small"
                variant={state.selected?.id === draft.id ? "primary" : "secondary"}
                data-feedback-draft={draft.id}
                disabled={state.pending}
                onClick={() => select(draft)}
              >
                {draft.title}
              </Button>
            )}
          </For>
        </div>
        <fieldset disabled={state.pending} class="flex flex-col gap-3" onInput={edited} onChange={edited}>
          <label>
            {language.t("feedback.subject")}
            <input
              data-field="feedback-title"
              class={field}
              value={state.input.title}
              maxLength={65536}
              onInput={(event) => setState("input", "title", event.currentTarget.value)}
            />
          </label>
          <label>
            {language.t("feedback.details")}
            <textarea
              data-field="feedback-details"
              class={field}
              rows={5}
              value={state.input.details}
              maxLength={65536}
              onInput={(event) => setState("input", "details", event.currentTarget.value)}
            />
          </label>
          <div class="grid grid-cols-2 gap-3">
            <label>
              {language.t("feedback.type")}
              <select
                data-field="feedback-type"
                class={field}
                value={state.input.type}
                onChange={(event) => setState("input", "type", event.currentTarget.value as Feedback.Input["type"])}
              >
                <For each={Feedback.Type.literals}>
                  {(value) => <option value={value}>{language.t(`feedback.type.${value}`)}</option>}
                </For>
              </select>
            </label>
            <label>
              {language.t("feedback.area")}
              <input
                class={field}
                value={state.input.product_area}
                maxLength={65536}
                onInput={(event) => setState("input", "product_area", event.currentTarget.value)}
              />
            </label>
            <label>
              {language.t("feedback.category")}
              <select
                class={field}
                value={state.input.task_category ?? ""}
                onChange={(event) =>
                  setState(
                    "input",
                    "task_category",
                    event.currentTarget.value
                      ? (event.currentTarget.value as Feedback.Input["task_category"])
                      : undefined,
                  )
                }
              >
                <option value="">{language.t("feedback.optional")}</option>
                <For each={Feedback.TaskCategory.literals}>
                  {(value) => <option value={value}>{language.t(`feedback.category.${value}`)}</option>}
                </For>
              </select>
            </label>
            <label>
              {language.t("feedback.failure")}
              <select
                class={field}
                value={state.input.failure_mode ?? ""}
                onChange={(event) =>
                  setState(
                    "input",
                    "failure_mode",
                    event.currentTarget.value
                      ? (event.currentTarget.value as Feedback.Input["failure_mode"])
                      : undefined,
                  )
                }
              >
                <option value="">{language.t("feedback.optional")}</option>
                <For each={Feedback.FailureMode.literals}>
                  {(value) => <option value={value}>{language.t(`feedback.failure.${value}`)}</option>}
                </For>
              </select>
            </label>
          </div>
        </fieldset>
        <section data-component="feedback-images" class="space-y-2">
          <p class="text-12-regular text-text-weak">{language.t("feedback.images.limits")}</p>
          <input
            ref={picker}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/gif"
            class="hidden"
            data-field="feedback-images"
            aria-label={language.t("feedback.images.add")}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? [])
              event.currentTarget.value = ""
              void addImages(files)
            }}
          />
          <div class="flex gap-2">
            <Button data-action="feedback-image-add" disabled={state.pending} onClick={() => picker?.click()}>
              {language.t("feedback.images.add")}
            </Button>
            <Button data-action="feedback-image-paste" disabled={state.pending} onClick={() => void pasteImage()}>
              {language.t("feedback.images.paste")}
            </Button>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <For each={state.images}>
              {(image) => (
                <figure
                  data-feedback-image={image.key}
                  class="min-w-0 rounded-md border border-border-base p-2 space-y-2"
                >
                  <Show when={image.preview}>
                    <img src={image.preview} alt={image.name} class="h-28 w-full object-contain" />
                  </Show>
                  <figcaption class="truncate text-12-regular" title={image.name}>
                    {image.name}
                  </figcaption>
                  <Button
                    data-action="feedback-image-remove"
                    disabled={state.pending}
                    onClick={() => {
                      setState(
                        "images",
                        state.images.filter((item) => item.key !== image.key),
                      )
                      edited()
                    }}
                  >
                    {language.t("prompt.attachment.remove")}
                  </Button>
                </figure>
              )}
            </For>
          </div>
          <Show when={state.imageError}>
            <p role="alert" class="text-12-regular text-text-danger-base">
              {language.t("feedback.images.error")}
            </p>
          </Show>
        </section>
        <div class="flex flex-wrap gap-2">
          <Button
            data-action="feedback-save"
            disabled={
              state.pending || !state.input.title.trim() || (!state.input.details.trim() && !state.images.length)
            }
            onClick={() => void save(false)}
          >
            {language.t("feedback.save")}
          </Button>
          <Button
            data-action="feedback-review"
            variant="primary"
            disabled={
              state.pending || !state.input.title.trim() || (!state.input.details.trim() && !state.images.length)
            }
            onClick={() => void save(true)}
          >
            {language.t("feedback.review")}
          </Button>
          <Show when={state.selected}>
            <Button data-action="feedback-delete" disabled={state.pending} onClick={() => setState("confirm", true)}>
              {language.t("feedback.delete")}
            </Button>
          </Show>
        </div>
        <Show when={state.confirm}>
          <div role="alert" class="flex items-center gap-3">
            <span>{language.t("feedback.deleteConfirm")}</span>
            <Button data-action="feedback-delete-confirm" disabled={state.pending} onClick={() => void remove()}>
              {language.t("feedback.delete")}
            </Button>
            <Button disabled={state.pending} onClick={() => setState("confirm", false)}>
              {language.t("common.cancel")}
            </Button>
          </div>
        </Show>
        <Show when={state.saved}>
          <p role="status" class="text-12-regular text-text-weak">
            {language.t("feedback.saved")}
          </p>
        </Show>
        <Show when={state.error}>
          <p role="alert" class="text-12-regular text-text-danger-base">
            {language.t("feedback.error")}
          </p>
        </Show>
        <Show when={state.issue}>
          {(issue) => (
            <section data-component="feedback-preview" class="flex flex-col gap-3">
              <h3>{issue().title}</h3>
              <pre class="whitespace-pre-wrap break-words text-12-regular max-h-72 overflow-y-auto">{issue().body}</pre>
              <p class="text-12-regular text-text-weak">{language.t("feedback.manual")}</p>
              <Show when={issue().draft.images?.length}>
                <p data-component="feedback-image-manual" class="text-12-regular text-text-weak">
                  {language.t("feedback.images.manual")}
                </p>
              </Show>
              <Show when={!new URL(issue().url).searchParams.has("body")}>
                <p role="status">{language.t("feedback.large")}</p>
              </Show>
              <div class="flex flex-wrap gap-2">
                <Button data-action="feedback-open" onClick={() => platform.openExternal(issue().url)}>
                  {language.t("feedback.open")}
                </Button>
                <Button
                  data-action="feedback-copy"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(issue().body)
                      .then(() => setState("copied", true))
                      .catch(() => setState("error", true))
                  }
                >
                  {language.t(state.copied ? "feedback.copied" : "feedback.copy")}
                </Button>
                <Button data-action="feedback-download" disabled={state.pending} onClick={() => void download()}>
                  {language.t(issue().draft.images?.length ? "feedback.images.export" : "feedback.download")}
                </Button>
              </div>
            </section>
          )}
        </Show>
      </div>
    </Dialog>
  )
}

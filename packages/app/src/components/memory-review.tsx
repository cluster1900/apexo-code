import { createStore } from "solid-js/store"
import { onCleanup, onMount, Show } from "solid-js"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useDialog } from "@apexo/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

export function MemoryReviewDialog(props: { sessionID: string; content?: string }) {
  const language = useLanguage()
  const dialog = useDialog()
  const client = useSDK()().client
  const lifetime = new AbortController()
  const requests = { rewrite: undefined as AbortController | undefined }
  const [state, setState] = createStore({
    raw: props.content?.trim() ?? "",
    rewritten: "",
    enhanced: false,
    editing: !props.content?.trim(),
    rewriting: false,
    saving: false,
    error: false,
    scope: "global" as "global" | "workspace",
    saved: "",
  })
  const content = () => (state.enhanced ? state.rewritten : state.raw)
  const rewrite = async () => {
    requests.rewrite?.abort()
    const abort = new AbortController()
    requests.rewrite = abort
    setState({ editing: false, rewriting: true, error: false })
    await client.experimental.memory
      .rewrite(
        { sessionID: props.sessionID, memoryReviewRewrite: { content: state.raw } },
        { throwOnError: true, signal: abort.signal },
      )
      .then((result) => {
        if (!abort.signal.aborted) setState("rewritten", result.data.content)
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!abort.signal.aborted) setState("rewriting", false)
      })
  }
  const edit = () => {
    requests.rewrite?.abort()
    setState({ raw: content(), rewritten: "", enhanced: false, editing: true, rewriting: false, error: false })
  }
  const save = async () => {
    if (state.saving || !content().trim()) return
    requests.rewrite?.abort()
    setState({ saving: true, rewriting: false, error: false })
    await client.experimental.memory
      .remember(
        { sessionID: props.sessionID, memoryReviewSave: { content: content(), scope: state.scope } },
        { throwOnError: true, signal: lifetime.signal },
      )
      .then((result) => {
        if (!lifetime.signal.aborted) setState("saved", result.data.path)
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("saving", false)
      })
  }
  onMount(() => {
    if (state.raw) void rewrite()
  })
  onCleanup(() => {
    lifetime.abort()
    requests.rewrite?.abort()
  })
  return (
    <Dialog title={language.t("memory.review.title")} size="large">
      <div class="flex flex-col gap-4 px-6 pb-6" data-component="memory-review">
        <Show
          when={!state.saved}
          fallback={
            <>
              <p role="status">{language.t("memory.review.saved")}</p>
              <code class="break-all">{state.saved}</code>
              <Button class="self-end" onClick={() => dialog.close()}>
                {language.t("common.close")}
              </Button>
            </>
          }
        >
          <p>{language.t("memory.review.description")}</p>
          <label for="memory-review-content">
            {language.t(state.enhanced ? "memory.review.rewritten" : "memory.review.original")}
          </label>
          <textarea
            id="memory-review-content"
            class="min-h-48 w-full rounded-md border border-border-base p-3 text-text-strong bg-background-base"
            value={content()}
            readOnly={!state.editing}
            onInput={(event) => setState("raw", event.currentTarget.value)}
          />
          <div class="flex gap-2 flex-wrap">
            <Show when={!state.editing}>
              <Button variant="secondary" disabled={state.saving} onClick={edit}>
                {language.t("common.edit")}
              </Button>
            </Show>
            <Button
              variant="secondary"
              disabled={!state.raw.trim() || state.rewriting || state.saving}
              onClick={() => void rewrite()}
            >
              {language.t(state.editing ? "memory.review.preview" : "memory.review.rewrite")}
            </Button>
            <Show when={state.rewritten && !state.editing}>
              <Button variant="secondary" disabled={state.saving} onClick={() => setState("enhanced", !state.enhanced)}>
                {language.t(state.enhanced ? "memory.review.original" : "memory.review.rewritten")}
              </Button>
            </Show>
          </div>
          <Show when={state.rewriting}>
            <p role="status">{language.t("memory.review.rewriting")}</p>
          </Show>
          <Show when={state.error}>
            <p role="alert">{language.t("memory.review.error")}</p>
          </Show>
          <label for="memory-review-scope">{language.t("memory.review.scope")}</label>
          <select
            id="memory-review-scope"
            value={state.scope}
            disabled={state.saving}
            onChange={(event) => setState("scope", event.currentTarget.value === "workspace" ? "workspace" : "global")}
          >
            <option value="global">{language.t("memory.global")}</option>
            <option value="workspace">{language.t("memory.workspace")}</option>
          </select>
          <div class="flex gap-2 justify-end">
            <Button variant="ghost" disabled={state.saving} onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button disabled={state.saving || state.editing || !content().trim()} onClick={() => void save()}>
              {language.t("common.save")}
            </Button>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}

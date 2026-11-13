import { codeReviewAvailable } from "@apexo/sdk/v2/code-review"
import { createMemo, createEffect, For, Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { CodeReviewInput, CodeReviewRun } from "@apexo/sdk/v2/client"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useDialog } from "@apexo/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { ReviewPanelV2 } from "@/pages/session/v2/review-panel-v2"
import { createReviewPanelV2State } from "@/pages/session/v2/review-panel-v2-state"

const fieldClass = "rounded border border-border-base bg-surface-inset-base px-2 py-1.5 text-13-regular text-text-base"

export function CodeReviewDialog(props: {
  sessionID: string
  currentSessionID: () => string | undefined
  focus?: string
}) {
  const language = useLanguage()
  const sdk = useSDK()()
  const dialog = useDialog()
  const lifetime = new AbortController()
  let refreshToken = 0
  const panel = createReviewPanelV2State()
  const [state, setState] = createStore({
    available: false,
    pending: true,
    refreshing: false,
    error: false,
    hasMore: false,
    target: "uncommitted" as CodeReviewInput["target"]["type"],
    ref: "",
    focus: props.focus ?? "",
    items: [] as CodeReviewRun[],
    selected: "",
    detail: undefined as CodeReviewRun | undefined,
    priority: "all",
    finding: "",
    file: "",
  })
  const current = () => !lifetime.signal.aborted && props.currentSessionID() === props.sessionID
  const options = { signal: lifetime.signal, throwOnError: true as const }
  const terminal = (run: CodeReviewRun) => !["admitted", "capturing", "running"].includes(run.status)
  const detail = async (id: string, compare = true, token = refreshToken) => {
    const selected = state.items.find((item) => item.id === id)
    const workspace = selected && terminal(selected) && (compare || !state.detail || !terminal(state.detail))
    const result = (
      await sdk.client.v2.codeReview.get(
        { sessionID: props.sessionID, reviewID: id, ...(workspace ? { compareWorkspace: "true" as const } : {}) },
        options,
      )
    ).data
    if (current() && token === refreshToken && state.selected === id) setState("detail", result)
  }
  const refresh = async (more = false, compare = true, token = refreshToken) => {
    const page = (
      await sdk.client.v2.codeReview.list(
        { sessionID: props.sessionID, ...(more && state.items.length ? { after: state.items.at(-1)!.id } : {}) },
        options,
      )
    ).data
    if (!current() || token !== refreshToken) return
    const items = more
      ? [...state.items, ...page.data]
      : [...page.data, ...state.items.filter((item) => !page.data.some((fresh) => fresh.id === item.id))]
    const selected = state.selected || items[0]?.id || ""
    setState({ items, selected, hasMore: page.hasMore })
    if (selected) await detail(selected, compare, token)
  }
  const run = async (work: () => Promise<void>) => {
    if (state.pending) return
    refreshToken++
    setState({ pending: true, error: false })
    await work()
      .catch(() => {
        if (current()) setState("error", true)
      })
      .finally(() => {
        if (current()) setState("pending", false)
      })
  }
  const select = (id: string) =>
    run(async () => {
      setState({ selected: id, detail: undefined, finding: "", file: "" })
      panel.setFilter("")
      await detail(id)
    })
  const start = () =>
    run(async () => {
      const target =
        state.target === "uncommitted" ? { type: state.target } : { type: state.target, ref: state.ref.trim() }
      const result = (
        await sdk.client.v2.codeReview.start(
          {
            sessionID: props.sessionID,
            codeReviewInput: { target, ...(state.focus.trim() ? { focus: state.focus.trim() } : {}) },
          },
          options,
        )
      ).data
      if (!current()) return
      setState({ selected: result.id, detail: undefined, finding: "", file: "" })
      await refresh()
    })
  const findings = createMemo(() =>
    (state.detail?.result?.findings ?? [])
      .filter((finding) => state.priority === "all" || finding.priority === state.priority)
      .toSorted((a, b) => a.priority.localeCompare(b.priority)),
  )
  const finding = createMemo(() => findings().find((finding) => finding.id === state.finding))
  const diffs = createMemo(() =>
    (state.detail?.captured?.files ?? []).map((file) => ({
      file: file.path,
      patch: file.patch,
      status: file.status === "renamed" ? ("modified" as const) : file.status,
      additions: file.patch.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
      deletions: file.patch.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
    })),
  )
  const focus = createMemo(() => {
    const item = finding()
    if (!item || item.anchor.type !== "line" || !item.anchor.inHunk) return null
    return {
      file: state.file,
      range: {
        start: item.anchor.startLine,
        end: item.anchor.endLine,
        side: item.anchor.side === "old" ? ("deletions" as const) : ("additions" as const),
      },
    }
  })
  onMount(async () => {
    await codeReviewAvailable(sdk.client, props.sessionID, lifetime.signal)
      .then(async (available) => {
        if (!current()) return
        setState("available", available)
        if (available) await refresh()
      })
      .catch(() => {
        if (current()) setState("error", true)
      })
    if (current()) setState("pending", false)
  })
  createEffect(() => {
    if (props.currentSessionID() !== props.sessionID) {
      lifetime.abort()
      dialog.close()
    }
  })
  const timer = setInterval(() => {
    if (
      !state.available ||
      state.pending ||
      state.refreshing ||
      !current() ||
      !state.items.some((item) => !terminal(item))
    )
      return
    const token = refreshToken
    setState("refreshing", true)
    void refresh(false, false, token)
      .catch(() => {
        if (current() && token === refreshToken) setState("error", true)
      })
      .finally(() => {
        if (current()) setState("refreshing", false)
      })
  }, 3000)
  onCleanup(() => {
    lifetime.abort()
    clearInterval(timer)
  })
  return (
    <Dialog title={language.t("codeReview.title")} size="x-large" fit>
      <div
        data-component="code-review"
        data-refreshing={state.refreshing}
        class="px-4 pb-4 space-y-3 max-h-[85vh] overflow-y-auto"
      >
        <Show when={!state.available && !state.pending}>
          <p>{language.t("codeReview.unsupported")}</p>
        </Show>
        <div class="flex flex-wrap items-end gap-2">
          <label class="flex flex-col gap-1 text-12-regular">
            {language.t("codeReview.target")}
            <select
              class={fieldClass}
              data-field="review-target"
              value={state.target}
              disabled={state.pending || !state.available}
              onChange={(event) => setState("target", event.currentTarget.value as CodeReviewInput["target"]["type"])}
            >
              <For each={["uncommitted", "base", "commit", "pr"] as const}>
                {(type) => <option value={type}>{language.t(`codeReview.target.${type}`)}</option>}
              </For>
            </select>
          </label>
          <Show when={state.target !== "uncommitted"}>
            <label class="flex flex-col gap-1 text-12-regular">
              {language.t("codeReview.ref")}
              <input
                class={fieldClass}
                data-field="review-ref"
                value={state.ref}
                onInput={(event) => setState("ref", event.currentTarget.value)}
              />
            </label>
          </Show>
          <label class="flex flex-col flex-1 gap-1 text-12-regular">
            {language.t("codeReview.focus")}
            <input
              data-field="review-focus"
              class={`w-full ${fieldClass}`}
              value={state.focus}
              onInput={(event) => setState("focus", event.currentTarget.value)}
            />
          </label>
          <Button
            data-action="review-start"
            variant="primary"
            disabled={state.pending || !state.available || (state.target !== "uncommitted" && !state.ref.trim())}
            onClick={() => void start()}
          >
            {language.t("codeReview.start")}
          </Button>
          <Button
            data-action="review-refresh"
            disabled={state.pending || !state.available}
            onClick={() => void run(() => refresh())}
          >
            {language.t("codeReview.refresh")}
          </Button>
        </div>
        <Show when={state.error}>
          <p role="alert">{language.t("codeReview.error")}</p>
        </Show>
        <Show when={state.available}>
          <label class="flex flex-col gap-1 text-12-regular">
            {language.t("codeReview.history")}
            <select
              class={fieldClass}
              data-field="review-history"
              disabled={state.pending}
              value={state.selected}
              onChange={(event) => void select(event.currentTarget.value)}
            >
              <option value="" disabled>
                {language.t("codeReview.empty")}
              </option>
              <For each={state.items}>
                {(item) => (
                  <option value={item.id}>
                    {new Date(item.createdAt).toLocaleString(language.intl())} ·{" "}
                    {language.t(`codeReview.target.${item.input.target.type}`)}{" "}
                    {item.input.target.type === "uncommitted" ? "" : item.input.target.ref} ·{" "}
                    {language.t(`codeReview.status.${item.status}`)}
                  </option>
                )}
              </For>
            </select>
          </label>
          <Show when={state.hasMore}>
            <Button disabled={state.pending} onClick={() => void run(() => refresh(true))}>
              {language.t("codeReview.more")}
            </Button>
          </Show>
        </Show>
        <Show when={state.detail}>
          {(entry) => (
            <section data-status={entry().status} class="space-y-3">
              <div class="flex gap-3 items-center">
                <span>{language.t(`codeReview.status.${entry().status}`)}</span>
                <span data-field="review-workspace">
                  {language.t(`codeReview.workspace.${entry().workspaceStatus ?? "unavailable"}`)}
                </span>
                <Show when={!terminal(entry())}>
                  <Button
                    data-action="review-cancel"
                    disabled={state.pending}
                    onClick={() =>
                      void run(async () => {
                        await sdk.client.v2.codeReview.cancel(
                          { sessionID: props.sessionID, reviewID: entry().id },
                          options,
                        )
                        await refresh()
                      })
                    }
                  >
                    {language.t("codeReview.cancel")}
                  </Button>
                </Show>
              </div>
              <details data-field="review-metadata">
                <summary>{language.t("codeReview.details")}</summary>
                <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-12-regular">
                  <dt>{language.t("codeReview.target")}</dt>
                  <dd>
                    {language.t(`codeReview.target.${entry().input.target.type}`)}{" "}
                    {(() => {
                      const target = entry().input.target
                      return target.type === "uncommitted" ? "" : target.ref
                    })()}
                  </dd>
                  <dt>{language.t("codeReview.capturedHead")}</dt>
                  <dd class="break-all">{entry().captured?.headSha ?? "—"}</dd>
                  <dt>{language.t("codeReview.focus")}</dt>
                  <dd class="whitespace-pre-wrap">{entry().input.focus || "—"}</dd>
                </dl>
              </details>
              <Show when={entry().error}>
                <p role="alert">{entry().error}</p>
              </Show>
              <Show when={entry().result}>
                {(result) => (
                  <>
                    <p data-field="review-summary" class="whitespace-pre-wrap">
                      {result().summary}
                    </p>
                    <p>{language.t(`codeReview.assessment.${result().assessment}`)}</p>
                    <details>
                      <summary>
                        {language.t("codeReview.coverage", {
                          count: result().coverage.exclusions.length,
                          invalid: result().coverage.invalidLocations,
                        })}
                      </summary>
                      <For each={result().coverage.exclusions}>
                        {(item) => (
                          <p>
                            {item.path}: {item.reason}
                          </p>
                        )}
                      </For>
                    </details>
                    <label class="flex flex-col gap-1 text-12-regular">
                      {language.t("codeReview.priority")}
                      <select
                        class={fieldClass}
                        data-field="review-priority"
                        value={state.priority}
                        onChange={(event) => setState({ priority: event.currentTarget.value, finding: "" })}
                      >
                        <option value="all">{language.t("codeReview.all")}</option>
                        <For each={["P0", "P1", "P2", "P3"]}>{(value) => <option>{value}</option>}</For>
                      </select>
                    </label>
                    <div class="flex gap-3">
                      <div class="w-64 max-h-96 overflow-y-auto shrink-0 space-y-2" data-field="review-findings">
                        <For each={findings()}>
                          {(item) => (
                            <button
                              class="block text-left w-full border rounded p-2"
                              data-finding={item.id}
                              aria-pressed={item.id === state.finding}
                              onClick={() => {
                                const file = entry().captured?.files.find(
                                  (file) => file.path === item.path || file.oldPath === item.path,
                                )
                                panel.setFilter("")
                                setState({ finding: item.id, file: file?.path ?? item.path })
                              }}
                            >
                              <strong>
                                [{item.priority}] {item.title}
                              </strong>
                              <p class="text-12-regular">
                                {item.path} ·{" "}
                                {item.anchor.type === "file"
                                  ? language.t("codeReview.fileAnchor")
                                  : `${item.anchor.side} ${item.anchor.startLine}–${item.anchor.endLine}`}
                              </p>
                            </button>
                          )}
                        </For>
                      </div>
                      <div class="flex-1 min-w-0 space-y-2">
                        <Show when={finding()}>
                          {(item) => (
                            <div data-field="review-finding-detail" class="whitespace-pre-wrap break-words">
                              <p>{item().explanation}</p>
                              <Show
                                when={(() => {
                                  const anchor = item().anchor
                                  return anchor.type === "line" && !anchor.inHunk
                                })()}
                              >
                                <p>{language.t("codeReview.snippet")}</p>
                                <pre>
                                  {(() => {
                                    const anchor = item().anchor
                                    return anchor.type === "line"
                                      ? anchor.snippet?.text
                                          .split("\n")
                                          .map((line, index) => `${anchor.snippet!.startLine + index} ${line}`)
                                          .join("\n")
                                      : ""
                                  })()}
                                </pre>
                              </Show>
                            </div>
                          )}
                        </Show>
                        <div class="h-[48vh] min-h-64 border rounded overflow-hidden" data-field="review-diff">
                          <ReviewPanelV2
                            diffs={diffs}
                            diffsReady={() => true}
                            activeFile={state.file}
                            onSelectFile={(file) => setState({ file, finding: "" })}
                            state={panel}
                            diffStyle="unified"
                            frozen
                            focusedLines={focus()}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </Show>
            </section>
          )}
        </Show>
      </div>
    </Dialog>
  )
}

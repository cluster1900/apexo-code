import { For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { ApexoClient, GoalReport, GoalReportContent, GoalReportFileKey } from "@apexo/sdk/v2/client"
import { Button } from "@apexo/ui/button"
import { useLanguage } from "@/context/language"

export default function GoalReports(props: {
  sessionID: string
  goalID: string
  canCleanup: boolean
  api: Promise<ApexoClient["goal"] | ApexoClient["v2"]["goal"]>
}) {
  const language = useLanguage()
  const lifetime = new AbortController()
  const preview = { element: undefined as HTMLDivElement | undefined, frame: 0 }
  const options = { throwOnError: true as const, signal: lifetime.signal }
  const target = () => ({ sessionID: props.sessionID, goalID: props.goalID })
  const [state, setState] = createStore({
    reports: [] as GoalReport[],
    content: undefined as GoalReportContent | undefined,
    pending: false,
    error: false,
    confirm: false,
  })
  const run = async (work: () => Promise<void>) => {
    if (state.pending) return
    setState({ pending: true, error: false })
    await work()
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  const refresh = async () => {
    const result = await (await props.api).reports(target(), options)
    if (!lifetime.signal.aborted) setState({ reports: result.data, content: undefined })
  }
  const read = (reportID: string, file: GoalReportFileKey, download: boolean) =>
    run(async () => {
      const result = await (await props.api).report({ ...target(), reportID, file }, options)
      if (lifetime.signal.aborted) return
      if (!download) {
        setState("content", result.data)
        cancelAnimationFrame(preview.frame)
        preview.frame = requestAnimationFrame(() => {
          if (!lifetime.signal.aborted) preview.element?.scrollIntoView({ block: "nearest", behavior: "instant" })
        })
        return
      }
      const url = URL.createObjectURL(new Blob([result.data.text], { type: result.data.contentType }))
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${reportID}-${result.data.name}`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    })
  const cleanup = () =>
    run(async () => {
      const result = await (await props.api).cleanupReports(target(), options)
      if (lifetime.signal.aborted) return
      setState("confirm", false)
      await refresh()
      if (result.data.failed.length) setState("error", true)
    })
  onMount(() => void run(refresh))
  onCleanup(() => {
    lifetime.abort()
    cancelAnimationFrame(preview.frame)
  })
  return (
    <section data-component="goal-reports" class="flex flex-col gap-3">
      <div class="flex flex-wrap gap-2">
        <Button
          data-action="goal-reports-refresh"
          size="small"
          disabled={state.pending}
          onClick={() => void run(refresh)}
        >
          {language.t("goal.reportsRefresh")}
        </Button>
        <Button
          data-action="goal-reports-delete"
          size="small"
          variant="ghost"
          disabled={state.pending || !props.canCleanup || !state.reports.length}
          onClick={() => setState("confirm", true)}
        >
          {language.t("goal.reportsDelete")}
        </Button>
      </div>
      <Show when={!props.canCleanup}>
        <p class="text-text-weak">{language.t("goal.reportsProtected")}</p>
      </Show>
      <Show when={state.error}>
        <p role="alert">{language.t("goal.reportsError")}</p>
      </Show>
      <Show when={state.confirm}>
        <p>{language.t("goal.reportsDeleteConfirm")}</p>
        <div class="flex gap-2">
          <Button data-action="goal-reports-delete-confirm" disabled={state.pending} onClick={() => void cleanup()}>
            {language.t("goal.reportsDelete")}
          </Button>
          <Button variant="ghost" disabled={state.pending} onClick={() => setState("confirm", false)}>
            {language.t("common.cancel")}
          </Button>
        </div>
      </Show>
      <Show when={!state.pending && !state.reports.length}>
        <p>{language.t("goal.reportsEmpty")}</p>
      </Show>
      <For each={state.reports}>
        {(report) => (
          <details data-report-id={report.id}>
            <summary class="break-all">{report.id}</summary>
            <Show when={!report.complete}>
              <p>{language.t("goal.reportIncomplete")}</p>
            </Show>
            <div class="flex flex-col gap-2 py-2">
              <For each={report.files}>
                {(file) => (
                  <div class="flex flex-wrap gap-2">
                    <Button
                      size="small"
                      variant="ghost"
                      data-report-file={file.key}
                      disabled={state.pending}
                      onClick={() => void read(report.id, file.key, false)}
                    >
                      {language.t("goal.reportView", { name: file.name })}
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      data-report-download={file.key}
                      disabled={state.pending}
                      onClick={() => void read(report.id, file.key, true)}
                    >
                      {language.t("goal.reportDownload", { name: file.name })}
                    </Button>
                  </div>
                )}
              </For>
            </div>
          </details>
        )}
      </For>
      <Show when={state.content}>
        {(content) => (
          <div
            ref={(element) => (preview.element = element)}
            data-component="goal-report-preview"
            class="flex flex-col gap-2"
          >
            <h4>{content().name}</h4>
            <pre class="whitespace-pre-wrap break-words max-h-80 overflow-auto text-12">{content().text}</pre>
          </div>
        )}
      </Show>
    </section>
  )
}

import { onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { MemoryWork } from "@apexo/schema/memory-work"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useDialog } from "@apexo/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

export function MemoryWorkDialog(props: { sessionID: string; kind?: MemoryWork.Kind }) {
  const language = useLanguage()
  const sdk = useSDK()
  const dialog = useDialog()
  const abort = new AbortController()
  const [state, setState] = createStore({ info: null as MemoryWork.Info | null, pending: true, error: false })
  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = async () => {
    await sdk()
      .client.experimental.memory.operation(
        { sessionID: props.sessionID },
        { signal: abort.signal, throwOnError: true },
      )
      .then((result) => {
        if (!abort.signal.aborted && !state.pending) setState({ info: result.data, error: false })
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!abort.signal.aborted) timer = setTimeout(refresh, state.info?.state === "running" ? 400 : 2000)
      })
  }
  const start = async (kind: MemoryWork.Kind) => {
    setState({ pending: true, error: false })
    await sdk()
      .client.experimental.memory.start(
        { sessionID: props.sessionID, memoryWorkStart: { kind } },
        { signal: abort.signal, throwOnError: true },
      )
      .then((result) => {
        if (!abort.signal.aborted) setState("info", result.data)
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!abort.signal.aborted) setState("pending", false)
      })
  }
  const cancel = async () => {
    const info = state.info
    if (!info || info.state !== "running") return
    setState({ pending: true, error: false })
    await sdk()
      .client.experimental.memory.cancel(
        { sessionID: props.sessionID, memoryWorkCancel: { id: info.id } },
        { signal: abort.signal, throwOnError: true },
      )
      .then((result) => {
        if (!abort.signal.aborted) setState("info", result.data)
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!abort.signal.aborted) setState("pending", false)
      })
  }
  onMount(() => {
    setState("pending", false)
    if (props.kind) void start(props.kind)
    void refresh()
  })
  onCleanup(() => {
    abort.abort()
    clearTimeout(timer)
  })
  const status = {
    completed: "memory.work.completed",
    shadow: "memory.work.shadow",
    no_work: "memory.work.noWork",
    disabled: "memory.work.disabled",
    busy: "memory.work.busy",
    denied: "memory.work.denied",
    conflict: "memory.work.conflict",
    cancelled: "memory.work.cancelled",
    failed: "memory.work.failed",
    retry_required: "memory.operations.retryRequired",
    timed_out: "memory.work.timedOut",
    too_soon: "memory.work.noWork",
    too_few_sessions: "memory.work.noWork",
  } as const
  return (
    <Dialog title={language.t("memory.work.title")} size="large">
      <div data-component="memory-work" class="flex flex-col gap-4 px-6 pb-6">
        <p>{language.t("memory.work.description")}</p>
        <Show
          when={state.info}
          fallback={<p role="status">{language.t(state.pending ? "common.loading" : "memory.work.empty")}</p>}
        >
          {(info) => (
            <>
              <h3>{language.t(info().kind === "flush" ? "memory.work.flush" : "memory.work.dream")}</h3>
              <p
                role="status"
                data-state={info().state}
                data-component={
                  info().state !== "running" &&
                  info().result?.status === "retry_required" &&
                  (info().result?.deferred ?? 0) > 0
                    ? "memory-batch-outcome"
                    : undefined
                }
              >
                {info().state !== "running" &&
                info().result?.status === "retry_required" &&
                (info().result?.deferred ?? 0) > 0
                  ? language.t("memory.operations.batchOutcome", {
                      deferred: info().result?.deferred ?? 0,
                      unplaceable: info().result?.unplaceable ?? 0,
                    })
                  : language.t(
                      info().state === "running"
                        ? info().kind === "flush"
                          ? "memory.work.flushing"
                          : "memory.work.dreaming"
                        : info().result?.status === "conflict" &&
                            info().result?.reason === "historical_capture_ownership"
                          ? "memory.work.historicalCaptureOwnership"
                          : status[info().result?.status ?? "failed"],
                    )}
              </p>
              <Show when={info().result?.path}>
                <code class="break-all">{info().result?.path}</code>
              </Show>
              <Show when={info().result?.processed !== undefined}>
                <p>{language.t("memory.work.processed", { count: info().result!.processed! })}</p>
              </Show>
              <Show
                when={
                  (info().state === "running" ||
                    info().result?.status !== "retry_required" ||
                    (info().result?.deferred ?? 0) === 0) &&
                  (info().result?.deferred !== undefined || info().result?.unplaceable !== undefined)
                }
              >
                <p data-component="memory-batch-outcome">
                  {language.t("memory.operations.batchOutcome", {
                    deferred: info().result?.deferred ?? 0,
                    unplaceable: info().result?.unplaceable ?? 0,
                  })}
                </p>
              </Show>
              <Show when={(info().result?.deferred ?? 0) > 0}>
                <Button
                  data-action="memory-work-dream-deferred"
                  disabled={state.pending || info().state === "running"}
                  onClick={() => void start("dream")}
                >
                  {language.t("memory.operations.dream")}
                </Button>
              </Show>
              <Show when={info().result?.chars !== undefined}>
                <p>{language.t("memory.work.chars", { count: info().result!.chars! })}</p>
              </Show>
              <Show when={info().result?.topics !== undefined}>
                <p>{language.t("memory.work.topics", { count: info().result!.topics! })}</p>
              </Show>
            </>
          )}
        </Show>
        <Show when={state.error}>
          <p role="alert">{language.t("memory.work.error")}</p>
        </Show>
        <div class="flex flex-wrap gap-2">
          <Button disabled={state.pending || state.info?.state === "running"} onClick={() => void start("flush")}>
            {language.t("memory.work.flush")}
          </Button>
          <Button disabled={state.pending || state.info?.state === "running"} onClick={() => void start("dream")}>
            {language.t("memory.work.dream")}
          </Button>
          <Show when={state.info?.state === "running"}>
            <Button variant="secondary" disabled={state.pending} onClick={() => void cancel()}>
              {language.t("common.cancel")}
            </Button>
          </Show>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

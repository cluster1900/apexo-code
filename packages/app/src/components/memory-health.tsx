import { For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { MemoryHealth } from "@apexo/schema/memory-health"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

export function MemoryHealthDialog(props: { sessionID: string }) {
  const language = useLanguage()
  const sdk = useSDK()
  const abort = new AbortController()
  const [state, setState] = createStore({ info: null as MemoryHealth.Info | null, pending: false, error: false })
  const refresh = async () => {
    if (state.pending) return
    setState({ pending: true, error: false })
    await sdk()
      .client.experimental.memory.health({ sessionID: props.sessionID }, { signal: abort.signal, throwOnError: true })
      .then((result) => {
        if (!abort.signal.aborted) setState("info", result.data)
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ error: true, info: null })
      })
      .finally(() => {
        if (!abort.signal.aborted) setState("pending", false)
      })
  }
  onMount(() => void refresh())
  onCleanup(() => abort.abort())
  const rows = [
    "pendingCaptureJobs",
    "runningCaptureJobs",
    "publishingCaptureJobs",
    "retryCaptureJobs",
    "failedCaptureJobs",
    "completedCaptureJobs",
    "pendingObservations",
    "hiddenPendingObservations",
    "quarantinedObservations",
    "oldestPendingAgeSecs",
    "dreamLease",
    "dreamSnapshotSize",
    "dreamPlanPending",
    "hasCoalescedTrigger",
    "lastSuccessAt",
    "lastFailureAt",
    "archiveCount",
    "tombstoneCount",
    "pendingDeletions",
  ] as const
  const value = (snapshot: MemoryHealth.Snapshot, key: (typeof rows)[number]) => {
    const entry = snapshot[key]
    if (entry === null) return language.t("memory.health.unknown")
    if (typeof entry === "boolean") return language.t(entry ? "memory.health.yes" : "memory.health.no")
    if (key === "dreamLease") return language.t(`memory.health.${snapshot.dreamLease}`)
    if (key === "lastSuccessAt" || key === "lastFailureAt") return new Date(Number(entry)).toLocaleString()
    return String(entry)
  }
  return (
    <Dialog title={language.t("memory.health.title")} size="large">
      <div data-component="memory-health" class="flex flex-col gap-4 px-6 pb-6 max-h-[75vh] overflow-y-auto">
        <p>{language.t("memory.health.description")}</p>
        <Show when={state.pending}>
          <p role="status">{language.t("common.loading")}</p>
        </Show>
        <Show when={state.error}>
          <p role="alert">{language.t("memory.health.error")}</p>
        </Show>
        <Show when={state.info}>
          {(info) => (
            <>
              <Show when={!info().enabled}>
                <p>{language.t("memory.work.disabled")}</p>
              </Show>
              <Show when={info().backend !== "v2"}>
                <p>{language.t("memory.health.legacy")}</p>
              </Show>
              <For each={info().scopes}>
                {(scope) => (
                  <section class="flex flex-col gap-2" data-scope={scope.scope}>
                    <h3 class="font-medium">
                      {language.t(scope.scope === "global" ? "memory.global" : "memory.workspace")}
                    </h3>
                    <p role="status" data-state={scope.state}>
                      {language.t(`memory.health.${scope.state}`)}
                    </p>
                    <Show when={scope.reason}>
                      <p>{language.t(`memory.health.reason.${scope.reason!}`)}</p>
                    </Show>
                    <Show when={scope.snapshot}>
                      {(snapshot) => (
                        <dl class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
                          <For each={rows}>
                            {(key) => (
                              <>
                                <dt>{language.t(`memory.health.${key}`)}</dt>
                                <dd class="text-right tabular-nums">{value(snapshot(), key)}</dd>
                              </>
                            )}
                          </For>
                        </dl>
                      )}
                    </Show>
                  </section>
                )}
              </For>
            </>
          )}
        </Show>
        <Button variant="secondary" disabled={state.pending} onClick={() => void refresh()}>
          {language.t("memory.health.refresh")}
        </Button>
      </div>
    </Dialog>
  )
}

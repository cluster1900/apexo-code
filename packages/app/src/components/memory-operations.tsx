import { createEffect, createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type {
  MemoryOperationInfo,
  MemoryOperationMigrationPreview,
  MemoryOperationRecoveryPreview,
} from "@apexo/sdk/v2"
import { MemoryOperation } from "@apexo/schema/memory-operation"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useDialog } from "@apexo/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { MemoryActionError } from "@/utils/session-memory"
import { memoryOperationActions, type MemoryOperationCommand } from "@/utils/memory-operations"

type Preview =
  | { kind: "migration"; value: MemoryOperationMigrationPreview }
  | { kind: "recovery"; value: MemoryOperationRecoveryPreview }
const choices = ["flush", "dream", "relocation", "carryover", "discard", "clear"] as const
const resultKeys = {
  completed: "memory.operations.result.completed",
  no_work: "memory.operations.result.noWork",
  disabled: "memory.operations.result.disabled",
  denied: "memory.operations.result.denied",
  retry_required: "memory.operations.retryRequired",
  failed: "memory.operations.result.failed",
  cancelled: "memory.operations.result.cancelled",
  timed_out: "memory.operations.result.timedOut",
  conflict: "memory.operations.result.conflict",
} as const

export function MemoryOperationsDialog(props: { sessionID: string; kind?: "flush" | "dream"; active?: () => boolean }) {
  const language = useLanguage()
  const resultText = (result: NonNullable<MemoryOperationInfo["result"]>) =>
    result.status === "retry_required" && (result.deferred ?? 0) > 0
      ? language.t("memory.operations.batchOutcome", {
          deferred: result.deferred ?? 0,
          unplaceable: result.unplaceable ?? 0,
        })
      : language.t(resultKeys[result.status])
  const dialog = useDialog()
  const sdk = useSDK()
  const scope = sdk()
  const sessionID = props.sessionID
  const owner = new AbortController()
  const actions = memoryOperationActions(scope.client, async () => sessionID, owner.signal)
  const [state, setState] = createStore({
    active: true,
    items: [] as MemoryOperationInfo[],
    selected: undefined as string | undefined,
    choice: (props.kind ?? "flush") as (typeof choices)[number],
    scope: "workspace" as "workspace" | "global",
    preview: undefined as Preview | undefined,
    confirmClear: false,
    pending: false,
    error: undefined as MemoryActionError["code"] | "refresh" | "unknown" | undefined,
    uncertain: undefined as MemoryOperationCommand | undefined,
  })
  const selected = createMemo(() => state.items.find((row) => row.id === state.selected))
  const observation = { version: 0, reading: false, timer: undefined as ReturnType<typeof setTimeout> | undefined }
  const idle = () => state.active && !state.pending && !state.uncertain
  createEffect(() => {
    if (sdk() === scope && (!props.active || props.active())) return
    owner.abort()
    setState("active", false)
    dialog.close()
  })
  const refresh = async () => {
    if (observation.reading || owner.signal.aborted) return
    observation.reading = true
    const version = observation.version
    await actions
      .list(owner.signal)
      .then((items) => {
        if (owner.signal.aborted || state.pending || version !== observation.version) return
        setState("items", items)
        setState("selected", (id) => (items.some((row) => row.id === id) ? id : items[0]?.id))
      })
      .catch((error) => {
        if (!owner.signal.aborted && version === observation.version)
          setState("error", error instanceof MemoryActionError ? error.code : "refresh")
      })
      .finally(() => {
        observation.reading = false
      })
  }
  const poll = async () => {
    await refresh()
    if (!owner.signal.aborted)
      observation.timer = setTimeout(poll, state.items.some((row) => row.state !== "finished") ? 750 : 2000)
  }
  const execute = async (command: MemoryOperationCommand) => {
    if (!state.active || state.pending) return
    observation.version++
    setState({ pending: true, error: undefined, uncertain: command, confirmClear: false })
    await actions
      .execute(command, owner.signal)
      .then((row) => {
        if (owner.signal.aborted) return
        setState({
          items: [row, ...state.items.filter((item) => item.id !== row.id)],
          selected: row.id,
          preview: undefined,
          uncertain: undefined,
        })
      })
      .catch((error) => {
        if (owner.signal.aborted) return
        setState("error", error instanceof MemoryActionError ? error.code : "unknown")
        if (error instanceof MemoryActionError && error.code !== "failed" && error.code !== "unavailable")
          setState({ uncertain: undefined, preview: undefined })
      })
      .finally(() => {
        if (!owner.signal.aborted) setState("pending", false)
      })
  }
  const prepare = async () => {
    if (!idle()) return
    const kind = state.choice
    if (kind === "flush" || kind === "dream") {
      await execute({ kind, id: MemoryOperation.ID.create() })
      return
    }
    observation.version++
    setState({ pending: true, error: undefined, preview: undefined, confirmClear: false })
    await (
      kind === "relocation" || kind === "carryover"
        ? actions
            .migrationPreview(kind, state.scope, owner.signal)
            .then((value): Preview => ({ kind: "migration", value }))
        : actions
            .recoveryPreview(kind, state.scope, owner.signal)
            .then((value): Preview => ({ kind: "recovery", value }))
    )
      .then((value) => {
        if (!owner.signal.aborted) setState("preview", value)
      })
      .catch((error) => {
        if (!owner.signal.aborted) setState("error", error instanceof MemoryActionError ? error.code : "failed")
      })
      .finally(() => {
        if (!owner.signal.aborted) setState("pending", false)
      })
  }
  const apply = () => {
    const preview = state.preview
    if (
      !idle() ||
      !preview?.value.available ||
      (preview.kind === "recovery" && preview.value.action === "clear" && !state.confirmClear)
    )
      return
    void execute(
      preview.kind === "migration"
        ? { kind: "migration", id: MemoryOperation.ID.create(), preview: preview.value }
        : { kind: "recovery", id: MemoryOperation.ID.create(), preview: preview.value },
    )
  }
  onMount(() => void poll())
  onCleanup(() => {
    owner.abort()
    clearTimeout(observation.timer)
  })
  return (
    <Dialog
      size="large"
      title={language.t("memory.operations.title")}
      description={language.t("memory.operations.description")}
    >
      <div data-component="memory-operations" class="flex flex-col gap-3 min-h-0 px-5 pb-5">
        <Show when={state.error}>
          {(error) => (
            <p role="alert" data-component="memory-operation-error">
              {language.t(
                error() === "refresh"
                  ? "memory.operations.refreshError"
                  : error() === "unknown"
                    ? "memory.operations.unknown"
                    : error() === "forbidden"
                      ? "memory.operations.forbidden"
                      : error() === "failed"
                        ? "memory.error"
                        : `memory.native.${error()}`,
              )}
            </p>
          )}
        </Show>
        <Show when={state.uncertain && !state.pending}>
          <p>{language.t("memory.operations.unknown")}</p>
          <Button
            data-action="memory-operation-repeat"
            disabled={!state.active}
            onClick={() => state.uncertain && void execute(state.uncertain)}
          >
            {language.t("memory.operations.repeat")}
          </Button>
        </Show>
        <div class="flex gap-2 flex-wrap items-end">
          <label class="flex flex-col gap-1">
            {language.t("memory.operations.action")}
            <select
              data-action="memory-operation-choice"
              value={state.choice}
              disabled={!idle()}
              class="border border-border-base rounded px-2 py-1"
              onChange={(event) => {
                const choice = choices.find((value) => value === event.currentTarget.value)
                if (choice) setState({ choice, preview: undefined, confirmClear: false })
              }}
            >
              <For each={choices}>
                {(choice) => <option value={choice}>{language.t(`memory.operations.${choice}`)}</option>}
              </For>
            </select>
          </label>
          <Show when={state.choice !== "flush" && state.choice !== "dream"}>
            <label class="flex flex-col gap-1">
              {language.t("memory.operations.scope")}
              <select
                data-action="memory-operation-scope"
                value={state.scope}
                disabled={!idle()}
                class="border border-border-base rounded px-2 py-1"
                onChange={(event) =>
                  setState({
                    scope: event.currentTarget.value === "global" ? "global" : "workspace",
                    preview: undefined,
                    confirmClear: false,
                  })
                }
              >
                <option value="workspace">{language.t("memory.workspace")}</option>
                <option value="global">{language.t("memory.global")}</option>
              </select>
            </label>
          </Show>
          <Button data-action="memory-operation-prepare" disabled={!idle()} onClick={() => void prepare()}>
            {language.t(
              state.choice === "flush"
                ? "memory.operations.flush"
                : state.choice === "dream"
                  ? "memory.operations.dream"
                  : "memory.operations.preview",
            )}
          </Button>
          <Button
            variant="secondary"
            data-action="memory-operation-refresh"
            disabled={state.pending || !state.active}
            onClick={() => {
              observation.version++
              setState("error", undefined)
              void refresh()
            }}
          >
            {language.t("memory.refresh")}
          </Button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 h-[52vh] min-h-0">
          <div class="overflow-auto border border-border-base rounded p-2" data-component="memory-operation-list">
            <Show when={!state.items.length}>
              <p>{language.t("memory.operations.empty")}</p>
            </Show>
            <For each={state.items}>
              {(row) => (
                <button
                  type="button"
                  class="block text-left w-full rounded px-2 py-2 break-words hover:bg-surface-base-hover"
                  data-operation-id={row.id}
                  aria-pressed={state.selected === row.id}
                  disabled={!idle()}
                  onClick={() => setState({ selected: row.id, preview: undefined, confirmClear: false })}
                >
                  <strong>{language.t(`memory.operations.${row.kind}`)}</strong>
                  <div>
                    {language.t(`memory.operations.${row.state}`)} · {language.t(`memory.operations.${row.ownership}`)}
                  </div>
                  <Show when={row.result}>{(result) => <p>{resultText(result())}</p>}</Show>
                </button>
              )}
            </For>
          </div>
          <div
            class="overflow-auto border border-border-base rounded p-3 flex flex-col gap-2 break-words"
            tabIndex={0}
            data-component="memory-operation-detail"
          >
            <Show
              keyed
              when={state.preview}
              fallback={
                <Show when={selected()}>
                  {(row) => (
                    <>
                      <code class="break-all">{row().id}</code>
                      <Show when={row().ownership === "unverified"}>
                        <p>{language.t("memory.operations.unverifiedDescription")}</p>
                      </Show>
                      <Show when={row().result}>
                        {(result) => (
                          <>
                            <p
                              role="status"
                              data-component={
                                result().status === "retry_required" && (result().deferred ?? 0) > 0
                                  ? "memory-batch-outcome"
                                  : undefined
                              }
                            >
                              {resultText(result())}
                            </p>
                            <p>
                              {language.t("memory.operations.processed", {
                                processed: result().processed ?? 0,
                                topics: result().topics ?? 0,
                              })}
                            </p>
                            <Show
                              when={
                                (result().status !== "retry_required" || (result().deferred ?? 0) === 0) &&
                                (result().deferred !== undefined || result().unplaceable !== undefined)
                              }
                            >
                              <p data-component="memory-batch-outcome">
                                {language.t("memory.operations.batchOutcome", {
                                  deferred: result().deferred ?? 0,
                                  unplaceable: result().unplaceable ?? 0,
                                })}
                              </p>
                            </Show>
                            <Show when={(result().deferred ?? 0) > 0}>
                              <Button
                                data-action="memory-operation-dream-deferred"
                                disabled={!idle()}
                                onClick={() => {
                                  setState({ choice: "dream", preview: undefined, confirmClear: false })
                                  void prepare()
                                }}
                              >
                                {language.t("memory.operations.dream")}
                              </Button>
                            </Show>
                            <Show when={result().shadow}>
                              <p>{language.t("memory.operations.shadow")}</p>
                            </Show>
                            <Show when={result().committed}>
                              <p data-component="memory-operation-committed">
                                {language.t("memory.operations.committed")}
                              </p>
                            </Show>
                            <Show when={result().reason}>
                              <p>
                                {language.t(
                                  result().reason === "historical_capture_ownership"
                                    ? "memory.work.historicalCaptureOwnership"
                                    : "memory.operations.sourceChanged",
                                )}
                              </p>
                            </Show>
                          </>
                        )}
                      </Show>
                      <Button
                        data-action="memory-operation-retry"
                        disabled={!idle() || row().ownership === "local"}
                        onClick={() =>
                          void execute({ kind: "retry", id: MemoryOperation.ID.create(), retryOf: row().id })
                        }
                      >
                        {language.t("memory.operations.retry")}
                      </Button>
                      <Button
                        variant="secondary"
                        data-action="memory-operation-cancel"
                        disabled={!idle() || row().ownership !== "local" || row().state === "finished"}
                        onClick={() => void execute({ kind: "cancel", operationID: row().id })}
                      >
                        {language.t("memory.operations.cancel")}
                      </Button>
                    </>
                  )}
                </Show>
              }
            >
              {(preview) => (
                <>
                  <h3>{language.t("memory.operations.previewTitle")}</h3>
                  <p>{language.t(preview.value.scope === "global" ? "memory.global" : "memory.workspace")}</p>
                  <p>{language.t("memory.operations.generation", { generation: preview.value.generation })}</p>
                  <Show when={preview.kind === "migration"}>
                    {preview.kind === "migration" && (
                      <p>
                        {language.t(
                          preview.value.kind === "relocation"
                            ? "memory.operations.relocationDescription"
                            : "memory.operations.carryoverDescription",
                        )}
                      </p>
                    )}
                  </Show>
                  <Show when={preview.kind === "recovery"}>
                    {preview.kind === "recovery" && (
                      <>
                        <p>
                          {language.t(
                            preview.value.action === "clear"
                              ? "memory.operations.clearDescription"
                              : "memory.operations.discardDescription",
                          )}
                        </p>
                        <p>
                          {language.t("memory.operations.counts", {
                            files: preview.value.files,
                            plans: preview.value.plans,
                          })}
                        </p>
                        <Show when={preview.value.reason}>
                          {(reason) => <p>{language.t(`memory.operations.${reason()}`)}</p>}
                        </Show>
                        <Show when={preview.value.action === "clear" && preview.value.available}>
                          <label class="flex gap-2 items-start">
                            <input
                              data-action="memory-operation-clear-confirm"
                              type="checkbox"
                              checked={state.confirmClear}
                              disabled={!idle()}
                              onChange={(event) => setState("confirmClear", event.currentTarget.checked)}
                            />
                            {language.t("memory.operations.confirmClear")}
                          </label>
                        </Show>
                      </>
                    )}
                  </Show>
                  <Show when={!preview.value.available}>
                    <p role="status">{language.t("memory.operations.previewUnavailable")}</p>
                  </Show>
                  <Button
                    data-action="memory-operation-apply"
                    disabled={
                      !idle() ||
                      !preview.value.available ||
                      (preview.kind === "recovery" && preview.value.action === "clear" && !state.confirmClear)
                    }
                    onClick={apply}
                  >
                    {language.t("memory.operations.apply")}
                  </Button>
                </>
              )}
            </Show>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

import { createEffect, For, onCleanup, Show, untrack } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import {
  taskActions,
  taskKey,
  TaskCancelError,
  ProcessActionError,
  ScheduleActionError,
  type TaskItem,
  type TaskOutput,
  type TaskTarget,
} from "@/utils/session-tasks"
import { TaskMessage } from "./task-message"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useDialog } from "@apexo/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useCommand } from "@/context/command"
import { restoreSession, restorationMessage, SessionRestorationError } from "@/utils/session-restore"

export function createSessionTasks(sessionID: () => string | undefined) {
  const sdk = useSDK()
  const language = useLanguage()
  const [state, setState] = createStore({
    items: [] as TaskItem[],
    selected: undefined as string | undefined,
    detail: undefined as TaskOutput | undefined,
    pending: undefined as string | undefined,
    error: "",
    actionError: "",
    restorationNotice: "",
    loaded: false,
    native: false,
    issues: [] as ("tasks" | "processes" | "schedules")[],
    waitResult: undefined as "waiting" | "timedOut" | "settled" | undefined,
  })
  let refresh = async () => {}
  let cancel = async (_target: TaskTarget) => {}
  let wait = async (_target: TaskTarget) => {}
  let changeSchedule = async (_target: TaskTarget, _action: "pause" | "resume" | "delete") => {}
  let restore = async () => {}
  let stopWaiting = () => {}
  createEffect(() => {
    const id = sessionID()
    const scope = sdk()
    setState({
      items: [],
      selected: undefined,
      detail: undefined,
      pending: undefined,
      error: "",
      actionError: "",
      restorationNotice: "",
      loaded: false,
      native: false,
      issues: [],
      waitResult: undefined,
    })
    if (!id) return
    const abort = new AbortController()
    const actions = taskActions(scope.client, id, scope.protocol)
    let timer: ReturnType<typeof setTimeout> | undefined
    let revision = 0
    const errorText = (error: unknown) =>
      error instanceof SessionRestorationError
        ? language.t("session.restore.failed")
        : error instanceof ScheduleActionError
          ? language.t(`tasks.scheduleError.${error.code}`)
          : error instanceof ProcessActionError
            ? language.t(`tasks.processError.${error.code}`)
            : error instanceof TaskCancelError
              ? language.t(`tasks.cancelError.${error.code}`)
              : error instanceof Error
                ? error.message
                : String(error)
    refresh = async () => {
      const current = ++revision
      clearTimeout(timer)
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)])
      await actions
        .list(signal)
        .then(async (list) => {
          if (abort.signal.aborted || current !== revision) return
          setState("items", reconcile(list.items, { key: "key" }))
          setState({ native: list.native, issues: list.issues, error: "", loaded: true })
          const selected = state.selected
          const target =
            list.items.find((item) => item.key === selected) ??
            (state.detail?.source === "native-schedule" && state.detail.key === selected ? state.detail : undefined)
          if (!target) {
            setState({ selected: undefined, detail: undefined })
            return
          }
          const detail = await actions.get(target, signal)
          if (!abort.signal.aborted && current === revision && state.selected === selected) {
            setState("detail", reconcile(detail))
            if (detail.status !== "running" && state.waitResult === "timedOut") setState("waitResult", "settled")
          }
        })
        .catch((error: unknown) => {
          if (abort.signal.aborted || current !== revision) return
          setState("error", errorText(error))
        })
        .finally(() => {
          if (!abort.signal.aborted && current === revision) timer = setTimeout(refresh, 2_000)
        })
    }
    cancel = async (target) => {
      if (abort.signal.aborted || state.pending) return
      setState({ pending: taskKey(target), actionError: "" })
      await actions
        .cancel(target, abort.signal)
        .then(() => {
          if (!abort.signal.aborted) return refresh()
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted) setState("actionError", errorText(error))
        })
        .finally(() => {
          if (!abort.signal.aborted) setState("pending", undefined)
        })
    }
    wait = async (target) => {
      if (abort.signal.aborted || state.pending) return
      const waiting = new AbortController()
      stopWaiting = () => waiting.abort()
      const signal = AbortSignal.any([abort.signal, waiting.signal, AbortSignal.timeout(15_000)])
      setState({ pending: taskKey(target), actionError: "", waitResult: "waiting" })
      await actions
        .wait(target, signal)
        .then(async (result) => {
          if (signal.aborted) return
          if (state.selected === taskKey(target)) {
            setState("detail", reconcile(result.detail))
            setState("waitResult", result.timedOut ? "timedOut" : "settled")
          }
          await refresh()
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted && !waiting.signal.aborted)
            setState({ actionError: errorText(error), waitResult: undefined })
        })
        .finally(() => {
          if (!abort.signal.aborted) setState("pending", undefined)
        })
    }
    changeSchedule = async (target, action) => {
      if (abort.signal.aborted || state.pending) return
      setState({ pending: taskKey(target), actionError: "" })
      await actions
        .changeSchedule(target, action, abort.signal)
        .then(async (detail) => {
          if (abort.signal.aborted) return
          setState("detail", reconcile(detail))
          await refresh()
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted) setState("actionError", errorText(error))
        })
        .finally(() => {
          if (!abort.signal.aborted) setState("pending", undefined)
        })
    }
    restore = async () => {
      if (abort.signal.aborted || state.pending) return
      setState({ pending: "session-restore", actionError: "", restorationNotice: "" })
      await restoreSession({ client: scope.client, protocol: scope.protocol, sessionID: id }, abort.signal)
        .then(async (result) => {
          if (abort.signal.aborted) return
          const key = restorationMessage(result)
          if (result) setState("restorationNotice", language.t(key ?? "session.restore.done"))
          await refresh()
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted) setState("actionError", errorText(error))
        })
        .finally(() => {
          if (!abort.signal.aborted) setState("pending", undefined)
        })
    }
    void untrack(refresh)
    onCleanup(() => {
      abort.abort()
      clearTimeout(timer)
      refresh = async () => {}
      cancel = async () => {}
      wait = async () => {}
      changeSchedule = async () => {}
      restore = async () => {}
      stopWaiting()
    })
  })
  return {
    state,
    available: () => !!sessionID(),
    running: () => state.items.filter((task) => task.status === "running").length,
    select(target?: TaskTarget) {
      stopWaiting()
      setState({ selected: target ? taskKey(target) : undefined, detail: undefined, waitResult: undefined })
      void refresh()
    },
    cancel: (target: TaskTarget) => cancel(target),
    wait: (target: TaskTarget) => wait(target),
    refresh: () => refresh(),
    restore: () => restore(),
    changeSchedule: (target: TaskTarget, action: "pause" | "resume" | "delete") => changeSchedule(target, action),
  }
}

export function BackgroundTasksButton(props: { tasks: ReturnType<typeof createSessionTasks> }) {
  const dialog = useDialog()
  const language = useLanguage()
  const open = () => dialog.show(() => <BackgroundTasksDialog tasks={props.tasks} />)
  useCommand().register("session-tasks", () => [
    {
      id: "session.tasks",
      title: language.t("tasks.title"),
      description: language.t("tasks.description"),
      slash: "tasks",
      disabled: !props.tasks.available(),
      onSelect: open,
    },
  ])
  return (
    <Show when={props.tasks.available()}>
      <Button data-action="session-tasks" variant="ghost" size="small" onClick={open}>
        <Show
          when={props.tasks.state.native}
          fallback={
            <>
              {language.t("tasks.title")} ·{" "}
              {props.tasks.state.error ? "?" : props.tasks.state.loaded ? props.tasks.running() : "…"}
            </>
          }
        >
          {language.t("tasks.nativeButton", {
            count:
              props.tasks.state.error || props.tasks.state.issues.some((issue) => issue !== "schedules")
                ? "?"
                : props.tasks.running(),
          })}
        </Show>
      </Button>
    </Show>
  )
}

function BackgroundTasksDialog(props: { tasks: ReturnType<typeof createSessionTasks> }) {
  const sdk = useSDK()
  const language = useLanguage()
  const status = {
    running: "tasks.running",
    completed: "tasks.completed",
    cancelled: "tasks.cancelled",
    error: "tasks.failed",
    failed: "tasks.failed",
    interrupted: "tasks.interrupted",
    active: "tasks.scheduleActive",
    paused: "tasks.schedulePaused",
    expired: "tasks.scheduleExpired",
    deleted: "tasks.scheduleDeleted",
  } as const
  const type = {
    shell: "tasks.shell",
    monitor: "tasks.monitor",
    scheduler: "tasks.scheduler",
    task: "tasks.subagent",
  } as const
  onCleanup(() => props.tasks.select())
  return (
    <Dialog
      title={language.t("tasks.title")}
      size="large"
      fit
      description={
        props.tasks.state.native
          ? language.t("tasks.nativeScheduledDescription", { limit: 100 })
          : language.t("tasks.description")
      }
    >
      <div class="flex flex-col gap-3 px-5 pb-5 max-h-[70vh] overflow-y-auto" data-component="background-tasks">
        <Show when={props.tasks.state.error || props.tasks.state.actionError}>
          <p role="alert">
            {language.t("common.requestFailed")}: {props.tasks.state.actionError || props.tasks.state.error}
          </p>
        </Show>
        <Show when={props.tasks.state.restorationNotice}>
          <p role="status" data-restoration-result>
            {props.tasks.state.restorationNotice}
          </p>
        </Show>
        <For each={props.tasks.state.issues}>
          {(source) => (
            <p role="alert" data-list-unavailable={source}>
              {language.t(`tasks.listUnavailable.${source}`)}
            </p>
          )}
        </For>
        <div class="flex items-center justify-between gap-2">
          <Button
            size="small"
            variant="secondary"
            data-action="tasks-refresh"
            onClick={() => void props.tasks.refresh()}
          >
            {language.t("tasks.refresh")}
          </Button>
          <Show when={props.tasks.state.native}>
            <Button
              size="small"
              variant="secondary"
              data-action="session-restore"
              disabled={!!props.tasks.state.pending}
              onClick={() => void props.tasks.restore()}
            >
              {language.t("session.restore.action")}
            </Button>
          </Show>
        </div>
        <Show when={props.tasks.state.native}>
          <p>{language.t("session.restore.hint")}</p>
        </Show>
        <p>
          {language.t(props.tasks.state.native ? "tasks.nativeCount" : "tasks.count", {
            count:
              props.tasks.state.error || props.tasks.state.issues.some((issue) => issue !== "schedules")
                ? "?"
                : props.tasks.running(),
          })}
        </p>
        <Show when={props.tasks.state.loaded} fallback={<p>{language.t("common.loading")}</p>}>
          <Show when={props.tasks.state.items.length} fallback={<p>{language.t("tasks.empty")}</p>}>
            <For each={props.tasks.state.items}>
              {(task) => (
                <div
                  class="flex items-center gap-2 border-b border-border-weak-base py-2"
                  data-task-id={task.id}
                  data-task-source={task.source}
                >
                  <button
                    type="button"
                    class="flex-1 min-w-0 text-left"
                    onClick={() => props.tasks.select(task)}
                    aria-pressed={props.tasks.state.selected === task.key}
                  >
                    <div class="truncate">{task.title || task.id}</div>
                    <div class="text-12-regular text-text-weak" data-task-status={task.status}>
                      {language.t(
                        task.source === "native-process"
                          ? task.type === "monitor"
                            ? "tasks.monitorProcess"
                            : "tasks.process"
                          : (type[task.type as keyof typeof type] ?? "tasks.other"),
                      )}{" "}
                      · {language.t(status[task.status])}
                      <Show when={task.background}>
                        <span data-task-background> · {language.t("tasks.background")}</span>
                      </Show>
                    </div>
                  </button>
                  <Show when={task.status === "running"}>
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={!!props.tasks.state.pending}
                      onClick={() => void props.tasks.cancel(task)}
                    >
                      {language.t(task.source === "native-process" ? "tasks.processCancel" : "tasks.cancel")}
                    </Button>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </Show>
        <Show when={props.tasks.state.selected}>
          <div class="flex flex-col gap-2" data-component="task-output">
            <h3>
              {language.t(
                props.tasks.state.detail?.source === "native-schedule" ? "tasks.scheduleDetails" : "tasks.output",
              )}
            </h3>
            <Show when={props.tasks.state.detail} fallback={<p>{language.t("common.loading")}</p>}>
              {(detail) => (
                <>
                  <Show when={detail().schedule}>
                    {(schedule) => (
                      <div class="flex flex-col gap-2 text-12-regular" data-schedule-details>
                        <p class="text-12-mono break-all" dir="ltr">
                          {schedule().id}
                        </p>
                        <p>{language.t("tasks.scheduleInterval", { seconds: schedule().intervalSeconds })}</p>
                        <p>{language.t(schedule().durable ? "tasks.scheduleDurable" : "tasks.scheduleTemporary")}</p>
                        <p>
                          {language.t("tasks.scheduleExpires", {
                            time: new Date(schedule().expiresAt).toLocaleString(language.intl()),
                          })}
                        </p>
                        <Show when={schedule().status === "active"}>
                          <p>
                            {language.t("tasks.scheduleNext", {
                              time: new Date(schedule().nextFireAt).toLocaleString(language.intl()),
                            })}
                          </p>
                        </Show>
                        <Show when={schedule().blockedReason}>
                          {(reason) => <p data-schedule-reason>{language.t(`tasks.scheduleReason.${reason()}`)}</p>}
                        </Show>
                        <Show when={schedule().latestTaskID}>
                          {(id) => (
                            <p data-schedule-task>
                              {language.t("tasks.scheduleTask", {
                                id: id(),
                                status: language.t(`tasks.occurrence.${schedule().occurrenceStatus ?? "unknown"}`),
                              })}
                            </p>
                          )}
                        </Show>
                        <p>{language.t("tasks.scheduleControlHint")}</p>
                        <div class="flex flex-wrap gap-2">
                          <Show when={schedule().status === "active" || schedule().status === "paused"}>
                            <Button
                              size="small"
                              variant="secondary"
                              data-action="schedule-toggle"
                              disabled={!!props.tasks.state.pending}
                              onClick={() =>
                                void props.tasks.changeSchedule(
                                  detail(),
                                  schedule().status === "active" ? "pause" : "resume",
                                )
                              }
                            >
                              {language.t(
                                schedule().status === "active" ? "tasks.schedulePause" : "tasks.scheduleResume",
                              )}
                            </Button>
                            <Button
                              size="small"
                              variant="secondary"
                              data-action="schedule-delete"
                              disabled={!!props.tasks.state.pending}
                              onClick={() => void props.tasks.changeSchedule(detail(), "delete")}
                            >
                              {language.t("tasks.scheduleDelete")}
                            </Button>
                          </Show>
                        </div>
                      </div>
                    )}
                  </Show>
                  <Show when={detail().blockedReason === "process_restart"}>
                    <p data-task-restart class="text-12-regular text-text-weak">
                      {language.t(detail().source === "native-process" ? "tasks.shellRestart" : "tasks.processRestart")}
                    </p>
                  </Show>
                  <Show when={detail().source === "native-process"}>
                    <p data-process-id class="text-12-mono break-all" dir="ltr">
                      {detail().id}
                    </p>
                    <p class="text-12-regular text-text-weak">{language.t("tasks.processControlHint")}</p>
                    <Show when={detail().background && detail().status === "running"}>
                      <p class="text-12-regular text-text-weak">
                        {language.t(detail().type === "monitor" ? "tasks.monitorStopHint" : "tasks.processStopHint")}
                      </p>
                    </Show>
                    <Show when={detail().monitor}>
                      {(monitor) => (
                        <div class="flex flex-col gap-1 text-12-regular text-text-weak" data-monitor-details>
                          <p>
                            {language.t(
                              monitor().persistent ? "tasks.monitorPersistent" : "tasks.monitorNonpersistent",
                            )}
                          </p>
                          <p>
                            {monitor().timeoutMs === 0
                              ? language.t("tasks.monitorNoDeadline")
                              : language.t("tasks.monitorTimeout", { timeout: monitor().timeoutMs })}
                          </p>
                          <p data-monitor-batches>
                            {language.t("tasks.monitorBatches", {
                              accepted: monitor().accepted,
                              suppressed: monitor().suppressed,
                            })}
                          </p>
                          <p>{language.t("tasks.monitorCountsHint")}</p>
                          <Show when={monitor().overloaded}>
                            <p role="status" data-monitor-overloaded>
                              {language.t("tasks.monitorOverloaded")}
                            </p>
                          </Show>
                        </div>
                      )}
                    </Show>
                    <Show when={detail().status === "running"}>
                      <Button
                        size="small"
                        variant="secondary"
                        data-action="process-wait"
                        disabled={!!props.tasks.state.pending}
                        onClick={() => void props.tasks.wait(detail())}
                      >
                        {language.t("tasks.processWait")}
                      </Button>
                    </Show>
                    <Show when={props.tasks.state.waitResult}>
                      {(result) => (
                        <p role="status" data-process-wait={result()}>
                          {language.t(`tasks.waitResult.${result()}`)}
                        </p>
                      )}
                    </Show>
                    <Show when={detail().exitCode !== undefined}>
                      <p data-process-exit>{language.t("tasks.exitCode", { code: detail().exitCode! })}</p>
                    </Show>
                    <Show when={detail().truncated}>
                      <p data-process-truncated>{language.t("tasks.outputTruncated")}</p>
                    </Show>
                  </Show>
                  <Show when={detail().source === "native-task" && `${detail().id}:${detail().started_at}`} keyed>
                    {(_key) => (
                      <Show when={sdk().client} keyed>
                        {(client) => <TaskMessage client={client} task={detail()} />}
                      </Show>
                    )}
                  </Show>
                  <Show when={detail().error}>
                    <p role="alert">{detail().error}</p>
                  </Show>
                  <pre class="whitespace-pre-wrap break-words text-12-mono max-h-64 overflow-auto">
                    {detail().output || language.t("tasks.noOutput")}
                  </pre>
                </>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}

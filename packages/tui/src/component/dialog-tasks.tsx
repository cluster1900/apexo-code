import { taskMessageDraft } from "@apexo/sdk/v2/task-message"
import { TaskMessage } from "./task-message"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useBindings } from "../keymap"
import { createEffect, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import {
  taskActions,
  type TaskItem,
  type TaskOutput,
  type TaskTarget,
  taskIssueText,
  processLines,
  scheduleLines,
} from "../util/session-tasks"
import { useTerminalDimensions } from "@opentui/solid"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { DialogSelect, type DialogSelectProps } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"

function createTasks(sessionID: () => string | undefined) {
  const sdk = useSDK()
  const [state, setState] = createStore({
    items: [] as TaskItem[],
    selected: undefined as string | undefined,
    detail: undefined as TaskOutput | undefined,
    error: "",
    actionError: "",
    pending: false,
    native: false,
    loaded: false,
    issues: [] as ("tasks" | "processes" | "schedules")[],
    waitResult: "",
  })
  let refresh = async () => {}
  let cancel = async (_target: TaskTarget) => {}
  let wait = async (_target: TaskTarget) => {}
  let changeSchedule = async (_target: TaskTarget, _action: "pause" | "resume" | "delete") => {}
  let stopWaiting = () => {}
  createEffect(() => {
    const id = sessionID()
    setState({
      items: [],
      selected: undefined,
      detail: undefined,
      error: "",
      actionError: "",
      pending: false,
      native: false,
      loaded: false,
      issues: [],
      waitResult: "",
    })
    if (!id) return
    const abort = new AbortController()
    const actions = taskActions(
      sdk.client,
      () => id,
      async () => (await sdk.transport()).kind,
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    let revision = 0
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
          if (!abort.signal.aborted && current === revision && state.selected === selected)
            setState("detail", reconcile(detail))
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted && current === revision)
            setState("error", error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (!abort.signal.aborted && current === revision) timer = setTimeout(refresh, 2_000)
        })
    }
    cancel = async (target) => {
      if (abort.signal.aborted || state.pending) return
      setState({ pending: true, actionError: "" })
      await actions
        .cancel(target, abort.signal)
        .then(() => {
          if (!abort.signal.aborted) return refresh()
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted) setState("actionError", error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (!abort.signal.aborted) setState("pending", false)
        })
    }
    wait = async (target) => {
      if (abort.signal.aborted || state.pending || target.source !== "native-process") return
      const waiting = new AbortController()
      stopWaiting = () => waiting.abort()
      const signal = AbortSignal.any([abort.signal, waiting.signal, AbortSignal.timeout(15_000)])
      setState({ pending: true, actionError: "", waitResult: "Waiting up to 10 seconds…" })
      await actions
        .wait(target, signal)
        .then(async (result) => {
          if (signal.aborted) return
          if (state.selected === `${target.source}:${target.id}`)
            setState({
              detail: result.detail,
              waitResult: result.timedOut
                ? "The wait ended; the process is still running."
                : "The process has finished.",
            })
          await refresh()
        })
        .catch((error: unknown) => {
          if (!signal.aborted)
            setState({
              actionError: error instanceof Error ? error.message : "Process request failed.",
              waitResult: "",
            })
        })
        .finally(() => {
          if (!abort.signal.aborted) setState("pending", false)
        })
    }
    changeSchedule = async (target, action) => {
      if (abort.signal.aborted || state.pending) return
      setState({ pending: true, actionError: "" })
      await actions
        .changeSchedule(target, action, abort.signal)
        .then(async (detail) => {
          if (!abort.signal.aborted) {
            setState("detail", reconcile(detail))
            await refresh()
          }
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted)
            setState("actionError", error instanceof Error ? error.message : "The schedule request failed")
        })
        .finally(() => {
          if (!abort.signal.aborted) setState("pending", false)
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
      stopWaiting()
    })
  })
  return {
    state,
    select(id: string) {
      if (id === state.selected) return
      stopWaiting()
      setState({ selected: id, detail: undefined, waitResult: "" })
      void refresh()
    },
    cancel: (key: string) => {
      const target = state.items.find((item) => item.key === key)
      if (target) return cancel(target)
    },
    changeSchedule: (key: string, action: "pause" | "resume" | "delete") => {
      const target = state.items.find((item) => item.key === key)
      if (target) return changeSchedule(target, action)
    },
    wait: (key: string) => {
      const target = state.items.find((item) => item.key === key)
      if (target) return wait(target)
    },
    running: () => state.items.filter((task) => task.status === "running").length,
  }
}

export function TaskStatus(props: { sessionID: () => string | undefined }) {
  const tasks = createTasks(props.sessionID)
  const theme = useTheme()
  const dialog = useDialog()
  return (
    <Show when={props.sessionID()}>
      {(id) => (
        <text fg={theme.theme.textMuted} onMouseUp={() => dialog.replace(() => <DialogTasks sessionID={id()} />)}>
          /tasks{" "}
          {tasks.state.error || tasks.state.issues.some((issue) => issue !== "schedules")
            ? "?"
            : tasks.state.loaded
              ? tasks.running()
              : "…"}{" "}
          running
          {tasks.state.native ? " (recent)" : ""}
        </text>
      )}
    </Show>
  )
}

export function DialogTasks(props: { sessionID: string }) {
  const sdk = useSDK()
  const [messaging, setMessaging] = createSignal(false)
  const tasks = createTasks(() => props.sessionID)
  createEffect(() => {
    props.sessionID
    tasks.state.detail?.id
    tasks.state.detail?.started_at
    sdk.client
    setMessaging(false)
  })
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  createEffect(() => {
    const first = tasks.state.items[0]
    if (!tasks.state.selected && first) tasks.select(first.key)
  })
  let output: ScrollBoxRenderable | undefined
  useBindings(() => ({
    priority: 1,
    enabled: !!tasks.state.detail && !messaging(),
    bindings: ["pageup", "pagedown"].map((key) => ({
      key,
      desc: "Scroll task output",
      group: "Tasks",
      cmd: () => output?.scrollBy((key === "pageup" ? -1 : 1) * output.height),
    })),
  }))
  return (
    <box
      id="session-task-dialog"
      flexDirection="column"
      height={Math.max(12, Math.min(28, dimensions().height - Math.floor(dimensions().height / 4) - 2))}
    >
      <Show
        when={!messaging()}
        fallback={
          <TaskMessage
            target={() =>
              tasks.state.detail
                ? `${tasks.state.detail.title || "Task"} · ${tasks.state.detail.id}`
                : "Task unavailable"
            }
            draft={
              tasks.state.detail
                ? taskMessageDraft(sdk.client, props.sessionID, tasks.state.detail.id, tasks.state.detail.started_at)
                : undefined
            }
            available={() => tasks.state.detail?.status === "running" || tasks.state.detail?.status === "completed"}
            theme={() => ({ text: theme.theme.text, muted: theme.theme.textMuted, error: theme.theme.error })}
            onClose={() => setMessaging(false)}
          />
        }
      >
        <DialogSelect
          title={`Tasks · ${tasks.state.error || tasks.state.issues.some((issue) => issue !== "schedules") ? "?" : tasks.running()} running${tasks.state.native ? " (recent)" : ""}`}
          placeholder="Search session tasks"
          preserveSelection
          options={tasks.state.items.map((task) => ({
            value: task.key,
            title: task.title || task.id,
            description: `${task.type} · ${task.status}${task.background ? " · Background" : ""}`,
          }))}
          onMove={(option) => tasks.select(option.value)}
          onSelect={(option) => tasks.select(option.value)}
          bindings={[
            { key: "ctrl+e", cmd: "task.message" },
            { key: "ctrl+x", cmd: "task.cancel" },
            { key: "ctrl+w", cmd: "process.wait" },
            { key: "ctrl+r", cmd: "schedule.toggle" },
            { key: "ctrl+d", cmd: "schedule.delete" },
          ]}
          actions={(
            [
              {
                command: "task.message",
                title: "Message Task",
                disabled: (option) =>
                  tasks.state.pending ||
                  !tasks.state.items.some((item) => item.key === option?.value && item.source === "native-task") ||
                  tasks.state.detail?.key !== option?.value,
                onTrigger: () => setMessaging(true),
              },
              {
                command: "schedule.toggle",
                title: "Pause/Resume schedule",
                disabled: (option) =>
                  tasks.state.pending ||
                  !tasks.state.items.some(
                    (item) =>
                      item.key === option?.value &&
                      item.source === "native-schedule" &&
                      ["active", "paused"].includes(item.status),
                  ),
                onTrigger: (option) =>
                  void tasks.changeSchedule(
                    option.value,
                    tasks.state.items.find((item) => item.key === option.value)?.status === "active"
                      ? "pause"
                      : "resume",
                  ),
              },
              {
                command: "schedule.delete",
                title: "Delete schedule",
                disabled: (option) =>
                  tasks.state.pending ||
                  !tasks.state.items.some(
                    (item) =>
                      item.key === option?.value &&
                      item.source === "native-schedule" &&
                      ["active", "paused"].includes(item.status),
                  ),
                onTrigger: (option) => void tasks.changeSchedule(option.value, "delete"),
              },
              {
                command: "task.cancel",
                title: "Stop selected",
                disabled: (option) =>
                  tasks.state.pending ||
                  !tasks.state.items.some((task) => task.key === option?.value && task.status === "running"),
                onTrigger: (option) => void tasks.cancel(option.value),
              },
              {
                command: "process.wait",
                title: "Wait (10 s)",
                disabled: (option) =>
                  tasks.state.pending ||
                  !tasks.state.items.some(
                    (item) =>
                      item.key === option?.value && item.source === "native-process" && item.status === "running",
                  ),
                onTrigger: (option) => void tasks.wait(option.value),
              },
            ] satisfies DialogSelectProps<string>["actions"]
          ).filter((action) =>
            action.command === "task.message"
              ? tasks.state.detail?.source === "native-task"
              : action.command.startsWith("schedule.") === (tasks.state.detail?.source === "native-schedule"),
          )}
          emptyView={<text fg={theme.theme.textMuted}>No tasks in this session.</text>}
        />
        <box flexDirection="column" flexShrink={0} paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <Show when={tasks.state.native}>
            <text fg={theme.theme.textMuted}>
              Up to 100 recent tasks and processes, plus current schedules. Schedules are not running Tasks.
            </text>
          </Show>
          <For each={tasks.state.issues}>{(issue) => <text fg={theme.theme.error}>{taskIssueText(issue)}</text>}</For>
          <Show when={tasks.state.waitResult}>
            <text fg={theme.theme.textMuted}>{tasks.state.waitResult}</text>
          </Show>
          <Show when={tasks.state.error || tasks.state.actionError}>
            <text fg={theme.theme.error}>{tasks.state.actionError || tasks.state.error}</text>
          </Show>
          <Show when={tasks.state.detail}>
            {(detail) => (
              <>
                <text fg={theme.theme.textMuted} wrapMode="none" height={1}>
                  {detail().id}
                </text>
                <Show when={detail().source !== "native-process" && detail().blockedReason === "process_restart"}>
                  <text fg={theme.theme.textMuted}>
                    Interrupted by a server restart. Review output before starting a new task.
                  </text>
                </Show>
                <scrollbox
                  id="session-task-output"
                  ref={(ref) => {
                    output = ref
                  }}
                  height={Math.max(
                    2,
                    Math.min(
                      7,
                      dimensions().height - 20 - (tasks.state.native ? 2 : 0) - (detail().blockedReason ? 2 : 0),
                    ),
                  )}
                >
                  <text fg={theme.theme.textMuted}>
                    {[...scheduleLines(detail()), ...processLines(detail())].join("\n")}
                  </text>
                  <text fg={theme.theme.text}>{detail().error || detail().output || "No output yet."}</text>
                </scrollbox>
              </>
            )}
          </Show>
        </box>
      </Show>
    </box>
  )
}

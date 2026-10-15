import { TaskMessage } from "@apexo/tui/component/task-message"
import type { ScrollBoxRenderable } from "@opentui/core"
/** @jsxImportSource @opentui/solid */
import { useKeyboard } from "@opentui/solid"
import { createEffect, createSignal, createMemo, For, onCleanup, Show, untrack } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import {
  processLines,
  scheduleLines,
  taskIssueText,
  type TaskItem,
  type TaskOutput,
} from "@apexo/tui/util/session-tasks"
import { RunFooterMenu, createFooterMenuState } from "./footer.menu"
import type { RunFooterTheme } from "./theme"
import type { RunTaskActions } from "./types"

export function RunTasksBody(props: {
  theme: () => RunFooterTheme
  tasks: () => TaskItem[]
  native?: () => boolean
  issues?: () => ("tasks" | "processes" | "schedules")[]
  error: () => string | undefined
  actions?: RunTaskActions
  onClose: () => void
}) {
  const [messaging, setMessaging] = createSignal(false)
  const menu = createFooterMenuState({
    count: () => props.tasks().length,
    limit: 6,
  })
  const selected = createMemo(() => props.tasks()[menu.selected()])
  const selectedID = createMemo(() => (selected() ? `${selected()!.key}:${selected()!.started_at}` : undefined))
  createEffect(() => {
    selectedID()
    props.actions
    setMessaging(false)
  })
  const [state, setState] = createStore({
    detail: undefined as TaskOutput | undefined,
    error: "",
    actionError: "",
    pending: false,
    waitResult: "",
  })
  let output: ScrollBoxRenderable | undefined
  let cancelSignal: AbortSignal | undefined
  createEffect(() => {
    const id = selectedID()
    const target = untrack(selected)
    const actions = props.actions
    cancelSignal = undefined
    setState({ detail: undefined, error: "", actionError: "", pending: false, waitResult: "" })
    if (!id || !target || !actions) return
    const abort = new AbortController()
    cancelSignal = abort.signal
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      await actions
        .get(target, AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]))
        .then((detail) => {
          if (!abort.signal.aborted) {
            setState("detail", reconcile(detail))
            setState("error", "")
          }
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted) setState("error", error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (!abort.signal.aborted) timer = setTimeout(refresh, 2_000)
        })
    }
    void untrack(refresh)
    onCleanup(() => {
      abort.abort()
      clearTimeout(timer)
    })
  })
  useKeyboard((key) => {
    if (key.defaultPrevented || messaging()) return
    if (
      key.name === "m" &&
      !key.ctrl &&
      !key.meta &&
      props.actions?.messageDraft &&
      selected()?.source === "native-task" &&
      !state.pending
    ) {
      key.preventDefault()
      setMessaging(true)
      return
    }
    if (key.name === "escape") {
      key.preventDefault()
      props.onClose()
      return
    }
    if (key.name === "up" || key.name === "down") {
      key.preventDefault()
      menu.move(key.name === "up" ? -1 : 1)
      return
    }
    if (key.name === "pageup" || key.name === "pagedown") {
      key.preventDefault()
      output?.scrollBy((key.name === "pageup" ? -1 : 1) * output.height)
      return
    }
    const task = selected()
    if (task?.source === "native-schedule" && ["p", "r", "d"].includes(key.name) && !key.ctrl && !key.meta) {
      const signal = cancelSignal
      if (!signal || signal.aborted || state.pending || !props.actions || !["active", "paused"].includes(task.status))
        return
      if ((key.name === "p" && task.status !== "active") || (key.name === "r" && task.status !== "paused")) return
      key.preventDefault()
      setState({ pending: true, actionError: "" })
      void props.actions
        .changeSchedule(task, key.name === "p" ? "pause" : key.name === "r" ? "resume" : "delete", signal)
        .then((detail) => {
          if (!signal.aborted) setState("detail", reconcile(detail))
        })
        .catch((error: unknown) => {
          if (!signal.aborted)
            setState("actionError", error instanceof Error ? error.message : "The schedule request failed")
        })
        .finally(() => {
          if (!signal.aborted) setState("pending", false)
        })
      return
    }
    if (
      (key.name !== "c" && key.name !== "w") ||
      key.ctrl ||
      key.meta ||
      !task ||
      task.status !== "running" ||
      state.pending ||
      !props.actions
    )
      return
    const signal = cancelSignal
    if (!signal || signal.aborted) return
    key.preventDefault()
    if (key.name === "w") {
      if (task.source !== "native-process") return
      setState({ pending: true, actionError: "", waitResult: "Waiting up to 10 seconds…" })
      void props.actions
        .wait(task, AbortSignal.any([signal, AbortSignal.timeout(15_000)]))
        .then((result) => {
          if (!signal.aborted)
            setState({
              detail: result.detail,
              waitResult: result.timedOut
                ? "The wait ended; the process is still running."
                : "The process has finished.",
            })
        })
        .catch((error: unknown) => {
          if (!signal.aborted)
            setState({
              actionError: error instanceof Error ? error.message : "Process request failed.",
              waitResult: "",
            })
        })
        .finally(() => {
          if (!signal.aborted) setState("pending", false)
        })
      return
    }
    setState({ pending: true, actionError: "" })
    void props.actions
      .cancel(task, signal)
      .catch((error: unknown) => {
        if (!signal.aborted) setState("actionError", error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!signal.aborted) setState("pending", false)
      })
  })
  return (
    <box id="session-task-mini" height={19} width="100%" flexDirection="column">
      <Show
        when={!messaging()}
        fallback={
          <TaskMessage
            target={() => (selected() ? `${selected()!.title || "Task"} · ${selected()!.id}` : "Task unavailable")}
            draft={selected() ? props.actions?.messageDraft?.(selected()!) : undefined}
            available={() => selected()?.status === "running" || selected()?.status === "completed"}
            theme={props.theme}
            onClose={() => setMessaging(false)}
          />
        }
      >
        <text flexShrink={0} fg={props.theme().text}>
          Tasks ·{" "}
          {props.error() || props.issues?.().some((issue) => issue !== "schedules")
            ? "?"
            : props.tasks().filter((task) => task.status === "running").length}{" "}
          running
          {props.native?.() ? " (recent)" : ""} · ↑↓ select ·{" "}
          {selected()?.source === "native-schedule"
            ? "p pause · r resume · d delete"
            : selected()?.source === "native-task"
              ? "c stop · m message"
              : selected()?.source === "native-process"
                ? "c stop · w wait"
                : "c stop"}{" "}
          · PgUp/PgDn output · esc back
        </text>
        <Show when={props.native?.()}>
          <text flexShrink={0} fg={props.theme().muted}>
            Up to 100 recent tasks and processes, plus current schedules. Schedules are not running Tasks.
          </text>
        </Show>
        <For each={props.issues?.() ?? []}>
          {(issue) => <text fg={props.theme().error}>{taskIssueText(issue)}</text>}
        </For>
        <Show when={state.pending && selected()?.source === "native-schedule"}>
          <text flexShrink={0} fg={props.theme().muted}>
            Updating schedule…
          </text>
        </Show>
        <Show when={state.waitResult}>
          <text fg={props.theme().muted}>{state.waitResult}</text>
        </Show>
        <Show when={props.error() || state.error || state.actionError}>
          <text fg={props.theme().error}>{props.error() || state.error || state.actionError}</text>
        </Show>
        <RunFooterMenu
          theme={props.theme}
          items={() =>
            props.tasks().map((task) => ({
              display: task.title || task.id,
              footer: `${task.type} · ${task.status}${task.background ? " · Background" : ""}`,
            }))
          }
          selected={menu.selected}
          offset={menu.offset}
          rows={menu.rows}
          limit={6}
          empty="No tasks in this session"
          border={false}
        />
        <Show when={selected()}>
          <text flexShrink={0} fg={props.theme().muted}>
            {selected()?.id}
          </text>
          <Show when={state.detail?.source !== "native-process" && state.detail?.blockedReason === "process_restart"}>
            <text flexShrink={0} fg={props.theme().muted}>
              Interrupted by a server restart. Review output before starting a new task.
            </text>
          </Show>
          <scrollbox
            ref={(ref) => {
              output = ref
            }}
            id="session-task-output"
            flexGrow={1}
            flexBasis={0}
            minHeight={2}
            width="100%"
          >
            <text fg={props.theme().muted}>
              {state.detail ? [...scheduleLines(state.detail), ...processLines(state.detail)].join("\n") : ""}
            </text>
            <text fg={props.theme().text}>{state.detail?.error || state.detail?.output || "No output yet."}</text>
          </scrollbox>
        </Show>
      </Show>
    </box>
  )
}

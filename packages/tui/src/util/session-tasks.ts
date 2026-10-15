import type {
  ApexoClient,
  BackgroundTaskDetail,
  BackgroundTaskSummary,
  TaskSummary,
  TaskDetail,
  SessionProcessSummary,
  SessionProcessDetail,
  SessionScheduleSummary,
  SessionScheduleDetail,
} from "@apexo/sdk/v2"
import { serverProtocol } from "./server-protocol"

export type TaskSource = "native-task" | "native-process" | "native-schedule" | "compatibility"
export type TaskTarget = { id: string; source: TaskSource }
export type TaskItem = Omit<BackgroundTaskSummary, "status"> &
  TaskTarget & {
    key: string
    status: BackgroundTaskSummary["status"] | TaskSummary["status"] | SessionScheduleSummary["status"]
    blockedReason?: TaskSummary["blockedReason"]
    truncated?: boolean
    schedule?: SessionScheduleSummary & { prompt?: string }
    monitor?: SessionProcessSummary["monitor"]
    exitCode?: number
  }
export type TaskOutput = TaskItem & Pick<BackgroundTaskDetail, "output" | "error">
export type TaskSnapshot = { native: boolean; items: TaskItem[]; issues: ("tasks" | "processes" | "schedules")[] }
export const taskKey = (target: TaskTarget) => `${target.source}:${target.id}`

type ActionCode = "conflict" | "missing" | "unavailable" | "failed"
const actionCode = (status?: number): ActionCode =>
  status === 409 ? "conflict" : status === 404 ? "missing" : status === 503 ? "unavailable" : "failed"

export class TaskCancelError extends Error {
  constructor(readonly code: ActionCode) {
    super(
      {
        conflict:
          "The task changed or its worker is still starting. Refresh the list, then retry cancellation if it is running.",
        missing: "This task is no longer available in this session.",
        unavailable: "Task state is temporarily unavailable. Try again later.",
        failed: "Could not stop the task. Refresh the list before trying again.",
      }[code],
    )
  }
}

export class ProcessActionError extends Error {
  constructor(readonly code: ActionCode) {
    super(
      {
        conflict: "The process changed or is still starting. Refresh the list before trying again.",
        missing: "This process is no longer available in this session.",
        unavailable: "Process state is temporarily unavailable. Try again later.",
        failed: "The process request failed. Refresh the list before trying again.",
      }[code],
    )
  }
}

export class ScheduleActionError extends Error {
  constructor(readonly code: ActionCode | "forbidden") {
    super("The schedule request failed")
  }
}

export function scheduleItem(schedule: SessionScheduleSummary): TaskItem {
  const source = "native-schedule"
  return {
    id: schedule.id,
    source,
    key: taskKey({ id: schedule.id, source }),
    sessionID: schedule.sessionID,
    title: schedule.promptPreview,
    type: "scheduler",
    status: schedule.status,
    started_at: schedule.createdAt,
    background: false,
    schedule,
  }
}
const scheduleOutput = (schedule: SessionScheduleDetail): TaskOutput => ({
  ...scheduleItem(schedule),
  schedule,
  output: schedule.prompt,
})

export function taskItem(task: TaskSummary): TaskItem {
  const source = "native-task"
  return {
    id: task.id,
    source,
    key: taskKey({ id: task.id, source }),
    sessionID: task.parentSessionID,
    childSessionID: task.id,
    title: task.description,
    type: "task",
    status: task.status,
    started_at: task.startedAt,
    completed_at: task.completedAt,
    blockedReason: task.blockedReason,
    background: task.background ?? false,
  }
}

export function processItem(process: SessionProcessSummary): TaskItem {
  const source = "native-process"
  return {
    id: process.id,
    source,
    key: taskKey({ id: process.id, source }),
    sessionID: process.sessionID,
    title: process.description,
    type: process.kind,
    status: process.status,
    started_at: process.startedAt,
    completed_at: process.completedAt,
    blockedReason: process.blockedReason,
    background: process.background,
    truncated: process.truncated,
    exitCode: process.exitCode,
    monitor: process.monitor,
  }
}

export function taskOutput(task: TaskDetail): TaskOutput {
  return { ...taskItem(task), output: task.output }
}
const processOutput = (process: SessionProcessDetail): TaskOutput => ({
  ...processItem(process),
  output: process.output,
})
const compatibilityItem = (item: BackgroundTaskSummary): TaskItem => ({
  ...item,
  source: "compatibility",
  key: taskKey({ id: item.id, source: "compatibility" }),
})

export function taskActions(
  client: ApexoClient,
  owner: () => string,
  selected?: (signal: AbortSignal) => Promise<"native" | "compatibility">,
) {
  const detect = serverProtocol(client)
  const protocol =
    selected ?? (async (signal: AbortSignal) => ((await detect(signal)) === "v2" ? "native" : "compatibility"))
  return {
    async list(signal: AbortSignal): Promise<TaskSnapshot> {
      const sessionID = owner()
      const native = (await protocol(signal)) === "native"
      const options = { signal, throwOnError: true as const }
      if (!native)
        return {
          native,
          items: (await client.experimental.task.list({ sessionID }, options)).data.map(compatibilityItem),
          issues: [],
        }
      const [tasks, processes, schedules] = await Promise.allSettled([
        client.v2.task.list({ sessionID, limit: "100" }, options),
        client.v2.process.list({ sessionID, limit: "100" }, options),
        client.v2.schedule.list({ sessionID }, options),
      ])
      if (signal.aborted) throw signal.reason
      return {
        native,
        items: [
          ...(tasks.status === "fulfilled" ? tasks.value.data.map(taskItem) : []),
          ...(processes.status === "fulfilled" ? processes.value.data.map(processItem) : []),
        ]
          .sort((a, b) => b.started_at - a.started_at || b.key.localeCompare(a.key))
          .slice(0, 100)
          .concat(schedules.status === "fulfilled" ? schedules.value.data.map(scheduleItem) : [])
          .sort((a, b) => b.started_at - a.started_at || b.key.localeCompare(a.key)),
        issues: [
          ...(tasks.status === "rejected" ? ["tasks" as const] : []),
          ...(processes.status === "rejected" ? ["processes" as const] : []),
          ...(schedules.status === "rejected" ? ["schedules" as const] : []),
        ],
      }
    },
    async get(target: TaskTarget, signal: AbortSignal): Promise<TaskOutput> {
      const sessionID = owner()
      const options = { signal, throwOnError: true as const }
      if (target.source === "native-schedule") {
        const result = await client.v2.schedule.get(
          { sessionID, scheduleID: target.id },
          { signal, throwOnError: false },
        )
        if (signal.aborted) throw signal.reason
        if (!result.response?.ok || !result.data)
          throw new ScheduleActionError(
            result.response?.status === 403 ? "forbidden" : actionCode(result.response?.status),
          )
        return scheduleOutput(result.data)
      }
      if (target.source === "native-process") {
        const result = await client.v2.process.output(
          { sessionID, processID: target.id },
          { signal, throwOnError: false },
        )
        if (signal.aborted) throw signal.reason
        if (!result.response?.ok || !result.data) throw new ProcessActionError(actionCode(result.response?.status))
        return processOutput(result.data)
      }
      if (target.source === "native-task")
        return taskOutput((await client.v2.task.output({ sessionID, taskID: target.id }, options)).data)
      const result = (await client.experimental.task.get({ sessionID, taskID: target.id }, options)).data
      return { ...compatibilityItem(result), output: result.output, error: result.error }
    },
    async cancel(target: TaskTarget, signal: AbortSignal) {
      if (target.source === "native-schedule") throw new ScheduleActionError("failed")
      const sessionID = owner()
      if (target.source === "compatibility")
        return client.experimental.task.cancel({ sessionID, taskID: target.id }, { signal, throwOnError: true })
      const result =
        target.source === "native-process"
          ? await client.v2.process.cancel({ sessionID, processID: target.id }, { signal, throwOnError: false })
          : await client.v2.task.cancel({ sessionID, taskID: target.id }, { signal, throwOnError: false })
      if (signal.aborted) throw signal.reason
      if (!result.response?.ok) {
        const code = actionCode(result.response?.status)
        throw target.source === "native-process" ? new ProcessActionError(code) : new TaskCancelError(code)
      }
      return result
    },
    async changeSchedule(target: TaskTarget, action: "pause" | "resume" | "delete", signal: AbortSignal) {
      const sessionID = owner()
      if (target.source !== "native-schedule") throw new ScheduleActionError("failed")
      const input = { sessionID, scheduleID: target.id }
      const result = await client.v2.schedule[action](input, { signal, throwOnError: false })
      if (signal.aborted) throw signal.reason
      if (!result.response?.ok)
        throw new ScheduleActionError(
          result.response?.status === 403 ? "forbidden" : actionCode(result.response?.status),
        )
      const detail = await client.v2.schedule.get(input, { signal, throwOnError: false })
      if (signal.aborted) throw signal.reason
      if (!detail.response?.ok || !detail.data) throw new ScheduleActionError(actionCode(detail.response?.status))
      return scheduleOutput(detail.data)
    },
    async wait(target: TaskTarget, signal: AbortSignal) {
      const sessionID = owner()
      if (target.source !== "native-process") throw new ProcessActionError("failed")
      const result = await client.v2.process.wait(
        { sessionID, processID: target.id, sessionProcessWait: { timeoutMs: 10_000 } },
        { signal, throwOnError: false },
      )
      if (signal.aborted) throw signal.reason
      if (!result.response?.ok || !result.data) throw new ProcessActionError(actionCode(result.response?.status))
      return { detail: processOutput(result.data.process), timedOut: result.data.timedOut }
    },
  }
}

export function taskIssueText(source: "tasks" | "processes" | "schedules") {
  if (source === "schedules") return "The schedule list could not be loaded. Available tasks and processes are shown."
  return source === "tasks"
    ? "The task list could not be loaded. Available process results are shown."
    : "The process list could not be loaded. Available task results are shown."
}

export function processLines(task: TaskOutput) {
  if (task.source !== "native-process") return []
  const monitor = task.monitor
  return [
    "Reading or waiting does not start model work. Closing this panel does not stop the process.",
    ...(task.blockedReason === "process_restart"
      ? ["Interrupted by a server restart. This command will not resume automatically."]
      : []),
    ...(monitor
      ? [
          monitor.persistent ? "Persistent Monitor; does not survive a server restart." : "Nonpersistent Monitor.",
          monitor.timeoutMs === 0 ? "No deadline." : `Effective timeout: ${monitor.timeoutMs} ms.`,
          `Batches accepted: ${monitor.accepted} · suppressed: ${monitor.suppressed}`,
          "Batch counts are not provider-call or line counts.",
          ...(monitor.overloaded ? ["Stopped after sustained output overload. Use a more selective command."] : []),
        ]
      : []),
    ...(task.status === "running" && task.background
      ? [
          monitor
            ? "Model Stop pauses Monitor delivery until new user input. Stop process ends the command."
            : "Model Stop suppresses completion messages. Stop process ends the command.",
        ]
      : []),
    ...(task.exitCode !== undefined ? [`Exit code: ${task.exitCode}`] : []),
    ...(task.truncated ? ["Only part of the output was retained."] : []),
  ]
}

export function scheduleLines(task: TaskOutput) {
  const schedule = task.schedule
  if (!schedule) return []
  const reason = {
    restart_required:
      "Saved intent is paused after restart. Resume schedules future occurrences; interrupted work is not replayed.",
    stopped: "Paused by model Stop. Resume explicitly to schedule future occurrences.",
    plan_pending: "Paused while Plan approval is pending.",
    goal_active: "Paused because this session has an active Goal.",
    busy: "An occurrence was skipped while prior work was busy.",
    unavailable: "The schedule could not run. Review the session before resuming.",
    denied: "The current permission policy denied this schedule.",
  }
  return [
    `Schedule: ${schedule.status}. Interval: ${schedule.intervalSeconds} seconds.`,
    schedule.durable ? "Durable option: enabled." : "Durable option: disabled.",
    `Expires: ${new Date(schedule.expiresAt).toLocaleString()}`,
    ...(schedule.status === "active" ? [`Next deadline: ${new Date(schedule.nextFireAt).toLocaleString()}`] : []),
    ...(schedule.blockedReason ? [reason[schedule.blockedReason]] : []),
    ...(schedule.latestTaskID
      ? [`Latest Task: ${schedule.latestTaskID} (${schedule.occurrenceStatus ?? "unknown"})`]
      : []),
    "Pause/Delete affect future occurrences. An admitted Task remains separately controllable.",
  ]
}

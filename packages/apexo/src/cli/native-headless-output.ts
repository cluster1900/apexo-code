import { Schema } from "effect"
import { SessionEvent } from "@apexo/schema/session-event"
import { nativeSessionView } from "@apexo/tui/transport/native-session-view"
import type { SessionInput } from "@apexo/schema/session-input"

/** Presentation over the canonical native projection; no execution or synthetic transcript events. */
export function nativeHeadlessOutput(input: {
  sessionID: string
  inputID: string
  directory: string
  format: "default" | "json" | "streaming-json"
  thinking: boolean
  write: (value: string) => void
  error: (value: string) => void
}) {
  const view = nativeSessionView(input.sessionID, input.directory)
  const emitted = new Set<string>()
  const lengths = new Map<string, number>()
  const emit = (type: string, value: Record<string, unknown>) =>
    input.write(
      JSON.stringify(
        input.format === "json"
          ? { type, timestamp: Date.now(), sessionID: input.sessionID, ...value }
          : { type, ...value },
      ) + "\n",
    )
  const once = (key: string, run: () => void) => {
    if (emitted.has(key)) return
    emitted.add(key)
    run()
  }
  return {
    get sequence() {
      return view.sequence
    },
    apply(value: unknown) {
      if (
        typeof value !== "object" ||
        value === null ||
        !("type" in value) ||
        typeof value.type !== "string" ||
        !value.type.startsWith("session.next.")
      )
        return
      const event = Schema.decodeUnknownSync(SessionEvent.All)(value)
      if (event.data.sessionID !== input.sessionID || !view.apply(value)) return
      const messages = view
        .snapshot()
        .filter((item) => item.info.role === "assistant" && item.info.parentID === input.inputID)
      for (const item of messages) {
        for (const part of item.parts) {
          const key = `${item.info.id}:${part.id}`
          if (part.type === "text" || part.type === "reasoning") {
            if (part.type === "reasoning" && !input.thinking && input.format !== "streaming-json") continue
            if (input.format === "streaming-json") {
              const previous = lengths.get(key) ?? 0
              if (part.text.length > previous)
                emit(part.type === "reasoning" ? "thought" : "text", { data: part.text.slice(previous) })
              lengths.set(key, part.text.length)
              continue
            }
            if (!part.time?.end) continue
            once(key, () =>
              input.format === "json"
                ? emit(part.type, { part })
                : input.write((part.type === "reasoning" ? "Thinking: " : "") + part.text + "\n"),
            )
            continue
          }
          if (part.type !== "tool") continue
          const state = part.state
          if (input.format === "streaming-json") {
            const kind = ["run_terminal_cmd", "run_terminal_command", "bash", "shell"].includes(part.tool)
              ? "execute"
              : ["read_file", "read", "list_dir"].includes(part.tool)
                ? "read"
                : ["search_replace", "write", "edit", "apply_patch", "patch"].includes(part.tool)
                  ? "edit"
                  : ["grep", "glob", "web_search"].includes(part.tool)
                    ? "search"
                    : [
                          "spawn_subagent",
                          "task",
                          "enter_plan_mode",
                          "exit_plan_mode",
                          "plan_enter",
                          "plan_exit",
                        ].includes(part.tool)
                      ? "think"
                      : part.tool === "web_fetch"
                        ? "fetch"
                        : "other"
            const location = [
              state.input.target_file,
              state.input.file_path,
              state.input.target_directory,
              state.input.workdir,
            ].find((value): value is string => typeof value === "string")
            const common = {
              toolCallId: part.callID,
              toolName: part.tool,
              kind,
              rawInput: state.input,
              title:
                kind === "execute" && typeof state.input.command === "string"
                  ? state.input.command
                  : typeof state.input.description === "string"
                    ? state.input.description
                    : typeof state.input.target_file === "string"
                      ? state.input.target_file
                      : typeof state.input.file_path === "string"
                        ? state.input.file_path
                        : part.tool,
              locations: location ? [{ path: location }] : [],
            }
            once(`${key}:pending`, () => emit("tool_call", { ...common, status: "pending", content: [] }))
            once(`${key}:${state.status}`, () => {
              if (state.status === "pending") return
              const output =
                state.status === "completed" ? state.output : state.status === "error" ? state.error : undefined
              emit("tool_call_update", {
                ...common,
                status: state.status === "running" ? "in_progress" : state.status === "error" ? "failed" : "completed",
                content: output === undefined ? [] : [{ type: "content", content: { type: "text", text: output } }],
                ...(state.status === "completed"
                  ? { rawOutput: { output: state.output, metadata: state.metadata } }
                  : state.status === "error"
                    ? { rawOutput: { error: state.error, metadata: state.metadata } }
                    : {}),
              })
            })
            continue
          }
          if (state.status !== "completed" && state.status !== "error") continue
          once(key, () => {
            if (input.format === "json") return emit("tool_use", { part })
            if (state.status === "error") return input.error(`${part.tool}: ${state.error}\n`)
            input.write(`${part.tool}: ${state.output}\n`)
          })
        }
      }
      if (!("assistantMessageID" in event.data)) return
      const data = event.data
      if (!messages.some((item) => item.info.id === data.assistantMessageID)) return
      if (event.type === "session.next.step.started" && input.format === "json")
        once(event.id, () =>
          emit("step_start", {
            part: { type: "step-start", id: event.id, sessionID: input.sessionID, messageID: data.assistantMessageID },
          }),
        )
      if (event.type === "session.next.step.ended" && input.format === "json")
        once(event.id, () =>
          emit("step_finish", {
            part: {
              type: "step-finish",
              id: event.id,
              sessionID: input.sessionID,
              messageID: event.data.assistantMessageID,
              reason: event.data.finish,
              cost: event.data.cost,
              tokens: event.data.tokens,
            },
          }),
        )
      if (event.type === "session.next.step.failed")
        once(event.id, () =>
          input.format === "default"
            ? input.error(event.data.error.message + "\n")
            : emit("error", { message: event.data.error.message }),
        )
    },
    finish(execution: SessionInput.Execution) {
      once("terminal", () => {
        const result = {
          inputID: execution.id,
          sessionID: execution.sessionID,
          status: execution.status,
          reason: execution.reason,
          usageIncomplete: execution.usageIncomplete,
        }
        if (input.format === "default") {
          if (execution.status !== "completed")
            input.error(`Input ${execution.id}: ${execution.reason ?? execution.status}\n`)
          if (execution.usageIncomplete) input.error("Input usage is incomplete.\n")
          return
        }
        emit("input_execution", result)
        if (input.format === "streaming-json")
          emit("end", {
            stopReason: execution.status === "completed" ? "end_turn" : (execution.reason ?? execution.status),
            sessionId: input.sessionID,
            requestId: input.inputID,
            ...result,
          })
      })
    },
  }
}

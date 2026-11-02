import { mediaMetadata } from "@/utils/media-output"
import type { ApexoEvent, SessionMessageInfo, SessionPendingMessage } from "@apexo/client/promise"

type Assistant = Extract<SessionMessageInfo, { type: "assistant" }>
type AssistantTool = Extract<Assistant["content"][number], { type: "tool" }>
type AssistantReasoning = Extract<Assistant["content"][number], { type: "reasoning" }>
type ProviderState = AssistantTool["providerState"]
type ToolRunningMetadata = Extract<AssistantTool["state"], { status: "running" }>["metadata"]
type Compaction = Extract<SessionMessageInfo, { type: "compaction" }>
type Shell = Extract<SessionMessageInfo, { type: "shell" }>

export type V2SessionReduction = {
  sessionID: string
  messages: SessionMessageInfo[]
  touched: string[]
  removed?: string[]
  missing?: string
}

export function createV2SessionReducer() {
  const pending = new Map<string, SessionPendingMessage>()

  const reduce = (source: readonly SessionMessageInfo[], rawEvent: ApexoEvent): V2SessionReduction | undefined => {
    const unknownEvent = rawEvent as unknown as {
      id: string
      type: string
      created?: number
      metadata?: SessionMessageInfo["metadata"]
      data?: Record<string, unknown>
    }
    if (!unknownEvent.data || typeof unknownEvent.data.sessionID !== "string") return
    const sessionID = unknownEvent.data.sessionID
    const timestamp =
      typeof unknownEvent.data.timestamp === "number"
        ? unknownEvent.data.timestamp
        : (unknownEvent.created ?? Date.now())
    const result = (messages: SessionMessageInfo[], touched: string[] = []): V2SessionReduction => ({
      sessionID,
      messages,
      touched,
    })
    const append = (message: SessionMessageInfo) => {
      const exists = source.some((item) => item.id === message.id)
      if (exists) {
        return result(
          update(source, message.id, () => message),
          [message.id],
        )
      }
      return result([...source, message], [message.id])
    }

    if (unknownEvent.type.startsWith("session.next.")) {
      return reduceNext(
        source,
        { ...unknownEvent, data: unknownEvent.data },
        sessionID,
        timestamp,
        result,
        append,
      )
    }

    const event = rawEvent
    if (!("data" in event) || !("sessionID" in event.data) || typeof event.data.sessionID !== "string") return

    switch (event.type) {
      case "session.input.admitted":
        pending.set(key(sessionID, event.data.inputID), event.data.input)
        return result([...source])
      case "session.input.promoted": {
        const input = pending.get(key(sessionID, event.data.inputID))
        pending.delete(key(sessionID, event.data.inputID))
        if (!input) return { ...result([...source]), missing: event.data.inputID }
        if (input.type === "user")
          return append({
            id: event.data.inputID,
            type: "user",
            metadata: input.data.metadata,
            text: input.data.text,
            files: input.data.files,
            agents: input.data.agents,
            time: { created: event.created },
          })
        return append({
          id: event.data.inputID,
          type: "synthetic",
          metadata: input.data.metadata,
          text: input.data.text,
          description: input.data.description,
          time: { created: event.created },
        })
      }
      case "session.agent.selected":
        return append({
          id: messageID(event.id),
          type: "agent-switched",
          metadata: event.metadata,
          agent: event.data.agent,
          time: { created: event.created },
        })
      case "session.model.selected":
        return append({
          id: messageID(event.id),
          type: "model-switched",
          metadata: event.metadata,
          model: event.data.model,
          previous: source.findLast(
            (item): item is Extract<SessionMessageInfo, { type: "model-switched" | "assistant" }> =>
              item.type === "model-switched" || item.type === "assistant",
          )?.model,
          time: { created: event.created },
        })
      case "session.synthetic":
        return append({
          id: messageID(event.id),
          type: "synthetic",
          metadata: event.data.metadata,
          text: event.data.text,
          description: event.data.description,
          time: { created: event.created },
        })
      case "session.skill.activated":
        return append({
          id: messageID(event.id),
          type: "skill",
          metadata: event.metadata,
          skill: event.data.id,
          name: event.data.name,
          text: event.data.text,
          time: { created: event.created },
        })
      case "session.shell.started":
        return append({
          id: messageID(event.id),
          type: "shell",
          metadata: event.metadata,
          shellID: event.data.shell.id,
          command: event.data.shell.command,
          status: event.data.shell.status,
          exit: event.data.shell.exit,
          time: { created: event.created },
        })
      case "session.shell.ended":
        return updateMessage<Shell>(
          source,
          (item): item is Shell => item.type === "shell" && item.shellID === event.data.shell.id,
          (item) => ({
            ...item,
            status: event.data.shell.status,
            exit: event.data.shell.exit,
            output: event.data.output,
            time: { ...item.time, completed: event.created },
          }),
          sessionID,
        )
      case "session.step.started": {
        const current = source.findLast((item): item is Assistant => item.type === "assistant" && !item.time.completed)
        const completed =
          current && current.id !== event.data.assistantMessageID
            ? update(source, current.id, (item) =>
                item.type === "assistant"
                  ? { ...item, retry: undefined, time: { ...item.time, completed: event.created } }
                  : item,
              )
            : [...source]
        const existing = completed.find((item) => item.id === event.data.assistantMessageID)
        if (existing?.type === "assistant")
          return result(
            update(completed, existing.id, (item) =>
              item.type === "assistant"
                ? {
                    ...item,
                    agent: event.data.agent,
                    model: event.data.model,
                    retry: undefined,
                    error: undefined,
                    finish: undefined,
                    snapshot: event.data.snapshot ? { ...item.snapshot, start: event.data.snapshot } : item.snapshot,
                    time: { ...item.time, completed: undefined },
                  }
                : item,
            ),
            current && current.id !== existing.id ? [current.id, existing.id] : [existing.id],
          )
        return result(
          [
            ...completed,
            {
              id: event.data.assistantMessageID,
              type: "assistant",
              metadata: event.metadata,
              agent: event.data.agent,
              model: event.data.model,
              content: [],
              snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
              time: { created: event.created },
            },
          ],
          current ? [current.id, event.data.assistantMessageID] : [event.data.assistantMessageID],
        )
      }
      case "session.step.ended":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          finish: event.data.finish,
          cost: event.data.cost,
          tokens: event.data.tokens,
          snapshot:
            event.data.snapshot || event.data.files
              ? { ...item.snapshot, end: event.data.snapshot, files: event.data.files }
              : item.snapshot,
          time: { ...item.time, completed: event.created },
        }))
      case "session.step.failed":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          finish: "error",
          error: event.data.error,
          retry: undefined,
          cost: event.data.cost ?? item.cost,
          tokens: event.data.tokens ?? item.tokens,
          snapshot:
            event.data.snapshot || event.data.files
              ? { ...item.snapshot, end: event.data.snapshot, files: event.data.files }
              : item.snapshot,
          time: { ...item.time, completed: event.created },
        }))
      case "session.text.started":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: insertOrdinal(item.content, "text", event.data.ordinal, { type: "text", text: "" }),
        }))
      case "session.text.delta":
        return updateContent(source, event.data.assistantMessageID, sessionID, "text", event.data.ordinal, (item) => ({
          ...item,
          text: item.text + event.data.delta,
        }))
      case "session.text.ended":
        return updateContent(source, event.data.assistantMessageID, sessionID, "text", event.data.ordinal, (item) => ({
          ...item,
          text: event.data.text,
        }))
      case "session.reasoning.started":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: insertOrdinal(item.content, "reasoning", event.data.ordinal, {
            type: "reasoning",
            text: "",
            state: event.data.state,
            time: { created: event.created },
          }),
        }))
      case "session.reasoning.delta":
        return updateContent(
          source,
          event.data.assistantMessageID,
          sessionID,
          "reasoning",
          event.data.ordinal,
          (item) => ({
            ...item,
            text: item.text + event.data.delta,
          }),
        )
      case "session.reasoning.ended":
        return updateContent(
          source,
          event.data.assistantMessageID,
          sessionID,
          "reasoning",
          event.data.ordinal,
          (item) => ({
            ...item,
            text: event.data.text,
            state: event.data.state ?? item.state,
            time: { created: item.time?.created ?? event.created, completed: event.created },
          }),
        )
      case "session.tool.input.started":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: item.content.some((content) => content.type === "tool" && content.id === event.data.callID)
            ? item.content
            : [
                ...item.content,
                {
                  type: "tool",
                  id: event.data.callID,
                  name: event.data.name,
                  state: { status: "streaming", input: "" },
                  time: { created: event.created },
                },
              ],
        }))
      case "session.tool.input.delta":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "streaming"
            ? { ...tool, state: { ...tool.state, input: tool.state.input + event.data.delta } }
            : tool,
        )
      case "session.tool.input.ended":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "streaming" ? { ...tool, state: { ...tool.state, input: event.data.text } } : tool,
        )
      case "session.tool.called":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => ({
          ...tool,
          executed: event.data.executed,
          providerState: event.data.state,
          // structured: {}, content: []
          state: { status: "running", input: event.data.input, metadata: {} },
          time: { ...tool.time, ran: event.created },
        }))
      case "session.tool.progress":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "running"
            ? {
                ...tool,
                // state: { ...tool.state, structured: event.data.structured, content: event.data.content },
                state: { ...tool.state, metadata: mediaMetadata(tool.name, event.data) ?? event.data.metadata },
              }
            : tool,
        )
      case "session.tool.success":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => {
          if (tool.state.status !== "running") return tool
          return {
            ...tool,
            executed: event.data.executed || tool.executed === true,
            providerResultState: event.data.resultState,
            state: {
              status: "completed",
              input: tool.state.input,
              // structured: event.data.structured,
              metadata: mediaMetadata(tool.name, event.data) ?? event.data.metadata,
              content: event.data.content,
              // result: event.data.result,
            },
            time: { ...tool.time, completed: event.created },
          }
        })
      case "session.tool.failed":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => {
          if (tool.state.status !== "streaming" && tool.state.status !== "running") return tool
          return {
            ...tool,
            executed: event.data.executed || tool.executed === true,
            providerResultState: event.data.resultState,
            state: {
              status: "error",
              input: typeof tool.state.input === "string" ? {} : tool.state.input,
              // structured: tool.state.status === "running" ? tool.state.structured : {},
              metadata: event.data.metadata ?? (tool.state.status === "running" ? tool.state.metadata : {}),
              content: event.data.content,
              error: event.data.error,
              // result: event.data.result,
            },
            time: { ...tool.time, completed: event.created },
          }
        })
      case "session.retry.scheduled":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          retry: { attempt: event.data.attempt, at: event.data.at, error: event.data.error },
        }))
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        const current = source.findLast((item): item is Assistant => item.type === "assistant" && !item.time.completed)
        if (!current?.retry) return result([...source])
        return updateAssistant(source, current.id, sessionID, (item) => ({ ...item, retry: undefined }))
      }
      case "session.compaction.started":
        return append({
          id: event.data.inputID ?? messageID(event.id),
          type: "compaction",
          status: "running",
          metadata: event.metadata,
          reason: event.data.reason,
          summary: "",
          recent: event.data.recent,
          time: { created: event.created },
        })
      case "session.compaction.delta":
        return updateMessage<Extract<Compaction, { status: "running" }>>(
          source,
          (item): item is Extract<Compaction, { status: "running" }> =>
            item.type === "compaction" && item.status === "running",
          (item) => ({
            ...item,
            summary: item.summary + event.data.text,
          }),
          sessionID,
        )
      case "session.compaction.ended": {
        const current = source.findLast(
          (item): item is Extract<Compaction, { status: "running" }> =>
            item.type === "compaction" && item.status === "running",
        )
        if (!current)
          return append({
            id: messageID(event.id),
            type: "compaction",
            status: "completed",
            metadata: event.metadata,
            reason: event.data.reason,
            summary: event.data.text,
            recent: event.data.recent,
            time: { created: event.created },
          })
        return result(
          update(source, current.id, () => ({
            ...current,
            status: "completed",
            reason: event.data.reason,
            summary: event.data.text,
            recent: event.data.recent,
          })),
          [current.id],
        )
      }
      case "session.compaction.failed": {
        const current = source.findLast(
          (item): item is Extract<Compaction, { status: "running" }> =>
            item.type === "compaction" && item.status === "running",
        )
        const failed: Extract<Compaction, { status: "failed" }> = {
          id: current?.id ?? event.data.inputID ?? messageID(event.id),
          type: "compaction",
          status: "failed",
          metadata: current?.metadata ?? event.metadata,
          reason: event.data.reason,
          error: event.data.error,
          time: current?.time ?? { created: event.created },
        }
        if (!current) return append(failed)
        return result(
          update(source, current.id, () => failed),
          [failed.id],
        )
      }
      case "session.revert.committed": {
        const index = source.findIndex((item) => item.id === event.data.to)
        if (index < 0) return result([...source])
        return {
          sessionID,
          messages: source.slice(0, index),
          touched: [],
          removed: source.slice(index).map((item) => item.id),
        }
      }
      default:
        return
    }
  }

  return {
    reduce,
    clear(sessionID: string) {
      for (const id of pending.keys()) {
        if (id.startsWith(`${sessionID}:`)) pending.delete(id)
      }
    },
  }
}

function key(sessionID: string, inputID: string) {
  return `${sessionID}:${inputID}`
}

function messageID(eventID: string) {
  return eventID.replace(/^evt_/, "msg_")
}

function update(
  source: readonly SessionMessageInfo[],
  id: string,
  apply: (item: SessionMessageInfo) => SessionMessageInfo,
) {
  return source.map((item) => (item.id === id ? apply(item) : item))
}

function updateMessage<T extends SessionMessageInfo>(
  source: readonly SessionMessageInfo[],
  matches: (item: SessionMessageInfo) => item is T,
  apply: (item: T) => T,
  sessionID: string,
): V2SessionReduction {
  const current = source.findLast(matches)
  if (!current) return { sessionID, messages: [...source], touched: [] }
  return {
    sessionID,
    messages: update(source, current.id, (item) => (matches(item) ? apply(item) : item)),
    touched: [current.id],
  }
}

function updateAssistant(
  source: readonly SessionMessageInfo[],
  id: string,
  sessionID: string,
  apply: (item: Assistant) => Assistant,
): V2SessionReduction {
  return {
    sessionID,
    messages: update(source, id, (item) => (item.type === "assistant" ? apply(item) : item)),
    touched: source.some((item) => item.id === id && item.type === "assistant") ? [id] : [],
  }
}

function updateContent<T extends "text" | "reasoning">(
  source: readonly SessionMessageInfo[],
  messageID: string,
  sessionID: string,
  type: T,
  ordinal: number,
  apply: (
    item: Extract<Assistant["content"][number], { type: T }>,
  ) => Extract<Assistant["content"][number], { type: T }>,
) {
  return updateAssistant(source, messageID, sessionID, (assistant) => {
    let index = -1
    return {
      ...assistant,
      content: assistant.content.map((item) => {
        if (item.type !== type || ++index !== ordinal) return item
        return apply(item as Extract<Assistant["content"][number], { type: T }>)
      }),
    }
  })
}

function updateTool(
  source: readonly SessionMessageInfo[],
  messageID: string,
  callID: string,
  sessionID: string,
  apply: (
    item: Extract<Assistant["content"][number], { type: "tool" }>,
  ) => Extract<Assistant["content"][number], { type: "tool" }>,
) {
  return updateAssistant(source, messageID, sessionID, (assistant) => ({
    ...assistant,
    content: assistant.content.map((item) => (item.type === "tool" && item.id === callID ? apply(item) : item)),
  }))
}

function insertOrdinal<T extends Assistant["content"][number]["type"]>(
  source: Assistant["content"],
  type: T,
  ordinal: number,
  item: Extract<Assistant["content"][number], { type: T }>,
) {
  const matches = source.filter((content) => content.type === type)
  if (matches[ordinal]) return source
  return [...source, item]
}

function reduceNext(
  source: readonly SessionMessageInfo[],
  event: {
    id: string
    type: string
    created?: number
    metadata?: SessionMessageInfo["metadata"]
    data: Record<string, unknown>
  },
  sessionID: string,
  timestamp: number,
  result: (messages: SessionMessageInfo[], touched?: string[]) => V2SessionReduction,
  append: (message: SessionMessageInfo) => V2SessionReduction,
): V2SessionReduction | undefined {
  const data = event.data
  switch (event.type) {
    case "session.next.prompt.admitted":
    case "session.next.prompt.withdrawn":
    case "session.next.history.copy.started":
    case "session.next.history.copy.completed":
    case "session.next.context.updated":
    case "session.next.moved":
      return result([...source])
    case "session.next.history.copy.message": {
      const message = data.message as SessionMessageInfo | undefined
      if (!message || typeof message.id !== "string") return result([...source])
      return append(message)
    }
    case "session.next.prompted": {
      const prompt = (data.prompt as { text?: string; files?: unknown[]; agents?: unknown[] } | undefined) ?? {}
      return append({
        id: String(data.messageID ?? messageID(event.id)),
        type: "user",
        metadata: event.metadata,
        text: typeof prompt.text === "string" ? prompt.text : "",
        files: prompt.files as Extract<SessionMessageInfo, { type: "user" }>["files"],
        agents: prompt.agents as Extract<SessionMessageInfo, { type: "user" }>["agents"],
        time: { created: timestamp },
      })
    }
    case "session.next.agent.switched":
      return append({
        id: String(data.messageID ?? messageID(event.id)),
        type: "agent-switched",
        metadata: event.metadata,
        agent: String(data.agent ?? ""),
        time: { created: timestamp },
      })
    case "session.next.model.switched":
      return append({
        id: String(data.messageID ?? messageID(event.id)),
        type: "model-switched",
        metadata: event.metadata,
        model: data.model as Extract<SessionMessageInfo, { type: "model-switched" }>["model"],
        previous: source.findLast(
          (item): item is Extract<SessionMessageInfo, { type: "model-switched" | "assistant" }> =>
            item.type === "model-switched" || item.type === "assistant",
        )?.model,
        time: { created: timestamp },
      })
    case "session.next.synthetic":
      return append({
        id: String(data.messageID ?? messageID(event.id)),
        type: "synthetic",
        metadata: event.metadata,
        text: String(data.text ?? ""),
        description: typeof data.description === "string" ? data.description : undefined,
        time: { created: timestamp },
      })
    case "session.next.shell.started":
      return append({
        id: String(data.messageID ?? messageID(event.id)),
        type: "shell",
        metadata: event.metadata,
        shellID: String(data.callID ?? ""),
        command: String(data.command ?? ""),
        status: "running",
        time: { created: timestamp },
      })
    case "session.next.shell.ended": {
      const callID = String(data.callID ?? "")
      const rawOutput = data.output
      const output =
        typeof rawOutput === "string"
          ? { output: rawOutput, cursor: rawOutput.length, size: rawOutput.length, truncated: false }
          : (rawOutput as Shell["output"])
      return updateMessage<Shell>(
        source,
        (item): item is Shell =>
          item.type === "shell" &&
          (item.shellID === callID || ("callID" in item && (item as { callID?: string }).callID === callID)),
        (item) => ({
          ...item,
          status: "exited",
          output,
          time: { ...item.time, completed: timestamp },
        }),
        sessionID,
      )
    }
    case "session.next.step.started": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const current = source.findLast((item): item is Assistant => item.type === "assistant" && !item.time.completed)
      const completed =
        current && current.id !== assistantMessageID
          ? update(source, current.id, (item) =>
              item.type === "assistant"
                ? { ...item, retry: undefined, time: { ...item.time, completed: timestamp } }
                : item,
            )
          : [...source]
      const existing = completed.find((item) => item.id === assistantMessageID)
      const snapshot = typeof data.snapshot === "string" ? data.snapshot : undefined
      if (existing?.type === "assistant")
        return result(
          update(completed, existing.id, (item) =>
            item.type === "assistant"
              ? {
                  ...item,
                  agent: String(data.agent ?? item.agent),
                  model: (data.model as Assistant["model"]) ?? item.model,
                  retry: undefined,
                  error: undefined,
                  finish: undefined,
                  snapshot: snapshot ? { ...item.snapshot, start: snapshot } : item.snapshot,
                  time: { ...item.time, completed: undefined },
                }
              : item,
          ),
          current && current.id !== existing.id ? [current.id, existing.id] : [existing.id],
        )
      return result(
        [
          ...completed,
          {
            id: assistantMessageID,
            type: "assistant",
            metadata: event.metadata,
            agent: String(data.agent ?? ""),
            model: data.model as Assistant["model"],
            content: [],
            snapshot: snapshot ? { start: snapshot } : undefined,
            time: { created: timestamp },
          },
        ],
        current ? [current.id, assistantMessageID] : [assistantMessageID],
      )
    }
    case "session.next.step.ended": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const snapshot = typeof data.snapshot === "string" ? data.snapshot : undefined
      const files = Array.isArray(data.files) ? (data.files as NonNullable<Assistant["snapshot"]>["files"]) : undefined
      return updateAssistant(source, assistantMessageID, sessionID, (item) => ({
        ...item,
        finish: data.finish as Assistant["finish"],
        cost: typeof data.cost === "number" ? data.cost : item.cost,
        tokens: (data.tokens as Assistant["tokens"]) ?? item.tokens,
        snapshot: snapshot || files ? { ...item.snapshot, end: snapshot, files } : item.snapshot,
        time: { ...item.time, completed: timestamp },
      }))
    }
    case "session.next.step.failed": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      return updateAssistant(source, assistantMessageID, sessionID, (item) => ({
        ...item,
        finish: "error",
        error: data.error as Assistant["error"],
        retry: undefined,
        time: { ...item.time, completed: timestamp },
      }))
    }
    case "session.next.text.started": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const textID = String(data.textID ?? "")
      return updateAssistant(source, assistantMessageID, sessionID, (item) => ({
        ...item,
        content: hasContentByID(item.content, "text", textID)
          ? item.content
          : [...item.content, { type: "text", id: textID, text: "" } as Assistant["content"][number]],
      }))
    }
    case "session.next.text.delta": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const textID = String(data.textID ?? "")
      const delta = String(data.delta ?? "")
      return updateContentByID(source, assistantMessageID, sessionID, "text", textID, (item) => ({
        ...item,
        text: item.text + delta,
      }))
    }
    case "session.next.text.ended": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const textID = String(data.textID ?? "")
      const text = String(data.text ?? "")
      return updateContentByID(source, assistantMessageID, sessionID, "text", textID, (item) => ({
        ...item,
        text,
      }))
    }
    case "session.next.reasoning.started": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const reasoningID = String(data.reasoningID ?? "")
      return updateAssistant(source, assistantMessageID, sessionID, (item) => ({
        ...item,
        content: hasContentByID(item.content, "reasoning", reasoningID)
          ? item.content
          : [
              ...item.content,
              {
                type: "reasoning",
                id: reasoningID,
                text: "",
                state: data.providerMetadata as AssistantReasoning["state"],
                time: { created: timestamp },
              } as Assistant["content"][number],
            ],
      }))
    }
    case "session.next.reasoning.delta": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const reasoningID = String(data.reasoningID ?? "")
      const delta = String(data.delta ?? "")
      return updateContentByID(source, assistantMessageID, sessionID, "reasoning", reasoningID, (item) => ({
        ...item,
        text: item.text + delta,
      }))
    }
    case "session.next.reasoning.ended": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const reasoningID = String(data.reasoningID ?? "")
      const text = String(data.text ?? "")
      return updateContentByID(source, assistantMessageID, sessionID, "reasoning", reasoningID, (item) => ({
        ...item,
        text,
        state: (data.providerMetadata as AssistantReasoning["state"]) ?? item.state,
        time: { created: item.time?.created ?? timestamp, completed: timestamp },
      }))
    }
    case "session.next.tool.input.started": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const callID = String(data.callID ?? "")
      const name = String(data.name ?? "")
      return updateAssistant(source, assistantMessageID, sessionID, (item) => ({
        ...item,
        content: item.content.some((content) => content.type === "tool" && content.id === callID)
          ? item.content
          : [
              ...item.content,
              {
                type: "tool",
                id: callID,
                name,
                state: { status: "streaming", input: "" },
                time: { created: timestamp },
              },
            ],
      }))
    }
    case "session.next.tool.input.delta": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const callID = String(data.callID ?? "")
      const delta = String(data.delta ?? "")
      return updateTool(source, assistantMessageID, callID, sessionID, (tool) =>
        tool.state.status === "streaming"
          ? { ...tool, state: { ...tool.state, input: tool.state.input + delta } }
          : tool,
      )
    }
    case "session.next.tool.input.ended": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const callID = String(data.callID ?? "")
      const text = String(data.text ?? "")
      return updateTool(source, assistantMessageID, callID, sessionID, (tool) =>
        tool.state.status === "streaming" ? { ...tool, state: { ...tool.state, input: text } } : tool,
      )
    }
    case "session.next.tool.called": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const callID = String(data.callID ?? "")
      const provider = data.provider as { executed?: boolean; metadata?: ProviderState } | undefined
      return updateAssistant(source, assistantMessageID, sessionID, (assistant) => {
        const exists = assistant.content.some((item) => item.type === "tool" && item.id === callID)
        const nextInput = (data.input as Extract<AssistantTool["state"], { status: "running" }>["input"]) ?? {}
        const content: Assistant["content"] = exists
          ? assistant.content.map((item): Assistant["content"][number] =>
              item.type === "tool" && item.id === callID
                ? {
                    ...item,
                    executed: provider?.executed,
                    providerState: provider?.metadata,
                    state: {
                      status: "running",
                      input: nextInput,
                      metadata: {},
                    },
                    time: { ...item.time, ran: timestamp },
                  }
                : item,
            )
          : [
              ...assistant.content,
              {
                type: "tool",
                id: callID,
                name: String(data.tool ?? "tool"),
                executed: provider?.executed,
                providerState: provider?.metadata,
                state: {
                  status: "running",
                  input: nextInput,
                  metadata: {},
                },
                time: { created: timestamp, ran: timestamp },
              },
            ]
        return { ...assistant, content }
      })
    }
    case "session.next.tool.progress": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const callID = String(data.callID ?? "")
      return updateTool(source, assistantMessageID, callID, sessionID, (tool) =>
        tool.state.status === "running"
          ? {
              ...tool,
              state: {
                ...tool.state,
                metadata:
                  ((mediaMetadata(tool.name, data) ?? data.structured) as ToolRunningMetadata | undefined) ??
                  tool.state.metadata,
              },
            }
          : tool,
      )
    }
    case "session.next.tool.success": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const callID = String(data.callID ?? "")
      const provider = data.provider as { executed?: boolean; metadata?: ProviderState } | undefined
      return updateTool(source, assistantMessageID, callID, sessionID, (tool) => {
        if (tool.state.status !== "running" && tool.state.status !== "streaming") return tool
        return {
          ...tool,
          executed: Boolean(provider?.executed) || tool.executed === true,
          providerResultState: provider?.metadata,
          state: {
            status: "completed",
            input: typeof tool.state.input === "string" ? {} : tool.state.input,
            metadata: ((mediaMetadata(tool.name, data) ?? data.structured) as ToolRunningMetadata | undefined) ?? {},
            content: (data.content as Extract<typeof tool.state, { status: "completed" }>["content"]) ?? [],
          },
          time: { ...tool.time, completed: timestamp },
        }
      })
    }
    case "session.next.tool.failed": {
      const assistantMessageID = String(data.assistantMessageID ?? "")
      const callID = String(data.callID ?? "")
      const provider = data.provider as { executed?: boolean; metadata?: ProviderState } | undefined
      return updateTool(source, assistantMessageID, callID, sessionID, (tool) => {
        if (tool.state.status !== "streaming" && tool.state.status !== "running") return tool
        return {
          ...tool,
          executed: Boolean(provider?.executed) || tool.executed === true,
          providerResultState: provider?.metadata,
          state: {
            status: "error",
            input: typeof tool.state.input === "string" ? {} : tool.state.input,
            metadata: tool.state.status === "running" ? tool.state.metadata : {},
            content: (data.content ?? []) as unknown as Extract<typeof tool.state, { status: "error" }>["content"],
            error: data.error as Extract<typeof tool.state, { status: "error" }>["error"],
          },
          time: { ...tool.time, completed: timestamp },
        }
      })
    }
    case "session.next.retried": {
      const current = source.findLast((item): item is Assistant => item.type === "assistant" && !item.time.completed)
      if (!current) return result([...source])
      return updateAssistant(source, current.id, sessionID, (item) => ({
        ...item,
        retry: {
          attempt: Number(data.attempt ?? 1),
          at: timestamp + 1000,
          error: data.error as NonNullable<Assistant["retry"]>["error"],
        },
      }))
    }
    case "session.next.input.execution.settled": {
      const current = source.findLast((item): item is Assistant => item.type === "assistant" && !item.time.completed)
      if (!current?.retry) return result([...source])
      return updateAssistant(source, current.id, sessionID, (item) => ({ ...item, retry: undefined }))
    }
    case "session.next.compaction.started":
      return append({
        id: String(data.messageID ?? messageID(event.id)),
        type: "compaction",
        status: "running",
        metadata: event.metadata,
        reason: data.reason as Compaction["reason"],
        summary: "",
        recent: String(data.recent ?? ""),
        time: { created: timestamp },
      })
    case "session.next.compaction.delta":
      return updateMessage<Extract<Compaction, { status: "running" }>>(
        source,
        (item): item is Extract<Compaction, { status: "running" }> =>
          item.type === "compaction" && item.status === "running",
        (item) => ({
          ...item,
          summary: item.summary + String(data.text ?? ""),
        }),
        sessionID,
      )
    case "session.next.compaction.ended": {
      const current = source.findLast(
        (item): item is Extract<Compaction, { status: "running" }> =>
          item.type === "compaction" && item.status === "running",
      )
      if (!current)
        return append({
          id: String(data.messageID ?? messageID(event.id)),
          type: "compaction",
          status: "completed",
          metadata: event.metadata,
          reason: data.reason as Compaction["reason"],
          summary: String(data.text ?? ""),
          recent: data.recent as Extract<Compaction, { status: "completed" }>["recent"],
          time: { created: timestamp },
        })
      return result(
        update(source, current.id, () => ({
          ...current,
          status: "completed",
          reason: data.reason as Compaction["reason"],
          summary: String(data.text ?? ""),
          recent: data.recent as Extract<Compaction, { status: "completed" }>["recent"],
        })),
        [current.id],
      )
    }
    case "session.next.revert.committed": {
      const targetID = String(data.messageID ?? "")
      const index = source.findIndex((item) => item.id === targetID)
      if (index < 0) return result([...source])
      return {
        sessionID,
        messages: source.slice(0, index),
        touched: [],
        removed: source.slice(index).map((item) => item.id),
      }
    }
    default:
      return
  }
}

function hasContentByID(source: Assistant["content"], type: "text" | "reasoning", id: string) {
  return source.some((item) => item.type === type && (item as { id?: string }).id === id)
}

function updateContentByID<T extends "text" | "reasoning">(
  source: readonly SessionMessageInfo[],
  messageID: string,
  sessionID: string,
  type: T,
  id: string,
  apply: (
    item: Extract<Assistant["content"][number], { type: T }>,
  ) => Extract<Assistant["content"][number], { type: T }>,
) {
  return updateAssistant(source, messageID, sessionID, (assistant) => {
    const targetIndex = assistant.content.findLastIndex(
      (item) => item.type === type && ((item as { id?: string }).id === id || !(item as { id?: string }).id),
    )
    if (targetIndex < 0) {
      const initial =
        type === "text"
          ? ({ type: "text", id, text: "" } as unknown as Extract<Assistant["content"][number], { type: T }>)
          : ({ type: "reasoning", id, text: "" } as unknown as Extract<Assistant["content"][number], { type: T }>)
      return {
        ...assistant,
        content: [...assistant.content, apply(initial)],
      }
    }
    return {
      ...assistant,
      content: assistant.content.map((item, index) =>
        index === targetIndex ? apply(item as Extract<Assistant["content"][number], { type: T }>) : item,
      ),
    }
  })
}

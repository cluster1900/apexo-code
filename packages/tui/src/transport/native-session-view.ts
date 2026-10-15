import { SessionEvent } from "@apexo/core/session/event"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionMessageUpdater } from "@apexo/core/session/message-updater"
import type { AssistantMessage, FilePart, Message, Part, ToolPart } from "@apexo/sdk/v2"
import { Effect, Option, Schema } from "effect"

const encode = Schema.encodeSync(SessionMessage.Message)
const decode = Schema.decodeUnknownSync(SessionEvent.All)
const parseInput = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
type Source = typeof SessionMessage.Message.Encoded

export type TerminalMessage = { info: Message; parts: Part[] }

// This is the same in-memory projection used by Core, not a second event reducer.
// The surrounding transport serializes replay and live delivery before calling it.
export function nativeSessionView(sessionID: string, directory: string) {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const adapter = SessionMessageUpdater.memory(state)
  const seen = new Set<string>()
  const settled = new Set<string>()
  const cursor = { seq: 0 }
  return {
    reset() {
      state.messages.length = 0
      seen.clear()
      settled.clear()
      cursor.seq = 0
    },
    get sequence() {
      return cursor.seq
    },
    apply(value: unknown) {
      const event = decode(value)
      if (event.data.sessionID !== sessionID) return false
      if (seen.has(event.id) || (event.durable && event.durable.seq <= cursor.seq)) return false
      const fragment = fragmentKey(event)
      if (fragment && event.type.endsWith(".delta") && settled.has(fragment)) return false
      Effect.runSync(SessionMessageUpdater.update(adapter, event))
      if (fragment && event.type.endsWith(".ended")) settled.add(fragment)
      if (event.durable) cursor.seq = event.durable.seq
      seen.add(event.id)
      if (seen.size > 2048) seen.delete(seen.values().next().value!)
      return true
    },
    snapshot() {
      return terminalMessages(
        sessionID,
        directory,
        state.messages.map((message) => encode(message)),
      )
    },
  }
}

function fragmentKey(event: SessionEvent.Event) {
  if ("textID" in event.data) return `${event.data.assistantMessageID}:text:${event.data.textID}`
  if ("reasoningID" in event.data) return `${event.data.assistantMessageID}:reasoning:${event.data.reasoningID}`
  if (event.type.startsWith("session.next.tool.input.") && "callID" in event.data && "assistantMessageID" in event.data)
    return `${event.data.assistantMessageID}:input:${event.data.callID}`
}

// Only presentation data is converted. Native message/tool identities and full values
// remain authoritative, and no generated view event is sent back to the server.
export function terminalMessages(sessionID: string, directory: string, source: readonly Source[]): TerminalMessage[] {
  const current = {
    agent: "",
    model: { id: "", providerID: "", variant: undefined as string | undefined },
    parentID: "",
  }
  return source.flatMap((message): TerminalMessage[] => {
    if (message.type === "agent-switched") {
      current.agent = message.agent
      return []
    }
    if (message.type === "model-switched") {
      current.model = { ...message.model, variant: message.model.variant ?? undefined }
      return []
    }
    if (message.type === "user") {
      current.parentID = message.id
      return [
        {
          info: {
            id: message.id,
            sessionID,
            role: "user",
            time: message.time,
            agent: current.agent,
            model: { providerID: current.model.providerID, modelID: current.model.id, variant: current.model.variant },
          },
          parts: [
            { id: `${message.id}:text`, sessionID, messageID: message.id, type: "text", text: message.text },
            ...(message.files ?? []).map(
              (file, index): FilePart => ({
                id: `${message.id}:file:${index}`,
                sessionID,
                messageID: message.id,
                type: "file",
                mime: file.mime,
                filename: file.name ?? undefined,
                url: file.uri,
              }),
            ),
            ...(message.agents ?? []).map(
              (agent, index): Part => ({
                id: `${message.id}:agent:${index}`,
                sessionID,
                messageID: message.id,
                type: "agent",
                name: agent.name,
                source: agent.source
                  ? { value: agent.source.text, start: agent.source.start, end: agent.source.end }
                  : undefined,
              }),
            ),
          ],
        },
      ]
    }
    if (message.type !== "assistant") return []
    current.agent = message.agent
    current.model = { ...message.model, variant: message.model.variant ?? undefined }
    const info: AssistantMessage = {
      id: message.id,
      sessionID,
      role: "assistant",
      parentID: current.parentID,
      time: { created: message.time.created, completed: message.time.completed ?? undefined },
      modelID: message.model.id,
      providerID: message.model.providerID,
      variant: message.model.variant ?? undefined,
      mode: message.agent,
      agent: message.agent,
      path: { cwd: directory, root: directory },
      cost: message.cost ?? 0,
      tokens: message.tokens ?? tokens,
      finish: message.finish ?? undefined,
      error: message.error ? { name: "UnknownError", data: { message: message.error.message } } : undefined,
    }
    return [
      {
        info,
        parts: message.content.map((part): Part => {
          const base = { id: part.id, sessionID, messageID: message.id }
          if (part.type === "text")
            return {
              ...base,
              type: "text",
              text: part.text,
              time: { start: message.time.created, end: message.time.completed ?? undefined },
            }
          if (part.type === "reasoning")
            return {
              ...base,
              type: "reasoning",
              text: part.text,
              time: { start: part.time?.created ?? message.time.created, end: part.time?.completed ?? undefined },
            }
          const start = part.time.ran ?? part.time.created
          const state: ToolPart["state"] = (() => {
            if (part.state.status === "pending") {
              const parsed = Option.getOrUndefined(parseInput(part.state.input))
              const input = record(parsed) ? parsed : {}
              return { status: "pending", input, raw: part.state.input }
            }
            if (part.state.status === "running")
              return {
                status: "running",
                input: part.state.input,
                metadata: part.state.structured,
                time: { start },
              }
            if (part.state.status === "error")
              return {
                status: "error",
                input: part.state.input,
                error: part.state.error.message,
                metadata: part.state.structured,
                time: { start, end: part.time.completed ?? start },
              }
            return {
              status: "completed",
              input: part.state.input,
              output: part.state.content
                .flatMap((content) => (content.type === "text" ? [content.text] : []))
                .join("\n"),
              title: part.name,
              metadata: part.state.structured,
              time: { start, end: part.time.completed ?? start },
              attachments: part.state.attachments?.map((file, index) => ({
                id: `${part.id}:file:${index}`,
                sessionID,
                messageID: message.id,
                type: "file" as const,
                mime: file.mime,
                filename: file.name ?? undefined,
                url: file.uri,
              })),
            }
          })()
          return { ...base, type: "tool", callID: part.id, tool: part.name, state }
        }),
      },
    ]
  })
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

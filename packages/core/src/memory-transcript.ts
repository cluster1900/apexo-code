export * as MemoryTranscript from "./memory-transcript"

import { Event } from "@apexo/schema/event"
import { Schema } from "effect"
import { SessionV1 } from "./v1/session"

export const Source = Schema.Struct({
  version: Schema.Literal(1),
  createdEventID: Schema.optional(Event.ID),
  user: SessionV1.User,
  transcript: Schema.String,
})
export const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Source))

// Durable message IDs, rather than filtered-history offsets, deduplicate
// admission after compaction, retries and process restarts.
export function turns(messages: SessionV1.WithParts[], interrupted = false, createdEventID?: Event.ID) {
  return messages.flatMap((message, index) => {
    if (message.info.role !== "user") return []
    const text = message.parts
      .flatMap((part) =>
        part.type === "file"
          ? [`[Attachment: ${part.filename ?? part.mime}]`]
          : part.type === "text" && !part.synthetic && !part.ignored && part.text.trim()
            ? [part.text.trim()]
            : [],
      )
      .join("\n")
    if (!text || /^[/!]/.test(text)) return []
    const boundary = messages.findIndex((next, position) => position > index && next.info.role === "user")
    const window = messages.slice(index, boundary < 0 ? undefined : boundary)
    const assistants = window.filter((next) => next.info.role === "assistant" && next.info.parentID === message.info.id)
    const last = assistants.at(-1)
    if (!last || last.info.role !== "assistant") return []
    if (last.parts.some((part) => part.type === "tool" && ["pending", "running"].includes(part.state.status))) return []
    if (last.info.error && last.info.error.name !== "MessageAbortedError") return []
    const cancelled = interrupted && message.info.id === messages.findLast((item) => item.info.role === "user")?.info.id
    if (!cancelled && !last.info.error && last.info.finish !== "stop") return []
    const transcript = [message, ...assistants]
      .map((next) => {
        const body = next.parts
          .flatMap((part) => {
            if (part.type === "file") return [`[Attachment: ${part.filename ?? part.mime}]`]
            if (part.type === "text" && !part.ignored && !part.synthetic) return [bounded(part.text, 12 * 1024)]
            if (part.type !== "tool") return []
            return [
              `Tool ${part.tool}\nInput: ${bounded(JSON.stringify(part.state.input), 2048)}\nResult: ${bounded(
                part.state.status === "completed"
                  ? part.state.output
                  : part.state.status === "error"
                    ? part.state.error
                    : "",
                4096,
              )}`,
            ]
          })
          .join("\n")
        return `${next.info.role}:\n${body}`
      })
      .join("\n\n")
    return [
      {
        promptID: message.info.id,
        promptIndex: index,
        source: JSON.stringify({
          version: 1,
          ...(createdEventID ? { createdEventID } : {}),
          user: {
            id: message.info.id,
            sessionID: message.info.sessionID,
            role: "user",
            time: message.info.time,
            agent: message.info.agent,
            model: message.info.model,
          },
          transcript: bounded(transcript, 96 * 1024),
        }),
      },
    ]
  })
}

function bounded(text: string, bytes: number) {
  if (Buffer.byteLength(text) <= bytes) return text
  return (
    Buffer.from(text)
      .subarray(0, bytes)
      .toString("utf8")
      .replace(/\ufffd$/, "") + "\n[truncated]"
  )
}

export * as MemoryTranscriptNative from "./memory-transcript-native"

import { DateTime, Schema } from "effect"
import { Event } from "@apexo/schema/event"
import { Model } from "@apexo/schema/model"
import { SessionID } from "@apexo/schema/session-id"
import { SessionMessage } from "./session/message"
import { PermissionAuthority } from "./permission/authority"

export const Source = Schema.Struct({
  version: Schema.Literal(2),
  sessionID: SessionID,
  createdEventID: Event.ID,
  promptID: SessionMessage.ID,
  assistantID: SessionMessage.ID,
  createdAt: Schema.Number,
  agent: Schema.String,
  model: Model.Ref,
  authority: Schema.Array(PermissionAuthority.Snapshot),
  terminal: Schema.Literals(["completed", "stopped"]),
  transcript: Schema.String,
})
export type Source = typeof Source.Type
export const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Source))

/** stopped is supplied only by the owned native runner after all tool fibers settle. */
export function turns(messages: readonly SessionMessage.Message[], stopped?: SessionMessage.ID) {
  return messages.flatMap((user, index) => {
    if (user.type !== "user" || (!user.text.trim() && !user.files?.length)) return []
    const next = messages.findIndex((message, position) => position > index && message.type === "user")
    const window = messages.slice(index + 1, next < 0 ? undefined : next)
    const assistants = window.filter((message) => message.type === "assistant")
    const last = assistants.at(-1)
    if (!last || !last.time.completed) return []
    if (
      assistants.some((message) =>
        message.content.some(
          (part) => part.type === "tool" && (part.state.status === "pending" || part.state.status === "running"),
        ),
      )
    )
      return []
    const terminal =
      last.id === stopped
        ? ("stopped" as const)
        : last.finish === "stop" && !last.error
          ? ("completed" as const)
          : undefined
    if (!terminal) return []
    // An agent/model transition within a tool chain must not grant extraction the later agent's authority.
    if (
      assistants.some(
        (message) => message.agent !== last.agent || JSON.stringify(message.model) !== JSON.stringify(last.model),
      )
    )
      return []
    const transcript = [
      `user:\n${bounded(user.text, 12 * 1024)}`,
      ...(user.files ?? []).map((file) => `[Attachment: ${file.name ?? file.mime}]`),
      ...assistants.flatMap((message) =>
        message.content.flatMap((part) => {
          if (part.type === "text") return [`assistant:\n${bounded(part.text, 12 * 1024)}`]
          if (part.type !== "tool") return []
          const result =
            part.state.status === "completed"
              ? part.state.content
                  .map((item) => (item.type === "text" ? item.text : `[Attachment: ${item.mime}]`))
                  .join("\n")
              : part.state.status === "error"
                ? part.state.error.message
                : ""
          return [
            `Tool ${part.name}\nInput: ${bounded(JSON.stringify(part.state.input), 2048)}\nResult: ${bounded(result, 4096)}`,
          ]
        }),
      ),
    ].join("\n\n")
    return [
      {
        promptID: user.id,
        assistantID: last.id,
        createdAt: DateTime.toEpochMillis(user.time.created),
        agent: last.agent,
        model: last.model,
        terminal,
        transcript: bounded(transcript, 96 * 1024),
      },
    ]
  })
}
function bounded(text: string, bytes: number) {
  return Buffer.byteLength(text) <= bytes
    ? text
    : Buffer.from(text)
        .subarray(0, Math.max(0, bytes - Buffer.byteLength("\n[truncated]")))
        .toString("utf8")
        .replace(/\ufffd$/, "") + "\n[truncated]"
}

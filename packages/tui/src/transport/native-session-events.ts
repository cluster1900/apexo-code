import { Permission } from "@apexo/schema/permission"
import { Question } from "@apexo/schema/question"
import type { Event, PermissionRequest, QuestionRequest } from "@apexo/sdk/v2"
import { Option, Schema } from "effect"

const decode = Schema.decodeUnknownOption(
  Schema.Union([
    Permission.Event.Asked,
    Permission.Event.Replied,
    Question.Event.Asked,
    Question.Event.Replied,
    Question.Event.Rejected,
  ]),
)

type NativePermission = typeof Permission.Request.Encoded
type NativeQuestion = typeof Question.Request.Encoded

export function terminalPermission(request: NativePermission): PermissionRequest & { approvalLifetime: "saved" } {
  return {
    id: request.id,
    sessionID: request.sessionID,
    permission: request.action,
    approvalLifetime: "saved",
    patterns: [...request.resources],
    always: [...(request.save ?? [])],
    metadata: request.metadata ?? {},
    tool: request.source ? { messageID: request.source.messageID, callID: request.source.callID } : undefined,
  }
}

export function terminalQuestion(request: NativeQuestion): QuestionRequest {
  return {
    id: request.id,
    sessionID: request.sessionID,
    tool: request.tool ?? undefined,
    questions: request.questions.map((question) => ({
      header: question.header,
      question: question.question,
      multiple: question.multiple ?? undefined,
      custom: question.custom ?? undefined,
      purpose: question.purpose ?? undefined,
      options: question.options.map((option) => ({ ...option })),
    })),
  }
}

// Presentation-only adaptation. Ownership is always the original native Session.
export function terminalRequestEvent(value: unknown): Event | undefined {
  const parsed = decode(value)
  if (Option.isNone(parsed)) return
  const event = parsed.value
  if (event.type === "permission.v2.asked")
    return {
      id: event.id,
      type: "permission.asked",
      properties: terminalPermission(Schema.encodeSync(Permission.Request)(event.data)),
    }
  if (event.type === "permission.v2.replied")
    return { id: event.id, type: "permission.replied", properties: { ...event.data } }
  if (event.type === "question.v2.asked")
    return {
      id: event.id,
      type: "question.asked",
      properties: terminalQuestion(Schema.encodeSync(Question.Request)(event.data)),
    }
  if (event.type === "question.v2.replied")
    return {
      id: event.id,
      type: "question.replied",
      properties: { ...event.data, answers: event.data.answers.map((answer) => [...answer]) },
    }
  return { id: event.id, type: "question.rejected", properties: { ...event.data } }
}

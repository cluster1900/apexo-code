import { Task } from "@apexo/schema/task"
import { SessionMessage } from "@apexo/schema/session-message"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import {
  ForbiddenError,
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "../errors"

export class TaskNotFoundError extends Schema.TaggedErrorClass<TaskNotFoundError>()(
  "TaskNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}
const root = "/api/session/:sessionID/task"
const target = { sessionID: SessionID, taskID: SessionID }
const error = [
  ForbiddenError,
  TaskNotFoundError,
  SessionNotFoundError,
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
]
export const TaskGroup = HttpApiGroup.make("server.task").add(
  HttpApiEndpoint.post("task.message.send", `${root}/:taskID/message`, {
    params: target,
    payload: Task.MessageInput,
    success: Task.MessageReceipt,
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.task.message.send" })),
  HttpApiEndpoint.get("task.message.get", `${root}/:taskID/message/:inputID`, {
    params: { ...target, inputID: SessionMessage.ID },
    success: Task.MessageReceipt,
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.task.message.get" })),
  HttpApiEndpoint.get("task.list", root, {
    params: { sessionID: SessionID },
    query: {
      limit: Schema.optional(
        Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
      ),
    },
    success: Schema.Array(Task.Summary),
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.task.list",
      description: "Owned Task summaries, newest child creation first. Default limit 50, maximum 100.",
    }),
  ),
  HttpApiEndpoint.get("task.output", `${root}/:taskID`, { params: target, success: Task.Detail, error }).annotateMerge(
    OpenApi.annotations({ identifier: "v2.task.output" }),
  ),
  HttpApiEndpoint.post("task.wait", `${root}/:taskID/wait`, {
    params: target,
    payload: Task.Wait,
    success: Task.WaitResult,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.task.wait",
      description: "Wait for an owned Task without waking model execution. Default timeout 30 seconds.",
    }),
  ),
  HttpApiEndpoint.post("task.cancel", `${root}/:taskID/cancel`, {
    params: target,
    success: HttpApiSchema.NoContent,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.task.cancel",
      description: "Cancel and join an owned Task. No request body.",
    }),
  ),
)

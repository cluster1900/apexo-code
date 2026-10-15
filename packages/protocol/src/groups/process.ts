import { SessionProcess } from "@apexo/schema/session-process"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError } from "../errors"

export class ProcessNotFoundError extends Schema.TaggedErrorClass<ProcessNotFoundError>()(
  "ProcessNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}
const root = "/api/session/:sessionID/process"
const target = { sessionID: SessionID, processID: SessionProcess.ID }
const error = [ProcessNotFoundError, SessionNotFoundError, ConflictError, InvalidRequestError, ServiceUnavailableError]
export const ProcessGroup = HttpApiGroup.make("server.process").add(
  HttpApiEndpoint.get("process.list", root, {
    params: { sessionID: SessionID },
    query: {
      limit: Schema.optional(
        Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
      ),
    },
    success: Schema.Array(SessionProcess.Summary),
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.process.list",
      description:
        "Owned shell process summaries, newest admission first. Still-starting entries are hidden. Default limit 50, maximum 100.",
    }),
  ),
  HttpApiEndpoint.get("process.output", `${root}/:processID`, {
    params: target,
    success: SessionProcess.Detail,
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.process.output" })),
  HttpApiEndpoint.post("process.wait", `${root}/:processID/wait`, {
    params: target,
    payload: SessionProcess.Wait,
    success: SessionProcess.WaitResult,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.process.wait",
      description: "Wait for an owned shell process without waking model execution. Default timeout 30 seconds.",
    }),
  ),
  HttpApiEndpoint.post("process.cancel", `${root}/:processID/cancel`, {
    params: target,
    success: HttpApiSchema.NoContent,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.process.cancel",
      description: "Cancel and join an owned shell process. No request body.",
    }),
  ),
)

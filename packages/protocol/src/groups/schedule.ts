import { SessionSchedule } from "@apexo/schema/session-schedule"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError } from "../errors"

export class ScheduleNotFoundError extends Schema.TaggedErrorClass<ScheduleNotFoundError>()(
  "ScheduleNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}
const root = "/api/session/:sessionID/schedule"
const params = { sessionID: SessionID, scheduleID: SessionSchedule.ID }
const error = [ScheduleNotFoundError, SessionNotFoundError, ConflictError, InvalidRequestError, ServiceUnavailableError]
export const ScheduleGroup = HttpApiGroup.make("server.schedule").add(
  HttpApiEndpoint.get("schedule.list", root, {
    params: { sessionID: SessionID },
    success: Schema.Array(SessionSchedule.Summary),
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.schedule.list",
      description:
        "Passive list of nonterminal owned schedule intent. Does not activate timers or replay interrupted work.",
    }),
  ),
  HttpApiEndpoint.get("schedule.get", `${root}/:scheduleID`, {
    params,
    success: SessionSchedule.Detail,
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.schedule.get" })),
  HttpApiEndpoint.delete("schedule.delete", `${root}/:scheduleID`, {
    params,
    success: HttpApiSchema.NoContent,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.schedule.delete",
      description: "Delete future schedule intent. Admitted Tasks remain independently controllable. No body.",
    }),
  ),
  HttpApiEndpoint.post("schedule.pause", `${root}/:scheduleID/pause`, {
    params,
    success: SessionSchedule.Detail,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.schedule.pause",
      description: "Pause future schedule intent without cancelling an already admitted Task. No body.",
    }),
  ),
  HttpApiEndpoint.post("schedule.resume", `${root}/:scheduleID/resume`, {
    params,
    success: SessionSchedule.Detail,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.schedule.resume",
      description:
        "Explicit future-only Resume. Revalidate authority and placement; never replay interrupted occurrences. No body.",
    }),
  ),
)

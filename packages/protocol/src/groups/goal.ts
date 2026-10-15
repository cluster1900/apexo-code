import { Goal } from "@apexo/schema/goal"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError } from "../errors"

export class GoalReportNotFoundError extends Schema.TaggedErrorClass<GoalReportNotFoundError>()(
  "GoalReportNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

const root = "/api/session/:sessionID/goal"
const target = { sessionID: SessionID, goalID: Goal.ID }
const error = [ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError]
export const GoalGroup = HttpApiGroup.make("server.goal")
  .add(
    HttpApiEndpoint.get("goal.get", root, {
      params: { sessionID: SessionID },
      success: Schema.NullOr(Goal.Info),
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.goal.get" })),
    HttpApiEndpoint.post("goal.create", root, {
      params: { sessionID: SessionID },
      payload: Goal.Create,
      success: Goal.Info,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.goal.create" })),
    HttpApiEndpoint.post("goal.start", `${root}/:goalID/start`, {
      params: target,
      payload: Goal.Start,
      success: Goal.Info,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.goal.start" })),
    HttpApiEndpoint.post("goal.run", `${root}/:goalID/run`, {
      params: target,
      success: Goal.Info,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.goal.run" })),
    HttpApiEndpoint.post("goal.resume", `${root}/:goalID/resume`, {
      params: target,
      success: Goal.Info,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.goal.resume" })),
    HttpApiEndpoint.post("goal.pause", `${root}/:goalID/pause`, {
      params: target,
      success: Goal.Info,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.goal.pause" })),
    HttpApiEndpoint.delete("goal.clear", `${root}/:goalID`, {
      params: target,
      success: HttpApiSchema.NoContent,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.goal.clear" })),
    HttpApiEndpoint.get("goal.reports", `${root}/:goalID/reports`, {
      params: target,
      success: Schema.Array(Goal.Report),
      error: [...error, GoalReportNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.goal.reports" })),
    HttpApiEndpoint.get("goal.report", `${root}/:goalID/reports/:reportID/:file`, {
      params: { ...target, reportID: Goal.ReportID, file: Goal.ReportFileKey },
      success: Goal.ReportContent,
      error: [...error, GoalReportNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.goal.report" })),
    HttpApiEndpoint.delete("goal.cleanupReports", `${root}/:goalID/reports`, {
      params: target,
      success: Goal.ReportCleanup,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.goal.cleanupReports" })),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "goal",
      description: "Native V2 persistent Goals and independently verified reports",
    }),
  )

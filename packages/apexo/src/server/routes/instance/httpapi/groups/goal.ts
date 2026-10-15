import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Goal } from "@apexo/schema/goal"
import { SessionID } from "@apexo/schema/session-id"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import {
  ApiNotFoundError,
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionBusyError,
} from "../errors"

const root = "/session/:sessionID/goal"
const error = [ApiNotFoundError, ConflictError, InvalidRequestError, ServiceUnavailableError, SessionBusyError]
const target = { sessionID: SessionID, goalID: Goal.ID }

export const GoalApi = HttpApi.make("goal").add(
  HttpApiGroup.make("goal")
    .add(
      HttpApiEndpoint.get("get", root, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        success: Schema.NullOr(Goal.Info),
        error,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "goal.get",
          summary: "Read the session goal without starting or recovering it",
        }),
      ),
      HttpApiEndpoint.post("create", root, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        payload: Goal.Create,
        success: Goal.Info,
        error,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "goal.create", summary: "Persist a goal without starting model execution" }),
      ),
      HttpApiEndpoint.post("start", `${root}/:goalID/start`, {
        params: target,
        query: WorkspaceRoutingQuery,
        payload: Goal.Start,
        success: Goal.Info,
        error,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "goal.start",
          summary: "Admit the objective with the selected model and start the goal, including in an empty session",
        }),
      ),
      HttpApiEndpoint.post("run", `${root}/:goalID/run`, {
        params: target,
        query: WorkspaceRoutingQuery,
        success: Goal.Info,
        error,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "goal.run",
          summary: "Start an active goal and acknowledge exclusive execution admission",
        }),
      ),
      HttpApiEndpoint.post("pause", `${root}/:goalID/pause`, {
        params: target,
        query: WorkspaceRoutingQuery,
        success: Goal.Info,
        error,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "goal.pause", summary: "Pause the goal and stop its owned execution" }),
      ),
      HttpApiEndpoint.post("resume", `${root}/:goalID/resume`, {
        params: target,
        query: WorkspaceRoutingQuery,
        success: Goal.Info,
        error,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "goal.resume", summary: "Explicitly resume and run a paused goal" }),
      ),
      HttpApiEndpoint.delete("clear", `${root}/:goalID`, {
        params: target,
        query: WorkspaceRoutingQuery,
        success: Schema.Boolean,
        error,
      }).annotateMerge(OpenApi.annotations({ identifier: "goal.clear", summary: "Stop and clear the specified goal" })),
      HttpApiEndpoint.get("reports", `${root}/:goalID/reports`, {
        params: target,
        query: WorkspaceRoutingQuery,
        success: Schema.Array(Goal.Report),
        error,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "goal.reports", summary: "List finalized and incomplete Goal reports" }),
      ),
      HttpApiEndpoint.get("report", `${root}/:goalID/reports/:reportID/:file`, {
        params: { ...target, reportID: Goal.ReportID, file: Goal.ReportFileKey },
        query: WorkspaceRoutingQuery,
        success: Goal.ReportContent,
        error,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "goal.report",
          summary: "Read a bounded, integrity-verified Goal report for viewing or download",
        }),
      ),
      HttpApiEndpoint.delete("cleanupReports", `${root}/:goalID/reports`, {
        params: target,
        query: WorkspaceRoutingQuery,
        success: Goal.ReportCleanup,
        error,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "goal.cleanupReports",
          summary: "Remove reports of a finished or cleared Goal; protect resumable Goals",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)

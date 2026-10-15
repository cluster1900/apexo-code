import { Workflow } from "@apexo/schema/workflow"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError } from "../errors"

export class WorkflowNotFoundError extends Schema.TaggedErrorClass<WorkflowNotFoundError>()(
  "WorkflowNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}
const root = "/api/session/:sessionID/workflow"
const target = { sessionID: SessionID, workflowID: Workflow.ID }
const error = [WorkflowNotFoundError, ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError]
export const WorkflowGroup = HttpApiGroup.make("server.workflow")
  .add(
    HttpApiEndpoint.get("workflow.related", `${root}/related`, {
      params: { sessionID: SessionID },
      success: Schema.Array(Workflow.Info),
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.related" })),
    HttpApiEndpoint.post("workflow.launch", `${root}/launch`, {
      params: { sessionID: SessionID },
      payload: Workflow.Launch,
      success: Workflow.Info,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.launch" })),
    HttpApiEndpoint.get("workflow.sources", `${root}/sources`, {
      params: { sessionID: SessionID },
      success: Schema.Array(Workflow.SourceEntry),
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.sources" })),
    HttpApiEndpoint.post("workflow.validate", `${root}/validate`, {
      params: { sessionID: SessionID },
      payload: Schema.Struct({ source: Workflow.Source }),
      success: Workflow.Validation,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.validate" })),
    HttpApiEndpoint.get("workflow.list", root, {
      params: { sessionID: SessionID },
      success: Schema.Array(Workflow.Info),
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.list" })),
    HttpApiEndpoint.post("workflow.start", root, {
      params: { sessionID: SessionID },
      payload: Workflow.Start,
      success: Workflow.Info,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.start" })),
    HttpApiEndpoint.get("workflow.get", `${root}/:workflowID`, {
      params: target,
      success: Workflow.Info,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.get" })),
    HttpApiEndpoint.post("workflow.resume", `${root}/:workflowID/resume`, {
      params: target,
      payload: Workflow.Resume,
      success: Workflow.Info,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.resume" })),
    HttpApiEndpoint.post("workflow.pause", `${root}/:workflowID/pause`, {
      params: target,
      success: Workflow.Info,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.pause" })),
    HttpApiEndpoint.post("workflow.stop", `${root}/:workflowID/stop`, {
      params: target,
      success: Workflow.Info,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.stop" })),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "workflow", description: "Apexo native workflows with independent child Sessions" }),
  )

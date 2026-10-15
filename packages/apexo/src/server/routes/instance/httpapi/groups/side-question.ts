import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { SideQuestion } from "@apexo/schema/side-question"
import { SessionID } from "@apexo/schema/session-id"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { ApiNotFoundError, ConflictError, InvalidRequestError, ServiceUnavailableError } from "../errors"

const root = "/session/:sessionID/side-question"
const error = [ApiNotFoundError, ConflictError, InvalidRequestError, ServiceUnavailableError]
export const SideQuestionApi = HttpApi.make("sideQuestion").add(
  HttpApiGroup.make("sideQuestion")
    .add(
      HttpApiEndpoint.get("list", root, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        success: Schema.Array(SideQuestion.Entry),
        error,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "sideQuestion.list",
          summary: "List this session's independent side questions",
        }),
      ),
      HttpApiEndpoint.post("ask", root, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        payload: SideQuestion.Input,
        success: SideQuestion.Entry,
        error,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "sideQuestion.ask",
          summary: "Start an independent side question without changing the conversation",
        }),
      ),
      HttpApiEndpoint.post("cancel", `${root}/:questionID/cancel`, {
        params: { sessionID: SessionID, questionID: SideQuestion.ID },
        query: WorkspaceRoutingQuery,
        success: SideQuestion.Entry,
        error,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "sideQuestion.cancel", summary: "Cancel only this side question" }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)

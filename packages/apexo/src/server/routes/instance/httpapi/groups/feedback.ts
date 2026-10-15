import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Feedback } from "@apexo/schema/feedback"
import { SessionID } from "@apexo/schema/session-id"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { ApiNotFoundError, ConflictError, InvalidRequestError, ServiceUnavailableError } from "../errors"

const root = "/session/:sessionID/feedback"
const error = [ApiNotFoundError, ConflictError, InvalidRequestError, ServiceUnavailableError]
const target = { sessionID: SessionID, draftID: Feedback.ID }

export const FeedbackApi = HttpApi.make("feedback").add(
  HttpApiGroup.make("feedback")
    .add(
      HttpApiEndpoint.get("list", root, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        success: Schema.Array(Feedback.Draft),
        error,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "feedback.list", summary: "List local feedback drafts for this session" }),
      ),
      HttpApiEndpoint.post("save", root, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        payload: Feedback.Save,
        success: Feedback.Draft,
        error,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "feedback.save",
          summary: "Save or replace a local feedback draft without submitting it",
        }),
      ),
      HttpApiEndpoint.post("review", `${root}/:draftID/review`, {
        params: target,
        query: WorkspaceRoutingQuery,
        payload: Feedback.Review,
        success: Feedback.Issue,
        error,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "feedback.review",
          summary: "Prepare the reviewed draft for the user to open in the issue form; never submit it",
        }),
      ),
      HttpApiEndpoint.post("image", `${root}/:draftID/image/:imageID`, {
        params: { ...target, imageID: Feedback.ImageID },
        query: WorkspaceRoutingQuery,
        payload: Feedback.Review,
        success: Feedback.ImageContent,
        error,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "feedback.image",
          summary: "Read an image from the exact reviewed draft revision",
        }),
      ),
      HttpApiEndpoint.delete("remove", `${root}/:draftID`, {
        params: target,
        query: WorkspaceRoutingQuery,
        payload: Feedback.Review,
        success: Schema.Boolean,
        error,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "feedback.remove",
          summary: "Delete the reviewed revision of a local feedback draft",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)

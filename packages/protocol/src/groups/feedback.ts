import { Feedback } from "@apexo/schema/feedback"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError } from "../errors"

export class FeedbackNotFoundError extends Schema.TaggedErrorClass<FeedbackNotFoundError>()(
  "FeedbackNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

const root = "/api/session/:sessionID/feedback"
const target = { sessionID: SessionID, draftID: Feedback.ID }
const error = [FeedbackNotFoundError, SessionNotFoundError, ConflictError, InvalidRequestError, ServiceUnavailableError]
export const FeedbackGroup = HttpApiGroup.make("server.feedback")
  .add(
    HttpApiEndpoint.get("feedback.list", root, {
      params: { sessionID: SessionID },
      success: Schema.Array(Feedback.Draft),
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.feedback.list", summary: "List local feedback drafts" })),
    HttpApiEndpoint.post("feedback.save", root, {
      params: { sessionID: SessionID },
      payload: Feedback.Save,
      success: Feedback.Draft,
      error,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.feedback.save",
        summary: "Save a local draft without submitting feedback",
      }),
    ),
    HttpApiEndpoint.post("feedback.review", `${root}/:draftID/review`, {
      params: target,
      payload: Feedback.Review,
      success: Feedback.Issue,
      error,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.feedback.review",
        summary: "Prepare an issue form from the reviewed draft revision",
      }),
    ),
    HttpApiEndpoint.post("feedback.image", `${root}/:draftID/image/:imageID`, {
      params: { ...target, imageID: Feedback.ImageID },
      payload: Feedback.Review,
      success: Feedback.ImageContent,
      error,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.feedback.image",
        summary: "Read an image from the exact reviewed draft revision",
      }),
    ),
    HttpApiEndpoint.delete("feedback.remove", `${root}/:draftID`, {
      params: target,
      payload: Feedback.Review,
      success: Schema.Boolean,
      error,
    }).annotateMerge(
      OpenApi.annotations({ identifier: "v2.feedback.remove", summary: "Delete the reviewed local draft revision" }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "feedback",
      description: "Apexo-owned local drafts; no automatic external submission",
    }),
  )

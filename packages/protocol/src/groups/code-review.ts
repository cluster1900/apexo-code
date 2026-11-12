import { CodeReview } from "@apexo/schema/code-review"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError } from "../errors"

const root = "/api/session/:sessionID/review"
const params = { sessionID: SessionID, reviewID: CodeReview.ID }
const error = [ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError]
export const CodeReviewGroup = HttpApiGroup.make("server.codeReview")
  .add(
    HttpApiEndpoint.post("codeReview.start", root, {
      params: { sessionID: SessionID },
      payload: CodeReview.Input,
      success: CodeReview.Run,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.codeReview.start" })),
    HttpApiEndpoint.get("codeReview.list", root, {
      params: { sessionID: SessionID },
      query: Schema.Struct({
        after: Schema.optional(CodeReview.ID),
        limit: Schema.optional(
          Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
        ),
      }),
      success: Schema.Struct({ data: Schema.Array(CodeReview.Run), hasMore: Schema.Boolean }),
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.codeReview.list" })),
    HttpApiEndpoint.get("codeReview.get", `${root}/:reviewID`, {
      params,
      query: Schema.Struct({ compareWorkspace: Schema.optional(Schema.Literal("true")) }),
      success: CodeReview.Run,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.codeReview.get" })),
    HttpApiEndpoint.get("codeReview.diff", `${root}/:reviewID/diff`, {
      params,
      success: Schema.Array(CodeReview.CapturedFile),
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.codeReview.diff" })),
    HttpApiEndpoint.post("codeReview.cancel", `${root}/:reviewID/cancel`, {
      params,
      success: CodeReview.Run,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.codeReview.cancel" })),
  )
  .annotateMerge(OpenApi.annotations({ title: "codeReview", description: "Frozen, read-only structured code reviews" }))

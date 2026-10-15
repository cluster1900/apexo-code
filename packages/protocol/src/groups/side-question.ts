import { SideQuestion } from "@apexo/schema/side-question"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError } from "../errors"

const root = "/api/session/:sessionID/side-question"
const error = [ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError]
export const SideQuestionGroup = HttpApiGroup.make("server.sideQuestion")
  .add(
    HttpApiEndpoint.get("sideQuestion.list", root, {
      params: { sessionID: SessionID },
      success: Schema.Array(SideQuestion.Entry),
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.sideQuestion.list" })),
    HttpApiEndpoint.post("sideQuestion.ask", root, {
      params: { sessionID: SessionID },
      payload: SideQuestion.Input,
      success: SideQuestion.Entry,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.sideQuestion.ask" })),
    HttpApiEndpoint.post("sideQuestion.cancel", `${root}/:questionID/cancel`, {
      params: { sessionID: SessionID, questionID: SideQuestion.ID },
      success: SideQuestion.Entry,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.sideQuestion.cancel" })),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "sideQuestion",
      description: "Independent side questions without modifying the Session transcript",
    }),
  )
